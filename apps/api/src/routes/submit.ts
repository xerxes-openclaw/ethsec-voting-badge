import type { FastifyInstance } from "fastify";
import type { Hex } from "viem";
import { and, eq, isNull, sql } from "drizzle-orm";
import { SubmitRequestSchema, type VotingAddressSubmission } from "@ethsec/shared";
import { verifyCiphertextHash, verifySignature, verifyTimestampWindow } from "../verify.js";
import { decodeBundle } from "@ethsec/shared";
import { submissions } from "../db/schema.js";
import type { DB } from "../db/client.js";
import type { Env } from "../config.js";
import type { OwnershipChecker } from "../onchain.js";

/** Recognise pg unique_violation (SQLSTATE 23505) regardless of driver. */
function isUniqueViolation(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const msg = (e as { message?: string }).message ?? "";
  const code = (e as { code?: string }).code;
  return code === "23505" || /duplicate key|unique/i.test(msg);
}

export interface SubmitRouteDeps {
  db: DB;
  env: Env;
  /**
   * Optional onchain ownership check. If omitted (Task 3.5 stub) the route
   * skips the check; Task 3.6 wires in viem-backed verification.
   */
  ownership?: OwnershipChecker | null;
}

export async function submitRoute(app: FastifyInstance, deps: SubmitRouteDeps): Promise<void> {
  const { db, env, ownership } = deps;

  app.post("/submit", async (req, reply) => {
    const parsed = SubmitRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.issues });
    }
    const p = parsed.data;

    // Reject early if the badge contract in the payload doesn't match server config.
    if (p.badgeContract.toLowerCase() !== env.BADGE_CONTRACT.toLowerCase()) {
      return reply.code(400).send({ error: "badge_contract_mismatch" });
    }

    // Decode the ciphertext bundle so we fail fast on obviously-malformed input.
    try {
      decodeBundle(p.ciphertext);
    } catch {
      return reply.code(400).send({ error: "malformed_ciphertext" });
    }

    // 1. Ciphertext hash must match what the user signed.
    const ciphertextHash = p.ciphertextHash as Hex;
    const nonce = p.nonce as Hex;
    const hashCheck = verifyCiphertextHash(p.ciphertext, ciphertextHash);
    if (hashCheck.kind !== "ok") {
      return reply.code(400).send({ error: hashCheck.kind });
    }

    const submission: VotingAddressSubmission = {
      badgeContract: env.BADGE_CONTRACT.toLowerCase() as `0x${string}`,
      tokenId: BigInt(p.tokenId),
      holderWallet: p.holderWallet,
      ciphertextHash,
      nonce,
      issuedAt: BigInt(p.issuedAt),
      expiresAt: BigInt(p.expiresAt),
    };

    // 2. Timestamp window.
    const tsCheck = verifyTimestampWindow(
      submission.issuedAt,
      submission.expiresAt,
      BigInt(Math.floor(Date.now() / 1000)),
    );
    if (tsCheck.kind !== "ok") {
      return reply.code(400).send({ error: tsCheck.kind });
    }

    // 3. EIP-712 signature.
    const sigCheck = await verifySignature(env.CHAIN_ID, submission, p.signature as Hex);
    if (sigCheck.kind !== "ok") {
      return reply.code(400).send({ error: sigCheck.kind });
    }

    // 4. Onchain ownership (Task 3.6). When `ownership` is null, skip — used
    //    in Task 3.5 tests and in environments without an RPC URL configured.
    if (ownership) {
      const own = await ownership.check(submission.tokenId, submission.holderWallet);
      if (!own.ownsThisToken) return reply.code(403).send({ error: "not_owner" });
      // Multi-badge holders can't submit — one holder, one voting address.
      // Balance 0 is already caught by !ownsThisToken above; this only
      // fires when balance > 1.
      if (own.balance > 1n) {
        return reply.code(403).send({ error: "multi_badge_holder_not_supported" });
      }
    }

    // 5. Persist — with resubmission semantics.
    //
    // Holders may replace their voting address after an initial submission.
    // The previous row is NOT deleted; it's marked `superseded_at = now()`
    // with `superseded_by` pointing at the new row. Admin export surfaces
    // the full history. At most one ACTIVE row per token_id is enforced by
    // the partial unique index in the schema.
    //
    // Strategy: do both writes in a transaction so a replay of the old row
    // being superseded can't orphan the system if the insert fails.
    let resubmission = false;
    try {
      await db.transaction(async (tx) => {
        const existing = await tx
          .select({ id: submissions.id })
          .from(submissions)
          .where(and(eq(submissions.tokenId, p.tokenId), isNull(submissions.supersededAt)))
          .limit(1);

        const inserted = await tx
          .insert(submissions)
          .values({
            tokenId: p.tokenId,
            holderWallet: p.holderWallet,
            signature: p.signature,
            signaturePayloadJson: {
              badgeContract: submission.badgeContract,
              tokenId: submission.tokenId.toString(),
              holderWallet: submission.holderWallet,
              ciphertextHash: submission.ciphertextHash,
              nonce: submission.nonce,
              issuedAt: submission.issuedAt.toString(),
              expiresAt: submission.expiresAt.toString(),
            },
            ciphertext: p.ciphertext,
            ciphertextHash: p.ciphertextHash,
            nonce: p.nonce,
          })
          .returning({ id: submissions.id });

        const newId = inserted[0]?.id;
        if (!newId) throw new Error("insert returned no id");

        if (existing.length > 0) {
          resubmission = true;
          await tx
            .update(submissions)
            .set({ supersededAt: sql`now()`, supersededBy: newId })
            .where(eq(submissions.id, existing[0]!.id));
        }
      });
    } catch (e) {
      // A unique_violation here means two concurrent inserts raced on the
      // partial unique index. Treat as "re-send", don't surface 500.
      if (isUniqueViolation(e)) {
        return reply.code(409).send({ error: "concurrent_submission_retry" });
      }
      req.log.error({ err: e }, "submit: insert failed");
      return reply.code(500).send({ error: "internal_error" });
    }

    return { ok: true, submittedAt: new Date().toISOString(), resubmission };
  });
}
