#!/usr/bin/env tsx
/**
 * Admin decryption script — takes the CSV from /admin/export plus the
 * ML-KEM-768 private key file and outputs a clean decrypted CSV.
 *
 * Usage:
 *   pnpm --filter @ethsec/scripts decrypt \
 *     --in encrypted-export.csv \
 *     --key ./keys/private.key \
 *     --out decrypted.csv
 */
import { readFileSync, writeFileSync } from "node:fs";
import { hexToBytes } from "@noble/hashes/utils";
import { decryptBundle } from "@ethsec/shared";

function parseArgs(argv: string[]) {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const input = get("--in");
  if (!input) throw new Error("--in <path> required (encrypted CSV from /admin/export)");
  const keyPath = get("--key");
  if (!keyPath) throw new Error("--key <path> required (ML-KEM-768 private key file)");
  const output = get("--out") ?? input.replace(/\.csv$/, ".decrypted.csv");
  return { input, keyPath, output };
}

/**
 * Minimal RFC-4180 CSV line splitter. Handles double-quoted fields.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cur += c;
      }
    } else {
      if (c === '"') {
        quoted = true;
      } else if (c === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out;
}

function main(): void {
  const { input, keyPath, output } = parseArgs(process.argv.slice(2));

  // Load private key
  const keyHex = readFileSync(keyPath, "utf8").trim().replace(/^0x/, "");
  const secretKey = hexToBytes(keyHex);

  // Parse input CSV
  const raw = readFileSync(input, "utf8").trimEnd();
  const [headerLine, ...rows] = raw.split("\n");
  const headers = splitCsvLine(headerLine);

  const ctIdx = headers.indexOf("ciphertext");
  if (ctIdx < 0) throw new Error('Input CSV missing "ciphertext" column');
  const tokenIdIdx = headers.indexOf("token_id");
  const holderIdx = headers.indexOf("holder_wallet");
  const submittedIdx = headers.indexOf("submitted_at");

  // Decrypt each row
  const outHeader = "token_id,holder_wallet,voting_address,submitted_at";
  const outRows: string[] = [outHeader];
  let ok = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.trim()) continue;
    const cols = splitCsvLine(row);
    const ct = cols[ctIdx];
    const tokenId = tokenIdIdx >= 0 ? cols[tokenIdIdx] : "";
    const holderWallet = holderIdx >= 0 ? cols[holderIdx] : "";
    const submittedAt = submittedIdx >= 0 ? cols[submittedIdx] : "";

    try {
      const pt = decryptBundle(ct, secretKey) as {
        votingAddress: string;
        tokenId?: string;
        holderWallet?: string;
        timestamp?: string;
      };
      outRows.push(
        `"${tokenId}","${holderWallet}","${pt.votingAddress}","${submittedAt}"`,
      );
      ok++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`WARN: row token_id=${tokenId} decrypt failed: ${msg}`);
      outRows.push(`"${tokenId}","${holderWallet}","DECRYPT_FAILED","${submittedAt}"`);
      failed++;
    }
  }

  writeFileSync(output, outRows.join("\n") + "\n");
  console.log(`Decrypted ${ok} row(s), ${failed} failed. Output: ${output}`);
}

main();
