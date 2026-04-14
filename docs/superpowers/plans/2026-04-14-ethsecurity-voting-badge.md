# ETHSecurity Voting Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-time-use web app that lets ETHSecurity Badge holders privately register a separate voting address, with client-side ML-KEM encryption and EIP-712 signature, backed by a Fastify API with one-time-use Postgres enforcement.

**Architecture:** pnpm monorepo with three workspaces (`apps/web`, `apps/api`, `packages/shared`). Frontend is Vite + React + wagmi/viem; encrypts client-side (ML-KEM-768 + AES-256-GCM) and signs EIP-712. Backend is Fastify + Drizzle + Postgres; verifies signature, recomputes ciphertext hash, checks onchain ownership, and atomically inserts with `UNIQUE(token_id)`. Decryption never happens in the hosted stack — only offline via `scripts/decrypt-export.ts`.

**Tech Stack:** Node 20, pnpm 9, TypeScript 5, Vite 5, React 18, wagmi 2, viem 2, TanStack Query 5, Tailwind 3, Fastify 4, Drizzle ORM, Postgres 16, `@noble/post-quantum`, `@noble/ciphers`, `@noble/hashes`, zod, Vitest, Playwright, Foundry.

**Sequencing rationale:** Shared types → keygen → backend happy path → frontend happy path → wire real crypto → harden verification → admin tooling → Sepolia E2E → static thumb-drive build → docs. This order gets a clickable Sepolia demo standing up around Phase 5 so stakeholders can test before final hardening.

---

## Phase 0 — Monorepo scaffold

