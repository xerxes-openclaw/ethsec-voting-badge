import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet, sepolia } from "wagmi/chains";
import type { Chain } from "viem";
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
});
