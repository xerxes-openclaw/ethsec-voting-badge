/**
 * Frontend runtime config — sourced from Vite env vars.
 *
 * The backend's `/config` endpoint is the source of truth for the ML-KEM-768
 * encryption public key and EIP-712 domain — those are fetched at runtime
 * (see `api.ts` + `useSubmission`). Build-time config is just the API base
 * URL, the badge contract address, and the chain id we expect the user to be
 * on.
 */

const env = import.meta.env;

const rawApi = (env.VITE_API_BASE_URL ?? "http://localhost:3001") as string;
const apiBaseUrl = rawApi.replace(/\/+$/, "");

const rawChainId = env.VITE_CHAIN_ID ?? "1";
const chainId = Number(rawChainId);
if (!Number.isInteger(chainId) || chainId <= 0) {
  throw new Error(`VITE_CHAIN_ID must be a positive integer, got ${rawChainId}`);
}

const badgeContract = (
  env.VITE_BADGE_CONTRACT ?? "0xf67c0ade41c607efebf198f9d6065ab1ec5ad4cd"
).toLowerCase() as `0x${string}`;
if (!/^0x[a-f0-9]{40}$/.test(badgeContract)) {
  throw new Error(`VITE_BADGE_CONTRACT must be an EVM address, got ${badgeContract}`);
}

const walletConnectProjectId = (env.VITE_WALLETCONNECT_PROJECT_ID ?? "") as string;

const rpcUrl = (env.VITE_RPC_URL ?? "") as string;

/**
 * When set, used as the ML-KEM-768 public key in offline mode so the page
 * doesn't need to fetch /config over the network. Leave unset in the hosted
 * build — the online flow fetches /config from the API as normal.
 */
const encryptionPublicKeyHex = (env.VITE_ENCRYPTION_PUBLIC_KEY_HEX ?? "") as string;

/** Localtunnel hosts demand a `bypass-tunnel-reminder` header on every request. */
export const isTunnelHost = (url: string): boolean => {
  if (!url) return false;
  try {
    return /\.loca\.lt$/i.test(new URL(url).hostname);
  } catch {
    // Relative or empty base URLs aren't tunnels.
    return false;
  }
};

export const APP_CONFIG = {
  apiBaseUrl,
  chainId,
  badgeContract,
  walletConnectProjectId,
  rpcUrl,
  encryptionPublicKeyHex,
  isTunnel: isTunnelHost(apiBaseUrl),
} as const;

export type AppConfig = typeof APP_CONFIG;
