interface Props {
  submittedAt: string;
  tokenId: string;
  onReset: () => void;
}

export function Submitted({ submittedAt, tokenId, onReset }: Props): JSX.Element {
  return (
    <section className="animate-scaleIn rounded-2xl border border-brand-green-500/30 bg-brand-green-500/[0.06] backdrop-blur-sm p-6 sm:p-8 space-y-5 text-center">
      {/* Animated checkmark */}
      <div className="flex justify-center">
        <div className="h-16 w-16 rounded-full bg-brand-green-500/15 flex items-center justify-center">
          <svg className="h-8 w-8 text-brand-green-500" viewBox="0 0 24 24" fill="none">
            <path
              className="animate-checkmark"
              d="M4 12.5L9.5 18L20 6"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ strokeDasharray: 30, strokeDashoffset: 30, animation: "checkmark 0.6s ease-out 0.3s forwards" }}
            />
          </svg>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="font-tight text-xl sm:text-2xl text-brand-green-500">
          Submitted
        </h2>
        <p className="text-sm text-white/70 leading-relaxed">
          Badge <span className="font-mono text-white">{tokenId}</span> has
          recorded its voting address.
        </p>
        <p className="text-xs text-white/40 font-mono">
          {submittedAt}
        </p>
      </div>

      <div className="rounded-lg bg-white/[0.03] border border-white/5 px-4 py-3">
        <p className="text-xs text-white/40 leading-relaxed">
          Your plaintext voting address never left this browser — only the
          encrypted ciphertext and signed commitment were submitted.
        </p>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="rounded-xl border border-white/10 hover:bg-white/5 active:scale-[0.98] px-5 py-2.5 text-sm font-medium transition-all duration-200"
      >
        Submit another
      </button>
    </section>
  );
}