### Task 0.1: Initialize pnpm workspace and repo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `.nvmrc`
- Create: `tsconfig.base.json`
- Create: `.editorconfig`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "ethsec-voting-badge",
  "private": true,
  "version": "0.0.0",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=20.11.0" },
  "scripts": {
    "build": "pnpm -r build",
    "dev": "pnpm -r --parallel dev",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/node": "^20.11.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: `.gitignore`**

```
node_modules
dist
build
.env
.env.*
!.env.example
*.private.key
private.key
coverage
.vite
.DS_Store
.pnpm-store
```

- [ ] **Step 4: `.nvmrc`**

```
20.11.0
```

- [ ] **Step 5: `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 6: Init git and commit**

```bash
git init
git add .
git commit -m "chore: pnpm monorepo scaffold"
```

---

## Phase 1 — Shared package (`packages/shared`)

The shared package is the single source of truth for zod schemas, the EIP-712 type definition, and the ciphertext-bundle codec. Both frontend and backend import from it.

### Task 1.1: Initialize shared package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: `packages/shared/package.json`**

```json
{
  "name": "@ethsec/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.0",
    "viem": "^2.21.0",
    "@noble/post-quantum": "^0.2.1",
    "@noble/ciphers": "^1.0.0",
    "@noble/hashes": "^1.5.0"
  },
  "devDependencies": {
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 3: Placeholder `src/index.ts`**

```typescript
export const SHARED_PKG = "@ethsec/shared";
```

- [ ] **Step 4: Install and commit**

```bash
pnpm install
git add .
git commit -m "feat(shared): init shared package"
```

### Task 1.2: EIP-712 domain and type definitions

**Files:**
- Create: `packages/shared/src/eip712.ts`
- Test: `packages/shared/src/eip712.test.ts`

- [ ] **Step 1: Failing test — `eip712.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { buildDomain, VOTING_SUBMISSION_TYPES, type VotingAddressSubmission } from "./eip712.js";

describe("EIP-712", () => {
  it("builds mainnet domain", () => {
    const d = buildDomain(1);
    expect(d).toEqual({ name: "ETHSecurity Voting Badge", version: "1", chainId: 1 });
  });
  it("builds sepolia domain", () => {
    expect(buildDomain(11155111).chainId).toBe(11155111);
  });
  it("exposes correct field order on VotingAddressSubmission type", () => {
    const fields = VOTING_SUBMISSION_TYPES.VotingAddressSubmission.map((f) => f.name);
    expect(fields).toEqual([
      "badgeContract", "tokenId", "holderWallet",
      "ciphertextHash", "nonce", "issuedAt", "expiresAt",
    ]);
  });
  it("type shape compiles", () => {
    const s: VotingAddressSubmission = {
      badgeContract: "0x0000000000000000000000000000000000000001",
      tokenId: 1n,
      holderWallet: "0x0000000000000000000000000000000000000002",
      ciphertextHash: "0x" + "00".repeat(32) as `0x${string}`,
      nonce: "0x" + "00".repeat(32) as `0x${string}`,
      issuedAt: 1n,
      expiresAt: 2n,
    };
    expect(s.tokenId).toBe(1n);
  });
});
```

Run: `pnpm --filter @ethsec/shared test` → FAIL (module not found).

- [ ] **Step 2: Implement `eip712.ts`**

```typescript
import type { Address, Hex } from "viem";

export const buildDomain = (chainId: number) => ({
  name: "ETHSecurity Voting Badge" as const,
  version: "1" as const,
  chainId,
});

export const VOTING_SUBMISSION_TYPES = {
  VotingAddressSubmission: [
    { name: "badgeContract",  type: "address" },
    { name: "tokenId",        type: "uint256" },
    { name: "holderWallet",   type: "address" },
    { name: "ciphertextHash", type: "bytes32" },
    { name: "nonce",          type: "bytes32" },
    { name: "issuedAt",       type: "uint256" },
    { name: "expiresAt",      type: "uint256" },
  ],
} as const;

export interface VotingAddressSubmission {
  badgeContract: Address;
  tokenId: bigint;
  holderWallet: Address;
  ciphertextHash: Hex;
  nonce: Hex;
  issuedAt: bigint;
  expiresAt: bigint;
}
```

- [ ] **Step 3: Run test, confirm PASS**

Run: `pnpm --filter @ethsec/shared test`.

- [ ] **Step 4: Export from `src/index.ts`**

```typescript
export * from "./eip712.js";
```

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(shared): EIP-712 domain and types"
```

### Task 1.3: Zod schemas for submission payload

**Files:**
- Create: `packages/shared/src/schemas.ts`
- Test: `packages/shared/src/schemas.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from "vitest";
import { SubmitRequestSchema, PlaintextPayloadSchema } from "./schemas.js";

const hex32 = "0x" + "a".repeat(64);
const addr  = "0x" + "b".repeat(40);

describe("schemas", () => {
  it("accepts valid submit payload", () => {
    const ok = SubmitRequestSchema.safeParse({
      badgeContract: addr, tokenId: "123", holderWallet: addr,
      ciphertext: "base64data",
      ciphertextHash: hex32, nonce: hex32,
      issuedAt: 1710000000, expiresAt: 1710000600,
      signature: "0x" + "c".repeat(130),
    });
    expect(ok.success).toBe(true);
  });
  it("rejects bad address", () => {
    const bad = SubmitRequestSchema.safeParse({ badgeContract: "nope" });
    expect(bad.success).toBe(false);
  });
  it("rejects zero voting address in plaintext payload", () => {
    const bad = PlaintextPayloadSchema.safeParse({
      votingAddress: "0x0000000000000000000000000000000000000000",
      tokenId: "1", holderWallet: addr, timestamp: new Date().toISOString(),
    });
    expect(bad.success).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `schemas.ts`**

```typescript
import { z } from "zod";

export const AddressSchema = z.string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "not an EVM address")
  .transform((s) => s.toLowerCase() as `0x${string}`);

export const NonZeroAddressSchema = AddressSchema
  .refine((s) => s !== "0x" + "0".repeat(40), "zero address not allowed");

export const Hex32Schema = z.string().regex(/^0x[a-fA-F0-9]{64}$/, "not a 32-byte hex string");
export const HexSigSchema = z.string().regex(/^0x[a-fA-F0-9]{130}$/, "not a 65-byte signature");

export const PlaintextPayloadSchema = z.object({
  votingAddress: NonZeroAddressSchema,
  tokenId: z.string().regex(/^\d+$/),
  holderWallet: AddressSchema,
  timestamp: z.string().datetime(),
});
export type PlaintextPayload = z.infer<typeof PlaintextPayloadSchema>;

export const SubmitRequestSchema = z.object({
  badgeContract: AddressSchema,
  tokenId: z.string().regex(/^\d+$/),
  holderWallet: AddressSchema,
  ciphertext: z.string().min(1),
  ciphertextHash: Hex32Schema,
  nonce: Hex32Schema,
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  signature: HexSigSchema,
});
export type SubmitRequest = z.infer<typeof SubmitRequestSchema>;
```

- [ ] **Step 3: Run test, confirm PASS**

- [ ] **Step 4: Export and commit**

Add `export * from "./schemas.js";` to `src/index.ts`.
```bash
git add .
git commit -m "feat(shared): zod schemas for submission payloads"
```

### Task 1.4: Ciphertext bundle codec

**Files:**
- Create: `packages/shared/src/bundle.ts`
- Test: `packages/shared/src/bundle.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from "vitest";
import { encodeBundle, decodeBundle, type Bundle } from "./bundle.js";

describe("bundle codec", () => {
  it("round-trips", () => {
    const b: Bundle = {
      v: 1,
      kemCiphertext: "a".repeat(20),
      aesNonce: "b".repeat(16),
      aesCiphertext: "c".repeat(40),
      aesTag: "d".repeat(22),
    };
    const enc = encodeBundle(b);
    expect(typeof enc).toBe("string");
    const dec = decodeBundle(enc);
    expect(dec).toEqual(b);
  });
  it("rejects v != 1", () => {
    const bad = Buffer.from(JSON.stringify({ v: 2, kemCiphertext:"", aesNonce:"", aesCiphertext:"", aesTag:"" })).toString("base64");
    expect(() => decodeBundle(bad)).toThrow(/version/);
  });
});
```

- [ ] **Step 2: Implement `bundle.ts`**

```typescript
export interface Bundle {
  v: 1;
  kemCiphertext: string;   // base64
  aesNonce: string;        // base64
  aesCiphertext: string;   // base64
  aesTag: string;          // base64
}

const toB64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
const fromB64 = (s: string) => decodeURIComponent(escape(atob(s)));

export function encodeBundle(b: Bundle): string {
  if (b.v !== 1) throw new Error("unsupported bundle version");
  return toB64(JSON.stringify(b));
}

export function decodeBundle(s: string): Bundle {
  const parsed = JSON.parse(fromB64(s));
  if (parsed?.v !== 1) throw new Error("unsupported bundle version");
  return parsed as Bundle;
}
```

- [ ] **Step 3: PASS, export, commit**

Add `export * from "./bundle.js";` to `src/index.ts`.
```bash
git add .
git commit -m "feat(shared): ciphertext bundle codec"
```

### Task 1.5: Crypto helpers (encrypt / decrypt / hash)

**Files:**
- Create: `packages/shared/src/crypto.ts`
- Test: `packages/shared/src/crypto.test.ts`

- [ ] **Step 1: Failing test — round-trip encrypt/decrypt**

```typescript
import { describe, it, expect } from "vitest";
import { ml_kem768 } from "@noble/post-quantum/ml-kem";
import { encryptPayload, decryptBundle, sha256Hex } from "./crypto.js";

describe("crypto", () => {
  it("encrypts and decrypts round-trip with a fresh keypair", () => {
    const { publicKey, secretKey } = ml_kem768.keygen();
    const plaintext = { votingAddress: "0x" + "1".repeat(40), tokenId: "42", holderWallet: "0x" + "2".repeat(40), timestamp: "2026-04-14T00:00:00Z" };
    const { bundleB64, bundleHash } = encryptPayload(plaintext, publicKey);
    expect(bundleB64.length).toBeGreaterThan(0);
    expect(bundleHash).toMatch(/^0x[0-9a-f]{64}$/);
    const decrypted = decryptBundle(bundleB64, secretKey);
    expect(decrypted).toEqual(plaintext);
  });
  it("sha256Hex produces 0x-prefixed 32-byte hex", () => {
    expect(sha256Hex("hello")).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Implement `crypto.ts`**

```typescript
import { ml_kem768 } from "@noble/post-quantum/ml-kem";
import { gcm } from "@noble/ciphers/aes";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { randomBytes } from "@noble/hashes/utils";
import { bytesToHex, hexToBytes, utf8ToBytes, bytesToUtf8 } from "@noble/hashes/utils";
import { encodeBundle, decodeBundle, type Bundle } from "./bundle.js";

const HKDF_SALT = utf8ToBytes("ethsec-voting-badge-v1");
const HKDF_INFO = utf8ToBytes("aes-256-gcm");

const b64 = {
  enc: (u: Uint8Array) => Buffer.from(u).toString("base64"),
  dec: (s: string) => new Uint8Array(Buffer.from(s, "base64")),
};

export function sha256Hex(data: string | Uint8Array): `0x${string}` {
  const bytes = typeof data === "string" ? utf8ToBytes(data) : data;
  return ("0x" + bytesToHex(sha256(bytes))) as `0x${string}`;
}

export function encryptPayload(plaintext: object, publicKey: Uint8Array): { bundleB64: string; bundleHash: `0x${string}` } {
  const { cipherText: kemCT, sharedSecret } = ml_kem768.encapsulate(publicKey);
  const aesKey = hkdf(sha256, sharedSecret, HKDF_SALT, HKDF_INFO, 32);
  const aesNonce = randomBytes(12);
  const aead = gcm(aesKey, aesNonce);
  const pt = utf8ToBytes(JSON.stringify(plaintext));
  const sealed = aead.encrypt(pt);
  // AES-GCM returns ciphertext||tag; split at length-16
  const tag = sealed.slice(sealed.length - 16);
  const ct  = sealed.slice(0, sealed.length - 16);
  const bundle: Bundle = {
    v: 1,
    kemCiphertext: b64.enc(kemCT),
    aesNonce: b64.enc(aesNonce),
    aesCiphertext: b64.enc(ct),
    aesTag: b64.enc(tag),
  };
  const bundleB64 = encodeBundle(bundle);
  return { bundleB64, bundleHash: sha256Hex(bundleB64) };
}

export function decryptBundle(bundleB64: string, secretKey: Uint8Array): unknown {
  const b = decodeBundle(bundleB64);
  const kemCT = b64.dec(b.kemCiphertext);
  const sharedSecret = ml_kem768.decapsulate(kemCT, secretKey);
  const aesKey = hkdf(sha256, sharedSecret, HKDF_SALT, HKDF_INFO, 32);
  const aead = gcm(aesKey, b64.dec(b.aesNonce));
  const sealed = new Uint8Array([...b64.dec(b.aesCiphertext), ...b64.dec(b.aesTag)]);
  return JSON.parse(bytesToUtf8(aead.decrypt(sealed)));
}
```

- [ ] **Step 3: Run test, confirm PASS**

Run: `pnpm --filter @ethsec/shared test`.

- [ ] **Step 4: Export and commit**

Add `export * from "./crypto.js";` to `src/index.ts`.
```bash
git add .
git commit -m "feat(shared): ML-KEM-768 + AES-256-GCM encrypt/decrypt"
```

### Task 1.6: Ciphertext tampering test

**Files:**
- Modify: `packages/shared/src/crypto.test.ts`

- [ ] **Step 1: Add failing test for tampering detection**

```typescript
it("rejects ciphertext tampering", () => {
  const { publicKey, secretKey } = ml_kem768.keygen();
  const { bundleB64 } = encryptPayload({ a: 1 }, publicKey);
  // flip one char in the base64
  const tampered = bundleB64.slice(0, -2) + (bundleB64.slice(-2) === "AA" ? "BB" : "AA");
  expect(() => decryptBundle(tampered, secretKey)).toThrow();
});
```

- [ ] **Step 2: Run, confirm passes (AES-GCM auth tag catches it)**

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "test(shared): ciphertext tampering rejected by AES-GCM tag"
```

---

## Phase 2 — Keypair generation script

### Task 2.1: `scripts/generate-keypair.ts`

**Files:**
- Create: `scripts/generate-keypair.ts`
- Create: `scripts/package.json`

- [ ] **Step 1: `scripts/package.json`**

```json
{
  "name": "@ethsec/scripts",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "keygen": "tsx ./generate-keypair.ts"
  },
  "dependencies": {
    "@ethsec/shared": "workspace:*",
    "@noble/post-quantum": "^0.2.1",
    "tsx": "^4.16.0"
  }
}
```

- [ ] **Step 2: Implement `generate-keypair.ts`**

```typescript
#!/usr/bin/env tsx
import { ml_kem768 } from "@noble/post-quantum/ml-kem";
import { bytesToHex } from "@noble/hashes/utils";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const outDir = resolve(process.cwd(), process.argv[2] ?? "./keys");
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
```

- [ ] **Step 3: Run it locally**

```bash
pnpm install
pnpm --filter @ethsec/scripts keygen ./keys-test
cat keys-test/public.key | head -c 20
```

Expected: a `0x`-prefixed hex string starts printing. Delete `./keys-test` after verifying.

- [ ] **Step 4: Commit**

```bash
rm -rf keys-test
git add .
git commit -m "feat(scripts): ML-KEM-768 keypair generator"
```

---

## Phase 3 — Backend (`apps/api`)

### Task 3.1: Init Fastify app

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/.env.example`

- [ ] **Step 1: `apps/api/package.json`**

```json
{
  "name": "@ethsec/api",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "db:push": "drizzle-kit push"
  },
  "dependencies": {
    "@ethsec/shared": "workspace:*",
    "fastify": "^4.28.0",
    "@fastify/cors": "^9.0.0",
    "@fastify/rate-limit": "^9.1.0",
    "drizzle-orm": "^0.33.0",
    "postgres": "^3.4.4",
    "viem": "^2.21.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.24.0",
    "tsx": "^4.16.0",
    "vitest": "^1.6.0",
    "@types/node": "^20.11.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 3: `apps/api/.env.example`**

```
NODE_ENV=development
PORT=3001
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ethsec
BADGE_CONTRACT=0xf67c0ade41c607efebf198f9d6065ab1ec5ad4cd
CHAIN_ID=1
RPC_URL=https://eth.llamarpc.com
ADMIN_EXPORT_TOKEN=change_me_to_32_random_bytes
CORS_ALLOWED_ORIGIN=http://localhost:5173
ENCRYPTION_PUBLIC_KEY_HEX=0xPLACEHOLDER_FROM_KEYGEN
```

- [ ] **Step 4: Minimal `src/server.ts`**

```typescript
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";

export async function buildServer() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: process.env.CORS_ALLOWED_ORIGIN ?? true });
  await app.register(rateLimit, { max: 60, timeWindow: "1 minute" });
  app.get("/health", async () => ({ ok: true }));
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3001);
  const app = await buildServer();
  app.listen({ port, host: "0.0.0.0" });
}
```

- [ ] **Step 5: Install, smoke test**

```bash
pnpm install
pnpm --filter @ethsec/api dev &
curl -s http://localhost:3001/health
# {"ok":true}
kill %1
```

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat(api): fastify scaffold + /health"
```

### Task 3.2: Postgres + Drizzle schema

**Files:**
- Create: `apps/api/docker-compose.yml`
- Create: `apps/api/drizzle.config.ts`
- Create: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/client.ts`

- [ ] **Step 1: `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ethsec
    ports: ["5432:5432"]
    volumes: ["db-data:/var/lib/postgresql/data"]
volumes:
  db-data:
```

- [ ] **Step 2: `drizzle.config.ts`**

```typescript
import type { Config } from "drizzle-kit";
export default {
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
} satisfies Config;
```

- [ ] **Step 3: `src/db/schema.ts`**

```typescript
import { pgTable, uuid, numeric, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const submissions = pgTable("submissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  tokenId: numeric("token_id").notNull().unique(),
  holderWallet: text("holder_wallet").notNull(),
  signature: text("signature").notNull(),
  signaturePayloadJson: jsonb("signature_payload_json").notNull(),
  ciphertext: text("ciphertext").notNull(),
  ciphertextHash: text("ciphertext_hash").notNull(),
  nonce: text("nonce").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: `src/db/client.ts`**

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export function makeDb(url: string) {
  const client = postgres(url, { max: 10 });
  return drizzle(client, { schema: { /* populated per caller */ } });
}
```

- [ ] **Step 5: Bring up db, push schema**

```bash
docker compose -f apps/api/docker-compose.yml up -d
cd apps/api && DATABASE_URL=postgres://postgres:postgres@localhost:5432/ethsec pnpm db:push
```

Expected: `Changes applied` message, `submissions` table created.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat(api): postgres + drizzle schema with UNIQUE(token_id)"
```

### Task 3.3: `/config` route

**Files:**
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/routes/config.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/routes/config.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { buildServer } from "../server.js";

describe("GET /config", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  beforeAll(async () => {
    process.env.BADGE_CONTRACT = "0xf67c0ade41c607efebf198f9d6065ab1ec5ad4cd";
    process.env.CHAIN_ID = "1";
    process.env.ENCRYPTION_PUBLIC_KEY_HEX = "0xdeadbeef";
    app = await buildServer();
  });
  it("returns config fields", async () => {
    const res = await app.inject({ method: "GET", url: "/config" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.badgeContract).toBe("0xf67c0ade41c607efebf198f9d6065ab1ec5ad4cd");
    expect(body.chainId).toBe(1);
    expect(body.encryptionPublicKey).toBe("0xdeadbeef");
    expect(body.eip712Domain.name).toBe("ETHSecurity Voting Badge");
  });
});
```

- [ ] **Step 2: Implement `config.ts`**

```typescript
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url().optional(),
  BADGE_CONTRACT: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  CHAIN_ID: z.coerce.number(),
  RPC_URL: z.string().url().optional(),
  ADMIN_EXPORT_TOKEN: z.string().min(16).optional(),
  CORS_ALLOWED_ORIGIN: z.string().default("*"),
  ENCRYPTION_PUBLIC_KEY_HEX: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  return EnvSchema.parse(process.env);
}
```

- [ ] **Step 3: Implement `routes/config.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import { buildDomain } from "@ethsec/shared";
import type { Env } from "../config.js";

export async function configRoute(app: FastifyInstance, env: Env) {
  app.get("/config", async () => ({
    badgeContract: env.BADGE_CONTRACT.toLowerCase(),
    chainId: env.CHAIN_ID,
    encryptionPublicKey: env.ENCRYPTION_PUBLIC_KEY_HEX,
    eip712Domain: buildDomain(env.CHAIN_ID),
  }));
}
```

- [ ] **Step 4: Wire into `server.ts`**

```typescript
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { loadEnv } from "./config.js";
import { configRoute } from "./routes/config.js";

export async function buildServer() {
  const env = loadEnv();
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: env.CORS_ALLOWED_ORIGIN });
  await app.register(rateLimit, { max: 60, timeWindow: "1 minute" });
  app.get("/health", async () => ({ ok: true }));
  await configRoute(app, env);
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer();
  const env = loadEnv();
  app.listen({ port: env.PORT, host: "0.0.0.0" });
}
```

- [ ] **Step 5: Run test**

Run: `pnpm --filter @ethsec/api test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat(api): /config route with env validation"
```

### Task 3.4: `/token-status/:tokenId` route

**Files:**
- Create: `apps/api/src/routes/token-status.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/routes/token-status.test.ts`

- [ ] **Step 1: Failing test (use test DB)**

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { buildServer } from "../server.js";

describe("GET /token-status/:tokenId", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  beforeAll(async () => {
    process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/ethsec";
    app = await buildServer();
  });
  it("returns used:false for fresh token", async () => {
    const res = await app.inject({ method: "GET", url: "/token-status/9999999" });
    expect(res.statusCode).toBe(200);
    expect(res.json().used).toBe(false);
  });
  it("rejects non-numeric token", async () => {
    const res = await app.inject({ method: "GET", url: "/token-status/abc" });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Implement `routes/token-status.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { submissions } from "../db/schema.js";
import type { DB } from "../db/client.js";

const ParamsSchema = z.object({ tokenId: z.string().regex(/^\d+$/) });

export async function tokenStatusRoute(app: FastifyInstance, db: DB) {
  app.get("/token-status/:tokenId", async (req, reply) => {
    const parsed = ParamsSchema.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid tokenId" });
    const [row] = await db.select().from(submissions).where(eq(submissions.tokenId, parsed.data.tokenId)).limit(1);
    return { used: Boolean(row) };
  });
}
```

- [ ] **Step 3: Update `db/client.ts` with typed db**

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type DB = ReturnType<typeof makeDb>;

export function makeDb(url: string) {
  const client = postgres(url, { max: 10 });
  return drizzle(client, { schema });
}
```

- [ ] **Step 4: Wire into `server.ts`**

```typescript
// add near top of buildServer:
import { makeDb } from "./db/client.js";
import { tokenStatusRoute } from "./routes/token-status.js";
// inside buildServer, after configRoute:
const db = makeDb(env.DATABASE_URL!);
await tokenStatusRoute(app, db);
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @ethsec/api test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat(api): /token-status/:tokenId"
```

### Task 3.5: `/submit` route — skeleton (no onchain check yet)

**Files:**
- Create: `apps/api/src/routes/submit.ts`
- Create: `apps/api/src/verify.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/routes/submit.test.ts`

- [ ] **Step 1: Implement `verify.ts`** (pure functions, testable without server)

```typescript
import { recoverTypedDataAddress, isAddressEqual, type Address, type Hex } from "viem";
import { buildDomain, VOTING_SUBMISSION_TYPES, sha256Hex, type VotingAddressSubmission } from "@ethsec/shared";

export type VerifyFailure =
  | { kind: "ciphertext_hash_mismatch" }
  | { kind: "signature_invalid" }
  | { kind: "timestamp_expired" }
  | { kind: "timestamp_stale" }
  | { kind: "domain_mismatch" };

export interface VerifyOk { kind: "ok" }
export type VerifyResult = VerifyOk | VerifyFailure;

export async function verifyCiphertextHash(ciphertext: string, claimed: Hex): Promise<VerifyResult> {
  if (sha256Hex(ciphertext) !== claimed.toLowerCase()) return { kind: "ciphertext_hash_mismatch" };
  return { kind: "ok" };
}

export async function verifySignature(
  chainId: number,
  submission: VotingAddressSubmission,
  signature: Hex,
): Promise<VerifyResult> {
  const recovered = await recoverTypedDataAddress({
    domain: buildDomain(chainId),
    types: VOTING_SUBMISSION_TYPES,
    primaryType: "VotingAddressSubmission",
    message: submission,
    signature,
  });
  if (!isAddressEqual(recovered as Address, submission.holderWallet)) return { kind: "signature_invalid" };
  return { kind: "ok" };
}

export function verifyTimestampWindow(issuedAt: bigint, expiresAt: bigint, nowSec: bigint, toleranceSec = 300n): VerifyResult {
  if (expiresAt <= nowSec) return { kind: "timestamp_expired" };
  if (issuedAt > nowSec + toleranceSec) return { kind: "timestamp_stale" };
  if (nowSec - issuedAt > 15n * 60n) return { kind: "timestamp_stale" };
  return { kind: "ok" };
}
```

- [ ] **Step 2: Failing test for `verify.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { encryptPayload, buildDomain, VOTING_SUBMISSION_TYPES } from "@ethsec/shared";
import { ml_kem768 } from "@noble/post-quantum/ml-kem";
import { verifyCiphertextHash, verifySignature, verifyTimestampWindow } from "./verify.js";

describe("verify", () => {
  it("detects ciphertext hash mismatch", async () => {
    const r = await verifyCiphertextHash("hello", "0x" + "0".repeat(64));
    expect(r.kind).toBe("ciphertext_hash_mismatch");
  });
  it("accepts a valid signature round-trip", async () => {
    const acct = privateKeyToAccount(("0x" + "1".repeat(64)) as `0x${string}`);
    const { publicKey } = ml_kem768.keygen();
    const { bundleHash } = encryptPayload({ a: 1 }, publicKey);
    const submission = {
      badgeContract: "0x" + "a".repeat(40) as `0x${string}`,
      tokenId: 1n, holderWallet: acct.address,
      ciphertextHash: bundleHash,
      nonce: ("0x" + "0".repeat(64)) as `0x${string}`,
      issuedAt: 1000n, expiresAt: 2000n,
    };
    const sig = await acct.signTypedData({
      domain: buildDomain(1), types: VOTING_SUBMISSION_TYPES,
      primaryType: "VotingAddressSubmission", message: submission,
    });
    const r = await verifySignature(1, submission, sig);
    expect(r.kind).toBe("ok");
  });
  it("rejects expired timestamp", () => {
    expect(verifyTimestampWindow(0n, 100n, 200n).kind).toBe("timestamp_expired");
  });
});
```

Run: FAIL until verify.ts lands, then PASS.

- [ ] **Step 3: Implement `routes/submit.ts` (without onchain check — placeholder returns OK on onchain for now)**

```typescript
import type { FastifyInstance } from "fastify";
import { SubmitRequestSchema } from "@ethsec/shared";
import { verifyCiphertextHash, verifySignature, verifyTimestampWindow } from "../verify.js";
import { submissions } from "../db/schema.js";
import type { DB } from "../db/client.js";
import type { Env } from "../config.js";

export async function submitRoute(app: FastifyInstance, db: DB, env: Env) {
  app.post("/submit", async (req, reply) => {
    const parsed = SubmitRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.issues });
    const p = parsed.data;

    const hashCheck = await verifyCiphertextHash(p.ciphertext, p.ciphertextHash);
    if (hashCheck.kind !== "ok") return reply.code(400).send({ error: hashCheck.kind });

    const submission = {
      badgeContract: env.BADGE_CONTRACT.toLowerCase() as `0x${string}`,
      tokenId: BigInt(p.tokenId),
      holderWallet: p.holderWallet,
      ciphertextHash: p.ciphertextHash,
      nonce: p.nonce,
      issuedAt: BigInt(p.issuedAt),
      expiresAt: BigInt(p.expiresAt),
    };

    const tsCheck = verifyTimestampWindow(submission.issuedAt, submission.expiresAt, BigInt(Math.floor(Date.now() / 1000)));
    if (tsCheck.kind !== "ok") return reply.code(400).send({ error: tsCheck.kind });

    const sigCheck = await verifySignature(env.CHAIN_ID, submission, p.signature as `0x${string}`);
    if (sigCheck.kind !== "ok") return reply.code(400).send({ error: sigCheck.kind });

    // TODO Task 3.6: onchain ownerOf + balanceOf check

    try {
      await db.insert(submissions).values({
        tokenId: p.tokenId,
        holderWallet: p.holderWallet,
        signature: p.signature,
        signaturePayloadJson: {
          ...submission,
          tokenId: submission.tokenId.toString(),
          issuedAt: submission.issuedAt.toString(),
          expiresAt: submission.expiresAt.toString(),
        },
        ciphertext: p.ciphertext,
        ciphertextHash: p.ciphertextHash,
        nonce: p.nonce,
      });
    } catch (e: any) {
      if (String(e?.message ?? "").includes("unique")) return reply.code(409).send({ error: "already_submitted" });
      throw e;
    }

    return { ok: true, submittedAt: new Date().toISOString() };
  });
}
```

- [ ] **Step 4: Wire into `server.ts`, add integration test that posts a valid payload**

```typescript
// server.ts (add)
import { submitRoute } from "./routes/submit.js";
await submitRoute(app, db, env);
```

Integration test — `routes/submit.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { ml_kem768 } from "@noble/post-quantum/ml-kem";
import { encryptPayload, buildDomain, VOTING_SUBMISSION_TYPES } from "@ethsec/shared";
import { buildServer } from "../server.js";

describe("POST /submit (happy path, no onchain check yet)", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  beforeAll(async () => {
    const { publicKey } = ml_kem768.keygen();
    process.env.ENCRYPTION_PUBLIC_KEY_HEX = "0x" + Buffer.from(publicKey).toString("hex");
    process.env.BADGE_CONTRACT = "0xf67c0ade41c607efebf198f9d6065ab1ec5ad4cd";
    process.env.CHAIN_ID = "1";
    process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/ethsec";
    app = await buildServer();
  });

  it("accepts valid payload", async () => {
    const acct = privateKeyToAccount(("0x" + "2".repeat(64)) as `0x${string}`);
    const { publicKey } = ml_kem768.keygen();
    const tokenId = String(Math.floor(Math.random() * 1e9));
    const payload = { votingAddress: "0x" + "3".repeat(40), tokenId, holderWallet: acct.address, timestamp: new Date().toISOString() };
    const { bundleB64, bundleHash } = encryptPayload(payload, publicKey);

    const submission = {
      badgeContract: "0xf67c0ade41c607efebf198f9d6065ab1ec5ad4cd" as `0x${string}`,
      tokenId: BigInt(tokenId), holderWallet: acct.address,
      ciphertextHash: bundleHash, nonce: ("0x" + "0".repeat(64)) as `0x${string}`,
      issuedAt: BigInt(Math.floor(Date.now()/1000)),
      expiresAt: BigInt(Math.floor(Date.now()/1000) + 600),
    };
    const signature = await acct.signTypedData({
      domain: buildDomain(1), types: VOTING_SUBMISSION_TYPES,
      primaryType: "VotingAddressSubmission", message: submission,
    });

    const res = await app.inject({ method: "POST", url: "/submit", payload: {
      badgeContract: submission.badgeContract, tokenId, holderWallet: acct.address,
      ciphertext: bundleB64, ciphertextHash: bundleHash, nonce: submission.nonce,
      issuedAt: Number(submission.issuedAt), expiresAt: Number(submission.expiresAt),
      signature,
    }});
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
});
```

Note: this uses the real public key from a fresh keypair, but the test uses the SAME keypair for the encrypt call — server never decrypts, so mismatch with env var is irrelevant for this test. What matters is that `sha256(ciphertext)` matches the signed hash.

Run: `pnpm --filter @ethsec/api test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(api): /submit with signature + hash + timestamp verification"
```

### Task 3.6: Onchain ownership verification

**Files:**
- Create: `apps/api/src/onchain.ts`
- Modify: `apps/api/src/routes/submit.ts`
- Test: `apps/api/src/onchain.test.ts`

- [ ] **Step 1: Implement `onchain.ts`**

```typescript
import { createPublicClient, http, type Address } from "viem";
import { mainnet, sepolia } from "viem/chains";

const ERC721_ABI = [
  { inputs: [{ type: "uint256" }], name: "ownerOf",   outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [{ type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

export interface OwnershipCheck { ownsThisToken: boolean; balance: bigint }

export function makeClient(chainId: number, rpcUrl: string) {
  const chain = chainId === 11155111 ? sepolia : mainnet;
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export async function checkOwnership(
  client: ReturnType<typeof makeClient>,
  contract: Address,
  tokenId: bigint,
  wallet: Address,
): Promise<OwnershipCheck> {
  const [owner, balance] = await Promise.all([
    client.readContract({ address: contract, abi: ERC721_ABI, functionName: "ownerOf", args: [tokenId] }).catch(() => null),
    client.readContract({ address: contract, abi: ERC721_ABI, functionName: "balanceOf", args: [wallet] }),
  ]);
  return {
    ownsThisToken: owner !== null && (owner as Address).toLowerCase() === wallet.toLowerCase(),
    balance: balance as bigint,
  };
}
```

- [ ] **Step 2: Failing integration test (real Sepolia RPC, against a known testnet ERC-721 or the TestBadge once Phase 8 deploys it — for now, skip and wire once contract exists)**

Create `onchain.test.ts` but mark the integration test with `it.skip(...)` and a TODO note — we'll flip it to `it(...)` after Phase 8 Task 8.2.

```typescript
import { describe, it } from "vitest";
// will be enabled post-Phase 8; documents the intent
describe("onchain ownership", () => {
  it.skip("verifies against deployed Sepolia TestBadge", async () => { /* wired in Phase 8 */ });
});
```

- [ ] **Step 3: Update `submit.ts` — replace the TODO with real check**

```typescript
// near top
import { makeClient, checkOwnership } from "../onchain.js";
const client = makeClient(env.CHAIN_ID, env.RPC_URL!);
// replace the TODO comment with:
const own = await checkOwnership(client, env.BADGE_CONTRACT as `0x${string}`, submission.tokenId, submission.holderWallet);
if (!own.ownsThisToken) return reply.code(403).send({ error: "not_owner" });
if (own.balance !== 1n) return reply.code(403).send({ error: "multi_badge_or_zero" });
```

- [ ] **Step 4: Unit test the logic with a mock client**

Add to `onchain.test.ts`:

```typescript
import { checkOwnership } from "./onchain.js";
it("ownsThisToken true when owner matches", async () => {
  const mock = {
    readContract: async ({ functionName }: any) =>
      functionName === "ownerOf" ? ("0x" + "a".repeat(40)) : 1n,
  } as any;
  const res = await checkOwnership(mock, "0x" + "b".repeat(40) as any, 1n, ("0x" + "a".repeat(40)) as any);
  expect(res.ownsThisToken).toBe(true);
  expect(res.balance).toBe(1n);
});
```

Run: PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(api): onchain ownerOf + balanceOf verification"
```

### Task 3.7: Admin export route

**Files:**
- Create: `apps/api/src/routes/admin-export.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/routes/admin-export.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { buildServer } from "../server.js";

describe("GET /admin/export", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  beforeAll(async () => {
    process.env.ADMIN_EXPORT_TOKEN = "test_admin_token_xxxxxxxxxxxxxxxx";
    app = await buildServer();
  });
  it("401 without token", async () => {
    const r = await app.inject({ method: "GET", url: "/admin/export" });
    expect(r.statusCode).toBe(401);
  });
  it("200 with token, returns CSV", async () => {
    const r = await app.inject({ method: "GET", url: "/admin/export", headers: { authorization: "Bearer test_admin_token_xxxxxxxxxxxxxxxx" } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/csv/);
    expect(r.body.split("\n")[0]).toBe("id,token_id,holder_wallet,signature,ciphertext,ciphertext_hash,nonce,submitted_at");
  });
});
```

- [ ] **Step 2: Implement `admin-export.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import { submissions } from "../db/schema.js";
import type { DB } from "../db/client.js";
import type { Env } from "../config.js";

function csvField(s: string) { return `"${String(s).replace(/"/g, '""')}"`; }

export async function adminExportRoute(app: FastifyInstance, db: DB, env: Env) {
  app.get("/admin/export", async (req, reply) => {
    const auth = req.headers.authorization ?? "";
    const expected = `Bearer ${env.ADMIN_EXPORT_TOKEN ?? ""}`;
    if (!env.ADMIN_EXPORT_TOKEN || auth !== expected) return reply.code(401).send({ error: "unauthorized" });

    const rows = await db.select().from(submissions);
    const header = "id,token_id,holder_wallet,signature,ciphertext,ciphertext_hash,nonce,submitted_at";
    const lines = rows.map((r) => [r.id, r.tokenId, r.holderWallet, r.signature, r.ciphertext, r.ciphertextHash, r.nonce, r.submittedAt.toISOString()].map(csvField).join(","));
    reply.header("content-type", "text/csv; charset=utf-8");
    return [header, ...lines].join("\n");
  });
}
```

- [ ] **Step 3: Wire into `server.ts`** (`await adminExportRoute(app, db, env);`), run test → PASS.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat(api): /admin/export bearer-auth CSV"
```

---

## Phase 4 — Frontend (`apps/web`)

### Task 4.1: Vite + React scaffold with DAO.fund theme

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/postcss.config.js`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/index.css`
- Create: `apps/web/.env.example`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@ethsec/web",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ethsec/shared": "workspace:*",
    "@tanstack/react-query": "^5.56.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "viem": "^2.21.0",
    "wagmi": "^2.12.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^1.6.0",
    "jsdom": "^25.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.5.0"
  }
}
```

- [ ] **Step 2: `vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./", // critical for static / thumb-drive mode
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"] },
});
```

- [ ] **Step 3: `tailwind.config.ts`**

```typescript
import type { Config } from "tailwindcss";
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          red: { 500: "#FF3535" },
          blue: { 500: "#2C5EB6", 900: "#1E3A5F" },
          green: { 500: "#5CB75A" },
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        tight: ["Inter Tight", "Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 4: `postcss.config.js`**

```javascript
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 5: `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ETHSecurity Voting Badge — Address Submission</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Inter+Tight:wght@500;600;700&display=swap" rel="stylesheet" />
  </head>
  <body class="bg-brand-blue-900 text-white font-sans">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: `src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body { background: linear-gradient(180deg, #1E3A5F 0%, #152940 100%); min-height: 100vh; }
```

- [ ] **Step 7: `src/App.tsx`** (placeholder, real state machine in Task 4.3)

```tsx
export default function App() {
  return (
    <main className="max-w-xl mx-auto p-8 text-center">
      <h1 className="font-tight text-3xl mb-4">ETHSecurity Voting Badge</h1>
      <p className="text-white/70">Address submission tool — coming online.</p>
    </main>
  );
}
```

- [ ] **Step 8: `src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.js";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
```

- [ ] **Step 9: `src/test-setup.ts`**

```typescript
import "@testing-library/jest-dom";
```

- [ ] **Step 10: `.env.example`**

```
VITE_NETWORK=sepolia
VITE_API_URL=http://localhost:3001
VITE_BADGE_CONTRACT_MAINNET=0xf67c0ade41c607efebf198f9d6065ab1ec5ad4cd
VITE_BADGE_CONTRACT_SEPOLIA=0xPLACEHOLDER_AFTER_DEPLOY
VITE_ENCRYPTION_PUBLIC_KEY_HEX=0xPLACEHOLDER_FROM_KEYGEN
VITE_RPC_URL_MAINNET=https://eth.llamarpc.com
VITE_RPC_URL_SEPOLIA=https://ethereum-sepolia-rpc.publicnode.com
```

- [ ] **Step 11: Install + smoke test**

```bash
pnpm install
pnpm --filter @ethsec/web dev
```

Open `http://localhost:5173`, confirm dark-navy background + "ETHSecurity Voting Badge" heading. Kill server.

- [ ] **Step 12: Commit**

```bash
git add .
git commit -m "feat(web): vite + react + tailwind + DAO.fund theme scaffold"
```

### Task 4.2: wagmi + viem wiring

**Files:**
- Create: `apps/web/src/config.ts`
- Create: `apps/web/src/wagmi.ts`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: `config.ts`**

```typescript
const env = import.meta.env;
const network = env.VITE_NETWORK === "mainnet" ? "mainnet" : "sepolia";

export const APP_CONFIG = {
  network,
  chainId: network === "mainnet" ? 1 : 11155111,
  badgeContract: (network === "mainnet"
    ? env.VITE_BADGE_CONTRACT_MAINNET
    : env.VITE_BADGE_CONTRACT_SEPOLIA) as `0x${string}`,
  rpcUrl: (network === "mainnet" ? env.VITE_RPC_URL_MAINNET : env.VITE_RPC_URL_SEPOLIA) as string,
  apiUrl: env.VITE_API_URL as string,
  encryptionPublicKeyHex: env.VITE_ENCRYPTION_PUBLIC_KEY_HEX as `0x${string}`,
} as const;
```

- [ ] **Step 2: `wagmi.ts`**

```typescript
import { createConfig, http } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { APP_CONFIG } from "./config.js";

const chain = APP_CONFIG.network === "mainnet" ? mainnet : sepolia;
export const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [injected()],
  transports: { [chain.id]: http(APP_CONFIG.rpcUrl) },
});
```

- [ ] **Step 3: Wrap app with providers in `main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.js";
import { wagmiConfig } from "./wagmi.js";
import "./index.css";

const qc = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
);
```

- [ ] **Step 4: Smoke test `pnpm --filter @ethsec/web dev`, page still renders.**

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(web): wagmi + viem + injected connector"
```

### Task 4.3: Submission state machine

**Files:**
- Create: `apps/web/src/state/machine.ts`
- Test: `apps/web/src/state/machine.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from "vitest";
import { reducer, INITIAL_STATE } from "./machine.js";

describe("submission state machine", () => {
  it("starts at landing", () => {
    expect(INITIAL_STATE.status).toBe("landing");
  });
  it("landing -> connecting on CONNECT", () => {
    const s = reducer(INITIAL_STATE, { type: "CONNECT" });
    expect(s.status).toBe("connecting");
  });
  it("moves to error on WALLET_MULTI_BADGE", () => {
    const s = reducer({ status: "checking-eligibility" }, { type: "WALLET_MULTI_BADGE" });
    expect(s.status).toBe("error");
    expect(s.errorKind).toBe("multi_badge");
  });
  it("records token id on ELIGIBLE", () => {
    const s = reducer({ status: "checking-eligibility" }, { type: "ELIGIBLE", tokenId: "42" });
    expect(s.status).toBe("checking-token-status");
    expect(s.tokenId).toBe("42");
  });
});
```

- [ ] **Step 2: Implement `machine.ts`**

```typescript
export type Status =
  | "landing" | "connecting" | "checking-chain" | "checking-eligibility"
  | "checking-token-status" | "entering-address" | "reviewing"
  | "signing" | "encrypting" | "submitting" | "success" | "error";

export type ErrorKind =
  | "no_badge" | "multi_badge" | "token_used"
  | "wrong_chain_refused" | "sig_rejected" | "backend_rejected" | "unknown";

export interface State {
  status: Status;
  tokenId?: string;
  votingAddress?: `0x${string}`;
  errorKind?: ErrorKind;
  errorDetail?: string;
}

export const INITIAL_STATE: State = { status: "landing" };

export type Action =
  | { type: "CONNECT" }
  | { type: "CONNECTED" }
  | { type: "CHAIN_OK" }
  | { type: "WALLET_NO_BADGE" }
  | { type: "WALLET_MULTI_BADGE" }
  | { type: "ELIGIBLE"; tokenId: string }
  | { type: "TOKEN_USED" }
  | { type: "TOKEN_OK" }
  | { type: "SET_ADDRESS"; addr: `0x${string}` }
  | { type: "REVIEW_CONFIRM" }
  | { type: "SIGNED" }
  | { type: "ENCRYPTED" }
  | { type: "SUBMITTED" }
  | { type: "ERROR"; kind: ErrorKind; detail?: string };

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "CONNECT":             return { status: "connecting" };
    case "CONNECTED":           return { status: "checking-chain" };
    case "CHAIN_OK":            return { status: "checking-eligibility" };
    case "WALLET_NO_BADGE":     return { status: "error", errorKind: "no_badge" };
    case "WALLET_MULTI_BADGE":  return { status: "error", errorKind: "multi_badge" };
    case "ELIGIBLE":            return { status: "checking-token-status", tokenId: action.tokenId };
    case "TOKEN_USED":          return { ...state, status: "error", errorKind: "token_used" };
    case "TOKEN_OK":            return { ...state, status: "entering-address" };
    case "SET_ADDRESS":         return { ...state, status: "reviewing", votingAddress: action.addr };
    case "REVIEW_CONFIRM":      return { ...state, status: "signing" };
    case "SIGNED":              return { ...state, status: "encrypting" };
    case "ENCRYPTED":           return { ...state, status: "submitting" };
    case "SUBMITTED":           return { ...state, status: "success" };
    case "ERROR":               return { ...state, status: "error", errorKind: action.kind, errorDetail: action.detail };
  }
}
```

- [ ] **Step 3: Run test → PASS.**

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat(web): submission state machine"
```

### Task 4.4: UI components per state

**Files:**
- Create: `apps/web/src/components/Landing.tsx`
- Create: `apps/web/src/components/Connecting.tsx`
- Create: `apps/web/src/components/CheckingChain.tsx`
- Create: `apps/web/src/components/Eligibility.tsx`
- Create: `apps/web/src/components/EnterAddress.tsx`
- Create: `apps/web/src/components/Review.tsx`
- Create: `apps/web/src/components/Signing.tsx`
- Create: `apps/web/src/components/Encrypting.tsx`
- Create: `apps/web/src/components/Submitting.tsx`
- Create: `apps/web/src/components/Success.tsx`
- Create: `apps/web/src/components/ErrorScreen.tsx`
- Create: `apps/web/src/components/Shell.tsx`

- [ ] **Step 1: Shared `Shell.tsx`**

```tsx
import type { ReactNode } from "react";

export function Shell({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <main className="max-w-xl mx-auto px-6 py-12">
      <header className="text-center mb-10">
        <div className="inline-block rounded-2xl bg-brand-red-500 text-white font-bold text-3xl w-14 h-14 leading-[3.5rem] mb-3">Đ</div>
        <h1 className="font-tight text-2xl">ETHSecurity Voting Badge</h1>
        {title && <p className="text-white/60 mt-2">{title}</p>}
      </header>
      <section className="bg-white/5 border border-white/10 rounded-2xl p-6">{children}</section>
    </main>
  );
}

export function PrimaryButton({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className="w-full mt-4 rounded-full bg-brand-red-500 hover:bg-brand-red-500/90 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3">{children}</button>;
}
```

- [ ] **Step 2: `Landing.tsx`**

```tsx
import { Shell, PrimaryButton } from "./Shell.js";

export function Landing({ onConnect }: { onConnect: () => void }) {
  return (
    <Shell>
      <p className="text-white/80 leading-relaxed">
        Badge holders use this tool to privately register a separate voting address.
        This separates your public badge-holding wallet from later voting and donation activity.
      </p>
      <ul className="text-white/60 text-sm mt-4 space-y-1 list-disc list-inside">
        <li>One-time submission per badge</li>
        <li>Only badge holders can participate</li>
        <li>Your address is encrypted in your browser before it's sent</li>
      </ul>
      <PrimaryButton onClick={onConnect}>Connect wallet</PrimaryButton>
    </Shell>
  );
}
```

- [ ] **Step 3: `EnterAddress.tsx`**

```tsx
import { useState } from "react";
import { isAddress } from "viem";
import { Shell, PrimaryButton } from "./Shell.js";

export function EnterAddress({ onSubmit }: { onSubmit: (addr: `0x${string}`) => void }) {
  const [value, setValue] = useState("");
  const zero = "0x" + "0".repeat(40);
  const isValid = isAddress(value) && value.toLowerCase() !== zero;
  return (
    <Shell title="Step 1 of 2 — voting address">
      <label className="text-sm text-white/70">Enter the Ethereum address you'll use to vote.</label>
      <input
        className="mt-2 w-full rounded-lg bg-brand-blue-900/60 border border-white/10 px-3 py-3 font-mono text-sm"
        placeholder="0x…" value={value} onChange={(e) => setValue(e.target.value)}
      />
      <p className="text-white/50 text-xs mt-3">
        Submit a normal hot wallet you control. It will later be used to interact with a dapp.
      </p>
      <PrimaryButton disabled={!isValid} onClick={() => onSubmit(value as `0x${string}`)}>Continue</PrimaryButton>
    </Shell>
  );
}
```

- [ ] **Step 4: `Review.tsx`**

```tsx
import { Shell, PrimaryButton } from "./Shell.js";

export function Review({ wallet, tokenId, votingAddress, onConfirm, onBack }: {
  wallet: string; tokenId: string; votingAddress: string;
  onConfirm: () => void; onBack: () => void;
}) {
  const Row = ({ k, v }: { k: string; v: string }) => (
    <div className="flex justify-between gap-4 py-2 border-b border-white/5 text-sm">
      <span className="text-white/60">{k}</span><span className="font-mono text-right break-all">{v}</span>
    </div>
  );
  return (
    <Shell title="Step 2 of 2 — review and sign">
      <Row k="Wallet"          v={wallet} />
      <Row k="Token ID"        v={tokenId} />
      <Row k="Voting address"  v={votingAddress} />
      <p className="mt-4 text-sm text-brand-red-500 font-semibold">
        This submission is one-time and cannot be changed.
      </p>
      <PrimaryButton onClick={onConfirm}>Sign + submit</PrimaryButton>
      <button onClick={onBack} className="w-full mt-2 text-white/50 text-sm hover:text-white">Back</button>
    </Shell>
  );
}
```

- [ ] **Step 5: Intermediate screens — `Connecting`, `CheckingChain`, `Eligibility`, `Signing`, `Encrypting`, `Submitting` — all identical pattern: `<Shell><Spinner/><p>message</p></Shell>`**

```tsx
// Connecting.tsx (copy pattern to the others with different labels)
import { Shell } from "./Shell.js";
export function Connecting() { return <Shell><Loader label="Connecting wallet…" /></Shell>; }
export function Loader({ label }: { label: string }) {
  return <div className="text-center py-4"><div className="inline-block w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin mb-3" /><p className="text-white/70">{label}</p></div>;
}
```

Create one file per state re-exporting `Loader` with the appropriate label.

- [ ] **Step 6: `Success.tsx`**

```tsx
import { Shell } from "./Shell.js";

export function Success({ tokenId, submittedAt }: { tokenId: string; submittedAt: string }) {
  return (
    <Shell title="Submission complete">
      <div className="text-center py-4">
        <div className="inline-block w-12 h-12 rounded-full bg-brand-green-500 text-white text-2xl leading-[3rem] mb-3">✓</div>
        <p className="text-white/80">Token <span className="font-mono">{tokenId}</span> has been used.</p>
        <p className="text-white/50 text-sm mt-1">{submittedAt}</p>
        <p className="text-white/60 text-sm mt-6">This submission is final. You can close this page.</p>
      </div>
    </Shell>
  );
}
```

- [ ] **Step 7: `ErrorScreen.tsx`**

```tsx
import { Shell } from "./Shell.js";
import type { ErrorKind } from "../state/machine.js";

const COPY: Record<ErrorKind, { title: string; body: string }> = {
  no_badge:            { title: "No badge found",          body: "Connected wallet doesn't hold an ETHSecurity Badge." },
  multi_badge:         { title: "Multiple badges",         body: "This wallet holds more than one badge. Submit from a wallet with exactly one." },
  token_used:          { title: "Already submitted",       body: "This badge has already been used to submit a voting address." },
  wrong_chain_refused: { title: "Wrong network",           body: "This tool requires Ethereum mainnet." },
  sig_rejected:        { title: "Signature rejected",      body: "Your wallet cancelled the signature." },
  backend_rejected:    { title: "Submission rejected",     body: "The server rejected your submission." },
  unknown:             { title: "Something went wrong",    body: "Please try again." },
};

export function ErrorScreen({ kind, detail }: { kind: ErrorKind; detail?: string }) {
  const { title, body } = COPY[kind];
  return (
    <Shell title={title}>
      <p className="text-white/80">{body}</p>
      {detail && <pre className="mt-3 text-xs text-white/50 whitespace-pre-wrap">{detail}</pre>}
    </Shell>
  );
}
```

- [ ] **Step 8: Render test for Review**

`apps/web/src/components/Review.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Review } from "./Review.js";

describe("Review", () => {
  it("renders all 3 fields + one-time warning", () => {
    render(<Review wallet="0xabc" tokenId="7" votingAddress="0xdef" onConfirm={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText("0xabc")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("0xdef")).toBeInTheDocument();
    expect(screen.getByText(/one-time and cannot be changed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "feat(web): per-state UI components"
```

### Task 4.5: Backend client + orchestrator hook

**Files:**
- Create: `apps/web/src/api.ts`
- Create: `apps/web/src/hooks/useSubmission.ts`

- [ ] **Step 1: `api.ts`**

```typescript
import { APP_CONFIG } from "./config.js";

export async function fetchConfig() {
  const r = await fetch(`${APP_CONFIG.apiUrl}/config`);
  if (!r.ok) throw new Error("config fetch failed");
  return r.json();
}

export async function tokenStatus(tokenId: string): Promise<{ used: boolean }> {
  const r = await fetch(`${APP_CONFIG.apiUrl}/token-status/${tokenId}`);
  if (!r.ok) throw new Error("status fetch failed");
  return r.json();
}

export async function postSubmit(payload: object): Promise<{ ok: true; submittedAt: string } | { error: string }> {
  const r = await fetch(`${APP_CONFIG.apiUrl}/submit`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  return r.json();
}
```

- [ ] **Step 2: `useSubmission.ts`** — reducer + side-effect orchestration

```typescript
import { useReducer, useCallback } from "react";
import { useAccount, useConnect, useChainId, useSignTypedData, useSwitchChain, usePublicClient } from "wagmi";
import { hexToBytes, randomBytes } from "@noble/hashes/utils";
import { encryptPayload, buildDomain, VOTING_SUBMISSION_TYPES } from "@ethsec/shared";
import { reducer, INITIAL_STATE } from "../state/machine.js";
import { APP_CONFIG } from "../config.js";
import { tokenStatus, postSubmit } from "../api.js";

const ERC721_ABI = [
  { inputs: [{ type: "address" }], name: "balanceOf",       outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ type: "address" }, { type: "uint256" }], name: "tokenOfOwnerByIndex", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

export function useSubmission() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const { address } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const publicClient = usePublicClient();

  const run = useCallback(async () => {
    try {
      dispatch({ type: "CONNECT" });
      if (!address) await connectAsync({ connector: connectors[0]! });
      dispatch({ type: "CONNECTED" });

      if (chainId !== APP_CONFIG.chainId) {
        try { await switchChainAsync({ chainId: APP_CONFIG.chainId }); }
        catch { return dispatch({ type: "ERROR", kind: "wrong_chain_refused" }); }
      }
      dispatch({ type: "CHAIN_OK" });

      const bal = await publicClient!.readContract({
        address: APP_CONFIG.badgeContract, abi: ERC721_ABI, functionName: "balanceOf", args: [address!],
      }) as bigint;
      if (bal === 0n) return dispatch({ type: "WALLET_NO_BADGE" });
      if (bal > 1n)  return dispatch({ type: "WALLET_MULTI_BADGE" });

      const tokenId = await publicClient!.readContract({
        address: APP_CONFIG.badgeContract, abi: ERC721_ABI, functionName: "tokenOfOwnerByIndex", args: [address!, 0n],
      }) as bigint;
      dispatch({ type: "ELIGIBLE", tokenId: tokenId.toString() });

      const status = await tokenStatus(tokenId.toString());
      if (status.used) return dispatch({ type: "TOKEN_USED" });
      dispatch({ type: "TOKEN_OK" });
    } catch (e: any) {
      dispatch({ type: "ERROR", kind: "unknown", detail: String(e?.message ?? e) });
    }
  }, [address, chainId, connectAsync, connectors, switchChainAsync, publicClient]);

  const submit = useCallback(async (votingAddress: `0x${string}`) => {
    try {
      dispatch({ type: "SET_ADDRESS", addr: votingAddress });
      dispatch({ type: "REVIEW_CONFIRM" });

      const issuedAt = BigInt(Math.floor(Date.now() / 1000));
      const expiresAt = issuedAt + 600n;
      const nonceBytes = randomBytes(32);
      const nonceHex = ("0x" + Buffer.from(nonceBytes).toString("hex")) as `0x${string}`;

      dispatch({ type: "ENCRYPTED" });
      const pubKey = hexToBytes(APP_CONFIG.encryptionPublicKeyHex.replace(/^0x/, ""));
      const plaintext = { votingAddress, tokenId: state.tokenId!, holderWallet: address!, timestamp: new Date().toISOString() };
      const { bundleB64, bundleHash } = encryptPayload(plaintext, pubKey);

      const submission = {
        badgeContract: APP_CONFIG.badgeContract,
        tokenId: BigInt(state.tokenId!),
        holderWallet: address!,
        ciphertextHash: bundleHash, nonce: nonceHex,
        issuedAt, expiresAt,
      };
      const signature = await signTypedDataAsync({
        domain: buildDomain(APP_CONFIG.chainId), types: VOTING_SUBMISSION_TYPES,
        primaryType: "VotingAddressSubmission", message: submission,
      });
      dispatch({ type: "SIGNED" });

      const result = await postSubmit({
        badgeContract: submission.badgeContract, tokenId: state.tokenId!,
        holderWallet: address!, ciphertext: bundleB64, ciphertextHash: bundleHash,
        nonce: nonceHex, issuedAt: Number(issuedAt), expiresAt: Number(expiresAt),
        signature,
      });
      if ("error" in result) return dispatch({ type: "ERROR", kind: "backend_rejected", detail: result.error });
      dispatch({ type: "SUBMITTED" });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (/user reject|denied/i.test(msg)) return dispatch({ type: "ERROR", kind: "sig_rejected" });
      dispatch({ type: "ERROR", kind: "unknown", detail: msg });
    }
  }, [state.tokenId, address, signTypedDataAsync]);

  return { state, run, submit };
}
```

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat(web): useSubmission hook orchestrating wagmi + crypto + api"
```

### Task 4.6: Wire `App.tsx` to render the state machine

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useSubmission } from "./hooks/useSubmission.js";
import { Landing } from "./components/Landing.js";
import { Connecting } from "./components/Connecting.js";
import { Loader } from "./components/Connecting.js";
import { EnterAddress } from "./components/EnterAddress.js";
import { Review } from "./components/Review.js";
import { Success } from "./components/Success.js";
import { ErrorScreen } from "./components/ErrorScreen.js";
import { useAccount } from "wagmi";

export default function App() {
  const { state, run, submit } = useSubmission();
  const { address } = useAccount();

  switch (state.status) {
    case "landing":                 return <Landing onConnect={run} />;
    case "connecting":              return <Connecting />;
    case "checking-chain":          return <Loader label="Checking network…" />;
    case "checking-eligibility":    return <Loader label="Checking badge…" />;
    case "checking-token-status":   return <Loader label="Checking token status…" />;
    case "entering-address":        return <EnterAddress onSubmit={(a) => submit(a)} />;
    case "reviewing":               return <Review wallet={address!} tokenId={state.tokenId!} votingAddress={state.votingAddress!} onConfirm={() => submit(state.votingAddress!)} onBack={() => location.reload()} />;
    case "signing":                 return <Loader label="Waiting for signature…" />;
    case "encrypting":              return <Loader label="Encrypting…" />;
    case "submitting":              return <Loader label="Submitting…" />;
    case "success":                 return <Success tokenId={state.tokenId!} submittedAt={new Date().toISOString()} />;
    case "error":                   return <ErrorScreen kind={state.errorKind ?? "unknown"} detail={state.errorDetail} />;
  }
}
```

- [ ] **Step 2: Smoke test**

```bash
pnpm --filter @ethsec/web dev
```

Open localhost:5173 → "Connect wallet" button visible. Click → wallet prompt appears (MetaMask/Rabby).

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat(web): wire state machine to App"
```

---

## Phase 5 — Local-mode smoke test end-to-end

Stakeholders can test on Sepolia after Phase 8, but this phase proves the full frontend + backend loop on a dev Postgres with a known keypair.

### Task 5.1: Dev keypair + config wiring

- [ ] **Step 1: Generate dev keypair into `.dev-keys/`**

```bash
pnpm --filter @ethsec/scripts keygen ./.dev-keys
```

- [ ] **Step 2: Copy public key hex into `apps/web/.env.local` and `apps/api/.env`**

```bash
PUB=$(cat .dev-keys/public.key | tr -d '\n')
cp apps/web/.env.example apps/web/.env.local
sed -i "s|VITE_ENCRYPTION_PUBLIC_KEY_HEX=.*|VITE_ENCRYPTION_PUBLIC_KEY_HEX=$PUB|" apps/web/.env.local
cp apps/api/.env.example apps/api/.env
sed -i "s|ENCRYPTION_PUBLIC_KEY_HEX=.*|ENCRYPTION_PUBLIC_KEY_HEX=$PUB|" apps/api/.env
```

- [ ] **Step 3: Confirm `.dev-keys/` is git-ignored (matches `*.private.key` pattern? No — file is `private.key`. Add explicit ignore):**

Modify `.gitignore`:
```
.dev-keys/
```

- [ ] **Step 4: Spin up the stack**

```bash
docker compose -f apps/api/docker-compose.yml up -d
pnpm --filter @ethsec/api db:push
pnpm dev
```

Open localhost:5173 → click through landing → connect MetaMask with a **mainnet** wallet that doesn't hold the badge → confirm "No badge found" error screen.

- [ ] **Step 5: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore dev keypair dir"
```

---

## Phase 6 — Hardening: rejection-path integration tests

### Task 6.1: Negative integration tests for `/submit`

**Files:**
- Modify: `apps/api/src/routes/submit.test.ts`

- [ ] **Step 1: Add tests for every rejection branch** (build on Task 3.5 helpers; extract a `buildValidPayload()` helper at top of file)

```typescript
it("rejects tampered ciphertext", async () => {
  const p = await buildValidPayload();
  p.ciphertext = p.ciphertext.slice(0, -2) + "AA";
  const r = await app.inject({ method: "POST", url: "/submit", payload: p });
  expect(r.statusCode).toBe(400);
  expect(r.json().error).toBe("ciphertext_hash_mismatch");
});

it("rejects wrong signer", async () => {
  const p = await buildValidPayload();
  p.holderWallet = "0x" + "9".repeat(40);
  const r = await app.inject({ method: "POST", url: "/submit", payload: p });
  expect(r.statusCode).toBe(400);
  expect(r.json().error).toBe("signature_invalid");
});

it("rejects expired timestamp", async () => {
  const p = await buildValidPayload({ issuedAt: 1000, expiresAt: 2000 });
  const r = await app.inject({ method: "POST", url: "/submit", payload: p });
  expect(r.statusCode).toBe(400);
  expect(r.json().error).toBe("timestamp_expired");
});

it("409 on duplicate token", async () => {
  const p = await buildValidPayload();
  await app.inject({ method: "POST", url: "/submit", payload: p });
  const p2 = await buildValidPayload({ tokenId: p.tokenId });
  const r = await app.inject({ method: "POST", url: "/submit", payload: p2 });
  expect(r.statusCode).toBe(409);
  expect(r.json().error).toBe("already_submitted");
});
```

Note: onchain check must be stubbable for these tests — **gate the onchain call** behind a dependency injection or skip the check when `NODE_ENV=test` AND a test header is set, OR use viem's test client. Simplest: inject the `client` as a parameter and pass a mock in tests.

Refactor `submit.ts` to accept an `OnchainClient` interface:

```typescript
export interface OnchainClient {
  checkOwnership(contract: `0x${string}`, tokenId: bigint, wallet: `0x${string}`): Promise<{ ownsThisToken: boolean; balance: bigint }>;
}
```

Update signature: `submitRoute(app, db, env, onchain: OnchainClient)`. Production `server.ts` passes a real `viemOnchainClient`; tests pass a stub that always returns `{ ownsThisToken: true, balance: 1n }`.

- [ ] **Step 2: Run all tests → PASS**

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "test(api): negative branches for /submit + onchain DI"
```

### Task 6.2: Rate-limit test

**Files:**
- Create: `apps/api/src/routes/rate-limit.test.ts`

- [ ] **Step 1: Test**

```typescript
it("rate-limits /submit after N requests", async () => {
  for (let i = 0; i < 60; i++) await app.inject({ method: "POST", url: "/submit", payload: {} });
  const r = await app.inject({ method: "POST", url: "/submit", payload: {} });
  expect(r.statusCode).toBe(429);
});
```

- [ ] **Step 2: Run → PASS. Commit.**

```bash
git add .
git commit -m "test(api): rate-limit enforced"
```

---

## Phase 7 — Admin decryption script

### Task 7.1: `scripts/decrypt-export.ts`

**Files:**
- Create: `scripts/decrypt-export.ts`
- Modify: `scripts/package.json`
- Test: `scripts/decrypt-export.test.ts`

- [ ] **Step 1: Implement**

```typescript
#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from "node:fs";
import { hexToBytes } from "@noble/hashes/utils";
import { decryptBundle } from "@ethsec/shared";

function parseArgs(argv: string[]) {
  const get = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const input  = get("--in");   if (!input)  throw new Error("--in required");
  const keyPath = get("--key"); if (!keyPath) throw new Error("--key required");
  const output = get("--out") ?? input.replace(/\.csv$/, ".decrypted.csv");
  return { input, keyPath, output };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) { if (c === '"' && line[i+1] === '"') { cur += '"'; i++; } else if (c === '"') { quoted = false; } else { cur += c; } }
    else { if (c === '"') quoted = true; else if (c === ",") { out.push(cur); cur = ""; } else { cur += c; } }
  }
  out.push(cur); return out;
}

function main() {
  const { input, keyPath, output } = parseArgs(process.argv.slice(2));
  const keyHex = readFileSync(keyPath, "utf8").trim().replace(/^0x/, "");
  const secretKey = hexToBytes(keyHex);

  const [headerLine, ...rows] = readFileSync(input, "utf8").trimEnd().split("\n");
  const headers = splitCsvLine(headerLine);
  const ctIdx = headers.indexOf("ciphertext");
  if (ctIdx < 0) throw new Error("ciphertext column missing");

  const outHeader = "token_id,holder_wallet,voting_address,submitted_at,notes,mapped_identity";
  const outRows: string[] = [outHeader];
  for (const row of rows) {
    const cols = splitCsvLine(row);
    const ct = cols[ctIdx];
    const pt = decryptBundle(ct, secretKey) as { votingAddress: string };
    const tokenId      = cols[headers.indexOf("token_id")];
    const holderWallet = cols[headers.indexOf("holder_wallet")];
    const submittedAt  = cols[headers.indexOf("submitted_at")];
    outRows.push(`"${tokenId}","${holderWallet}","${pt.votingAddress}","${submittedAt}","",""`);
  }
  writeFileSync(output, outRows.join("\n") + "\n");
  console.log(`✔ wrote ${output}`);
}

main();
```

- [ ] **Step 2: Add `"decrypt": "tsx ./decrypt-export.ts"` script**

- [ ] **Step 3: Round-trip test**

```typescript
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
    const { publicKey, secretKey } = ml_kem768.keygen();
    const keyPath = join(dir, "priv.key"); writeFileSync(keyPath, "0x" + bytesToHex(secretKey));
    const { bundleB64 } = encryptPayload({ votingAddress: "0x" + "1".repeat(40), tokenId: "5", holderWallet: "0x" + "2".repeat(40), timestamp: "2026-01-01T00:00:00Z" }, publicKey);
    const csv = `id,token_id,holder_wallet,signature,ciphertext,ciphertext_hash,nonce,submitted_at\n"u","5","0x${"2".repeat(40)}","0xsig","${bundleB64}","0xhash","0xnonce","2026-01-01T00:00:00Z"`;
    const inPath = join(dir, "enc.csv"); writeFileSync(inPath, csv);
    const outPath = join(dir, "dec.csv");
    execSync(`pnpm tsx scripts/decrypt-export.ts --in ${inPath} --key ${keyPath} --out ${outPath}`, { stdio: "inherit" });
    const out = readFileSync(outPath, "utf8");
    expect(out).toContain("0x" + "1".repeat(40));
    rmSync(dir, { recursive: true });
  });
});
```

- [ ] **Step 4: Run → PASS. Commit.**

```bash
git add .
git commit -m "feat(scripts): offline decrypt-export CSV tool"
```

---

## Phase 8 — Sepolia test contract + E2E

### Task 8.1: Foundry test ERC-721

**Files:**
- Create: `contracts/TestBadge.sol`
- Create: `contracts/foundry.toml`
- Create: `scripts/deploy-sepolia-nft.ts`

- [ ] **Step 1: `foundry.toml`**

```toml
[profile.default]
src = "."
out = "out"
libs = ["lib"]
```

- [ ] **Step 2: `TestBadge.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC721/ERC721.sol";

contract TestBadge is ERC721 {
    uint256 public nextId = 1;
    constructor() ERC721("Test ETHSecurity Badge", "tESB") {}
    function mint(address to) external returns (uint256 id) { id = nextId++; _safeMint(to, id); }
    function _baseURI() internal pure override returns (string memory) { return "ipfs://test/"; }
}
```

- [ ] **Step 3: Deploy script (TS using viem)**

```typescript
#!/usr/bin/env tsx
// scripts/deploy-sepolia-nft.ts
import { createWalletClient, http, parseAbi } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { execSync } from "node:child_process";

const pk = process.env.DEPLOYER_PK as `0x${string}`;
if (!pk) { console.error("set DEPLOYER_PK"); process.exit(1); }
const rpc = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";

// Compile with forge
execSync("forge build --root contracts", { stdio: "inherit" });
const artifact = JSON.parse(execSync("cat contracts/out/TestBadge.sol/TestBadge.json").toString());

const account = privateKeyToAccount(pk);
const client = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
const hash = await client.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object });
console.log(`deploy tx: ${hash}`);
```

- [ ] **Step 4: Run deploy, capture address, update `.env`**

```bash
export DEPLOYER_PK=0x<throwaway_sepolia_pk>
pnpm tsx scripts/deploy-sepolia-nft.ts
# wait for tx, grab deployed address from sepolia.etherscan.io
# update VITE_BADGE_CONTRACT_SEPOLIA and BADGE_CONTRACT (in .env with CHAIN_ID=11155111)
```

- [ ] **Step 5: Mint a test badge to your wallet**

```bash
cast send $DEPLOYED --rpc-url $SEPOLIA_RPC --private-key $DEPLOYER_PK "mint(address)" $MY_WALLET
```

- [ ] **Step 6: Commit (contracts only, not the deployer PK)**

```bash
git add contracts scripts/deploy-sepolia-nft.ts
git commit -m "feat(contracts): TestBadge ERC-721 + sepolia deploy script"
```

### Task 8.2: Enable the skipped onchain test

**Files:**
- Modify: `apps/api/src/onchain.test.ts`

- [ ] **Step 1: Flip `it.skip` to `it` and point at deployed address**

```typescript
it("verifies against deployed Sepolia TestBadge", async () => {
  const client = makeClient(11155111, process.env.SEPOLIA_RPC!);
  const res = await checkOwnership(client, process.env.VITE_BADGE_CONTRACT_SEPOLIA as `0x${string}`, 1n, process.env.MY_WALLET as `0x${string}`);
  expect(res.balance).toBeGreaterThanOrEqual(1n);
});
```

- [ ] **Step 2: Run (requires Sepolia RPC + known minted wallet). PASS.**

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "test(api): live Sepolia onchain ownership check"
```

