import { describe, it, expect } from "vitest";
import { SubmitRequestSchema, PlaintextPayloadSchema } from "./schemas.js";

const hex32 = "0x" + "a".repeat(64);
const addr  = "0x" + "b".repeat(40);

describe("schemas", () => {
  it("accepts valid submit payload (65-byte ECDSA sig)", () => {
    const ok = SubmitRequestSchema.safeParse({
      badgeContract: addr, tokenId: "123", holderWallet: addr,
      ciphertext: "base64data",
      ciphertextHash: hex32, nonce: hex32,
      issuedAt: 1710000000, expiresAt: 1710000600,
      signature: "0x" + "c".repeat(130),
    });
    expect(ok.success).toBe(true);
  });
  it("accepts variable-length signature (Safe / ERC-1271 multisig)", () => {
    // Safe collects per-owner ECDSA sigs and concatenates them; a 2-of-N
    // approval is 130 bytes (260 hex chars). Larger thresholds and any
    // ERC-6492 wrapper push it longer still.
    const ok = SubmitRequestSchema.safeParse({
      badgeContract: addr, tokenId: "123", holderWallet: addr,
      ciphertext: "base64data",
      ciphertextHash: hex32, nonce: hex32,
      issuedAt: 1710000000, expiresAt: 1710000600,
      signature: "0x" + "c".repeat(260),
    });
    expect(ok.success).toBe(true);
  });
  it("rejects odd-length signature", () => {
    const bad = SubmitRequestSchema.safeParse({
      badgeContract: addr, tokenId: "123", holderWallet: addr,
      ciphertext: "base64data",
      ciphertextHash: hex32, nonce: hex32,
      issuedAt: 1710000000, expiresAt: 1710000600,
      signature: "0x" + "c".repeat(131),
    });
    expect(bad.success).toBe(false);
  });
  it("rejects bad address", () => {
    const bad = SubmitRequestSchema.safeParse({ badgeContract: "nope" });
    expect(bad.success).toBe(false);
  });
  it("rejects zero voting address in plaintext payload", () => {
    const bad = PlaintextPayloadSchema.safeParse({
      votingAddress: "0x0000000000000000000000000000000000000000",
      tokenId: "1", holderWallet: addr, timestamp: new Date().toISOString(),
    });
    expect(bad.success).toBe(false);
  });
});
