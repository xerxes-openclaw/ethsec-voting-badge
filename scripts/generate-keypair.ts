#!/usr/bin/env tsx
import { ml_kem768 } from "@noble/post-quantum/ml-kem";
import { bytesToHex } from "@noble/hashes/utils";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const baseDir = process.env.INIT_CWD ?? process.cwd();
const outDir = resolve(baseDir, process.argv[2] ?? "./keys");
const pubPath  = resolve(outDir, "public.key");
const privPath = resolve(outDir, "private.key");

if (existsSync(privPath)) {
  console.error(`refusing to overwrite ${privPath} — move or delete the existing file first`);
  process.exit(1);
}

import { mkdirSync } from "node:fs";
mkdirSync(outDir, { recursive: true });

const { publicKey, secretKey } = ml_kem768.keygen();
writeFileSync(pubPath,  "0x" + bytesToHex(publicKey) + "\n",  { mode: 0o644 });
writeFileSync(privPath, "0x" + bytesToHex(secretKey) + "\n", { mode: 0o600 });

console.log(`✔ public.key  → ${pubPath}  (commit-safe)`);
console.log(`✔ private.key → ${privPath} (KEEP OFFLINE — never commit, never upload)`);
console.log(`\nPaste the public key into VITE_ENCRYPTION_PUBLIC_KEY_HEX.`);
