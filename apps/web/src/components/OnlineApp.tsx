import { useAccount, useChainId } from "wagmi";
import { WalletConnect } from "./WalletConnect.js";
import { TokenInput } from "./TokenInput.js";
import { Progress } from "./Progress.js";
import { Submitted } from "./Submitted.js";
import { ErrorState } from "./ErrorState.js";
import { Decor } from "./Decor.js";
import { useSubmission } from "../hooks/useSubmission.js";
import { expectedChain } from "../wagmi.js";

interface Props {
  onBack: () => void;
}

export function OnlineApp({ onBack }: Props): JSX.Element {
  const { address, status: accountStatus } = useAccount();
  const chainId = useChainId();
  const { state, start, reset } = useSubmission();

  const wrongChain = accountStatus === "connected" && chainId !== expectedChain.id;
  const canStart =
    accountStatus === "connected" &&
    !wrongChain &&
    (state.status === "idle" || state.status === "selecting_token");

  return (
    <section className="relative min-h-screen overflow-hidden pt-16 pb-24">
      <Decor />

      <div className="relative z-10 w-full max-w-lg mx-auto px-4">
        <header className="text-center space-y-4 mb-10 animate-fadeIn">
          <div className="flex justify-center">
            <video
              autoPlay
              loop
              muted
              playsInline
              src="/eth-security-badge.mp4"
              className="w-32 h-32 rounded-full shadow-xl shadow-dao-green/15"
            />
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-dao-green/15 px-3 py-1 text-xs font-semibold tracking-wider uppercase text-dao-green ring-1 ring-dao-green/30">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-dao-green animate-pulse" />
            Online mode
          </div>
          <h1 className="font-tight text-4xl sm:text-5xl font-semibold tracking-tight leading-tight">
            Voting Badge
          </h1>
          <p className="text-gray-300 text-base max-w-md mx-auto leading-relaxed">
            Submit a private voting address tied to your ETHSecurity badge.
            Your choice is encrypted in-browser and signed with your wallet.
          </p>
        </header>

        <div className="space-y-5">
          <WalletConnect />

          {wrongChain && (
            <div className="rounded-2xl border border-dao-red/30 bg-dao-red/10 p-4 text-center text-sm text-white/90 backdrop-blur-md">
              Please switch to <span className="font-medium text-white">{expectedChain.name}</span> in the wallet modal above.
            </div>
          )}

          {address && !wrongChain && (
            <div className="space-y-4 animate-fadeIn">
              {(state.status === "idle" || state.status === "selecting_token") && (
                <TokenInput onSubmit={start} disabled={!canStart} />
              )}

              {(state.status === "loading_config" ||
                state.status === "encrypting" ||
                state.status === "signing" ||
                state.status === "submitting") && <Progress status={state.status} />}

              {state.status === "submitted" && state.submittedAt && state.tokenId && (
                <Submitted
                  submittedAt={state.submittedAt}
                  tokenId={state.tokenId}
                  onReset={reset}
                />
              )}

              {state.status === "error" && state.error && (
                <ErrorState
                  code={state.error.code}
                  message={state.error.message}
                  onReset={reset}
                />
              )}
            </div>
          )}
        </div>

        <footer className="text-center pt-10">
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-white/50 hover:text-dao-green transition-colors"
          >
            ← Back to mode select
          </button>
        </footer>
      </div>
    </section>
  );
}
