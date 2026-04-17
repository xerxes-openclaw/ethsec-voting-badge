import { useState } from "react";
import { postSubmit, type SubmitBody, type SubmitOk } from "../api.js";

interface Props {
  onBack: () => void;
}

type UploadState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "submitted"; receipt: SubmitOk; tokenId: string }
  | { status: "error"; message: string };

/**
 * "Upload signed blob" page. Accepts a JSON file produced by the offline-
 * signing flow (see TokenInput's "Sign offline" checkbox + useSubmission's
 * export path) and POSTs it to /submit on behalf of the signer. No wallet
 * required on this machine — the signature is already baked into the blob.
 */
export function UploadBlob({ onBack }: Props): JSX.Element {
  const [state, setState] = useState<UploadState>({ status: "idle" });

  const onFileChange = async (file: File | null): Promise<void> => {
    if (!file) return;
    setState({ status: "submitting" });
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const body = validate(parsed);
      const receipt = await postSubmit(body);
      setState({ status: "submitted", receipt, tokenId: body.tokenId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState({ status: "error", message: msg });
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-8 sm:py-14">
      <div className="w-full max-w-lg space-y-6">
        <header className="space-y-3 text-center">
          <h1 className="font-tight text-3xl sm:text-4xl tracking-tight">Upload signed blob</h1>
          <p className="text-white/60 text-sm leading-relaxed">
            Submit a signed+encrypted voting-address blob that was produced on an
            offline machine. No wallet needed here — the signature is in the file.
          </p>
        </header>

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm p-6 sm:p-8 space-y-5">
          {state.status === "idle" && (
            <label className="block rounded-xl border border-dashed border-white/20 hover:border-brand-blue-500/60 hover:bg-brand-blue-500/5 transition-all cursor-pointer px-6 py-10 text-center space-y-2">
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
                className="sr-only"
              />
              <p className="text-sm font-medium text-white/80">Pick a .json blob</p>
              <p className="text-xs text-white/40">
                Produced by the offline-signing flow. One submission per file.
              </p>
            </label>
          )}

          {state.status === "submitting" && (
            <div className="rounded-xl border border-white/10 bg-black/20 px-6 py-8 text-center">
              <span className="inline-block h-2 w-2 rounded-full bg-brand-blue-500 animate-pulse mr-2 align-middle" />
              <span className="text-sm text-white/70">Submitting to server…</span>
            </div>
          )}

          {state.status === "submitted" && (
            <div className="rounded-xl border border-brand-green-500/30 bg-brand-green-500/[0.06] px-6 py-6 text-center space-y-2">
              <p className="font-tight text-lg text-brand-green-500">Submitted</p>
              <p className="text-sm text-white/70">
                Badge <span className="font-mono text-white">{state.tokenId}</span> recorded.
              </p>
              <p className="text-xs text-white/40 font-mono break-all">{state.receipt.submittedAt}</p>
            </div>
          )}

          {state.status === "error" && (
            <div className="rounded-xl border border-brand-red-500/30 bg-brand-red-500/[0.06] px-6 py-6 space-y-2 break-words">
              <p className="text-sm font-medium text-brand-red-500">Couldn&apos;t submit</p>
              <p className="text-xs text-brand-red-500/80 break-all">{state.message}</p>
              <button
                type="button"
                onClick={() => setState({ status: "idle" })}
                className="mt-2 text-xs text-white/60 hover:text-white underline-offset-2 hover:underline"
              >
                Try another file
              </button>
            </div>
          )}
        </section>

        <footer className="text-center pt-2">
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-white/50 hover:text-white/80 transition-colors"
          >
            ← Back to voter view
          </button>
        </footer>
      </div>
    </main>
  );
}

/**
 * Runtime shape check on the parsed JSON. Doesn't verify the signature —
 * that happens server-side in /submit — but fails fast on obviously
 * malformed uploads so the user gets a clear error before hitting the API.
 */
function validate(x: unknown): SubmitBody {
  if (!x || typeof x !== "object") throw new Error("File is not a JSON object");
  const o = x as Record<string, unknown>;
  const require = (k: string): unknown => {
    if (!(k in o)) throw new Error(`Missing field: ${k}`);
    return o[k];
  };
  const hex = (k: string, len?: number): `0x${string}` => {
    const v = require(k);
    if (typeof v !== "string" || !v.startsWith("0x")) {
      throw new Error(`Field ${k} must be a 0x-prefixed hex string`);
    }
    if (len != null && v.length !== len + 2) {
      throw new Error(`Field ${k} must be ${len} hex chars, got ${v.length - 2}`);
    }
    return v as `0x${string}`;
  };
  const str = (k: string): string => {
    const v = require(k);
    if (typeof v !== "string") throw new Error(`Field ${k} must be a string`);
    return v;
  };
  const num = (k: string): number => {
    const v = require(k);
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`Field ${k} must be a number`);
    }
    return v;
  };
  return {
    badgeContract: hex("badgeContract", 40),
    tokenId: str("tokenId"),
    holderWallet: hex("holderWallet", 40),
    ciphertext: str("ciphertext"),
    ciphertextHash: hex("ciphertextHash", 64),
    nonce: hex("nonce", 64),
    issuedAt: num("issuedAt"),
    expiresAt: num("expiresAt"),
    signature: hex("signature"),
  };
}
