import type { FastifyInstance } from "fastify";
import { submissions } from "../db/schema.js";
import type { DB } from "../db/client.js";
import type { Env } from "../config.js";

const CSV_HEADER =
  "id,token_id,holder_wallet,signature,ciphertext,ciphertext_hash,nonce,submitted_at,superseded_at,superseded_by";

function csvField(s: unknown): string {
  const str = s == null ? "" : String(s);
  return `"${str.replace(/"/g, '""')}"`;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * GET /admin/export — bearer-auth CSV dump of all submissions.
 *
 * Consumed by the offline decryption script (Phase 6) which holds the
 * private key. The endpoint is disabled when `ADMIN_EXPORT_TOKEN` is unset.
 */
export async function adminExportRoute(
  app: FastifyInstance,
  db: DB,
  env: Env,
): Promise<void> {
  app.get("/admin/export", async (req, reply) => {
    const expected = env.ADMIN_EXPORT_TOKEN;
    if (!expected) {
      return reply.code(401).send({ error: "admin_export_disabled" });
    }
    const auth = req.headers.authorization ?? "";
    const prefix = "Bearer ";
    if (!auth.startsWith(prefix) || !constantTimeEqual(auth.slice(prefix.length), expected)) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const rows = await db.select().from(submissions);
    const lines = rows.map((r) =>
      [
        r.id,
        r.tokenId,
        r.holderWallet,
        r.signature,
        r.ciphertext,
        r.ciphertextHash,
        r.nonce,
        r.submittedAt instanceof Date ? r.submittedAt.toISOString() : String(r.submittedAt),
        r.supersededAt instanceof Date ? r.supersededAt.toISOString() : (r.supersededAt ?? ""),
        r.supersededBy ?? "",
      ]
        .map(csvField)
        .join(","),
    );
    reply.header("content-type", "text/csv; charset=utf-8");
    return [CSV_HEADER, ...lines].join("\n");
  });
}
