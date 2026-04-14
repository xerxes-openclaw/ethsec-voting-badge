# ETHSecurity Voting Badge — Address Submission Tool

**Design spec · 2026-04-14**
**Authors:** Griff (product) · Zeptimus (product) · Xerxes (engineering)

## 1. Purpose

A one-time-use web app that lets ETHSecurity Badge holders privately register a separate Ethereum voting address. Submissions are encrypted client-side and stored as ciphertext only; decryption happens exclusively on Griff's offline machine.

The goal is unlinkability: a badge holder's on-chain voting and donation activity should not be trivially traceable back to their public badge-holding wallet.

## 2. Scope

### In scope
- Eligibility gate based on holding exactly **one** token from the configured ERC-721 contract on Ethereum mainnet
- One-time submission per `tokenId`, enforced in DB with a unique constraint
- EIP-712 signature by the badge-holding wallet
- Client-side encryption of the voting address using ML-KEM-768 + AES-256-GCM
- Hosted web deployment, local `git clone` dev, and fully static thumb-drive build
- Admin CSV export of ciphertexts (decryption happens offline via a separate script)

### Explicit non-goals (will not build)
Onchain storage · decentralized storage · in-app decryption · proof-of-control of the voting address · ENS resolution · edit/update flows · multi-token selection UX · anonymity systems beyond encrypted submission · private voting · unrelated product enhancements.

## 3. Stack & repo layout

Monorepo, `pnpm` workspaces:

```
ethsec-voting-badge/
├─ apps/
│  ├─ web/                     Vite + React 18 + TS (frontend)
│  └─ api/                     Fastify 4 + TS (backend)
├─ packages/
│  └─ shared/                  zod schemas, EIP-712 types, crypto helpers
├─ scripts/
│  ├─ generate-keypair.ts      ML-KEM-768 keygen (local, offline)
│  ├─ decrypt-export.ts        Local decryption of admin CSV export
│  └─ deploy-sepolia-nft.ts    Foundry script for test badge contract
├─ contracts/                  Foundry: TestBadge.sol (Sepolia only)
├─ docs/
│  ├─ architecture.md
│  ├─ hosted-mode.md
│  ├─ local-repo-mode.md
│  └─ static-thumb-drive-mode.md
└─ README.md
```

**Frontend deps:** wagmi v2, viem, TanStack Query, Tailwind CSS (DAO.fund palette), `@noble/post-quantum` (ML-KEM-768), `@noble/ciphers` (AES-256-GCM), `@noble/hashes` (SHA-256 + HKDF).

**Backend deps:** Fastify 4, Drizzle ORM, Postgres 16, viem (onchain reads), zod, `@fastify/rate-limit`, `@fastify/cors`.

**Shared:** zod submission schema, EIP-712 domain + type definition, ciphertext-bundle codec — single source of truth imported by both FE and BE.

## 4. Run modes

| Mode | Build | Who uses it | Notes |
|------|-------|-------------|-------|
| Hosted | `pnpm build` → deploy FE on Vercel/Netlify/Cloudflare, API on Railway/Fly, managed Postgres | Normal badge holders | Backend URL baked into FE build via `VITE_API_URL` |
| Local repo | `pnpm dev` | Devs, auditors, paranoid users running from source | Spins up FE + API + local Postgres (docker-compose) |
| Static thumb-drive | `pnpm build:static` → copy `apps/web/dist/` onto USB, open `index.html` via browser | Cold-storage signers, offline environments | FE works fully offline up to final `POST /submit`; backend URL set at build time or via prompt |

## 5. Contract configuration

- **Mainnet badge:** `0xf67c0ade41c607efebf198f9d6065ab1ec5ad4cd` (ERC-721, ERC1967 upgradeable proxy, verified on Etherscan)
- **Sepolia test badge:** deployed from `contracts/TestBadge.sol` via Foundry; address written to `.env.sepolia` after deploy
- Selection via `VITE_NETWORK=mainnet|sepolia` at build time

## 6. User flow

State machine, one React component per state:

```
landing → connecting → checking-chain → checking-eligibility
  → checking-token-status → entering-address → reviewing
  → signing → encrypting → submitting → success
                                              ↘ error (terminal)
```

**Hard-fail (terminal error) triggers:** >1 badge in wallet, token already used, user refuses mainnet switch, signature rejected, backend rejects submission.

