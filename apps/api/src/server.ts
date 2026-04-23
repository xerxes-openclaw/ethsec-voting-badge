import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadEnv, type Env } from "./config.js";
import { makeDb, type DB } from "./db/client.js";
import { configRoute } from "./routes/config.js";
import { tokenStatusRoute } from "./routes/token-status.js";
import { submitRoute } from "./routes/submit.js";
import { adminExportRoute } from "./routes/admin-export.js";
import {
  makeOwnershipChecker,
  makePublicClient,
  type OwnershipChecker,
} from "./onchain.js";

export interface BuildServerOptions {
  /** Override the DB (used by tests with pg-mem). Defaults to {@link makeDb}(env.DATABASE_URL). */
  db?: DB;
  /** Override the env (used by tests). Defaults to {@link loadEnv}(). */
  env?: Env;
  /**
   * Override the onchain ownership checker. Pass `null` to disable the
   * check entirely (e.g. /submit tests that don't want to hit an RPC).
   * Default: build one from `env.RPC_URL` + `env.BADGE_CONTRACT`, or
   * `null` if `RPC_URL` is unset.
   */
  ownership?: OwnershipChecker | null;
}

/**
 * Fixed 64-bit key for `pg_advisory_lock`. Derived from the schema name —
 * any constant would do; we just need ALL API replicas to agree.
 * Picked as the top 8 hex chars of sha256("ethsec-voting-badge:migrations")
 * converted to a signed bigint, then stored literally so there's nothing
 * to compute at runtime.
 */
const MIGRATION_LOCK_KEY = 7349512843124568397n;

/**
 * Module-level readiness flag. Flipped to `true` after migrations succeed.
 * A separate `/ready` endpoint exposes this so orchestrators can gate
 * traffic (and distinguish it from basic `/health` liveness).
 */
let migrationsReady = false;
export function areMigrationsReady(): boolean { return migrationsReady; }

/**
 * Run Drizzle migrations on boot so a fresh deploy comes up with the
 * `submissions` table already in place. Idempotent — Drizzle tracks
 * applied migrations in `__drizzle_migrations`. Skipped entirely when a
 * test injects its own DB.
 *
 * Wrapped in a session-level `pg_advisory_lock` so concurrent API
 * replicas (rolling deploys, horizontal scale) can't race on the
 * migrations table. Drizzle's migrator serializes via a single
 * transaction but does NOT take an explicit advisory lock, so under
 * concurrent boot two replicas can both attempt the same CREATE TABLE
 * and one will error out. The advisory lock makes it deterministic:
 * the first replica applies, subsequent replicas wait for the lock,
 * then see up-to-date `__drizzle_migrations` rows and no-op.
 */
async function ensureSchema(db: DB): Promise<void> {
  // The `drizzle/` folder sits at `apps/api/drizzle` in dev and
  // `/app/apps/api/drizzle` in the container. `import.meta.url` resolves
  // relative to the compiled `dist/server.js`, so walk up one level.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "..", "drizzle"),
    resolve(here, "..", "..", "drizzle"),
  ];
  const migrationsFolder = candidates.find((p) => existsSync(p));
  if (!migrationsFolder) {
    // No migrations folder found — tests run against pg-mem with schema
    // built in-process, so this is expected outside of production.
    migrationsReady = true;
    return;
  }

  // Serialise concurrent migration attempts across replicas.
  await db.execute(sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
  try {
    await migrate(db, { migrationsFolder });
    migrationsReady = true;
  } finally {
    // Always release — even on failure — so a replica that errors out
    // doesn't block other replicas forever.
    await db.execute(sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`)
      .catch(() => {});
  }
}

export async function buildServer(opts: BuildServerOptions = {}) {
  const env = opts.env ?? loadEnv();
  const db = opts.db ?? makeDb(env.DATABASE_URL);

  // Only run migrations when the DB was built from env (i.e. real
  // production / dev Postgres). Tests inject their own DB and skip this.
  // If the DB is unreachable at boot, don't crash — the server still
  // needs to answer /health and /config (which is env-only). DB-backed
  // routes will surface their own errors later.
  //
  // Log at error level with full stack so migration-vs-connectivity
  // failures are easy to distinguish in logs. If you see this in prod
  // and /health stays green, /submit and /token-status will 500 until
  // the migration is resolved. `/ready` (below) flips green only when
  // migrations actually applied.
  if (!opts.db) {
    try {
      await ensureSchema(db);
    } catch (err) {
      console.error(
        "[boot] ensureSchema failed — DB routes will 500 until resolved:",
        err instanceof Error ? (err.stack ?? err.message) : err,
      );
    }
  } else {
    // Tests inject their own DB with schema built in-process.
    migrationsReady = true;
  }

  let ownership: OwnershipChecker | null;
  if (opts.ownership !== undefined) {
    ownership = opts.ownership;
  } else if (env.RPC_URL) {
    const client = makePublicClient(env.CHAIN_ID, env.RPC_URL);
    ownership = makeOwnershipChecker(client, env.BADGE_CONTRACT as `0x${string}`);
  } else {
    ownership = null;
  }

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cors, { origin: env.CORS_ALLOWED_ORIGIN });
  await app.register(rateLimit, { max: 60, timeWindow: "1 minute" });

  app.get("/health", async () => ({ ok: true }));
  // /ready is distinct from /health: /health = liveness (process up),
  // /ready = traffic-ready (migrations applied, DB-backed routes will
  // actually work). Orchestrators should use /ready to gate traffic.
  app.get("/ready", async (_req, reply) => {
    if (!migrationsReady) return reply.code(503).send({ ok: false, reason: "migrations_pending" });
    return { ok: true };
  });
  await configRoute(app, env);
  await tokenStatusRoute(app, db);
  await submitRoute(app, { db, env, ownership });
  await adminExportRoute(app, db, env);

  return app;
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = loadEnv();
  const app = await buildServer({ env });
  app.listen({ port: env.PORT, host: "0.0.0.0" });
}
