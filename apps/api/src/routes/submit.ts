import type { FastifyInstance } from "fastify";
import type { Hex } from "viem";
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

    // 5. Persist. UNIQUE(token_id) is the authoritative duplicate check.
    try {
      await db.insert(submissions).values({
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
    } catch (e) {
      if (isUniqueViolation(e)) return reply.code(409).send({ error: "already_submitted" });
      req.log.error({ err: e }, "submit: insert failed");
      return reply.code(500).send({ error: "internal_error" });
    }

    return { ok: true, submittedAt: new Date().toISOString() };
  });
}