**Input validation:** voting address must be a valid EVM address (viem `isAddress`) and not `0x000…0`.

**UX guardrails:**
- No private-key input anywhere in UI; all signing via wallet
- One-time-submission warning on the review screen and the success screen
- Copy on the review screen: "Submit a normal hot wallet you control. It will later be used to interact with a dapp." and "This submission is one-time and cannot be changed."

## 7. Cryptography

### 7.1 Encryption (client-side, deterministic order)

1. Build plaintext JSON: `{votingAddress, tokenId, holderWallet, timestamp}` (ISO8601 timestamp).
2. ML-KEM-768 `encapsulate(publicKey)` → `{sharedSecret, kemCiphertext}`.
3. `aesKey = HKDF-SHA256(sharedSecret, salt="ethsec-voting-badge-v1", info="aes-256-gcm")`.
4. AES-256-GCM encrypt plaintext with random 12-byte `aesNonce`.
5. Ciphertext bundle = base64-encoded JSON `{v:1, kemCiphertext, aesNonce, aesCiphertext, aesTag}`.
6. `ciphertextHash = sha256(bundle)` — hex-encoded, included in signed payload.

### 7.2 EIP-712 signature

**Domain:**
```
name: "ETHSecurity Voting Badge"
version: "1"
chainId: 1                  // (11155111 when VITE_NETWORK=sepolia)
```

**Type `VotingAddressSubmission`:**
```
badgeContract:  address
tokenId:        uint256
holderWallet:   address
ciphertextHash: bytes32
nonce:          bytes32     // random, generated per submission
issuedAt:       uint256     // unix seconds
expiresAt:      uint256     // issuedAt + 600 (10-minute window)
```

### 7.3 Key management

- Keypair generated via `scripts/generate-keypair.ts` on Griff's offline machine.
- Output: `public.key` (embedded in FE config, safe to commit) and `private.key` (offline only, NEVER in repo).
- Root `.gitignore` blocks `*.private.key` and `private.key`.
- Library: `@noble/post-quantum` (audited, zero-dependency, works in browser and Node).

## 8. Backend

