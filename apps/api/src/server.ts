import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { loadEnv, type Env } from "./config.js";
import { makeDb, type DB } from "./db/client.js";
import { configRoute } from "./routes/config.js";
import { tokenStatusRoute } from "./routes/token-status.js";

export interface BuildServerOptions {
  /** Override the DB (used by tests with pg-mem). Defaults to {@link makeDb}(env.DATABASE_URL). */
  db?: DB;
  /** Override the env (used by tests). Defaults to {@link loadEnv}(). */
  env?: Env;
}

export async function buildServer(opts: BuildServerOptions = {}) {
  const env = opts.env ?? loadEnv();
  const db = opts.db ?? makeDb(env.DATABASE_URL);

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cors, { origin: env.CORS_ALLOWED_ORIGIN });
  await app.register(rateLimit, { max: 60, timeWindow: "1 minute" });

  app.get("/health", async () => ({ ok: true }));
  await configRoute(app, env);
  await tokenStatusRoute(app, db);

  return app;
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = loadEnv();
  const app = await buildServer({ env });
  app.listen({ port: env.PORT, host: "0.0.0.0" });
}
