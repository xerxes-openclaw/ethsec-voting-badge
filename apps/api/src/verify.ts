import { recoverTypedDataAddress, isAddressEqual, type Address, type Hex } from "viem";
import {
  buildDomain,
  VOTING_SUBMISSION_TYPES,
  sha256Hex,
  type VotingAddressSubmission,
} from "@ethsec/shared";

export type VerifyFailure =
  | { kind: "ciphertext_hash_mismatch" }
  | { kind: "signature_invalid" }
  | { kind: "timestamp_expired" }
  | { kind: "timestamp_stale" }
  | { kind: "timestamp_in_future" };

export interface VerifyOk {
  kind: "ok";
}
export type VerifyResult = VerifyOk | VerifyFailure;

export const OK: VerifyOk = { kind: "ok" };

/**
 * Narrow shape around viem's `publicClient.verifyTypedData`. Implementations
 * are expected to try ECDSA recovery first and then fall back to ERC-1271
 * (and ERC-6492 for counterfactual smart accounts) — viem's public-client
 * action does this transparently, so passing a viem `PublicClient` (wrapped
 * to drop the unused generic parameters) is the production case.
 */
export interface SignatureVerifier {
  verifyTypedData(args: {
    address: Address;
    domain: ReturnType<typeof buildDomain>;
    types: typeof VOTING_SUBMISSION_TYPES;
    primaryType: "VotingAddressSubmission";
    message: VotingAddressSubmission;
    signature: Hex;
  }): Promise<boolean>;
}

/**
 * Recompute sha256(ciphertext) and check it equals the value the client
 * signed over. Defends against ciphertext substitution post-signing.
 */
export function verifyCiphertextHash(ciphertext: string, claimed: Hex): VerifyResult {
  if (sha256Hex(ciphertext).toLowerCase() !== claimed.toLowerCase()) {
    return { kind: "ciphertext_hash_mismatch" };
  }
  return OK;
}

/**
 * Confirm the EIP-712 signature was produced by `submission.holderWallet`.
 *
 * When `verifier` is provided (production path), delegates to viem's
 * `verifyTypedData`, which handles both ECDSA wallets and ERC-1271 smart
 * contract wallets (Safe and similar multisigs) via an `isValidSignature`
 * RPC call. ERC-6492 wrapped signatures from counterfactual accounts also
 * verify through this path.
 *
 * When `verifier` is null/undefined (tests, no-RPC environments), falls
 * back to local ECDSA recovery only — smart-contract wallets cannot be
 * verified without an RPC, so they will be rejected as `signature_invalid`.
 */
export async function verifySignature(
  chainId: number,
  submission: VotingAddressSubmission,
  signature: Hex,
  verifier?: SignatureVerifier | null,
): Promise<VerifyResult> {
  if (verifier) {
    try {
      const ok = await verifier.verifyTypedData({
        address: submission.holderWallet,
        domain: buildDomain(chainId),
        types: VOTING_SUBMISSION_TYPES,
        primaryType: "VotingAddressSubmission",
        message: submission,
        signature,
      });
      return ok ? OK : { kind: "signature_invalid" };
    } catch {
      return { kind: "signature_invalid" };
    }
  }
  let recovered: Address;
  try {
    recovered = (await recoverTypedDataAddress({
      domain: buildDomain(chainId),
      types: VOTING_SUBMISSION_TYPES,
      primaryType: "VotingAddressSubmission",
      message: submission,
      signature,
    })) as Address;
  } catch {
    return { kind: "signature_invalid" };
  }
  if (!isAddressEqual(recovered, submission.holderWallet)) {
    return { kind: "signature_invalid" };
  }
  return OK;
}

/**
 * Validate the `issuedAt`/`expiresAt` window:
 * - `expiresAt` must be in the future (`> nowSec`)
 * - `issuedAt` must not be too far in the future (allow `toleranceSec` for clock skew)
 * - `issuedAt` must not be more than `MAX_ISSUE_AGE_SEC` old
 */
const MAX_ISSUE_AGE_SEC = 15n * 60n; // 15 minutes
export function verifyTimestampWindow(
  issuedAt: bigint,
  expiresAt: bigint,
  nowSec: bigint,
  toleranceSec = 300n,
): VerifyResult {
  if (expiresAt <= nowSec) return { kind: "timestamp_expired" };
  if (issuedAt > nowSec + toleranceSec) return { kind: "timestamp_in_future" };
  if (nowSec - issuedAt > MAX_ISSUE_AGE_SEC) return { kind: "timestamp_stale" };
  return OK;
}
