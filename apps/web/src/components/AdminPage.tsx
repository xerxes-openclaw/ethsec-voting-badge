import { useState, useCallback } from "react";
import { decryptBundle } from "@ethsec/shared";
import { APP_CONFIG } from "../config.js";

interface DecryptedRow {
  id: string;
  tokenId: string;
  holderWallet: string;
  votingAddress: string;
  timestamp: string;
  supersededAt: string;   // "" when active
  supersededBy: string;   // "" when active
}

interface RawRow {
  id: string;
  token_id: string;
  holder_wallet: string;
  ciphertext: string;
  superseded_at: string;
  superseded_by: string;
}

function parseCSV(csv: string): RawRow[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(",");
  const idIdx = headers.indexOf("id");
  const tokenIdx = headers.indexOf("token_id");
  const walletIdx = headers.indexOf("holder_wallet");
  const cipherIdx = headers.indexOf("ciphertext");
  const supAtIdx = headers.indexOf("superseded_at");
  const supByIdx = headers.indexOf("superseded_by");
  if (tokenIdx < 0 || walletIdx < 0 || cipherIdx < 0) return [];

  return lines.slice(1).map((line) => {
    const cols = parseCSVLine(line);
    return {
      id: idIdx >= 0 ? (cols[idIdx] ?? "") : "",
      token_id: cols[tokenIdx] ?? "",
      holder_wallet: cols[walletIdx] ?? "",
      ciphertext: cols[cipherIdx] ?? "",
      superseded_at: supAtIdx >= 0 ? (cols[supAtIdx] ?? "") : "",
      superseded_by: supByIdx >= 0 ? (cols[supByIdx] ?? "") : "",
    };
  });
}

function parseCSVLine(line: string): string[] {
  const cols: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { cols.push(current); current = ""; continue; }
    current += ch;
  }
  cols.push(current);
  return cols;
}