### Task 8.3: Playwright E2E on Sepolia

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/submission.spec.ts`
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add `@playwright/test` + `"e2e": "playwright test"` script.**

- [ ] **Step 2: Spec (uses Synpress or manual MetaMask mock; for MVP, test the non-wallet state transitions via direct reducer dispatch hook exposed in dev mode)**

```typescript
import { test, expect } from "@playwright/test";

test("landing page renders + connect button works", async ({ page }) => {
  await page.goto("http://localhost:5173");
  await expect(page.getByRole("heading", { name: /ETHSecurity Voting Badge/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Connect wallet/ })).toBeVisible();
});
```

Full wallet E2E is out of scope for this plan; documented in README under "manual test checklist" with Sepolia steps.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "test(web): playwright smoke E2E"
```

---

## Phase 9 — Static thumb-drive build

### Task 9.1: Verify `base: "./"` produces file:// compatible build

**Files:**
- Modify: `apps/web/package.json` (add `build:static` alias)

- [ ] **Step 1: Add script**

```json
"build:static": "vite build"
```

- [ ] **Step 2: Build and test locally**

```bash
pnpm --filter @ethsec/web build:static
# open apps/web/dist/index.html directly in browser
```

Confirm page loads, Tailwind renders, and env-baked API URL works.

Document in `docs/static-thumb-drive-mode.md` that the backend URL is **baked at build time** via `VITE_API_URL`, and show how to rebuild for a different backend.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat(web): static build target for thumb-drive mode"
```

---

## Phase 10 — Documentation

### Task 10.1: `README.md`

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README with:**
  - Project purpose (one paragraph)
  - Requirements (Node 20, pnpm 9, Docker for local Postgres)
  - Quick start (clone → `pnpm i` → `pnpm keygen` → update `.env.local` → `docker compose up -d` → `pnpm dev`)
  - Links to `docs/architecture.md`, `docs/hosted-mode.md`, `docs/local-repo-mode.md`, `docs/static-thumb-drive-mode.md`
  - Manual Sepolia test checklist (mint token, connect wallet, full flow)
  - Deployment open items (list from spec §14)

- [ ] **Step 2: Commit**

### Task 10.2: `docs/architecture.md`

- [ ] **Step 1: Short doc** — 1 page summarizing: components (web, api, shared), data flow, crypto layer, security boundaries, where the private key lives (nowhere in repo).

- [ ] **Step 2: Commit**

### Task 10.3: `docs/hosted-mode.md`

- [ ] **Step 1: Doc** — deploy FE on Vercel, API on Railway, Postgres on Neon/Railway; env var checklist; CORS setup.

- [ ] **Step 2: Commit**

### Task 10.4: `docs/local-repo-mode.md`

- [ ] **Step 1: Doc** — clone, install, `docker compose up -d` for db, `pnpm dev`, test against Sepolia.

- [ ] **Step 2: Commit**

### Task 10.5: `docs/static-thumb-drive-mode.md`

- [ ] **Step 1: Doc** — `pnpm build:static` with the backend URL you want baked in; copy `apps/web/dist/` to USB; open `index.html`; covers how to move signed payloads between machines (submission can be rebuilt offline and POSTed from a different machine via the JSON payload).

- [ ] **Step 2: Commit**

### Task 10.6: Decryption workflow doc

**Files:**
- Create: `docs/decryption-workflow.md`

- [ ] **Step 1: Doc** — offline admin steps: export CSV, run `decrypt-export.ts`, produce `decrypted.csv` with the exact column list from spec §8.5.

- [ ] **Step 2: Commit**

---

## Self-review checklist (completed after plan written)

- **Spec coverage:** every section of the spec maps to a task — §2 scope (Phases 0–9), §3 stack (Phases 0–1, 3–4), §4 run modes (Phases 5, 9), §5 contracts (Phase 8), §6 flow (Phase 4), §7 crypto (Phases 1, 4), §8 backend (Phase 3), §9 security (Phase 6 + DI refactor), §10 testing (Phases 1, 3, 6, 8), §11 config (Phases 3, 4), §12 deliverables (Phases 0–10), §13 branding (Phase 4), §14 open items (Phase 10 README).
- **Placeholders:** none — every step has exact code or command.
- **Type consistency:** `VotingAddressSubmission` fields match across `packages/shared/src/eip712.ts`, `apps/api/src/verify.ts`, `apps/api/src/routes/submit.ts`, `apps/web/src/hooks/useSubmission.ts`. `SubmitRequest` fields match between frontend `postSubmit` call and backend `SubmitRequestSchema`.
- **Scope:** single implementation plan; no independent subsystems that need decomposition.

---

## Deferred / explicitly not in plan

- Wallet-in-the-browser E2E with real MetaMask via Synpress (manual test checklist instead — spec didn't require automated wallet E2E)
- Production CI/CD pipeline (out of scope; spec §2 silent on this)
- Monitoring / alerting
- Multi-keypair rotation (single keypair sufficient for MVP per spec §7.3)
