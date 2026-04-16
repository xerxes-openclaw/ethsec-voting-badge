import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { submissions } from "../db/schema.js";
import type { DB } from "../db/client.js";

const ParamsSchema = z.object({
  tokenId: z.string().regex(/^\d+$/, "tokenId must be a non-negative integer"),
});

/**
 * GET /token-status/:tokenId — has this badge tokenId already submitted a
 * voting address?
 *
 * Used by the FE to short-circuit the signing flow if the badge has been
 * spent. Authoritative truth still lives in the UNIQUE constraint at
 * /submit time.
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
      .where(eq(submissions.tokenId, tokenId))
      .limit(1);
    return { tokenId, used: rows.length > 0 };
  });
}
