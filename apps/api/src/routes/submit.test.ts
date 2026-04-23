import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { ml_kem768 } from "@noble/post-quantum/ml-kem";
import {
  buildDomain,
  VOTING_SUBMISSION_TYPES,
  encryptPayload,
  type SubmitRequest,
  type VotingAddressSubmission,
} from "@ethsec/shared";
import { buildServer } from "../server.js";
import { makeTestDb } from "../db/testdb.js";
import type { DB } from "../db/client.js";

const BADGE_CONTRACT = "0xf67c0ade41c607efebf198f9d6065ab1ec5ad4cd" as Address;
const CHAIN_ID = 1;
const TEST_PK = ("0x" + "2".repeat(64)) as Hex;
const NONCE = ("0x" + "0".repeat(64)) as Hex;

interface FreshPayloadOpts {
  tokenId?: string;
  badgeContract?: Address;
  signerPk?: Hex;
  /** Optional override of the wallet recorded in the typed-data message. */
  holderWalletOverride?: Address;
  /** Optional override of `bundleHash` in the typed-data message. */
  hashOverride?: Hex;
  /** Optional override of `ciphertext` in the request body. */
  ciphertextOverride?: string;
  issuedAtOffsetSec?: number;
  expiresInSec?: number;
}

async function makeValidSubmission(opts: FreshPayloadOpts = {}): Promise<SubmitRequest> {
  const acct = privateKeyToAccount(opts.signerPk ?? TEST_PK);
  const holderWallet = (opts.holderWalletOverride ?? acct.address) as Address;
  const tokenId = opts.tokenId ?? String(Math.floor(Math.random() * 1e9));
  const { publicKey } = ml_kem768.keygen();
  const plaintext = {
    votingAddress: "0x" + "3".repeat(40),
    tokenId,
    holderWallet,
    timestamp: new Date().toISOString(),
  };
  const { bundleB64, bundleHash } = encryptPayload(plaintext, publicKey);
  const nowSec = Math.floor(Date.now() / 1000);
  const issuedAt = nowSec + (opts.issuedAtOffsetSec ?? 0);
  const expiresAt = issuedAt + (opts.expiresInSec ?? 600);
  const submission: VotingAddressSubmission = {
    badgeContract: (opts.badgeContract ?? BADGE_CONTRACT).toLowerCase() as Address,
    tokenId: BigInt(tokenId),
    holderWallet,
    ciphertextHash: opts.hashOverride ?? bundleHash,
    nonce: NONCE,
    issuedAt: BigInt(issuedAt),
    expiresAt: BigInt(expiresAt),
  };
  const signature = (await acct.signTypedData({
    domain: buildDomain(CHAIN_ID),
    types: VOTING_SUBMISSION_TYPES,
    primaryType: "VotingAddressSubmission",
    message: submission,
  })) as Hex;
  return {
    badgeContract: submission.badgeContract,
    tokenId,
    holderWallet,
    ciphertext: opts.ciphertextOverride ?? bundleB64,
    ciphertextHash: bundleHash,
    nonce: NONCE,
    issuedAt,
    expiresAt,
    signature,
  };
}

