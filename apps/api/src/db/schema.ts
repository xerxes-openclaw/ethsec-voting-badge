import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * `submissions` — one row per encrypted voting-address bundle.
 *
 * Holders may resubmit with a fresh voting address. The old row is NOT
 * deleted; instead it is marked `superseded_at = now()` with
 * `superseded_by` pointing at the newer row's `id`. The admin export
 * surfaces the full history. The uniqueness guarantee is moved onto the
 * *active* submission — there is at most one row per `token_id` with
 * `superseded_at IS NULL`, enforced by a partial unique index.
 *
 * `tokenId` is `text` rather than `numeric` so the JS shape is stable across
 * the production driver and the in-memory test DB (pg-mem returns `numeric`
 * as a JS `number`, real Postgres via node-postgres returns `string`).
 * ERC-721 tokenIds are at most uint256 anyway — text storage is exact.
 */
export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenId: text("token_id").notNull(),
    holderWallet: text("holder_wallet").notNull(),
    signature: text("signature").notNull(),
    signaturePayloadJson: jsonb("signature_payload_json").notNull(),
    ciphertext: text("ciphertext").notNull(),
    ciphertextHash: text("ciphertext_hash").notNull(),
    nonce: text("nonce").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    supersededBy: uuid("superseded_by"),
  },
  (t) => ({
    /**
     * Partial unique index: at most one ACTIVE submission per token_id.
     * Historical (superseded) rows are ignored by the uniqueness check.
     * Lookup for the active row stays O(index-scan).
     */
    activeSubmissionUniq: uniqueIndex("submissions_active_token_id_uniq")
      .on(t.tokenId)
      .where(sql`${t.supersededAt} IS NULL`),
  }),
);

export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