function hexToBytes(hex: string): Uint8Array {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

function downloadCSV(rows: DecryptedRow[]): void {
  const header = "id,token_id,holder_wallet,voting_address,timestamp,superseded_at,superseded_by";
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const body = rows.map((r) => [r.id, r.tokenId, r.holderWallet, r.votingAddress, r.timestamp, r.supersededAt, r.supersededBy].map(esc).join(",")).join("\n");
  const blob = new Blob([header + "\n" + body], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `votes-decrypted-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function AdminPage({ onBack }: { onBack: () => void }): JSX.Element {
  const [adminToken, setAdminToken] = useState("");
  const [privateKeyHex, setPrivateKeyHex] = useState<string | null>(null);
  const [privateKeyName, setPrivateKeyName] = useState("");
  const [rows, setRows] = useState<DecryptedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadKey = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPrivateKeyName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = (reader.result as string).trim();
      setPrivateKeyHex(text);
      setError(null);
    };
    reader.readAsText(file);
  }, []);

  const run = useCallback(async () => {
    if (!adminToken) { setError("Enter the admin export token."); return; }
    if (!privateKeyHex) { setError("Upload the private key file first."); return; }
    setLoading(true);
    setError(null);
    setRows(null);
    try {
      const headers: Record<string, string> = { "Authorization": `Bearer ${adminToken}` };
      if (APP_CONFIG.isTunnel) headers["bypass-tunnel-reminder"] = "true";
      const res = await fetch(`${APP_CONFIG.apiBaseUrl}/admin/export`, { headers });
      if (!res.ok) throw new Error(`Export failed: ${res.status} ${res.statusText}`);
      const csv = await res.text();
      const raw = parseCSV(csv);
      if (raw.length === 0) { setRows([]); return; }

      const sk = hexToBytes(privateKeyHex);
      const decrypted: DecryptedRow[] = [];
      for (const r of raw) {
        try {
          const plain = decryptBundle(r.ciphertext, sk) as {
            votingAddress: string;
            tokenId: string;
            holderWallet: string;
            timestamp: string;
          };
          decrypted.push({
            id: r.id,
            tokenId: r.token_id,
            holderWallet: r.holder_wallet,
            votingAddress: plain.votingAddress,
            timestamp: plain.timestamp,
            supersededAt: r.superseded_at,
            supersededBy: r.superseded_by,
          });
        } catch (err) {
          decrypted.push({
            id: r.id,
            tokenId: r.token_id,
            holderWallet: r.holder_wallet,
            votingAddress: `[DECRYPT FAILED: ${(err as Error).message}]`,
            timestamp: "",
            supersededAt: r.superseded_at,
            supersededBy: r.superseded_by,
          });
        }
      }
      // Sort: active rows first, then superseded (oldest-superseded last).
      decrypted.sort((a, b) => {
        const aSup = a.supersededAt ? 1 : 0;
        const bSup = b.supersededAt ? 1 : 0;
        if (aSup !== bSup) return aSup - bSup;
        return a.tokenId.localeCompare(b.tokenId, undefined, { numeric: true });
      });
      setRows(decrypted);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [adminToken, privateKeyHex]);

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-8 sm:py-14">
      <div className="w-full max-w-2xl space-y-6">
        <header className="space-y-3 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-red-500/20 px-3 py-1 text-xs font-medium text-brand-red-500 ring-1 ring-brand-red-500/30">
            Admin
          </div>
          <h1 className="font-tight text-3xl sm:text-4xl tracking-tight">
            Decrypt Votes
          </h1>
          <p className="text-white/60 text-sm max-w-md mx-auto leading-relaxed">
            Export encrypted submissions from the server and decrypt them
            in-browser using your private key. Nothing leaves this page.
          </p>
        </header>

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm p-6 sm:p-8 space-y-5">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-white/60 uppercase tracking-wider">
              Admin Export Token
            </label>
            <input
              type="password"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              placeholder="Paste your ADMIN_EXPORT_TOKEN"
              className="w-full rounded-xl bg-black/30 border border-white/10 focus:border-brand-blue-500 focus:ring-1 focus:ring-brand-blue-500/40 px-4 py-3 text-sm font-mono placeholder:text-white/20 outline-none transition-all duration-200"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-white/60 uppercase tracking-wider">
              Private Key File
            </label>
            <label className="flex items-center gap-3 cursor-pointer rounded-xl bg-black/30 border border-white/10 hover:border-white/20 px-4 py-3 transition-all duration-200">
              <svg className="h-5 w-5 text-white/40 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />
              </svg>
              <span className="text-sm text-white/50">
                {privateKeyName || "Choose private.key file..."}
              </span>
              <input type="file" accept=".key,.txt,.pem" onChange={loadKey} className="hidden" />
            </label>
            <p className="text-xs text-white/30">
              The key stays in your browser. It is never uploaded or sent anywhere.
            </p>
          </div>

          {error && (
            <div className="rounded-lg bg-brand-red-500/10 border border-brand-red-500/30 px-4 py-2.5">
              <p className="text-sm text-brand-red-500">{error}</p>
            </div>
          )}

          <button
            onClick={run}
            disabled={loading}
            className="w-full rounded-xl bg-brand-blue-500 hover:bg-brand-blue-500/85 active:scale-[0.98] disabled:opacity-40 px-5 py-3.5 text-sm font-semibold tracking-wide transition-all duration-200"
          >
            {loading ? "Decrypting..." : "Export & Decrypt"}
          </button>
        </section>

        {rows !== null && (
          <section className="animate-scaleIn rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm p-6 sm:p-8 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-tight text-xl">
                {rows.length} vote{rows.length !== 1 ? "s" : ""} decrypted
              </h2>
              {rows.length > 0 && (
                <button
                  onClick={() => downloadCSV(rows)}
                  className="rounded-lg border border-white/10 hover:bg-white/5 px-3 py-1.5 text-xs font-medium transition-all duration-200"
                >
                  Download CSV
                </button>
              )}
            </div>

            {rows.length === 0 ? (
              <p className="text-sm text-white/50">No submissions yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-white/40 uppercase tracking-wider">
                      <th className="pb-3 pr-4">Badge</th>
                      <th className="pb-3 pr-4">Holder</th>
                      <th className="pb-3 pr-4">Voting Address</th>
                      <th className="pb-3 pr-4">Time</th>
                      <th className="pb-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-xs">
                    {rows.map((r) => {
                      const superseded = r.supersededAt !== "";
                      return (
                        <tr
                          key={r.id || `${r.tokenId}-${r.timestamp}`}
                          className={`border-t border-white/5 ${superseded ? "opacity-40" : ""}`}
                        >
                          <td className="py-2.5 pr-4 text-white">{r.tokenId}</td>
                          <td className="py-2.5 pr-4 text-white/60">{r.holderWallet.slice(0, 8)}...{r.holderWallet.slice(-4)}</td>
                          <td className={`py-2.5 pr-4 ${superseded ? "text-white/60 line-through" : "text-brand-green-500"}`}>
                            {r.votingAddress.slice(0, 10)}...{r.votingAddress.slice(-4)}
                          </td>
                          <td className="py-2.5 pr-4 text-white/40">{r.timestamp.slice(0, 16)}</td>
                          <td className="py-2.5">
                            {superseded ? (
                              <span
                                className="inline-block rounded bg-brand-red-500/15 border border-brand-red-500/30 px-2 py-0.5 text-[10px] uppercase tracking-wider text-brand-red-500"
                                title={`Replaced ${r.supersededAt.slice(0, 16)} by ${r.supersededBy.slice(0, 8)}…`}
                              >
                                Superseded
                              </span>
                            ) : (
                              <span className="inline-block rounded bg-brand-green-500/15 border border-brand-green-500/30 px-2 py-0.5 text-[10px] uppercase tracking-wider text-brand-green-500">
                                Active
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <div className="text-center">
          <button
            onClick={onBack}
            className="rounded-xl border border-white/10 hover:bg-white/5 px-5 py-2.5 text-sm font-medium transition-all duration-200"
          >
            Back to voter view
          </button>
        </div>

        <footer className="text-center text-xs text-white/30 pt-4">
          ETHSecurity Voting Badge &middot; DAO.fund
        </footer>
      </div>
    </main>
  );
}
