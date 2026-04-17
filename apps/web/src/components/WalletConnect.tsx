import { ConnectButton } from "@rainbow-me/rainbowkit";

/**
 * Wallet connection UI — delegates entirely to RainbowKit's ConnectButton.
 *
 * When disconnected it shows a prominent "Connect Wallet" button with
 * auto-detection of MetaMask, Rabby, Coinbase, WalletConnect, etc.
 * When connected it shows ENS name (if available), chain badge, and balance.
 */
export function WalletConnect(): JSX.Element {
  return (
    <section className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4 sm:p-6">
      <div className="space-y-0.5">
        <h2 className="font-tight text-lg sm:text-xl">Wallet</h2>
        <p className="text-xs text-white/50">
          Use the wallet that holds your ETHSecurity badge.
        </p>
      </div>
      <ConnectButton
        chainStatus="icon"
        showBalance={false}
        accountStatus="avatar"
      />
    </section>
  );
}
