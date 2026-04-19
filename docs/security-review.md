# Security review — ethsec-voting-badge

**Date:** 2026-04-19
**Scope:** all code in this repo at commit `74a4335` (the tip before this
review was written). Review covers the API (`apps/api`), the web app
(`apps/web`), the shared crypto package (`packages/shared`), the CLI
scripts (`scripts/`), and the production Caddy + docker-compose setup.

**Headline:** No critical vulnerabilities found. Two low-severity items
were fixed as part of this review (see [§ Fixes applied](#fixes-applied)).
Everything else is either correctly implemented or an intentional
trade-off documented below.

---

## 1. Threat model

| Adversary | Goal | How we defend |
| --- | --- | --- |
| Random attacker | Submit a vote without owning a badge | EIP-712 signature + onchain `ownerOf` check at `/submit` |
| Malicious badge holder | Submit twice, replay an old signature, or swap the ciphertext after signing | UNIQUE(token_id) at DB level; `ciphertextHash` bound into the EIP-712 payload; 15-min `expiresAt` window; fresh 32-byte `nonce` per submission |
| Network attacker (MITM / traffic log) | Recover a submitted voting address | ML-KEM-768 + AES-256-GCM in-browser; only ciphertext + hash + signature ever leave the device; TLS on the wire via Caddy + Let's Encrypt |
| Stolen/leaked secret (one of two) | Decrypt the submission DB | Two-secret admin model — `ADMIN_EXPORT_TOKEN` alone gets you ciphertext you can't read; private key alone gets you nothing to fetch |
| Public API abuse | DoS the backend | `@fastify/rate-limit` (60 req/min per IP, global) + small request bodies (zod-enforced) |

Out of scope: compromise of the admin's personal machine after key
generation, compromise of the on-chain contract itself, social-engineering
against Griff.

---

## 2. Routes

### GET /config — [apps/api/src/routes/config.ts](../apps/api/src/routes/config.ts)

Returns ML-KEM pub key + EIP-712 domain + badge contract. All public
values, read by the web bundle at runtime.

- ✅ Nothing sensitive exposed.
- ✅ No parameters, no injection surface.

### GET /token-status/:tokenId — [apps/api/src/routes/token-status.ts](../apps/api/src/routes/token-status.ts)

Returns `{ tokenId, used: boolean }`. Used by the web flow to short-
circuit before signing if the badge already submitted.

- ✅ Path param validated by zod regex (`^\d+$`).
- ✅ Parameterised query via drizzle `eq()` — no SQLi.
- ⚠️ Information leak is intentional: yes, a scraper can learn which
  tokenIds have already voted. The authoritative check still happens at
  `/submit`. Acceptable trade-off for the UX.

### POST /submit — [apps/api/src/routes/submit.ts](../apps/api/src/routes/submit.ts)

The critical path. Accepts `{badgeContract, tokenId, holderWallet,
ciphertext, ciphertextHash, nonce, issuedAt, expiresAt, signature}`
and applies, in order:

1. zod schema validation on the body
2. `badgeContract` must equal the server's configured contract
3. ciphertext must base64-decode
4. `ciphertextHash === sha256(ciphertext)` — binds the signed commitment to
   the exact payload being stored
5. `issuedAt` within ±5 min of now; `expiresAt - issuedAt ≤ 15 min`
6. `recoverTypedDataAddress` over the full EIP-712 payload must return
   `holderWallet`
7. `ownerOf(tokenId)` via viem against the configured RPC must equal
   `holderWallet`
8. DB insert — `UNIQUE(token_id)` enforces one-shot

- ✅ Every step is authoritative; each guards a different attack.
- ✅ Signature is bound to the chain id (EIP-712 domain), contract
  address, tokenId, encrypted payload hash, nonce, and timestamps. No
  practical replay across chains, contracts, or payloads.
- ⚠️ Two identical submissions can race — the DB's UNIQUE constraint
  arbitrates. Whichever transaction commits first wins; the second
  returns `409 already_submitted`. No data corruption.
- ⚠️ Within a signature's 10-minute validity window, the same blob can
  be replayed by any party that sees it — but the server rejects it with
  `already_submitted` on the second attempt, so replay ≠ double-vote.
  Acceptable for the offline-signing story where a user may retry
  manually.

### GET /admin/export — [apps/api/src/routes/admin-export.ts](../apps/api/src/routes/admin-export.ts)

Bearer-auth CSV dump of all submissions.

- ✅ Endpoint returns `401 admin_export_disabled` when `ADMIN_EXPORT_TOKEN`
  env is unset — production default is to require it explicitly.
- ✅ Bearer compared **constant-time** via `constantTimeEqual()` — length
  checked first, then XOR accumulation. No timing side-channel.
- ✅ CSV fields double-quote-escaped per RFC 4180.
- ✅ GET-only — not cookie-based, so no CSRF path. If an attacker tricks
  the admin into visiting a site that fetches this URL cross-origin, the
  request fails (CORS preflight) and leaks nothing.
- ✅ Returns only the ciphertext bundle + signature, not the private key.
  Decryption happens client-side or via `scripts/decrypt-export.ts`; the
  private key never reaches this endpoint.

---

## 3. Signature + replay path

EIP-712 typed data lives in
[packages/shared/src/eip712.ts](../packages/shared/src/eip712.ts):

```
VotingAddressSubmission {
  address  badgeContract
  uint256  tokenId
  address  holderWallet
  bytes32  ciphertextHash
  bytes32  nonce
  uint256  issuedAt
  uint256  expiresAt
}
```

Domain is `{name: "ETHSecurity Voting Badge", version: "1", chainId}` —
chain id included.

- ✅ Cross-chain replay: prevented by chain id in domain.
- ✅ Cross-contract replay: `badgeContract` in the typed data is checked
  against the server's configured contract.
- ✅ Cross-badge replay: `tokenId` is signed; DB enforces `UNIQUE(token_id)`.
- ✅ Payload-swap: `ciphertextHash = sha256(ciphertext)` is signed; the
  server recomputes the hash and rejects on mismatch.
- ✅ Signature malleability: viem's `recoverTypedDataAddress` is used and
  the EVM ecosystem's canonical `s` normalisation is applied by any
  well-formed signer. We only compare the recovered address, so even a
  mutated-into-a-different-valid-form signature still recovers the same
  address.
- ✅ Timestamp replay: 15-min window from `issuedAt` to `expiresAt`,
  server enforces both. 5-min clock-skew tolerance on the future side.

---

## 4. Encryption

Hybrid ML-KEM-768 + AES-256-GCM, implemented in
[packages/shared/src/crypto.ts](../packages/shared/src/crypto.ts) using
`@noble/post-quantum` and `@noble/ciphers`.

Per submission:

1. `ml_kem768.encapsulate(pubKey)` → 32-byte shared secret + KEM
   ciphertext (a fresh one every call)
2. HKDF-SHA256 over the shared secret (salt `"ethsec-voting-badge-v1"`,
   info `"aes-256-gcm"`) → 32-byte AES key
3. Random 12-byte AES-GCM nonce
4. AES-256-GCM encrypts the JSON plaintext + 16-byte auth tag
5. Bundle is base64({v:1, kemCiphertext, aesNonce, aesCiphertext, aesTag})
6. `ciphertextHash = sha256(bundle base64)`, included in the EIP-712
   payload to tamper-lock the ciphertext to the signature

- ✅ Nonce uniqueness: a new 12-byte nonce is generated per encryption
  via `crypto.getRandomValues`. Combined with a fresh KEM key per
  submission, nonce-reuse is infeasible.
- ✅ Authenticated: GCM auth tag verifies integrity. Ciphertext cannot be
  silently modified.
- ✅ Post-quantum: ML-KEM-768 (FIPS 203) for the key-encapsulation step,
  AES-256 for the bulk cipher — both survive a CRQC.
- ✅ Domain-separated KDF: salt + info strings scope the derived key to
  this application and algorithm choice.
- ✅ Private key never leaves the admin's machine — neither during
  browser-based decryption (`apps/web/src/components/AdminPage.tsx`, runs
  entirely client-side) nor the CLI path (`scripts/decrypt-export.ts`,
  reads from a local file).

---

## 5. Admin auth + key handling

- ✅ Constant-time bearer comparison in
  [admin-export.ts:17–23](../apps/api/src/routes/admin-export.ts).
- ✅ Minimum `ADMIN_EXPORT_TOKEN` length (16 chars) enforced at
  [config.ts:18](../apps/api/src/config.ts). README recommends 32 bytes
  (64 hex chars).
- ✅ Admin UI at
  [AdminPage.tsx](../apps/web/src/components/AdminPage.tsx) never POSTs
  the private key — it's loaded from a file input, held in React state,
  used client-side, then discarded on page reload.
- ✅ No localStorage / sessionStorage writes of the token or key.
- ⚠️ `PUBLIC_KEY_PATH` in `config.ts` reads a file path literally. File
  permissions are operator responsibility. The public key is not a
  secret, so worst-case is a misconfiguration bug (wrong key used), not
  a leak.

---

## 6. CORS, rate limits, headers, DoS

- ✅ `@fastify/rate-limit`: 60 req/min/IP global at
  [server.ts:46](../apps/api/src/server.ts). Plenty for legit use, blocks
  bulk brute-force.
- ✅ `@fastify/cors`: driven by `CORS_ALLOWED_ORIGIN`. Default `*` is
  safe here because `/submit` is signature-gated and `/admin/export` is
  bearer-gated — CORS doesn't add security in either case.
- ✅ Request-size cap: Fastify's default 1MB body limit caps memory
  exhaustion. Our largest legitimate body is ~4KB.
- ✅ Caddy security headers (`Caddyfile`, newly added in this review):
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Strict-Transport-Security`, and a tight `Content-Security-Policy`
  (self for scripts/styles, Google Fonts allowed for Inter Tight,
  `frame-ancestors 'none'`, `connect-src` allowing HTTPS RPCs + WSS).
- ✅ Caddy strips its own `Server` header.

---

## 7. Secrets + logging

- ✅ `.env`, `.env.*` in `.gitignore`; only `.env.example` is tracked.
- ✅ `.dockerignore` excludes `.env`, `keys/`, `*.key` from build
  context — secrets can't leak into image layers.
- ✅ Fastify's default logger does not dump request bodies. `/submit`
  errors are logged as codes (`ciphertext_hash_mismatch`, `not_owner`,
  etc.) — no ciphertext or signature echoed to logs.
- ✅ constant-time compares on the only auth path.
- ⚠️ Not a bug, a reminder: Operators who set CSP / CORS / RPC_URL
  wrong will notice fast (page won't load, submissions fail). Silent
  misconfigurations aren't in the threat model.

---

## 8. Database

- ✅ Drizzle parameterises all queries; no raw SQL interpolation.
- ✅ `UNIQUE(token_id)` at schema level guarantees one submission per
  badge at commit time.
- ✅ `isUniqueViolation()` in `submit.ts` detects the Postgres error
  surface shape without regex-escaping user input.
- ⚠️ `tokenId` stored as `text` (not `numeric`) — intentional, see
  [apps/api/README.md](../apps/api/README.md) rationale. Comparisons use
  exact string equality which matches what the UI sends. Safe.

---

## 9. Web-side XSS, CSRF, key exposure

- ✅ React + Tailwind. Zero uses of `dangerouslySetInnerHTML`, `eval`,
  or raw DOM injection anywhere in the tree. Grep confirmed.
- ✅ No inline `<script>` in `index.html`. CSP's `script-src 'self'`
  is feasible without breaking anything.
- ✅ Admin private key: file input → React state → decrypt in-memory →
  discarded on reload. Never written to storage.
- ✅ Offline-mode signing: delegated to the user's wallet extension via
  wagmi + RainbowKit. Private keys never touch our code.
- ✅ Signed-blob downloads use `URL.createObjectURL` + `<a download>` —
  no server round-trip, no user-controlled HTML.

---

## 10. Scripts + CLI

- ✅ `generate-keypair.ts`: writes `public.key` (0o644, world-readable —
  safe) and `private.key` (0o600, owner-only). Refuses to overwrite an
  existing `private.key` — prevents accidental key destruction.
- ✅ `sign-offline.ts`: reads `PRIVATE_KEY` from local `.env` only.
  Writes signature file with mode 0o600. Refuses to run without the key
  set.
- ✅ `decrypt-export.ts`: reads encrypted CSV, writes decrypted output.
  **Originally** used default umask for the output file, which typically
  yields 0o644 — decrypted voting addresses readable by any local user.
  **Fixed in this review**: output now written with `{ mode: 0o600 }`.

---

## 11. Dependencies

Spot-check of versions — nothing flagged with active high-severity CVEs
as of writing:

| Package | Version | Notes |
| --- | --- | --- |
| fastify | 4.28.0 | Recent, maintained |
| @fastify/cors | 9.0.0 | — |
| @fastify/rate-limit | 9.1.0 | — |
| drizzle-orm | 0.33.0 | — |
| pg | 8.20.0 | — |
| viem | 2.21.0 – 2.47.17 | Audited |
| @noble/post-quantum | 0.2.1 | FIPS 203 ML-KEM-768 |
| @noble/ciphers | 1.0.0 | AES-GCM |
| @noble/hashes | 1.5.0 | SHA-256, HKDF |
| zod | 3.23.0 – 4.x | — |
| wagmi / rainbowkit | 2.x / 2.2.x | — |
| ethers | 6.16.0 | Used in `sign-offline.ts` only |

Recommendation: add `pnpm audit --prod` to the deploy pipeline once one
exists. Not urgent today.

---

## Fixes applied

Two low-severity items fixed as part of this review:

1. **`scripts/decrypt-export.ts`**: output CSV is now written with
   `{ mode: 0o600 }` so plaintext voting addresses aren't world-readable
   on the admin's machine by default.
2. **`Caddyfile`**: added `Strict-Transport-Security` and a strict
   `Content-Security-Policy` (self + Google Fonts + HTTPS RPCs). Both
   are defence-in-depth — the app already doesn't use inline scripts or
   third-party embeds.

No changes to the cryptography, routes, or database layer were needed.

---

## Recommendations (not required)

- **Add `pnpm audit --prod` + `docker scout` to CI** when a CI pipeline
  lands. Neither is wired up yet.
- **Consider a structured audit** by a crypto-literate third party
  before production if the voting round carries real stakes. This
  review covers implementation correctness against a stated threat
  model; it does not substitute for an independent audit.
- **Post-round data retention policy**: the DB holds ciphertext +
  signatures forever unless truncated. After results are finalised,
  consider exporting → verifying → truncating to minimise the amount of
  data at rest, even though everything in the DB is encrypted.
- **WalletConnect project id**: production deploys should register a
  real project at https://cloud.walletconnect.com rather than reusing a
  test id. The current config treats this as optional (RainbowKit works
  without it for injected wallets), but the QR connector needs a real id.
