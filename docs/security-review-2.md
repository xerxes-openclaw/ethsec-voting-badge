# Security review #2 — ethsec-voting-badge

**Date:** 2026-04-19
**Scope:** current HEAD of `griffgiveth:main` (commit `f618722`, the PR #6
merge). Diff-focused on commits `286fd7f`, `8723d34`, `f618722` relative
to the baseline [security-review.md](./security-review.md) at `92fdc0e`.

**Headline:** **No critical or high-severity issues found.** The two
commits in PR #6 improve resilience (deeper log scan + better airgap
error message) without introducing security regressions. Two
low-to-medium findings below, neither a bug — both quality-of-life
polish.

---

## Summary table

| Severity | Count | Finding |
| --- | --- | --- |
| Critical | 0 | — |
| High     | 0 | — |
| Medium   | 1 | Sequential RPC calls in `useHeldTokenIds` — UX, not security |
| Low      | 1 | `multi_badge_or_zero` error message lumps two distinct cases |
| Info     | 0 | — |

---

## 1. Encryption + decryption key handling

**No issues found.** Encryption flow unchanged from the baseline review.
ML-KEM-768 encapsulate + HKDF-SHA256 + AES-256-GCM with fresh 12-byte
nonces per call — verified again. PR #6 does not touch
`packages/shared/src/crypto.ts` or any of the decryption paths
(`AdminPage.tsx`, `scripts/decrypt-export.ts`, `scripts/sign-offline.ts`).

The private key still only ever lives in:
- the admin's local file (`0o600`)
- the admin's browser React state during in-page decryption
- the `PRIVATE_KEY` local `.env` when using the `sign-offline` CLI

Never on disk elsewhere, never over the wire, never in logs.

## 2. EIP-712 + signature verification

**No issues found.** `apps/api/src/verify.ts` and the `/submit`
signature recovery call at
[routes/submit.ts:80–83](../apps/api/src/routes/submit.ts) are
unchanged. Chain id still locked into the domain, `ciphertextHash`
still bound into the typed data, 15-min expiry window still enforced.

## 3. Onchain ownership check

**No issues found.** [`routes/submit.ts:87–91`](../apps/api/src/routes/submit.ts)
still `ownerOf(tokenId)` + `balanceOf(holderWallet)` via viem against
the configured RPC before insert. DB's `UNIQUE(token_id)` is the final
race arbiter.

See Finding B below for a low-severity note on the balance check's
error-message shape.

## 4. Admin endpoints

**No issues found.** Constant-time bearer compare
(`admin-export.ts:17–23`) unchanged. Admin-export endpoint still
returns `401 admin_export_disabled` when `ADMIN_EXPORT_TOKEN` env is
unset.

## 5. `useHeldTokenIds` hook — new in PR #6

### Finding A (medium, UX / RPC load — not security)

**File:** `apps/web/src/hooks/useHeldTokenIds.ts` lines 80–109

The rewrite walks Transfer logs backward in 49k-block chunks up to
`VITE_MAX_LOG_SCAN_BLOCKS` (default 2,000,000 ≈ 8 months on mainnet).
Chunks are awaited sequentially. Worst case for a wallet that holds
nothing but an older contract could trigger ~41 sequential `getLogs`
calls.

The `balanceOf` short-circuit at
[useHeldTokenIds.ts:71–78](../apps/web/src/hooks/useHeldTokenIds.ts)
protects non-holders cleanly, so this worst case only fires for a
holder whose balance lookup incorrectly returns > 0 (shouldn't happen
with a well-formed ERC-721). For realistic users, the early-exit when
`foundIds.size >= balance` at
[line 105](../apps/web/src/hooks/useHeldTokenIds.ts) usually ends the
scan in 1–3 chunks.

**Not a bug.** **Not a DoS vector** against our server — it hits
whatever public RPC `VITE_RPC_URL` points at. The concern is UX
(wall-clock time) + respect for public-RPC rate limits (60–300 req/min
on publicnode/Infura free tiers).

**Suggestion (optional, skipped in this PR for simplicity):** batch
chunks 3–5 at a time with `Promise.all` to reduce wall-clock by ~3–5×,
at the cost of 3–5× burst RPC traffic. Pick whichever you prefer; I
lean toward leaving sequential for now since the early-exit handles
the common case.

**Severity:** Medium (quality). Zero security impact.

