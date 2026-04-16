/**
 * Submission state machine.
 *
 * States flow roughly linearly:
 *
 *   idle
 *     -> connecting           (user kicks off the flow before wallet ready)
 *     -> loading_config       (wallet ready, fetch /config + /token-status)
 *     -> selecting_token      (user has badges and types/picks a tokenId)
 *     -> encrypting           (build payload, encrypt with KEM pubkey)
 *     -> signing              (request EIP-712 signature)
 *     -> submitting           (POST /submit)
 *     -> submitted            (terminal success)
 *     -> error                (terminal failure; can `reset` back to idle)
 *
 * Implemented as a plain reducer so test coverage is trivial and the state
 * shape is fully serialisable.
 */

import type { Address, Hex } from "viem";

export type SubmissionStatus =
  | "idle"
  | "connecting"
  | "loading_config"
  | "selecting_token"
  | "encrypting"
  | "signing"
  | "submitting"
  | "submitted"
  | "error";

export interface BackendConfig {
  badgeContract: Address;
  chainId: number;
  encryptionPublicKey: `0x${string}`;
  eip712Domain: { name: string; version: string; chainId: number };
}

export interface EncryptedPayload {
  ciphertext: string;
  ciphertextHash: `0x${string}`;
  nonce: `0x${string}`;
  issuedAt: number;
  expiresAt: number;
}

export interface SubmissionState {
  status: SubmissionStatus;
  config: BackendConfig | null;
  tokenId: string | null;
  votingAddress: Address | null;
  encrypted: EncryptedPayload | null;
  signature: Hex | null;
  submittedAt: string | null;
  error: { code: string; message: string } | null;
}

export const initialState: SubmissionState = {
  status: "idle",
  config: null,
  tokenId: null,
  votingAddress: null,
  encrypted: null,
  signature: null,
  submittedAt: null,
  error: null,
};

export type SubmissionEvent =
  | { type: "WALLET_REQUESTED" }
  | { type: "WALLET_READY" }
  | { type: "CONFIG_LOADED"; config: BackendConfig }
  | { type: "TOKEN_PICKED"; tokenId: string; votingAddress: Address }
  | { type: "ENCRYPTED"; encrypted: EncryptedPayload }
  | { type: "SIGNED"; signature: Hex }
  | { type: "SUBMITTING" }
  | { type: "SUBMITTED"; submittedAt: string }
  | { type: "ERROR"; code: string; message: string }
  | { type: "RESET" };

/**
 * Reducer-style transition. Invalid transitions are no-ops — callers should
 * `reset()` instead of trying to retry from an inconsistent state.
 */
export function reduce(
  state: SubmissionState,
  event: SubmissionEvent,
): SubmissionState {
  switch (event.type) {
    case "WALLET_REQUESTED":
      if (state.status !== "idle" && state.status !== "error") return state;
      return { ...initialState, status: "connecting" };

    case "WALLET_READY":
      if (state.status !== "idle" && state.status !== "connecting") return state;
      return { ...state, status: "loading_config", error: null };

    case "CONFIG_LOADED":
      if (state.status !== "loading_config") return state;
      return { ...state, status: "selecting_token", config: event.config };

    case "TOKEN_PICKED":
      if (state.status !== "selecting_token") return state;
      return {
        ...state,
        status: "encrypting",
        tokenId: event.tokenId,
        votingAddress: event.votingAddress,
      };

    case "ENCRYPTED":
      if (state.status !== "encrypting") return state;
      return { ...state, status: "signing", encrypted: event.encrypted };

    case "SIGNED":
      if (state.status !== "signing") return state;
      return { ...state, status: "submitting", signature: event.signature };

    case "SUBMITTING":
      if (state.status !== "signing" && state.status !== "submitting") return state;
      return { ...state, status: "submitting" };

    case "SUBMITTED":
      if (state.status !== "submitting") return state;
      return { ...state, status: "submitted", submittedAt: event.submittedAt };

    case "ERROR":
      // Errors can occur from any in-flight state. From terminal states we
      // ignore them — the user must `RESET` first.
      if (state.status === "submitted") return state;
      return {
        ...state,
        status: "error",
        error: { code: event.code, message: event.message },
      };

    case "RESET":
      return initialState;

    default: {
      // exhaustiveness check
      const _never: never = event;
      void _never;
      return state;
    }
  }
}

export const isTerminal = (s: SubmissionStatus): boolean =>
  s === "submitted" || s === "error";

export const isInFlight = (s: SubmissionStatus): boolean =>
  s === "encrypting" || s === "signing" || s === "submitting";
