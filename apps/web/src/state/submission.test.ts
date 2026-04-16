import { describe, expect, it } from "vitest";
import {
  initialState,
  isInFlight,
  isTerminal,
  reduce,
  type BackendConfig,
  type EncryptedPayload,
  type SubmissionState,
} from "./submission.js";

const cfg: BackendConfig = {
  badgeContract: "0xf67c0ade41c607efebf198f9d6065ab1ec5ad4cd",
  chainId: 1,
  encryptionPublicKey: "0xdeadbeef",
  eip712Domain: { name: "ETHSecurity Voting Badge", version: "1", chainId: 1 },
};

const enc: EncryptedPayload = {
  ciphertext: "ZmFrZQ==",
  ciphertextHash: ("0x" + "11".repeat(32)) as `0x${string}`,
  nonce: ("0x" + "22".repeat(32)) as `0x${string}`,
  issuedAt: 1700000000,
  expiresAt: 1700001000,
};

const sig = ("0x" + "ab".repeat(65)) as `0x${string}`;
const voter = "0x000000000000000000000000000000000000beef" as const;

function happyPath(): SubmissionState {
  let s = initialState;
  s = reduce(s, { type: "WALLET_REQUESTED" });
  s = reduce(s, { type: "WALLET_READY" });
  s = reduce(s, { type: "CONFIG_LOADED", config: cfg });
  s = reduce(s, { type: "TOKEN_PICKED", tokenId: "1", votingAddress: voter });
  s = reduce(s, { type: "ENCRYPTED", encrypted: enc });
  s = reduce(s, { type: "SIGNED", signature: sig });
  s = reduce(s, { type: "SUBMITTED", submittedAt: "2024-01-01T00:00:00.000Z" });
  return s;
}

describe("submission reducer", () => {
  it("starts idle", () => {
    expect(initialState.status).toBe("idle");
  });

  it("walks the happy path to submitted", () => {
    const s = happyPath();
    expect(s.status).toBe("submitted");
    expect(s.config).toEqual(cfg);
    expect(s.tokenId).toBe("1");
    expect(s.votingAddress).toBe(voter);
    expect(s.encrypted).toEqual(enc);
    expect(s.signature).toBe(sig);
    expect(s.submittedAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("WALLET_READY can fire directly from idle (already-connected wallet)", () => {
    const s = reduce(initialState, { type: "WALLET_READY" });
    expect(s.status).toBe("loading_config");
  });

  it("ignores out-of-order events", () => {
    // Cannot SIGNED before ENCRYPTED.
    const s = reduce(
      reduce(initialState, { type: "WALLET_REQUESTED" }),
      { type: "SIGNED", signature: sig },
    );
    expect(s.status).toBe("connecting");
    expect(s.signature).toBeNull();
  });

  it("ERROR transitions from any non-terminal state", () => {
    const states = ["idle", "connecting", "loading_config", "encrypting", "signing", "submitting"] as const;
    for (const status of states) {
      const start: SubmissionState = { ...initialState, status };
      const next = reduce(start, { type: "ERROR", code: "boom", message: "kaboom" });
      expect(next.status).toBe("error");
      expect(next.error).toEqual({ code: "boom", message: "kaboom" });
    }
  });

  it("ERROR is ignored when already submitted", () => {
    const s = happyPath();
    const next = reduce(s, { type: "ERROR", code: "x", message: "y" });
    expect(next).toBe(s);
  });

  it("RESET returns to initial state", () => {
    const s = happyPath();
    const reset = reduce(s, { type: "RESET" });
    expect(reset).toEqual(initialState);
  });

  it("WALLET_REQUESTED is allowed from error state", () => {
    const errored: SubmissionState = {
      ...initialState,
      status: "error",
      error: { code: "x", message: "y" },
    };
    const next = reduce(errored, { type: "WALLET_REQUESTED" });
    expect(next.status).toBe("connecting");
    expect(next.error).toBeNull();
  });

  it("isTerminal flags submitted and error", () => {
    expect(isTerminal("submitted")).toBe(true);
    expect(isTerminal("error")).toBe(true);
    expect(isTerminal("idle")).toBe(false);
    expect(isTerminal("signing")).toBe(false);
  });

  it("isInFlight flags encrypting/signing/submitting", () => {
    expect(isInFlight("encrypting")).toBe(true);
    expect(isInFlight("signing")).toBe(true);
    expect(isInFlight("submitting")).toBe(true);
    expect(isInFlight("idle")).toBe(false);
    expect(isInFlight("loading_config")).toBe(false);
  });
});
