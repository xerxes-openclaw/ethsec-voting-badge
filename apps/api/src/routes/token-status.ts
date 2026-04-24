import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { submissions } from "../db/schema.js";
import type { DB } from "../db/client.js";

const ParamsSchema = z.object({
  tokenId: z.string().regex(/^\d+$/, "tokenId must be a non-negative integer"),
});

/**
 * GET /token-status/:tokenId — does this badge tokenId currently have an
 * active voting-address submission?
 *
 * "Active" means there is at least one submission row for the tokenId
 * where `superseded_at IS NULL`. Superseded rows (previous addresses that
 * have been replaced via resubmission) are intentionally ignored so the
 * FE can distinguish "never submitted" from "has a current vote on file".
 *
 * Authoritative write-side truth lives in the partial unique index on
 * `(token_id) WHERE superseded_at IS NULL` and is checked at /submit time.
 */
export async function tokenStatusRoute(app: FastifyInstance, db: DB): Promise<void> {
  app.get("/token-status/:tokenId", async (req, reply) => {
    const parsed = ParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_token_id", issues: parsed.error.issues });
    }
    const tokenId = parsed.data.tokenId;
    const rows = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(eq(submissions.tokenId, tokenId), isNull(submissions.supersededAt)))
      .limit(1);
    return { tokenId, used: rows.length > 0 };
  });
}
