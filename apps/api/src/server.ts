import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { migrate } from "drizzle-orm/node-postgres/migrator";
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
 * Run Drizzle migrations on boot so a fresh deploy comes up with the
 * `submissions` table already in place. Idempotent — Drizzle tracks
 * applied migrations in `__drizzle_migrations`. Skipped entirely when a
 * test injects its own DB.
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
    return;
  }
  await migrate(db, { migrationsFolder });
}

export async function buildServer(opts: BuildServerOptions = {}) {
  const env = opts.env ?? loadEnv();
  const db = opts.db ?? makeDb(env.DATABASE_URL);

  // Only run migrations when the DB was built from env (i.e. real
  // production / dev Postgres). Tests inject their own DB and skip this.
  // If the DB is unreachable at boot, don't crash — the server still
  // needs to answer /health and /config (which is env-only). Routes that
  // actually touch the DB will surface their own errors later.
  if (!opts.db) {
    try {
      await ensureSchema(db);
    } catch (err) {
      console.error("[boot] migration skipped:", err instanceof Error ? err.message : err);
    }
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
