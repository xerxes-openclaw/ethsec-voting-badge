import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { ml_kem768 } from "@noble/post-quantum/ml-kem";
import {
  buildDomain,
  VOTING_SUBMISSION_TYPES,
  encryptPayload,
  type VotingAddressSubmission,
} from "@ethsec/shared";
import { verifyCiphertextHash, verifySignature, verifyTimestampWindow } from "./verify.js";

const TEST_PK = ("0x" + "1".repeat(64)) as `0x${string}`;

describe("verifyCiphertextHash", () => {
  it("ok for matching hash", () => {
    const { publicKey } = ml_kem768.keygen();
    const { bundleB64, bundleHash } = encryptPayload({ a: 1 }, publicKey);
    expect(verifyCiphertextHash(bundleB64, bundleHash).kind).toBe("ok");
  });

  it("rejects mismatched hash", () => {
    const r = verifyCiphertextHash("hello", ("0x" + "0".repeat(64)) as `0x${string}`);
    expect(r.kind).toBe("ciphertext_hash_mismatch");
  });

  it("hash check is case-insensitive on the claimed hash", () => {
    const { publicKey } = ml_kem768.keygen();
    const { bundleB64, bundleHash } = encryptPayload({ a: 1 }, publicKey);
    const upper = ("0x" + bundleHash.slice(2).toUpperCase()) as `0x${string}`;
    expect(verifyCiphertextHash(bundleB64, upper).kind).toBe("ok");
  });
});

describe("verifySignature", () => {
  it("ok for a valid signature round-trip", async () => {
    const acct = privateKeyToAccount(TEST_PK);
    const { publicKey } = ml_kem768.keygen();
    const { bundleHash } = encryptPayload({ a: 1 }, publicKey);
    const submission: VotingAddressSubmission = {
      badgeContract: ("0x" + "a".repeat(40)) as `0x${string}`,
      tokenId: 1n,
      holderWallet: acct.address,
      ciphertextHash: bundleHash,
      nonce: ("0x" + "0".repeat(64)) as `0x${string}`,
      issuedAt: 1000n,
      expiresAt: 2000n,
    };
    const sig = await acct.signTypedData({
      domain: buildDomain(1),
      types: VOTING_SUBMISSION_TYPES,
      primaryType: "VotingAddressSubmission",
      message: submission,
    });
    expect((await verifySignature(1, submission, sig)).kind).toBe("ok");
  });

  it("rejects when signer != holderWallet", async () => {
    const signer = privateKeyToAccount(TEST_PK);
    const otherWallet = privateKeyToAccount(("0x" + "2".repeat(64)) as `0x${string}`).address;
    const { publicKey } = ml_kem768.keygen();
    const { bundleHash } = encryptPayload({ a: 1 }, publicKey);
    const submission: VotingAddressSubmission = {
      badgeContract: ("0x" + "a".repeat(40)) as `0x${string}`,
      tokenId: 1n,
      holderWallet: otherWallet,
      ciphertextHash: bundleHash,
      nonce: ("0x" + "0".repeat(64)) as `0x${string}`,
      issuedAt: 1000n,
      expiresAt: 2000n,
    };
    const sig = await signer.signTypedData({
      domain: buildDomain(1),
      types: VOTING_SUBMISSION_TYPES,
      primaryType: "VotingAddressSubmission",
      message: submission,
    });
    expect((await verifySignature(1, submission, sig)).kind).toBe("signature_invalid");
  });

  it("rejects garbage signature", async () => {
    const acct = privateKeyToAccount(TEST_PK);
    const submission: VotingAddressSubmission = {
      badgeContract: ("0x" + "a".repeat(40)) as `0x${string}`,
      tokenId: 1n,
      holderWallet: acct.address,
      ciphertextHash: ("0x" + "0".repeat(64)) as `0x${string}`,
      nonce: ("0x" + "0".repeat(64)) as `0x${string}`,
      issuedAt: 1000n,
      expiresAt: 2000n,
    };
    const r = await verifySignature(1, submission, ("0x" + "ee".repeat(65)) as `0x${string}`);
    expect(r.kind).toBe("signature_invalid");
  });
});

describe("verifySignature with ERC-1271 verifier (smart-contract wallets)", () => {
  const submission: VotingAddressSubmission = {
    badgeContract: ("0x" + "a".repeat(40)) as `0x${string}`,
    tokenId: 1n,
    // Smart-contract wallets are the holderWallet — there is no private
    // key behind this address, only an `isValidSignature` view function.
    holderWallet: ("0x" + "f".repeat(40)) as `0x${string}`,
    ciphertextHash: ("0x" + "0".repeat(64)) as `0x${string}`,
    nonce: ("0x" + "0".repeat(64)) as `0x${string}`,
    issuedAt: 1000n,
    expiresAt: 2000n,
  };
  // Real Safe sigs are variable-length approval blobs, never the 65-byte
  // ECDSA shape. Use a deliberately-not-65-byte payload to make sure the
  // verifier is exercising the ERC-1271 path, not falling through to
  // ECDSA recovery somewhere by accident.
  const safeSig = ("0x" + "ab".repeat(200)) as `0x${string}`;

  it("ok when verifier returns true", async () => {
    const r = await verifySignature(1, submission, safeSig, {
      verifyTypedData: async () => true,
    });
    expect(r.kind).toBe("ok");
  });

  it("rejects when verifier returns false", async () => {
    const r = await verifySignature(1, submission, safeSig, {
      verifyTypedData: async () => false,
    });
    expect(r.kind).toBe("signature_invalid");
  });

  it("rejects (does not throw) when verifier throws — RPC failure / wallet not deployed", async () => {
    const r = await verifySignature(1, submission, safeSig, {
      verifyTypedData: async () => {
        throw new Error("eth_call reverted");
      },
    });
    expect(r.kind).toBe("signature_invalid");
  });
});

describe("verifyTimestampWindow", () => {
  it("ok when expiresAt > now and issuedAt is recent", () => {
    expect(verifyTimestampWindow(900n, 2000n, 1000n).kind).toBe("ok");
  });
  it("rejects expired", () => {
    expect(verifyTimestampWindow(0n, 100n, 200n).kind).toBe("timestamp_expired");
  });
  it("rejects stale (issuedAt > 15 min ago)", () => {
    const now = 100_000n;
    const issued = now - 16n * 60n;
    expect(verifyTimestampWindow(issued, now + 60n, now).kind).toBe("timestamp_stale");
  });
  it("rejects far-future issuedAt", () => {
    const now = 100_000n;
    expect(verifyTimestampWindow(now + 10_000n, now + 20_000n, now).kind).toBe("timestamp_in_future");
  });
});
