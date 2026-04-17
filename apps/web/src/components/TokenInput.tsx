import { useState } from "react";
import { isAddress } from "viem";
import type { Address } from "viem";

interface Props {
  onSubmit: (tokenId: string, votingAddress: Address) => void;
  disabled?: boolean;
}

/**
 * Form for the "selecting_token" / "idle" states. Collects the badge
 * tokenId and the voting address the user wants to delegate to, validates
 * both client-side, then hands off to the orchestrator.
 */
export function TokenInput({ onSubmit, disabled }: Props): JSX.Element {
  const [tokenId, setTokenId] = useState("");
  const [votingAddress, setVotingAddress] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!/^\d+$/.test(tokenId)) {
      setErr("Token ID must be a positive integer.");
      return;
    }
    if (!isAddress(votingAddress)) {
      setErr("Voting address must be a valid 0x-prefixed EVM address.");
      return;
    }
    setErr(null);
    onSubmit(tokenId, votingAddress as Address);
  };

  return (
    <section className="animate-scaleIn rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm p-6 sm:p-8 space-y-6">
      <header className="space-y-1">
        <h2 className="font-tight text-xl sm:text-2xl">Cast your voting address</h2>
        <p className="text-sm text-white/50 leading-relaxed">
          Enter your badge token ID and the address you want to delegate
          your voting power to. Everything is encrypted in-browser.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="tokenId" className="block text-xs font-medium text-white/60 uppercase tracking-wider">
            Badge Token ID
          </label>
          <input
            id="tokenId"
            value={tokenId}
            onChange={(e) => setTokenId(e.target.value)}
            disabled={disabled}
            placeholder="e.g. 42"
            inputMode="numeric"
            autoComplete="off"
            className="w-full rounded-xl bg-black/30 border border-white/10 focus:border-brand-blue-500 focus:ring-1 focus:ring-brand-blue-500/40 px-4 py-3 text-base font-mono placeholder:text-white/20 outline-none transition-all duration-200 disabled:opacity-40"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="votingAddress" className="block text-xs font-medium text-white/60 uppercase tracking-wider">
            Voting Address
          </label>
          <input
            id="votingAddress"
            value={votingAddress}
            onChange={(e) => setVotingAddress(e.target.value)}
            disabled={disabled}
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
          disabled={disabled}
          className="w-full rounded-xl bg-brand-green-500 hover:bg-brand-green-500/85 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 px-5 py-3.5 text-sm font-semibold tracking-wide transition-all duration-200"
        >
          Encrypt &amp; Sign
        </button>
      </form>
    </section>
  );
}
