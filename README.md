# ETHSecurity Voting Badge

A private voting-address registry for holders of the ETHSecurity Badge NFT.
Addresses are encrypted in the browser with **ML-KEM-768 + AES-256-GCM**,
stored as ciphertext, and decrypted offline by the admin after voting
closes.

## What the address is used for

The address you submit will be encrypted in the browser and decrypted
offline by Griff. He will send to that address:

- Your Voting NFT
- Gas money
- 46 FINN — worth 1 Finney (0.001 ETH) each if donated in the QF round

Every $1 donated from your submitted address counts as $4 toward
directing the matching pool. The same address may be used in future
rounds.

## Two modes

When you open the app you pick one of two modes.

### Online — normal dApp flow

For badgeholders on a regular internet-connected machine.

1. Click **Online**.
2. **Connect Wallet** → pick the wallet holding your badge.
3. The app auto-detects your `tokenId` onchain.
4. Enter your voting address → **Encrypt & Sign**.
5. Sign the EIP-712 message. The voting address is encrypted in-browser
   and posted with the signature.

One badge = one submission. Re-submissions are rejected.

### Offline — airgapped signing

For badgeholders whose signing key lives on an airgapped machine.

1. Click **Offline**.
2. Fill in: holder wallet, badge tokenId, voting address.
3. Click **Encrypt & prepare message**.
4. Pick a signing path:
   - **Connect wallet** — uses a local wallet extension (MetaMask, Rabby,
     Frame) including any hardware wallet plugged into this machine.
   - **Sign externally** — copy the EIP-712 payload, sign with `cast
     wallet sign-typed-data`, `pnpm sign-offline`, MyEtherWallet's
     offline signer, or any other EIP-712 signer; paste the `0x…`
     signature back. The page verifies the signature recovers to the
     declared holder wallet before producing the blob.
5. Download the signed blob `ethsec-submission-badge-<id>.json`.
6. On any online machine, open the app again, pick **Offline**, and use
   the **Submit a signed blob** section to upload.

What crosses the air gap: the signed JSON. What stays on the signing
machine: the private key and the plaintext voting address.

## Running locally

```bash
git clone https://github.com/griffgiveth/ethsec-voting-badge.git
cd ethsec-voting-badge
pnpm install

# Start Postgres (Docker)
docker compose -f apps/api/docker-compose.yml up -d

# Apply schema
pnpm --filter @ethsec/api db:push

# Run both servers
pnpm dev
# API → http://localhost:3001
# Web → http://localhost:5174
```

Verify:

```bash
pnpm test         # full test suite
pnpm typecheck    # tsc --noEmit
```

### Running on a truly airgapped machine

```bash
# On an online machine:
pnpm install
pnpm --filter @ethsec/web build

# Copy apps/web/dist/ to a USB, move to the airgapped machine, then serve:
npx --yes http-server apps/web/dist -p 5174
```

Open `http://localhost:5174`, pick **Offline**, follow the steps above.

Set `VITE_ENCRYPTION_PUBLIC_KEY_HEX` at build time so the page doesn't
need to fetch `/config` from the backend.

## Admin lifecycle

Before production, the admin generates two secrets on their own machine
and keeps them forever.

### 1. Keypair

```bash
pnpm install
pnpm --filter @ethsec/scripts keygen ./keys
```

Outputs:

- `./keys/public.key` — goes in `ENCRYPTION_PUBLIC_KEY_HEX` +
  `VITE_ENCRYPTION_PUBLIC_KEY_HEX` on the server. Safe to share.
- `./keys/private.key` — NEVER share, never commit, never upload. Lose
  this and you lose the ability to decrypt any submission.

### 2. Export token

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the 64-char hex string. This is your `ADMIN_EXPORT_TOKEN`. Also
never share unless via a secure channel (Signal, 1Password, age).

### 3. Deploy env vars

| Variable                          | Source                              |
| --------------------------------- | ----------------------------------- |
| `ENCRYPTION_PUBLIC_KEY_HEX`       | `./keys/public.key` contents        |
| `VITE_ENCRYPTION_PUBLIC_KEY_HEX`  | `./keys/public.key` contents        |
| `ADMIN_EXPORT_TOKEN`              | random 64-char hex from step 2      |
| `DATABASE_URL`                    | postgres connection string          |
| `BADGE_CONTRACT`                  | badge NFT address                   |
| `CHAIN_ID`                        | chain id (1 = mainnet)              |
| `RPC_URL`                         | RPC endpoint for onchain checks     |
| `CORS_ALLOWED_ORIGIN`             | the web app's origin URL            |

See `apps/api/.env.example` and `apps/web/.env.example`.

### 4. Decrypt after voting closes

**In-browser** — open `<your-url>` → footer → **Admin**, paste the token
and private key, click **Fetch & Decrypt**, **Download** the CSV. All
decryption happens client-side.

**Offline CLI** — for the most paranoid setup:

```bash
# 1. Fetch encrypted CSV
curl -H "Authorization: Bearer $ADMIN_EXPORT_TOKEN" \
  https://<api-host>/admin/export -o encrypted-export.csv

# 2. Decrypt locally (air-gapped OK)
pnpm --filter @ethsec/scripts decrypt \
  --in encrypted-export.csv \
  --key ./keys/private.key \
  --out decrypted.csv
```

## Architecture

| Package            | Role                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| `apps/api`         | Fastify server. Verifies EIP-712 sig + onchain ERC-721 ownership.       |
| `apps/web`         | Vite + React + RainbowKit frontend. Submission and admin-decrypt UI.   |
| `packages/shared`  | Hybrid encryption (ML-KEM-768 + AES-256-GCM). Browser- and Node-safe.  |
| `scripts`          | `keygen`, `decrypt`, `sign-offline` CLI tools.                          |

API routes: `GET /config`, `GET /token-status/:id`, `POST /submit`,
`GET /admin/export` (bearer-auth).

## Security model

Admin power is split across two secrets held by the same person:

1. `ADMIN_EXPORT_TOKEN` — grants access to the encrypted CSV dump.
2. ML-KEM-768 private key — decrypts the ciphertexts.

Either alone is useless: token → ciphertext blobs you can't read;
private key → nothing to fetch. Both secrets live only on the admin's
local machine. The browser admin page decrypts entirely client-side; the
private key never reaches a server.

## License

MIT.
