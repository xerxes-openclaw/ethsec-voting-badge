import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../server.js";
import { makeTestDb } from "../db/testdb.js";
import { submissions } from "../db/schema.js";
import type { DB } from "../db/client.js";

describe("GET /token-status/:tokenId", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let db: DB;
  let dispose: () => Promise<void>;
  let reset: () => Promise<void>;

  beforeAll(async () => {
    process.env.BADGE_CONTRACT = "0xf67c0ade41c607efebf198f9d6065ab1ec5ad4cd";
    process.env.CHAIN_ID = "1";
    process.env.ENCRYPTION_PUBLIC_KEY_HEX = "0xdeadbeef";
    process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
    const test = await makeTestDb();
    db = test.db;
    dispose = test.dispose;
    reset = test.reset;
    app = await buildServer({ db, ownership: null });
  });

  afterAll(async () => {
    await app.close();
    await dispose();
  });

  it("returns used:false for fresh token", async () => {
    await reset();
    const res = await app.inject({ method: "GET", url: "/token-status/9999999" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tokenId: "9999999", used: false });
  });

  it("returns used:true once a row is inserted", async () => {
    await reset();
    await db.insert(submissions).values({
      tokenId: "12345",
      holderWallet: "0x" + "a".repeat(40),
      signature: "0x" + "b".repeat(130),
      signaturePayloadJson: {},
      ciphertext: "ct",
      ciphertextHash: "0x" + "c".repeat(64),
      nonce: "0x" + "d".repeat(64),
    });
    const res = await app.inject({ method: "GET", url: "/token-status/12345" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tokenId: "12345", used: true });
  });

  it("rejects non-numeric tokenId with 400", async () => {
    const res = await app.inject({ method: "GET", url: "/token-status/abc" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeDefined();
  });

  it("rejects very large but-still-numeric tokenId (lets it pass; uniqueness handled at /submit)", async () => {
    const huge = "1" + "0".repeat(70);
    const res = await app.inject({ method: "GET", url: `/token-status/${huge}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().used).toBe(false);
  });
});
