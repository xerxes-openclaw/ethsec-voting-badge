import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
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
   * check entirely (e.g. tests that don't want to hit an RPC).
   *
   * When omitted, production/default startup must have `RPC_URL` so the
   * server can enforce badge ownership on `/submit`.
   */
  ownership?: OwnershipChecker | null;
}

export async function buildServer(opts: BuildServerOptions = {}) {
  const env = opts.env ?? loadEnv();
  const db = opts.db ?? makeDb(env.DATABASE_URL);

  let ownership: OwnershipChecker | null;
  if (opts.ownership !== undefined) {
    ownership = opts.ownership;
  } else if (env.RPC_URL) {
    const client = makePublicClient(env.CHAIN_ID, env.RPC_URL);
    ownership = makeOwnershipChecker(client, env.BADGE_CONTRACT as `0x${string}`);
  } else {
    throw new Error(
      "RPC_URL is required unless buildServer() is given an explicit ownership override. " +
        "Refusing to start with onchain ownership checks disabled.",
    );
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