### 8.1 Routes

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/config` | none | `{badgeContract, chainId, encryptionPublicKey, eip712Domain}` |
| GET | `/token-status/:tokenId` | none | `{used: boolean}` |
| POST | `/submit` | none (signature is the auth) | `{ok: true, submittedAt}` or typed error |
| GET | `/admin/export` | `Authorization: Bearer <ADMIN_EXPORT_TOKEN>` | CSV of ciphertext rows |

### 8.2 `/submit` verification order (atomic)

1. zod-validate payload shape.
2. Recompute `sha256(ciphertext)`; reject if ≠ signed `ciphertextHash`.
3. Recover EIP-712 signer; reject if ≠ `holderWallet`.
4. Reject if `issuedAt` or `expiresAt` outside a ±5-min tolerance around server clock, or `expiresAt ≤ now`.
5. viem RPC call: `ownerOf(tokenId) == holderWallet` AND `balanceOf(holderWallet) == 1` on the configured badge contract. Reject on either failure.
6. `INSERT INTO submissions …` — `UNIQUE(token_id)` constraint provides race-safe one-time enforcement; unique-violation maps to a dedicated "already submitted" error.

### 8.3 DB schema

```sql
CREATE TABLE submissions (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id               NUMERIC      UNIQUE NOT NULL,
  holder_wallet          TEXT         NOT NULL,
  signature              TEXT         NOT NULL,
  signature_payload_json JSONB        NOT NULL,
  ciphertext             TEXT         NOT NULL,
  ciphertext_hash        TEXT         NOT NULL,
  nonce                  TEXT         NOT NULL,
  submitted_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

### 8.4 CSV export columns

`id, token_id, holder_wallet, signature, ciphertext, ciphertext_hash, nonce, submitted_at`

No plaintext columns. Never.

### 8.5 Admin decryption workflow (offline)

1. `curl -H "Authorization: Bearer $TOKEN" https://api.host/admin/export > encrypted.csv`
2. `pnpm tsx scripts/decrypt-export.ts --in encrypted.csv --key ./private.key --out decrypted.csv`
3. Decrypted CSV columns: `token_id, holder_wallet, voting_address, submitted_at, notes, mapped_identity` (last two blank, manually filled by Griff).
4. Script runs entirely offline; never touches the backend.

## 9. Security posture

- Private key never in repo, frontend, or backend. Offline only.
- Frontend config contains only the ML-KEM public key — safe to commit, safe to serve.
- Backend cannot decrypt even if compromised.
- Rate limiting on `/submit` and `/token-status/:id` (per-IP, sane defaults via `@fastify/rate-limit`).
- CORS locked to configured frontend origin in hosted mode; open in static mode (user serves locally).
- EIP-712 10-minute `expiresAt` window limits replay exposure.
- No private-key paste surface anywhere in UI.
- Admin export gated by rotatable bearer token; returns ciphertexts only.
- CSP headers on backend responses; no inline scripts on FE; dependencies pinned.
- `holder_wallet` is recorded in the clear (it's the public badge-holding wallet — already public onchain). Only the voting address is secret.

## 10. Testing

- **Unit:** crypto round-trip (browser-env encrypt → node-script decrypt), EIP-712 verification, zod schemas, ciphertext-hash mismatch, signature mismatch.
- **Integration:** real Fastify + Postgres, happy path + every rejection branch (sig mismatch, ciphertext tampering, wrong owner, token already used, multi-badge holder, expired timestamp, stale timestamp).
- **E2E on Sepolia:** deploy `TestBadge.sol`, mint to a throwaway wallet, run full flow in Playwright against live Sepolia RPC.
- **Decryption script:** verified end-to-end against a real `/admin/export` CSV using the matching test keypair.

## 11. Configuration (placeholders)

Frontend (`apps/web/.env.example`):
```
VITE_NETWORK=mainnet
VITE_API_URL=http://localhost:3001
VITE_BADGE_CONTRACT_MAINNET=0xf67c0ade41c607efebf198f9d6065ab1ec5ad4cd
VITE_BADGE_CONTRACT_SEPOLIA=0xPLACEHOLDER_AFTER_DEPLOY
VITE_ENCRYPTION_PUBLIC_KEY_HEX=0xPLACEHOLDER_FROM_KEYGEN
VITE_RPC_URL_MAINNET=https://...
VITE_RPC_URL_SEPOLIA=https://...
```

Backend (`apps/api/.env.example`):
```
DATABASE_URL=postgres://...
BADGE_CONTRACT=0xf67c0ade41c607efebf198f9d6065ab1ec5ad4cd
CHAIN_ID=1
RPC_URL=https://...
ADMIN_EXPORT_TOKEN=<rotate_me>
CORS_ALLOWED_ORIGIN=https://your-frontend.example
```

## 12. Deliverables checklist

1. Monorepo structure as in §3
2. Frontend app (`apps/web`)
3. Backend app (`apps/api`)
4. Shared package (`packages/shared`)
5. `.env.example` for web and api
6. Root README with setup + run instructions for all 3 modes
7. `docs/hosted-mode.md`, `docs/local-repo-mode.md`, `docs/static-thumb-drive-mode.md`
8. `scripts/decrypt-export.ts` + documentation
9. `scripts/generate-keypair.ts` + documentation
10. `contracts/TestBadge.sol` + `scripts/deploy-sepolia-nft.ts`
11. `docs/architecture.md` — short architecture overview
12. Test suites per §10

## 13. Branding

DAO.fund palette:
- Red-500 `#FF3535` — primary CTA
- Blue-500 `#2C5EB6` — secondary / deep navy backgrounds
- Green-500 `#5CB75A` — success / accents
- Black — neutral scale

Typography: **Inter** (body), **Inter Tight** (headings).
Aesthetic: dark navy gradient background, white text on dark, rounded red buttons, centered minimal layout. Đ logo in header.

## 14. Open items for a human before deployment

- Generate production ML-KEM-768 keypair on Griff's offline machine; place `public.key` hex into `VITE_ENCRYPTION_PUBLIC_KEY_HEX`.
- Provision production Postgres (Railway/Fly/Neon) and set `DATABASE_URL`.
- Provision mainnet RPC endpoint (Alchemy/Infura) and set `RPC_URL`.
- Generate and set `ADMIN_EXPORT_TOKEN` (≥32 bytes random).
- Deploy `TestBadge.sol` to Sepolia and update `VITE_BADGE_CONTRACT_SEPOLIA`.
- Set `CORS_ALLOWED_ORIGIN` to the production frontend host.
- Confirm FE deployment target and DNS.