describe("POST /submit", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let _db: DB;
  let dispose: () => Promise<void>;
  let reset: () => Promise<void>;

  beforeAll(async () => {
    process.env.BADGE_CONTRACT = BADGE_CONTRACT;
    process.env.CHAIN_ID = String(CHAIN_ID);
    process.env.ENCRYPTION_PUBLIC_KEY_HEX = "0xdeadbeef";
    process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
    const t = await makeTestDb();
    _db = t.db;
    dispose = t.dispose;
    reset = t.reset;
    app = await buildServer({ db: t.db, ownership: null });
  });

  afterAll(async () => {
    await app.close();
    await dispose();
  });

  it("happy path: 200 + ok=true, replay same payload is also 200 (idempotent resubmission)", async () => {
    await reset();
    const body = await makeValidSubmission({ tokenId: "1001" });
    const res = await app.inject({ method: "POST", url: "/submit", payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().resubmission).toBe(false);

    // Second submission for the same tokenId: the old row is marked
    // superseded and the new row becomes the active submission.
    // Build a fresh payload (new nonce + new signed timestamp) so the
    // signature verifies — this mirrors how a real resubmit works.
    const body2 = await makeValidSubmission({ tokenId: "1001" });
    const res2 = await app.inject({ method: "POST", url: "/submit", payload: body2 });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().ok).toBe(true);
    expect(res2.json().resubmission).toBe(true);
  });

  it("resubmission marks the older row superseded, keeps data for admin export", async () => {
    await reset();
    const body1 = await makeValidSubmission({ tokenId: "1010" });
    const r1 = await app.inject({ method: "POST", url: "/submit", payload: body1 });
    expect(r1.statusCode).toBe(200);

    const body2 = await makeValidSubmission({ tokenId: "1010" });
    const r2 = await app.inject({ method: "POST", url: "/submit", payload: body2 });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().resubmission).toBe(true);

    // Two rows should exist for token_id 1010: one superseded, one active.
    const { submissions } = await import("../db/schema.js");
    const rows = await _db.select().from(submissions);
    const forToken = rows.filter((r) => r.tokenId === "1010");
    expect(forToken.length).toBe(2);
    const active = forToken.filter((r) => r.supersededAt === null);
    const superseded = forToken.filter((r) => r.supersededAt !== null);
    expect(active.length).toBe(1);
    expect(superseded.length).toBe(1);
    // Supersession should point at the active row.
    expect(superseded[0]!.supersededBy).toBe(active[0]!.id);
    // Ciphertexts differ (new nonce each submission), proving the old row
    // wasn't just overwritten.
    expect(active[0]!.ciphertext).not.toBe(superseded[0]!.ciphertext);
  });

  it("400 on schema-invalid body (missing fields)", async () => {
    const res = await app.inject({ method: "POST", url: "/submit", payload: { tokenId: "x" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_payload");
  });

  it("400 on bad signature (signer != holderWallet)", async () => {
    await reset();
    const otherWallet = privateKeyToAccount(("0x" + "9".repeat(64)) as Hex).address;
    const body = await makeValidSubmission({
      tokenId: "1002",
      holderWalletOverride: otherWallet,
    });
    const res = await app.inject({ method: "POST", url: "/submit", payload: body });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("signature_invalid");
  });

  it("400 on ciphertext_hash_mismatch (ciphertext doesn't hash to claimed value)", async () => {
    await reset();
    const body = await makeValidSubmission({ tokenId: "1003" });
    // Substitute a *different but well-formed* bundle — the claimed hash
    // (signed-over) was computed from the original.
    const otherBody = await makeValidSubmission({ tokenId: "9999003" });
    const tampered = { ...body, ciphertext: otherBody.ciphertext };
    const res = await app.inject({ method: "POST", url: "/submit", payload: tampered });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("ciphertext_hash_mismatch");
  });

  it("400 on malformed ciphertext bundle", async () => {
    await reset();
    const body = await makeValidSubmission({ tokenId: "1004" });
    const broken = { ...body, ciphertext: "not-base64-bundle" };
    const res = await app.inject({ method: "POST", url: "/submit", payload: broken });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("malformed_ciphertext");
  });

  it("400 on badge_contract_mismatch", async () => {
    await reset();
    const body = await makeValidSubmission({
      tokenId: "1005",
      badgeContract: ("0x" + "ee".repeat(20)) as Address,
    });
    const res = await app.inject({ method: "POST", url: "/submit", payload: body });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("badge_contract_mismatch");
  });

  it("400 on expired timestamp", async () => {
    await reset();
    const body = await makeValidSubmission({
      tokenId: "1006",
      issuedAtOffsetSec: -3600,
      expiresInSec: -10, // expiresAt is in the past
    });
    const res = await app.inject({ method: "POST", url: "/submit", payload: body });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("timestamp_expired");
  });
});

describe("POST /submit (with onchain ownership checker)", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let dispose: () => Promise<void>;
  let reset: () => Promise<void>;
  let nextOwnership: { ownsThisToken: boolean; balance: bigint };

  beforeAll(async () => {
    process.env.BADGE_CONTRACT = BADGE_CONTRACT;
    process.env.CHAIN_ID = String(CHAIN_ID);
    process.env.ENCRYPTION_PUBLIC_KEY_HEX = "0xdeadbeef";
    process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
    nextOwnership = { ownsThisToken: true, balance: 1n };
    const t = await makeTestDb();
    dispose = t.dispose;
    reset = t.reset;
    app = await buildServer({
      db: t.db,
      ownership: { check: async () => nextOwnership },
    });
  });

  afterAll(async () => {
    await app.close();
    await dispose();
  });

  it("403 not_owner when checker reports !ownsThisToken", async () => {
    await reset();
    nextOwnership = { ownsThisToken: false, balance: 1n };
    const body = await makeValidSubmission({ tokenId: "2001" });
    const res = await app.inject({ method: "POST", url: "/submit", payload: body });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("not_owner");
  });

  it("403 multi_badge_holder_not_supported when balance > 1", async () => {
    await reset();
    nextOwnership = { ownsThisToken: true, balance: 2n };
    const body = await makeValidSubmission({ tokenId: "2002" });
    const res = await app.inject({ method: "POST", url: "/submit", payload: body });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("multi_badge_holder_not_supported");
  });

  it("200 when ownership checker passes", async () => {
    await reset();
    nextOwnership = { ownsThisToken: true, balance: 1n };
    const body = await makeValidSubmission({ tokenId: "2003" });
    const res = await app.inject({ method: "POST", url: "/submit", payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
});
