import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet, sepolia } from "wagmi/chains";
import { http, type Chain } from "viem";
import { APP_CONFIG } from "./config.js";

const SUPPORTED: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [sepolia.id]: sepolia,
};

export const expectedChain: Chain = SUPPORTED[APP_CONFIG.chainId] ?? mainnet;

export const wagmiConfig = getDefaultConfig({
  appName: "ETHSecurity Voting Badge",
  // WalletConnect project ID — injected wallets work without it,
  // but WalletConnect QR won't show unless a real one is provided.
  projectId: APP_CONFIG.walletConnectProjectId || "PLACEHOLDER",
  chains: [expectedChain],
  // When VITE_RPC_URL is set, override the default transport so our log-scan
  // hook doesn't get capped at 1000 blocks by random thirdweb/Infura RPCs.
  ...(APP_CONFIG.rpcUrl
    ? { transports: { [expectedChain.id]: http(APP_CONFIG.rpcUrl) } }
    : {}),
});
