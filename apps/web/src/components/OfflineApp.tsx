import { useEffect, useMemo, useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import {
  isAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import {
  buildDomain,
  VOTING_SUBMISSION_TYPES,
  encryptPayload,
} from "@ethsec/shared";
import { WalletConnect } from "./WalletConnect.js";
import { Decor } from "./Decor.js";
import { APP_CONFIG } from "../config.js";
import { getConfig, postSubmit, type SubmitBody, type SubmitOk } from "../api.js";

interface Props {
  onBack: () => void;
}

type UploadState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "submitted"; receipt: SubmitOk; tokenId: string }
  | { status: "error"; message: string };

/**
 * Offline mode — a single page that holds the whole airgapped workflow.
 *
 * Designed to work two ways:
 *   1. On a locally-served static bundle running on an airgapped machine:
 *      the user manually enters holder wallet + tokenId + voting address,
 *      signs via either a local wallet extension OR the copy-paste /
 *      external-signer path, then downloads a signed-blob JSON to carry
 *      to an online machine on USB.
 *   2. On the hosted site, after the user returns with a signed blob:
 *      the same page's "Submit signed blob" section accepts the JSON file
 *      and POSTs it to /submit.
 *
 * NFT-ownership validation happens at /submit — the server rejects if the
 * signer doesn't actually own the badge. That's the gate.
 */
export function OfflineApp({ onBack }: Props): JSX.Element {
  // ── Form state ──
  const [holderWallet, setHolderWallet] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [votingAddress, setVotingAddress] = useState("");

  // ── Signing path selection ──
  type SignMode = "wallet" | "external";
  const [signMode, setSignMode] = useState<SignMode>("wallet");

  // ── External-sign path state ──
  const [pastedSignature, setPastedSignature] = useState("");

  // ── Prepared message + signed blob ──
  type PrepState =
    | { status: "idle" }
    | { status: "preparing" }
    | {
        status: "ready";
        body: Omit<SubmitBody, "signature">;
        typedData: {
          domain: ReturnType<typeof buildDomain>;
          types: typeof VOTING_SUBMISSION_TYPES;
          primaryType: "VotingAddressSubmission";
          message: Record<string, string | number>;
        };
      }
    | { status: "signed"; blob: SubmitBody }
    | { status: "error"; message: string };
  const [prep, setPrep] = useState<PrepState>({ status: "idle" });

  // ── Upload-blob state (separate — this section also works when the user
  // returns with a file they signed somewhere else) ──
  const [upload, setUpload] = useState<UploadState>({ status: "idle" });

  const { address: walletAddr } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();

  // When the connected wallet changes, auto-fill the holder field in
  // wallet mode so the user doesn't have to re-type.
  useEffect(() => {
    if (signMode === "wallet" && walletAddr && !holderWallet) {
      setHolderWallet(walletAddr);
    }
  }, [signMode, walletAddr, holderWallet]);

  // ── Prepare: validate inputs, fetch (or bake-in) the encryption pubkey,
  // encrypt the voting address, and build the EIP-712 payload. Does NOT
  // sign — signing happens next either via wagmi or the external path. ──
  async function prepare(): Promise<void> {
    if (!isAddress(holderWallet)) {
      setPrep({ status: "error", message: "Holder wallet must be a 0x EVM address." });
      return;
    }
    if (!/^\d+$/.test(tokenId)) {
      setPrep({ status: "error", message: "Badge token ID must be a positive integer." });
      return;
    }
    if (!isAddress(votingAddress)) {
      setPrep({ status: "error", message: "Voting address must be a 0x EVM address." });
      return;
    }

    setPrep({ status: "preparing" });
    try {
      // Encryption public key: either baked in (air-gapped build) or fetched.
      let pubKeyHex = APP_CONFIG.encryptionPublicKeyHex;
      let chainId = APP_CONFIG.chainId;
      let badgeContract = APP_CONFIG.badgeContract as Address;
      if (!pubKeyHex) {
        const cfg = await getConfig();
        pubKeyHex = cfg.encryptionPublicKey;
        chainId = cfg.chainId;
        badgeContract = cfg.badgeContract;
      }

      const issuedAt = Math.floor(Date.now() / 1000);
      const expiresAt = issuedAt + 600;
      const nonce = randomHex32();

      const plaintext = {
        votingAddress: votingAddress as Address,
        tokenId,
        holderWallet: holderWallet as Address,
        timestamp: new Date().toISOString(),
      };
      const { bundleB64, bundleHash } = encryptPayload(plaintext, hexToBytes(pubKeyHex as `0x${string}`));

      const body: Omit<SubmitBody, "signature"> = {
        badgeContract,
        tokenId,
        holderWallet: holderWallet as Address,
        ciphertext: bundleB64,
        ciphertextHash: bundleHash,
        nonce,
        issuedAt,
        expiresAt,
      };

      const typedData = {
        domain: buildDomain(chainId),
        types: VOTING_SUBMISSION_TYPES,
        primaryType: "VotingAddressSubmission" as const,
        message: {
          badgeContract,
          tokenId,
          holderWallet,
          ciphertextHash: bundleHash,
          nonce,
          issuedAt,
          expiresAt,
        },
      };

      setPrep({ status: "ready", body, typedData });
      setPastedSignature("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPrep({ status: "error", message: msg });
    }
  }

  // ── Sign via the connected wallet (Path A). ──
  async function signWithWallet(): Promise<void> {
    if (prep.status !== "ready") return;
    if (!walletAddr) {
      setPrep({ status: "error", message: "Connect a wallet first, or switch to the external-sign path." });
      return;
    }
    try {
      const sig = (await signTypedDataAsync({
        domain: prep.typedData.domain,
        types: prep.typedData.types,
        primaryType: prep.typedData.primaryType,
        message: {
          badgeContract: prep.body.badgeContract,
          tokenId: BigInt(prep.body.tokenId),
          holderWallet: prep.body.holderWallet,
          ciphertextHash: prep.body.ciphertextHash,
          nonce: prep.body.nonce,
          issuedAt: BigInt(prep.body.issuedAt),
          expiresAt: BigInt(prep.body.expiresAt),
        },
      })) as Hex;
      const blob: SubmitBody = { ...prep.body, signature: sig };
      downloadJson(blob, `ethsec-submission-badge-${prep.body.tokenId}.json`);
      setPrep({ status: "signed", blob });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPrep({ status: "error", message: msg });
    }
  }

  // ── Accept an externally-produced signature (Path B). Verifies that it
  // recovers to the holder wallet before producing the blob. ──
  async function applyExternalSignature(): Promise<void> {
    if (prep.status !== "ready") return;
    const sig = pastedSignature.trim() as Hex;
    if (!/^0x[a-fA-F0-9]{130}$/.test(sig)) {
      setPrep({ status: "error", message: "Signature must be a 0x-prefixed 65-byte hex string (132 chars)." });
      return;
    }
    try {
      const recovered = await recoverTypedDataAddress({
        domain: prep.typedData.domain,
        types: prep.typedData.types,
        primaryType: prep.typedData.primaryType,
        message: {
          badgeContract: prep.body.badgeContract,
          tokenId: BigInt(prep.body.tokenId),
          holderWallet: prep.body.holderWallet,
          ciphertextHash: prep.body.ciphertextHash,
          nonce: prep.body.nonce,
          issuedAt: BigInt(prep.body.issuedAt),
          expiresAt: BigInt(prep.body.expiresAt),
        },
        signature: sig,
      });
      if (recovered.toLowerCase() !== prep.body.holderWallet.toLowerCase()) {
        setPrep({
          status: "error",
          message: `Signature recovers to ${recovered}, not the holder wallet ${prep.body.holderWallet}.`,
        });
        return;
      }
      const blob: SubmitBody = { ...prep.body, signature: sig };
      downloadJson(blob, `ethsec-submission-badge-${prep.body.tokenId}.json`);
      setPrep({ status: "signed", blob });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPrep({ status: "error", message: msg });
    }
  }

  // ── Upload-blob handler (separate flow; works when online). ──
  async function onUploadFile(file: File | null): Promise<void> {
    if (!file) return;
    setUpload({ status: "submitting" });
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const body = validateSubmitBody(parsed);
      const receipt = await postSubmit(body);
      setUpload({ status: "submitted", receipt, tokenId: body.tokenId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setUpload({ status: "error", message: msg });
    }
  }

  const typedJsonPretty = useMemo(() => {
    if (prep.status !== "ready") return "";
    return JSON.stringify(
      {
        domain: prep.typedData.domain,
        types: prep.typedData.types,
        primaryType: prep.typedData.primaryType,
        message: prep.typedData.message,
      },
      null,
      2,
    );
  }, [prep]);

  const castOneLiner = useMemo(() => {
    if (prep.status !== "ready") return "";
    return `cast wallet sign-typed-data --data '${typedJsonPretty.replace(/'/g, "'\\''")}' --private-key $PRIVATE_KEY`;
  }, [prep, typedJsonPretty]);

  const ethersScriptSnippet = useMemo(() => {
    if (prep.status !== "ready") return "";
    return `# save the JSON above as payload.json, then:
echo "PRIVATE_KEY=0x..." > .env
pnpm --filter @ethsec/scripts sign-offline --in payload.json --out sig.txt
# the 0x… signature lands in sig.txt`;
  }, [prep]);

  return (
    <section className="relative min-h-screen overflow-hidden pt-16 pb-24">
      <Decor />

      <div className="relative z-10 w-full max-w-2xl mx-auto px-4 space-y-6">
        {/* Header */}
        <header className="space-y-4 text-center animate-fadeIn">
          <div className="flex justify-center">
            <video
              autoPlay
              loop
              muted
              playsInline
              src="/eth-security-badge.mp4"
              className="w-32 h-32 rounded-full shadow-xl shadow-dao-red/15"
            />
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-dao-red/15 px-3 py-1 text-xs font-semibold tracking-wider uppercase text-dao-red ring-1 ring-dao-red/30">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-dao-red animate-pulse" />
            Offline mode
          </div>
          <h1 className="font-tight text-4xl sm:text-5xl font-semibold tracking-tight leading-tight">
            Offline signing
          </h1>
          <p className="text-gray-300 text-base sm:text-lg max-w-lg mx-auto leading-relaxed">
            For badge holders whose signing keys live on an airgapped machine. Sign the
            voting message locally, export the signed blob, then come back online to
            submit. No private key ever crosses the air gap.
          </p>
        </header>

        {/* SECTION 1 — Form + Signing */}
        <section className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm p-6 sm:p-8">
          <h2 className="font-tight text-xl">1. Compose your submission</h2>

          <div className="space-y-4">
            <Field
              label="Holder wallet"
              hint="The 0x address that owns your ETHSecurity badge."
              value={holderWallet}
              onChange={setHolderWallet}
              placeholder="0x..."
            />
            <Field
              label="Badge token ID"
              hint="The tokenId you hold in the badge contract."
              value={tokenId}
              onChange={setTokenId}
              placeholder="e.g. 42"
              inputMode="numeric"
            />
            <Field
              label="Voting address"
              hint="Where your vote weight goes. Encrypted in-browser before it leaves this page."
              value={votingAddress}
              onChange={setVotingAddress}
              placeholder="0x..."
            />
          </div>

          {prep.status === "idle" && (
            <button
              type="button"
              onClick={prepare}
              className="w-full rounded-xl bg-brand-blue-500/80 hover:bg-brand-blue-500 active:scale-[0.98] px-5 py-3 text-sm font-semibold tracking-wide transition-all"
            >
              Encrypt &amp; prepare message
            </button>
          )}

          {prep.status === "preparing" && (
            <div className="rounded-xl bg-black/20 border border-white/10 px-4 py-3 text-sm text-white/60">
              <span className="inline-block h-2 w-2 rounded-full bg-brand-blue-500 animate-pulse mr-2 align-middle" />
              Encrypting and building EIP-712 payload…
            </div>
          )}

          {prep.status === "error" && (
            <div className="rounded-xl bg-brand-red-500/10 border border-brand-red-500/30 px-4 py-3 text-sm text-brand-red-500 break-words">
              <p className="font-medium mb-1">Prepare failed</p>
              <p className="text-xs text-brand-red-500/80 break-all">{prep.message}</p>
              <button
                type="button"
                onClick={() => setPrep({ status: "idle" })}
                className="mt-2 text-xs text-white/60 hover:text-white underline-offset-2 hover:underline"
              >
                Try again
              </button>
            </div>
          )}

          {prep.status === "ready" && (
            <>
              <div className="rounded-xl bg-brand-blue-500/10 border border-brand-blue-500/30 px-4 py-3 text-xs text-white/80 space-y-1">
                <p>Payload ready. Sign with one of the two paths below.</p>
                <p className="text-white/50">
                  Expires {new Date(prep.body.expiresAt * 1000).toLocaleString()} — sign before that or re-prepare.
                </p>
              </div>

              {/* Path toggle */}
              <div className="flex rounded-xl border border-white/10 overflow-hidden">
                <PathButton active={signMode === "wallet"} onClick={() => setSignMode("wallet")}>
                  Connect wallet
                </PathButton>
                <PathButton active={signMode === "external"} onClick={() => setSignMode("external")}>
                  Sign externally
                </PathButton>
              </div>

              {signMode === "wallet" ? (
                <div className="space-y-3">
                  <WalletConnect />
                  <button
                    type="button"
                    onClick={signWithWallet}
                    disabled={!walletAddr}
                    className="w-full rounded-xl bg-brand-green-500 hover:bg-brand-green-500/85 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 px-5 py-3 text-sm font-semibold tracking-wide transition-all"
                  >
                    Sign &amp; download signed blob
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-white/60 uppercase tracking-wider">
                      1) Copy this EIP-712 payload
                    </p>
                    <pre className="max-h-48 overflow-auto rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-xs font-mono text-white/70 whitespace-pre-wrap break-all">
                      {typedJsonPretty}
                    </pre>
                    <CopyButton text={typedJsonPretty} label="Copy payload JSON" />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-white/60 uppercase tracking-wider">
                      2) Sign it with your tool of choice
                    </p>
                    <p className="text-xs text-white/40 leading-relaxed">
                      Any EIP-712 signer works: Foundry&apos;s <span className="font-mono text-white/60">cast</span>,
                      an ethers.js script, MyEtherWallet&apos;s offline message signer, Frame, or a hardware wallet
                      via MetaMask/Rabby running on this machine. Two ready-to-paste snippets:
                    </p>
                    <div className="space-y-2">
                      <p className="text-[10px] font-medium text-white/50 uppercase tracking-wider">cast (Foundry)</p>
                      <pre className="max-h-32 overflow-auto rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-[10px] font-mono text-white/60 whitespace-pre-wrap break-all">
                        {castOneLiner}
                      </pre>
                      <CopyButton text={castOneLiner} label="Copy cast command" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] font-medium text-white/50 uppercase tracking-wider">
                        ethers.js (our sign-offline script — pattern after pcaversaccio/raw-tx)
                      </p>
                      <pre className="max-h-32 overflow-auto rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-[10px] font-mono text-white/60 whitespace-pre-wrap break-all">
                        {ethersScriptSnippet}
                      </pre>
                      <CopyButton text={ethersScriptSnippet} label="Copy sign-offline command" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-white/60 uppercase tracking-wider">
                      3) Paste the resulting 0x… signature
                    </p>
                    <textarea
                      value={pastedSignature}
                      onChange={(e) => setPastedSignature(e.target.value)}
                      placeholder="0x…"
                      rows={3}
                      className="w-full rounded-xl bg-black/30 border border-white/10 focus:border-brand-blue-500 focus:ring-1 focus:ring-brand-blue-500/40 px-4 py-3 text-xs font-mono placeholder:text-white/20 outline-none transition-all resize-none"
                    />
                    <button
                      type="button"
                      onClick={applyExternalSignature}
                      disabled={pastedSignature.trim().length === 0}
                      className="w-full rounded-xl bg-brand-green-500 hover:bg-brand-green-500/85 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 px-5 py-3 text-sm font-semibold tracking-wide transition-all"
                    >
                      Verify &amp; download signed blob
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {prep.status === "signed" && (
            <div className="rounded-xl bg-brand-green-500/10 border border-brand-green-500/30 px-4 py-4 text-sm text-white/80 space-y-2">
              <p className="text-brand-green-500 font-medium">Signed blob downloaded</p>
              <p className="text-xs text-white/60">
                File: <span className="font-mono">ethsec-submission-badge-{prep.blob.tokenId}.json</span>
              </p>
              <p className="text-xs text-white/60 leading-relaxed">
                Transfer it to an online machine (USB, SD, scp). Upload it below — or come back to this
                page on the online machine and upload from there.
              </p>
              <button
                type="button"
                onClick={() => setPrep({ status: "idle" })}
                className="text-xs text-white/60 hover:text-white underline-offset-2 hover:underline"
              >
                Sign another
              </button>
            </div>
          )}
        </section>

        {/* SECTION 2 — Upload signed blob */}
        <section className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm p-6 sm:p-8">
          <h2 className="font-tight text-xl">2. Submit a signed blob</h2>
          <p className="text-xs text-white/50 leading-relaxed">
            Upload a file you signed here, or one you signed on a different (offline) machine.
            Requires an internet connection — posts to the voting-badge API. Ownership of the badge
            is verified onchain at the server; an invalid submission is rejected with a clear error.
          </p>

          {upload.status === "idle" && (
            <label className="block rounded-xl border border-dashed border-white/20 hover:border-brand-blue-500/60 hover:bg-brand-blue-500/5 transition-all cursor-pointer px-6 py-8 text-center space-y-2">
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => onUploadFile(e.target.files?.[0] ?? null)}
                className="sr-only"
              />
              <p className="text-sm font-medium text-white/80">Pick a .json blob</p>
              <p className="text-xs text-white/40">One submission per file.</p>
            </label>
          )}

          {upload.status === "submitting" && (
            <div className="rounded-xl border border-white/10 bg-black/20 px-6 py-6 text-center text-sm text-white/70">
              <span className="inline-block h-2 w-2 rounded-full bg-brand-blue-500 animate-pulse mr-2 align-middle" />
              Submitting to server…
            </div>
          )}

          {upload.status === "submitted" && (
            <div className="rounded-xl border border-brand-green-500/30 bg-brand-green-500/[0.06] px-6 py-5 text-center space-y-1.5">
              <p className="font-tight text-lg text-brand-green-500">Submitted</p>
              <p className="text-sm text-white/70">
                Badge <span className="font-mono text-white">{upload.tokenId}</span> recorded.
              </p>
              <p className="text-xs text-white/40 font-mono break-all">{upload.receipt.submittedAt}</p>
              <button
                type="button"
                onClick={() => setUpload({ status: "idle" })}
                className="mt-1 text-xs text-white/60 hover:text-white underline-offset-2 hover:underline"
              >
                Upload another
              </button>
            </div>
          )}

          {upload.status === "error" && (
            <div className="rounded-xl border border-brand-red-500/30 bg-brand-red-500/[0.06] px-6 py-4 space-y-1.5 break-words">
              <p className="text-sm font-medium text-brand-red-500">Couldn&apos;t submit</p>
              <p className="text-xs text-brand-red-500/80 break-all">{upload.message}</p>
              <button
                type="button"
                onClick={() => setUpload({ status: "idle" })}
                className="text-xs text-white/60 hover:text-white underline-offset-2 hover:underline"
              >
                Try another file
              </button>
            </div>
          )}
        </section>

        {/* SECTION 3 — How to run this offline */}
        <section className="rounded-2xl border border-white/5 bg-black/20 p-5 sm:p-6 text-xs text-white/50 leading-relaxed space-y-2">
          <p className="font-medium text-white/70">Running this page offline</p>
          <p>
            For a truly airgapped machine, build the static bundle on an online machine
            and carry it across the air gap:
          </p>
          <pre className="rounded-lg bg-black/40 border border-white/10 px-3 py-2 font-mono text-[11px] text-white/60 overflow-auto">{`git clone https://github.com/griffgiveth/ethsec-voting-badge.git
cd ethsec-voting-badge
pnpm install
pnpm --filter @ethsec/web build
# copy apps/web/dist/ to USB, move to offline machine
npx --yes http-server apps/web/dist -p 5174`}</pre>
          <p>
            On the offline machine, open <span className="font-mono text-white/70">http://localhost:5174</span>,
            pick <span className="text-white/70">Offline</span>, complete Section 1 above, download the
            signed blob, carry it back to an online machine, and use Section 2 to submit.
          </p>
        </section>

        <footer className="text-center pt-2">
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

/* ──────────────────────── helpers ──────────────────────── */

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  inputMode?: "text" | "numeric";
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-white/60 uppercase tracking-wider">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode ?? "text"}
        autoComplete="off"
        className="w-full rounded-xl bg-black/30 border border-white/10 focus:border-brand-blue-500 focus:ring-1 focus:ring-brand-blue-500/40 px-4 py-3 text-sm font-mono placeholder:text-white/20 outline-none transition-all"
      />
      {hint && <p className="text-xs text-white/30">{hint}</p>}
    </div>
  );
}

function PathButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
        active ? "bg-brand-blue-500/20 text-white" : "text-white/50 hover:text-white/80"
      }`}
    >
      {children}
    </button>
  );
}

function CopyButton({ text, label }: { text: string; label: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard permission denied — no-op, user can still select+copy manually.
        }
      }}
      className="text-xs text-white/50 hover:text-white/80 underline-offset-2 hover:underline transition-colors"
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const s = hex.slice(2);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

function randomHex32(): `0x${string}` {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let hex = "0x";
  for (const b of buf) hex += b.toString(16).padStart(2, "0");
  return hex as `0x${string}`;
}

function downloadJson(body: SubmitBody, filename: string): void {
  const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function validateSubmitBody(x: unknown): SubmitBody {
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
