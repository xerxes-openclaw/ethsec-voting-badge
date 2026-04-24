import { useCallback, useReducer, useRef } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import type { Address, Hex } from "viem";
import {
  buildDomain,
  VOTING_SUBMISSION_TYPES,
  encryptPayload,
} from "@ethsec/shared";
import {
  initialState,
  reduce,
  type SubmissionState,
} from "../state/submission.js";
import { getConfig, postSubmit } from "../api.js";

/**
 * Orchestrator hook for the online flow. Entry points:
 *   - `start(tokenId, votingAddress)`: load-config → encrypt → sign → submit.
 *   - `reset()`: back to idle.
 *
 * Wallet connection is read from wagmi — callers should block on
 * `useAccount().status === "connected"` before calling `start`.
 *
 * Offline signing uses its own dedicated component (OfflineApp) and is not
 * routed through this hook.
 */
export function useSubmission(): {
  state: SubmissionState;
  start: (tokenId: string, votingAddress: Address) => Promise<void>;
  reset: () => void;
} {
  const [state, dispatch] = useReducer(reduce, initialState);
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const running = useRef(false);

  const reset = useCallback(() => {
    running.current = false;
    dispatch({ type: "RESET" });
  }, []);

  const start = useCallback(
    async (tokenId: string, votingAddress: Address) => {
      if (running.current) return;
      running.current = true;
      try {
        if (!address) throw Object.assign(new Error("no wallet connected"), { code: "no_wallet" });

        dispatch({ type: "WALLET_READY" });

        const config = await getConfig();
        // /token-status is intentionally NOT consulted here. Resubmission
        // is a first-class flow on the server (PR #5): /submit marks the
        // old row `superseded_at = now()` and inserts the replacement.
        // A UX hint ("this replaces your current voting address") would
        // be nice but requires a state-machine change and a UI surface —
        // out of scope for this hotfix.
        dispatch({ type: "CONFIG_LOADED", config });

        dispatch({ type: "TOKEN_PICKED", tokenId, votingAddress });

        const publicKey = hexToBytes(config.encryptionPublicKey);
        const issuedAt = Math.floor(Date.now() / 1000);
        const expiresAt = issuedAt + 600;
        const nonce = randomHex32();
        const plaintext = {
          votingAddress,
          tokenId,
          holderWallet: address,
          timestamp: new Date().toISOString(),
        };
        const { bundleB64, bundleHash } = encryptPayload(plaintext, publicKey);
        const encrypted = {
          ciphertext: bundleB64,
          ciphertextHash: bundleHash,
          nonce,
          issuedAt,
          expiresAt,
        } as const;
        dispatch({ type: "ENCRYPTED", encrypted });

        const message = {
          badgeContract: config.badgeContract,
          tokenId: BigInt(tokenId),
          holderWallet: address,
          ciphertextHash: bundleHash,
          nonce,
          issuedAt: BigInt(issuedAt),
          expiresAt: BigInt(expiresAt),
        };
        const signature = (await signTypedDataAsync({
          domain: buildDomain(config.chainId),
          types: VOTING_SUBMISSION_TYPES,
          primaryType: "VotingAddressSubmission",
          message,
        })) as Hex;
        dispatch({ type: "SIGNED", signature });

        dispatch({ type: "SUBMITTING" });
        const res = await postSubmit({
          badgeContract: config.badgeContract,
          tokenId,
          holderWallet: address,
          ciphertext: bundleB64,
          ciphertextHash: bundleHash,
          nonce,
          issuedAt,
          expiresAt,
          signature,
        });
        dispatch({ type: "SUBMITTED", submittedAt: res.submittedAt });
      } catch (err) {
        const e = err as { code?: string; message?: string; shortMessage?: string };
        dispatch({
          type: "ERROR",
          code: e.code ?? "unknown_error",
          message: e.shortMessage ?? e.message ?? "unknown error",
        });
      } finally {
        running.current = false;
      }
    },
    [address, signTypedDataAsync],
  );

  return { state, start, reset };
}

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const s = hex.slice(2);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.substr(i * 2, 2), 16);
  }
  return out;
}

function randomHex32(): `0x${string}` {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let hex = "0x";
  for (const b of buf) hex += b.toString(16).padStart(2, "0");
  return hex as `0x${string}`;
}
