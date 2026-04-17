import { useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { WalletConnect } from "./components/WalletConnect.js";
import { TokenInput } from "./components/TokenInput.js";
import { Progress } from "./components/Progress.js";
import { Submitted } from "./components/Submitted.js";
import { Exported } from "./components/Exported.js";
import { ErrorState } from "./components/ErrorState.js";
import { AdminPage } from "./components/AdminPage.js";
import { UploadBlob } from "./components/UploadBlob.js";
import { useSubmission } from "./hooks/useSubmission.js";
import { expectedChain } from "./wagmi.js";

type View = "voter" | "admin" | "upload";

export default function App(): JSX.Element {
  const [view, setView] = useState<View>("voter");
  const { address, status: accountStatus } = useAccount();
  const chainId = useChainId();
  const { state, start, reset } = useSubmission();

  if (view === "admin") {
    return <AdminPage onBack={() => setView("voter")} />;
  }
  if (view === "upload") {
    return <UploadBlob onBack={() => setView("voter")} />;
  }

  const wrongChain = accountStatus === "connected" && chainId !== expectedChain.id;
  const canStart =
    accountStatus === "connected" &&
    !wrongChain &&
    (state.status === "idle" || state.status === "selecting_token");

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-8 sm:py-14">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <header className="space-y-3 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-blue-500/20 px-3 py-1 text-xs font-medium text-brand-blue-500 ring-1 ring-brand-blue-500/30">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-green-500 animate-pulse" />
            ETHSecurity
          </div>
          <h1 className="font-tight text-3xl sm:text-4xl tracking-tight leading-tight">
            Voting Badge
          </h1>
          <p className="text-white/60 text-sm sm:text-base max-w-md mx-auto leading-relaxed">
            Submit a private voting address tied to your ETHSecurity badge.
            Your choice is encrypted in-browser and signed with your wallet.
          </p>
        </header>

        {/* Wallet */}
        <WalletConnect />

        {/* Wrong chain warning */}
        {wrongChain && (
          <div className="rounded-xl border border-brand-red-500/30 bg-brand-red-500/10 p-4 text-center text-sm text-white/80">
            Please switch to <span className="font-medium text-white">{expectedChain.name}</span> in the wallet modal above.
          </div>
        )}

        {/* Main flow */}
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

            {state.status === "exported" && state.tokenId && (
              <Exported tokenId={state.tokenId} onReset={reset} />
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

        {/* Footer */}
        <footer className="text-center text-xs text-white/30 pt-6 space-y-2">
          <p>ETHSecurity Voting Badge &middot; DAO.fund</p>
          <div className="flex justify-center gap-4">
            <button
              onClick={() => setView("upload")}
              className="text-white/20 hover:text-white/40 transition-colors"
            >
              Upload signed blob
            </button>
            <span className="text-white/10">&middot;</span>
            <button
              onClick={() => setView("admin")}
              className="text-white/20 hover:text-white/40 transition-colors"
            >
              Admin
            </button>
          </div>
        </footer>
      </div>
    </main>
  );
}
