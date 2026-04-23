import { newDb, DataType } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
import type { DB } from "./client.js";

/**
 * Build a fresh in-memory Postgres-compatible database (via pg-mem) and
 * return a Drizzle DB plus `reset()` and `dispose()` helpers.
 *
 * Implementation notes:
 * - We use `pg-mem`'s `createPg()` adapter, which exposes a node-postgres
 *   `Pool` that talks directly to pg-mem in-process (no TCP). We then
 *   patch the Pool to accept Drizzle's `rowMode: "array"` queries — pg-mem
 *   doesn't natively support that mode but we can emulate it by ordering
 *   the object-shaped result back into arrays using the row's own keys.
 * - The schema mirrors what `drizzle-kit generate` produced for `submissions`
 *   (kept in `drizzle/0000_*.sql`). pg-mem doesn't run drizzle migrations
 *   directly so we replay the equivalent CREATE TABLE here. If `db/schema.ts`
 *   changes, mirror it here too.
 */
export async function makeTestDb(): Promise<{
  db: DB;
  reset: () => Promise<void>;
  dispose: () => Promise<void>;
}> {
  const mem = newDb({ autoCreateForeignKeyIndices: true });

  // pg-mem doesn't ship gen_random_uuid().
  let uuidCounter = 0;
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => {
      uuidCounter += 1;
      const seq = uuidCounter.toString(16).padStart(12, "0").slice(-12);
      return `00000000-0000-4000-8000-${seq}`;
    },
  });

  // Create the submissions table — must mirror drizzle schema in `db/schema.ts`.
  // The partial unique index on (token_id) WHERE superseded_at IS NULL
  // isn't declared here because pg-mem's partial-index support is limited.
  // Application logic guarantees at-most-one active row per token_id; the
  // index is there for safety in real Postgres, not to support tests.
  mem.public.none(`
    CREATE TABLE submissions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      token_id text NOT NULL,
      holder_wallet text NOT NULL,
      signature text NOT NULL,
      signature_payload_json jsonb NOT NULL,
      ciphertext text NOT NULL,
      ciphertext_hash text NOT NULL,
      nonce text NOT NULL,
      submitted_at timestamp with time zone DEFAULT now() NOT NULL,
      superseded_at timestamp with time zone,
      superseded_by uuid
    );
  `);

  const { Pool } = mem.adapters.createPg();
  const pool = patchPoolForRowModeArray(new Pool());
  const db = drizzle(pool as never, { schema });

  const reset = async () => {
    mem.public.none("TRUNCATE submissions");
  };

  const dispose = async () => {
    // pg-mem's pool doesn't actually own anything, but call end() to be polite.
    try {
      await pool.end?.();
    } catch {
      /* noop */
    }
  };

  return { db, reset, dispose };
}

/**
 * Drizzle's node-postgres driver issues queries with `rowMode: "array"` so
 * column-name collisions (e.g. SELECT a.id, b.id) don't clobber. pg-mem
 * doesn't support this mode, but we can shim it: run the query in normal
 * (object) mode and reshape the result here.
 */
function patchPoolForRowModeArray<T extends { query: (...a: unknown[]) => unknown }>(pool: T): T {
  const original = pool.query.bind(pool);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pool as any).query = async function patched(arg: any, values?: unknown, cb?: unknown) {
    const wantsArray = arg && typeof arg === "object" && arg.rowMode === "array";
    if (!wantsArray) return original(arg, values as never, cb as never);
    const { rowMode: _rm, ...rest } = arg;
    const result = (await original(rest, values as never)) as {
      rows: Record<string, unknown>[];
      rowCount?: number;
      command?: string;
    };
    const sample = result.rows[0];
    const keys = sample ? Object.keys(sample) : [];
    return {
      rows: result.rows.map((r) => keys.map((k) => r[k])),
      rowCount: result.rowCount ?? result.rows.length,
      command: result.command ?? "SELECT",
      fields: keys.map((name) => ({ name })),
    };
  };
  return pool;
}
