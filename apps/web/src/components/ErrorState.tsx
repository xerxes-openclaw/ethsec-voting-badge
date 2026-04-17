interface Props {
  code: string;
  message: string;
  onReset: () => void;
}

export function ErrorState({ code, message, onReset }: Props): JSX.Element {
  return (
    <section className="animate-scaleIn rounded-2xl border border-brand-red-500/30 bg-brand-red-500/[0.06] backdrop-blur-sm p-6 sm:p-8 space-y-5">
      {/* Icon */}
      <div className="flex justify-center">
        <div className="h-14 w-14 rounded-full bg-brand-red-500/15 flex items-center justify-center">
          <svg className="h-7 w-7 text-brand-red-500" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
            <path d="M12 8v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="16" r="1" fill="currentColor" />
          </svg>
        </div>
      </div>

      <div className="text-center space-y-2">
        <h2 className="font-tight text-xl text-brand-red-500">
          Something went wrong
        </h2>
        <p className="text-sm text-white/70 leading-relaxed">{message}</p>
        <p className="text-xs text-white/30 font-mono">{code}</p>
      </div>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={onReset}
          className="rounded-xl bg-brand-red-500/20 hover:bg-brand-red-500/30 border border-brand-red-500/30 active:scale-[0.98] px-6 py-2.5 text-sm font-medium text-brand-red-500 transition-all duration-200"
        >
          Try again
        </button>
      </div>
    </section>
  );
}
