import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../server.js";
import { makeTestDb } from "../db/testdb.js";
import { submissions } from "../db/schema.js";
import type { DB } from "../db/client.js";

const TOKEN = "test_admin_token_xxxxxxxxxxxxxxxx";

describe("GET /admin/export", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let db: DB;
  let dispose: () => Promise<void>;
  let reset: () => Promise<void>;

  beforeAll(async () => {
    process.env.BADGE_CONTRACT = "0xf67c0ade41c607efebf198f9d6065ab1ec5ad4cd";
    process.env.CHAIN_ID = "1";
    process.env.ENCRYPTION_PUBLIC_KEY_HEX = "0xdeadbeef";
    process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
    process.env.ADMIN_EXPORT_TOKEN = TOKEN;
    const t = await makeTestDb();
    db = t.db;
    dispose = t.dispose;
    reset = t.reset;
    app = await buildServer({ db: t.db, ownership: null });
  });

  afterAll(async () => {
    await app.close();
    await dispose();
    delete process.env.ADMIN_EXPORT_TOKEN;
  });

  it("401 without token", async () => {
    const r = await app.inject({ method: "GET", url: "/admin/export" });
    expect(r.statusCode).toBe(401);
  });

  it("401 with wrong token", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/admin/export",
      headers: { authorization: "Bearer wrong-token-aaaaaaaaaaaaaaaa" },
    });
    expect(r.statusCode).toBe(401);
  });

  it("200 with token, returns CSV with header even when empty", async () => {
    await reset();
    const r = await app.inject({
      method: "GET",
      url: "/admin/export",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/csv/);
    const lines = r.body.split("\n");
    expect(lines[0]).toBe(
      "id,token_id,holder_wallet,signature,ciphertext,ciphertext_hash,nonce,submitted_at,superseded_at,superseded_by",
    );
    expect(lines).toHaveLength(1); // just the header
  });

  it("200 returns inserted rows escaped properly", async () => {
    await reset();
    await db.insert(submissions).values({
      tokenId: "555",
      holderWallet: "0x" + "a".repeat(40),
      signature: "0x" + "b".repeat(130),
      signaturePayloadJson: { tricky: 'has "quotes" and , commas' },
      ciphertext: 'has "quotes"',
      ciphertextHash: "0x" + "c".repeat(64),
      nonce: "0x" + "d".repeat(64),
    });
    const r = await app.inject({
      method: "GET",
      url: "/admin/export",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.statusCode).toBe(200);
    const lines = r.body.trim().split("\n");
    expect(lines).toHaveLength(2);
    // every field is wrapped in quotes; embedded quotes are doubled.
    expect(lines[1]).toContain('"555"');
    expect(lines[1]).toContain('"has ""quotes"""');
  });
});
