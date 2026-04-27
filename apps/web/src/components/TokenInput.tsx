import { useEffect, useState } from "react";
import { isAddress } from "viem";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { useHeldTokenIds } from "../hooks/useHeldTokenIds.js";

interface Props {
  onSubmit: (tokenId: string, votingAddress: Address) => void;
  disabled?: boolean;
}

/**
 * Collects the voting address and the badge tokenId. The tokenId is
 * auto-detected from the connected wallet's on-chain holdings (see
 * useHeldTokenIds) with a manual-override escape hatch for users whose RPC
 * can't serve log scans.
 *
 * Offline-signing lives in its own mode (OfflineApp); this component stays
 * focused on the normal connect-wallet-and-submit-now flow.
 */
export function TokenInput({ onSubmit, disabled }: Props): JSX.Element {
  const { address } = useAccount();
  const held = useHeldTokenIds(address);

  const [manualMode, setManualMode] = useState(false);
  const [manualTokenId, setManualTokenId] = useState("");
  const [autoTokenId, setAutoTokenId] = useState("");
  const [votingAddress, setVotingAddress] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (held.status !== "ready") return;
    if (held.tokenIds.length === 0) {
      setAutoTokenId("");
      return;
    }
    const stillHeld = held.tokenIds.includes(autoTokenId);
    if (!stillHeld) setAutoTokenId(held.tokenIds[0]!);
  }, [held, autoTokenId]);

  useEffect(() => {
    if (held.status === "error" && !manualMode) setManualMode(true);
  }, [held.status, manualMode]);

  const effectiveTokenId = manualMode ? manualTokenId.trim() : autoTokenId;

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!effectiveTokenId || !/^\d+$/.test(effectiveTokenId)) {
      setErr("Enter a valid badge token ID (positive integer).");
      return;
    }
    if (!isAddress(votingAddress)) {
      setErr("Voting address must be a valid 0x-prefixed EVM address.");
      return;
    }
    // The voting address must be a DIFFERENT wallet from the one holding
    // the badge — that's the whole point of the private-voting layer.
    //
    // Hard-guard on `address` rather than the previous `address && …`
    // short-circuit: wagmi's `useAccount()` can briefly return
    // `address: undefined` during reconnects / account switches even
    // while the parent component sees `accountStatus === "connected"`
    // (each `useAccount()` instance updates on its own render schedule).
    // The old guard let those races through, allowing a same-address
    // submission to slip past the check.
    if (!address) {
      setErr("Wallet disconnected. Reconnect and try again.");
      return;
    }
    if (votingAddress.toLowerCase() === address.toLowerCase()) {
      setErr("Please enter a new private address for your voting badge.");
      return;
    }
    setErr(null);
    onSubmit(effectiveTokenId, votingAddress as Address);
  };

  const autoBlocked =
    !manualMode && (held.status !== "ready" || held.tokenIds.length === 0);
  const formDisabled = Boolean(disabled) || autoBlocked;

  return (
    <section className="animate-scaleIn rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm p-6 sm:p-8 space-y-6">
      <header className="space-y-1">
        <h2 className="font-tight text-xl sm:text-2xl">Cast your voting address</h2>
        <p className="text-sm text-white/50 leading-relaxed">
          We&apos;ll detect your badge automatically. Enter the address you want to
          delegate your voting power to. Everything is encrypted in-browser.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-5">
        <BadgeField
          held={held}
          manualMode={manualMode}
          onToggleManual={() => setManualMode((m) => !m)}
          autoValue={autoTokenId}
          onAutoChange={setAutoTokenId}
          manualValue={manualTokenId}
          onManualChange={setManualTokenId}
        />

        <div className="space-y-2">
          <label htmlFor="votingAddress" className="block text-xs font-medium text-white/60 uppercase tracking-wider">
            Voting Address
          </label>
          <input
            id="votingAddress"
            value={votingAddress}
            onChange={(e) => setVotingAddress(e.target.value)}
            disabled={formDisabled}
            placeholder="0x..."
            autoComplete="off"
            className="w-full rounded-xl bg-black/30 border border-white/10 focus:border-brand-blue-500 focus:ring-1 focus:ring-brand-blue-500/40 px-4 py-3 text-base font-mono placeholder:text-white/20 outline-none transition-all duration-200 disabled:opacity-40"
          />
          <p className="text-xs text-white/30">Where your vote weight goes</p>
        </div>

        {err && (
          <div className="animate-fadeIn rounded-lg bg-brand-red-500/10 border border-brand-red-500/30 px-4 py-2.5">
            <p role="alert" className="text-sm text-brand-red-500">
              {err}
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={formDisabled}
          className="w-full rounded-xl bg-brand-green-500 hover:bg-brand-green-500/85 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 px-5 py-3.5 text-sm font-semibold tracking-wide transition-all duration-200"
        >
          Encrypt &amp; Sign
        </button>
      </form>
    </section>
  );
}

interface BadgeFieldProps {
  held: ReturnType<typeof useHeldTokenIds>;
  manualMode: boolean;
  onToggleManual: () => void;
  autoValue: string;
  onAutoChange: (next: string) => void;
  manualValue: string;
  onManualChange: (next: string) => void;
}

function BadgeField({
  held,
  manualMode,
  onToggleManual,
  autoValue,
  onAutoChange,
  manualValue,
  onManualChange,
}: BadgeFieldProps): JSX.Element {
  const label = (
    <label className="flex items-center justify-between">
      <span className="block text-xs font-medium text-white/60 uppercase tracking-wider">Badge</span>
      <button
        type="button"
        onClick={onToggleManual}
        className="text-xs text-white/40 hover:text-white/70 underline-offset-2 hover:underline transition-colors"
      >
        {manualMode ? "Use auto-detect" : "Enter manually"}
      </button>
    </label>
  );

  if (manualMode) {
    return (
      <div className="space-y-2">
        {label}
        <input
          id="tokenId"
          value={manualValue}
          onChange={(e) => onManualChange(e.target.value)}
          placeholder="e.g. 42"
          inputMode="numeric"
          autoComplete="off"
          className="w-full rounded-xl bg-black/30 border border-white/10 focus:border-brand-blue-500 focus:ring-1 focus:ring-brand-blue-500/40 px-4 py-3 text-base font-mono placeholder:text-white/20 outline-none transition-all duration-200"
        />
        <p className="text-xs text-white/30">
          Ownership is re-checked on the server — an invalid token ID will be rejected.
        </p>
      </div>
    );
  }

  if (held.status === "idle" || held.status === "loading") {
    return (
      <div className="space-y-2">
        {label}
        <div className="w-full rounded-xl bg-black/30 border border-white/10 px-4 py-3 text-sm text-white/40 font-mono">
          <span className="inline-block h-2 w-2 rounded-full bg-brand-blue-500/70 animate-pulse mr-2 align-middle" />
          Scanning wallet for badges…
        </div>
      </div>
    );
  }

  if (held.status === "error") {
    return (
      <div className="space-y-2">
        {label}
        <div className="w-full rounded-xl bg-brand-red-500/10 border border-brand-red-500/30 px-4 py-3 text-sm text-brand-red-500 break-words overflow-hidden">
          <p className="font-medium mb-1">Couldn&apos;t read holdings</p>
          <p className="text-xs text-brand-red-500/80 break-all">{held.error}</p>
          <p className="text-xs text-brand-red-500/80 mt-2">
            Click &ldquo;Enter manually&rdquo; above to type your badge ID.
          </p>
        </div>
      </div>
    );
  }

  if (held.status === "multi_badge") {
    return (
      <div className="space-y-2">
        {label}
        <div className="w-full rounded-xl bg-brand-red-500/10 border border-brand-red-500/30 px-4 py-3 text-sm text-brand-red-500">
          <p className="font-medium mb-1">This wallet holds {held.balance.toString()} badges</p>
          <p className="text-xs text-brand-red-500/80">
            One holder = one voting address. Wallets that hold more than one badge can&apos;t
            submit. Transfer the extras to a different wallet first, or submit from a
            wallet that only holds one badge.
          </p>
        </div>
      </div>
    );
  }

  if (held.tokenIds.length === 0) {
    return (
      <div className="space-y-2">
        {label}
        <div className="w-full rounded-xl bg-brand-red-500/10 border border-brand-red-500/30 px-4 py-3 text-sm text-brand-red-500">
          No badge found on this wallet. Only badgeholders can submit.
        </div>
      </div>
    );
  }

  if (held.tokenIds.length === 1) {
    const id = held.tokenIds[0]!;
    return (
      <div className="space-y-2">
        {label}
        <div className="w-full rounded-xl bg-brand-green-500/10 border border-brand-green-500/30 px-4 py-3 text-sm text-white/90 font-mono flex items-center justify-between">
          <span>Badge #{id}</span>
          <span className="text-xs text-brand-green-500 uppercase tracking-wider">detected</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {label}
      <select
        value={autoValue}
        onChange={(e) => onAutoChange(e.target.value)}
        className="w-full rounded-xl bg-black/30 border border-white/10 focus:border-brand-blue-500 focus:ring-1 focus:ring-brand-blue-500/40 px-4 py-3 text-base font-mono outline-none transition-all duration-200"
      >
        {held.tokenIds.map((id) => (
          <option key={id} value={id}>
            Badge #{id}
          </option>
        ))}
      </select>
      <p className="text-xs text-white/30">You hold {held.tokenIds.length} badges — pick which to use.</p>
    </div>
  );
}
