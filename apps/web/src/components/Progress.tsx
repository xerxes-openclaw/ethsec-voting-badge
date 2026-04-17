import type { SubmissionStatus } from "../state/submission.js";

const steps: { key: SubmissionStatus; label: string }[] = [
  { key: "loading_config", label: "Fetching encryption key" },
  { key: "encrypting",     label: "Encrypting your vote" },
  { key: "signing",        label: "Waiting for wallet signature" },
  { key: "submitting",     label: "Submitting to server" },
];

const stepIndex = (s: SubmissionStatus): number =>
  steps.findIndex((st) => st.key === s);

export function Progress({ status }: { status: SubmissionStatus }): JSX.Element {
  const current = stepIndex(status);

  return (
    <section className="animate-scaleIn rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm p-6 sm:p-8 space-y-5">
      <div className="space-y-4">
        {steps.map((step, i) => {
          const isDone    = i < current;
          const isActive  = i === current;
          const isPending = i > current;

          return (
            <div
              key={step.key}
              className={`flex items-center gap-3 transition-opacity duration-300 ${isPending ? "opacity-30" : "opacity-100"}`}
            >
              {/* Step indicator */}
              <div className="relative flex-shrink-0">
                {isDone ? (
                  <div className="h-6 w-6 rounded-full bg-brand-green-500/20 flex items-center justify-center">
                    <svg className="h-3.5 w-3.5 text-brand-green-500" viewBox="0 0 14 14" fill="none">
                      <path
                        className="animate-checkmark"
                        d="M2 7.5L5.5 11L12 3"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                ) : isActive ? (
                  <div className="h-6 w-6 rounded-full bg-brand-blue-500/20 flex items-center justify-center">
                    <span className="h-2.5 w-2.5 rounded-full bg-brand-blue-500 animate-pulse" />
                  </div>
                ) : (
                  <div className="h-6 w-6 rounded-full bg-white/5 flex items-center justify-center">
                    <span className="h-2 w-2 rounded-full bg-white/20" />
                  </div>
                )}
              </div>

              {/* Label */}
              <span className={`text-sm ${isActive ? "text-white font-medium" : isDone ? "text-white/60" : "text-white/40"}`}>
                {step.label}
                {isActive && <span className="ml-1 text-white/40">...</span>}
              </span>
            </div>
          );
        })}
      </div>

      {/* Shimmer bar */}
      <div className="h-1 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full rounded-full animate-shimmer bg-gradient-to-r from-transparent via-brand-blue-500/40 to-transparent" style={{ width: "100%" }} />
      </div>

      <p className="text-xs text-white/35">
        Don&apos;t close the tab. If your wallet opened a signing prompt, approve
        it to continue.
      </p>
    </section>
  );
}
