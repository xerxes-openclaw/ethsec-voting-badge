import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  walletConnectWallet,
  coinbaseWallet,
  rainbowWallet,
  frameWallet,
  safeWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";
import { type Chain } from "viem";
import { APP_CONFIG } from "./config.js";

const SUPPORTED: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [sepolia.id]: sepolia,
};

export const expectedChain: Chain = SUPPORTED[APP_CONFIG.chainId] ?? mainnet;

// Explicit wallet list. `injectedWallet` catches any EIP-6963 announced
// browser extension (Rabby, Rainbow, Frame, Brave Wallet, etc.) that isn't
// covered by a dedicated entry above, so users with wallets other than
// MetaMask get a direct in-extension connect instead of a WalletConnect QR.
const projectId = APP_CONFIG.walletConnectProjectId || "PLACEHOLDER";
const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [metaMaskWallet, rabbyWallet, injectedWallet],
    },
    {
      groupName: "Other",
      wallets: [rainbowWallet, coinbaseWallet, frameWallet, safeWallet, walletConnectWallet],
    },
  ],
  { appName: "ETHSecurity Voting Badge", projectId },
);

export const wagmiConfig = createConfig({
  connectors,
  chains: [expectedChain],
  transports: {
    [expectedChain.id]: APP_CONFIG.rpcUrl ? http(APP_CONFIG.rpcUrl) : http(),
  },
  ssr: false,
});
