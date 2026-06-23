import type { FastifyInstance } from "fastify";
import type { Hex } from "viem";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { SubmitRequestSchema, type VotingAddressSubmission } from "@ethsec/shared";
import {
  verifyCiphertextHash,
  verifySignature,
  verifyTimestampWindow,
  type SignatureVerifier,
} from "../verify.js";
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
  /**
   * Optional EIP-712 signature verifier. When present, smart-contract
   * wallets (Safe and other ERC-1271 wallets) are accepted; when null,
   * only ECDSA signatures recover-and-match against `holderWallet`.
   */
  verifier?: SignatureVerifier | null;
}

export async function submitRoute(app: FastifyInstance, deps: SubmitRouteDeps): Promise<void> {
  const { db, env, ownership, verifier } = deps;

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

    // 3. EIP-712 signature. With a `verifier` (production), smart-contract
    //    wallets are checked via ERC-1271 in addition to ECDSA recovery;
    //    without one (tests, no-RPC envs), only ECDSA wallets pass.
    const sigCheck = await verifySignature(env.CHAIN_ID, submission, p.signature as Hex, verifier);
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
    // the partial unique index `(token_id) WHERE superseded_at IS NULL`.
    //
    // **Critical ordering**: the UPDATE must run BEFORE the INSERT. If we
    // INSERT first with `superseded_at IS NULL`, the partial unique index
    // sees two (token_id, NULL) slots for a single moment — the old row
    // and the new one — and rejects the INSERT with 23505 before the
    // UPDATE can clear the old slot. Fix: pre-generate the new row's id
    // so we can set `superseded_by = newId` on the old row first, then
    // insert the new row into the (now-freed) active slot.
    const newId = randomUUID();
    let resubmission = false;
    try {
      await db.transaction(async (tx) => {
        const existing = await tx
          .select({ id: submissions.id })
          .from(submissions)
          .where(and(eq(submissions.tokenId, p.tokenId), isNull(submissions.supersededAt)))
          .limit(1);

        if (existing.length > 0) {
          resubmission = true;
          // `isNull(supersededAt)` on the UPDATE is intentional belt-and-
          // suspenders: under concurrent submissions for the same token_id
          // both transactions may have SELECT'd the same "active" row; one
          // commits its supersession first, and this guard makes the second
          // UPDATE a no-op (0 rows matched) instead of silently overwriting
          // the first supersession's metadata. Either way both transactions
          // still converge on the partial-unique-index check at INSERT.
          await tx
            .update(submissions)
            .set({ supersededAt: sql`now()`, supersededBy: newId })
            .where(and(eq(submissions.id, existing[0]!.id), isNull(submissions.supersededAt)));
        }

        await tx.insert(submissions).values({
          id: newId,
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
        });
      });
    } catch (e) {
      // A unique_violation here means two concurrent transactions both
      // saw no active row, UPDATE'd the same (non-existent) old row, and
      // tried to INSERT their new row simultaneously. The partial index
      // rejects one. Treat as "re-send", don't surface 500.
      if (isUniqueViolation(e)) {
        return reply.code(409).send({ error: "concurrent_submission_retry" });
      }
      req.log.error({ err: e }, "submit: insert failed");
      return reply.code(500).send({ error: "internal_error" });
    }

    return { ok: true, submittedAt: new Date().toISOString(), resubmission };
  });
}
