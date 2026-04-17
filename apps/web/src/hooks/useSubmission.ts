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
import { getConfig, getTokenStatus, postSubmit, type SubmitBody } from "../api.js";

export type SubmitMode = "online" | "offline";

/**
 * Orchestrator hook. Exposes the current state machine snapshot plus two
 * entry points: `start(tokenId, votingAddress, mode)` kicks off load-config →
 * encrypt → sign → submit (online) or → download blob (offline), and
 * `reset()` returns to idle.
 *
 * Wallet connection is read from wagmi — callers should block on
 * `useAccount().status === "connected"` before calling `start`.
 */
export function useSubmission(): {
  state: SubmissionState;
  start: (
    tokenId: string,
    votingAddress: Address,
    mode?: SubmitMode,
  ) => Promise<void>;
  reset: () => void;
} {
  const [state, dispatch] = useReducer(reduce, initialState);
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  // Guard against re-entry if the user double-clicks submit.
  const running = useRef(false);

  const reset = useCallback(() => {
    running.current = false;
    dispatch({ type: "RESET" });
  }, []);

  const start = useCallback(
    async (
      tokenId: string,
      votingAddress: Address,
      mode: SubmitMode = "online",
    ) => {
      if (running.current) return;
      running.current = true;
      try {
        if (!address) throw Object.assign(new Error("no wallet connected"), { code: "no_wallet" });

        dispatch({ type: "WALLET_READY" });

        // 1) Load config. In offline mode, we still hit /config because the
        // user is signing *in the hosted dApp* — they just skip the POST at
        // the end. For a truly air-gapped build (static bundle on an
        // offline machine), this module is bypassed entirely by the offline
        // bundle wiring; see README.
        const config = await getConfig();
        const status = await getTokenStatus(tokenId);
        if (status.used) {
          dispatch({
            type: "ERROR",
            code: "already_submitted",
            message: `Badge ${tokenId} already submitted a voting address.`,
          });
          return;
        }
        dispatch({ type: "CONFIG_LOADED", config });

        dispatch({ type: "TOKEN_PICKED", tokenId, votingAddress });

        // 2) Encrypt
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

        // 3) Sign EIP-712
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

        const body: SubmitBody = {
          badgeContract: config.badgeContract,
          tokenId,
          holderWallet: address,
          ciphertext: bundleB64,
          ciphertextHash: bundleHash,
          nonce,
          issuedAt,
          expiresAt,
          signature,
        };

        if (mode === "offline") {
          // 4b) Export blob for later submission from an online machine.
          downloadJson(body, `ethsec-submission-badge-${tokenId}.json`);
          dispatch({ type: "EXPORTED" });
          return;
        }

        // 4a) Submit to server.
        dispatch({ type: "SUBMITTING" });
        const res = await postSubmit(body);
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

function downloadJson(body: SubmitBody, filename: string): void {
  const blob = new Blob([JSON.stringify(body, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick before revoking; revoking synchronously
  // cancels some downloads on Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
