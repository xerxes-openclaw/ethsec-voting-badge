interface Props {
  tokenId: string;
  onReset: () => void;
}

/**
 * Terminal state for the offline-signing path. Shown right after the
 * signed+encrypted blob has been downloaded — no network submission has
 * happened yet. The user is expected to transport the file to an online
 * machine and upload it there via the /upload page.
 */
export function Exported({ tokenId, onReset }: Props): JSX.Element {
  return (
    <section className="animate-scaleIn rounded-2xl border border-brand-blue-500/30 bg-brand-blue-500/[0.06] backdrop-blur-sm p-6 sm:p-8 space-y-5 text-center">
      <div className="flex justify-center">
        <div className="h-16 w-16 rounded-full bg-brand-blue-500/15 flex items-center justify-center">
          <svg className="h-8 w-8 text-brand-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="font-tight text-xl sm:text-2xl text-brand-blue-500">
          Signed blob downloaded
        </h2>
        <p className="text-sm text-white/70 leading-relaxed">
          Badge <span className="font-mono text-white">{tokenId}</span>&apos;s
          signed + encrypted submission is now a JSON file on this device.
        </p>
      </div>

      <div className="rounded-lg bg-white/[0.03] border border-white/5 px-4 py-3 text-left space-y-2">
        <p className="text-xs font-medium text-white/80 uppercase tracking-wider">Next</p>
        <ol className="list-decimal list-inside text-xs text-white/50 leading-relaxed space-y-1">
          <li>Transfer the file to an online machine (USB, SD card, scp).</li>
          <li>
            Open the ETHSecurity Voting Badge site on that machine → click
            <span className="text-white"> &ldquo;Upload signed blob&rdquo;</span> in the footer.
          </li>
          <li>Pick the file and submit. The receipt appears when the server stores it.</li>
        </ol>
        <p className="text-xs text-white/40 leading-relaxed pt-1">
          Or POST the JSON directly:
          <br />
          <span className="font-mono text-white/60 break-all">
            curl -X POST -H &apos;content-type: application/json&apos; --data-binary @file.json &lt;api-url&gt;/submit
          </span>
        </p>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="rounded-xl border border-white/10 hover:bg-white/5 active:scale-[0.98] px-5 py-2.5 text-sm font-medium transition-all duration-200"
      >
        Sign another
      </button>
    </section>
  );
}