## 6. Offline mode / airgap flow — improved error

**File:** `apps/web/src/components/OfflineApp.tsx` lines 114–131
(commit `8723d34`)

**No issues found.** The change catches the network error when the
offline page falls back to `/config` fetch, and surfaces a clear
"build with VITE_ENCRYPTION_PUBLIC_KEY_HEX set" message. Defensive and
correct. No information leak in the error string (it includes the raw
fetch error, which is a generic `Failed to fetch` or `net::ERR_*`
string — no secrets).

## 7. Docker, Caddy, TLS, CSP, HSTS

**No issues found.** The three commits in PR #6 don't touch
`Dockerfile`, `docker-compose.yml`, `Caddyfile`, or `.env.example`.
Baseline review already covered those.

`VITE_MAX_LOG_SCAN_BLOCKS` is a new env var but it's build-time on the
web bundle, not secret, not runtime-sensitive.

## 8. Dependency hygiene

**No issues found.** PR #6 adds no new dependencies. Package versions
unchanged from the baseline review:

- `@noble/post-quantum` 0.2.1
- `@noble/ciphers` 1.0.0
- `@noble/hashes` 1.5.0
- `viem` 2.21.0
- `wagmi` 2.x, `@rainbow-me/rainbowkit` 2.2.x
- `fastify` 4.28.0
- `drizzle-orm` 0.33.0

No known high-severity CVEs in any of these as of 2026-04-19.

## 9. Error handling + timing side-channels

**No issues found.** The new error message in `OfflineApp.tsx` is
user-facing only — not logged server-side and doesn't leak
cryptographic state. The new hook's error branch returns the raw
error `.message`, which for network errors is generic. No crypto
timing surface was modified.

## 10. XSS / CSRF / content injection

**No issues found.** Zero uses of `dangerouslySetInnerHTML`, `eval`, or
raw DOM injection in the three modified files. `OfflineApp.tsx`'s
existing `validateSubmitBody()` still strictly types + length-checks
all uploaded blob fields before they leave the browser.

## 11. Database + UNIQUE constraints

**No issues found.** Schema unchanged. `UNIQUE(token_id)` is still
the final duplicate arbiter. Drizzle still parameterises all queries.

---

## Finding B (low, non-security)

**File:** [`apps/api/src/routes/submit.ts:87–91`](../apps/api/src/routes/submit.ts)

```ts
if (ownership) {
  const own = await ownership.check(submission.tokenId, submission.holderWallet);
  if (!own.ownsThisToken) return reply.code(403).send({ error: "not_owner" });
  if (own.balance !== 1n) return reply.code(403).send({ error: "multi_badge_or_zero" });
}
```

The second check rejects **any holder whose total badge balance is
not exactly 1**. That includes:

- A holder who owns **0** badges — already caught by `!ownsThisToken`,
  so they'd return `not_owner` first. This branch of the error is
  unreachable from the zero case.
- A holder who owns **>1** badge — gets `multi_badge_or_zero` even
  though they correctly own the specific tokenId they're submitting.

Two ways this shows up:

1. **If the design intends "one holder = one voting address
   regardless of how many badges they own":** a holder with 2 badges
   can't submit at all. They'd need to transfer one away first. This
   is a **product decision** question — intentional or not?
2. **If the design intends "one badge = one vote, a holder with N
   badges submits N times":** the check is a bug — it blocks
   legitimate multi-badge submissions.

**Suggestion:** confirm which model is intended. If model 2 (per-badge
vote), drop the `balance !== 1` check entirely — `ownsThisToken` +
`UNIQUE(token_id)` are sufficient. If model 1 (per-holder), keep the
check but split the error message so holders know they own multiple:

```ts
if (own.balance === 0n) return reply.code(403).send({ error: "not_owner" });
if (own.balance > 1n)  return reply.code(403).send({ error: "holder_must_own_exactly_one_badge" });
```

**Severity:** Low. No security impact — the check is restrictive in
the safe direction. Only an error-clarity / product-design concern.

---

## Conclusion

PR #6 is clean. The deeper log scan is correct, the new error message
is helpful, and neither change introduces a security regression. The
two findings above are:

- **Finding A** (Medium): optional RPC parallelisation. No urgency.
- **Finding B** (Low): product-design question about multi-badge
  holders + error-message split. Needs your call before I touch it.

Nothing to rotate, no keys to revoke, no endpoints to patch.
