import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ml_kem768 } from "@noble/post-quantum/ml-kem";
import { bytesToHex } from "@noble/hashes/utils";
import { encryptPayload } from "@ethsec/shared";

describe("decrypt-export script", () => {
  it("round-trips a 1-row CSV", () => {
    const dir = mkdtempSync(join(tmpdir(), "decrypt-"));
    try {
      // Generate a fresh keypair
      const { publicKey, secretKey } = ml_kem768.keygen();
      const keyPath = join(dir, "priv.key");
      writeFileSync(keyPath, "0x" + bytesToHex(secretKey));

      // Encrypt a sample payload
      const votingAddr = "0x" + "1".repeat(40);
      const holderAddr = "0x" + "2".repeat(40);
      const { bundleB64 } = encryptPayload(
        {
          votingAddress: votingAddr,
          tokenId: "5",
          holderWallet: holderAddr,
          timestamp: "2026-01-01T00:00:00Z",
        },
        publicKey,
      );

      // Build input CSV matching /admin/export format
      const csv = [
        "id,token_id,holder_wallet,signature,ciphertext,ciphertext_hash,nonce,submitted_at",
        `"uuid-1","5","${holderAddr}","0xsig","${bundleB64}","0xhash","0xnonce","2026-01-01T00:00:00Z"`,
      ].join("\n");
      const inPath = join(dir, "enc.csv");
      writeFileSync(inPath, csv);

      const outPath = join(dir, "dec.csv");
      execSync(
        `pnpm tsx decrypt-export.ts --in "${inPath}" --key "${keyPath}" --out "${outPath}"`,
        { cwd: "C:/Users/Xerxes/Xerxes-Claude/ethsec-voting-badge/scripts", stdio: "pipe" },
      );

      const out = readFileSync(outPath, "utf8");
      expect(out).toContain(votingAddr);
      expect(out).toContain("5");
      expect(out).toContain(holderAddr);
      expect(out).toContain("2026-01-01T00:00:00Z");

      // Verify header line
      const lines = out.trimEnd().split("\n");
      expect(lines[0]).toBe("token_id,holder_wallet,voting_address,submitted_at");
      expect(lines).toHaveLength(2); // header + 1 data row
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles multiple rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "decrypt-multi-"));
    try {
      const { publicKey, secretKey } = ml_kem768.keygen();
      const keyPath = join(dir, "priv.key");
      writeFileSync(keyPath, "0x" + bytesToHex(secretKey));

      const rows: string[] = [
        "id,token_id,holder_wallet,signature,ciphertext,ciphertext_hash,nonce,submitted_at",
      ];
      for (let i = 1; i <= 3; i++) {
        const addr = "0x" + String(i).repeat(40);
        const { bundleB64 } = encryptPayload(
          { votingAddress: addr, tokenId: String(i), holderWallet: addr, timestamp: `2026-01-0${i}T00:00:00Z` },
          publicKey,
        );
        rows.push(`"uuid-${i}","${i}","${addr}","0xsig","${bundleB64}","0xhash","0xnonce","2026-01-0${i}T00:00:00Z"`);
      }

      const inPath = join(dir, "enc.csv");
      writeFileSync(inPath, rows.join("\n"));
      const outPath = join(dir, "dec.csv");

      execSync(
        `pnpm tsx decrypt-export.ts --in "${inPath}" --key "${keyPath}" --out "${outPath}"`,
        { cwd: "C:/Users/Xerxes/Xerxes-Claude/ethsec-voting-badge/scripts", stdio: "pipe" },
      );

      const lines = readFileSync(outPath, "utf8").trimEnd().split("\n");
      expect(lines).toHaveLength(4); // header + 3 rows
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
