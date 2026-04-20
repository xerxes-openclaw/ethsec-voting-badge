import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { parseAbiItem, type Address } from "viem";
import { APP_CONFIG } from "../config.js";

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);

const ERC721_ABI = [
  {
    inputs: [{ type: "uint256", name: "tokenId" }],
    name: "ownerOf",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ type: "address", name: "owner" }],
    name: "balanceOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export type HeldTokenIdsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; tokenIds: string[] }
  | { status: "multi_badge"; balance: bigint }
  | { status: "error"; error: string };

/**
 * Detects which tokenIds of the configured badge contract the given wallet
 * currently holds.
 *
 * Why log scanning and not something simpler:
 *   • `ownerOf(tokenId)` answers "who owns token N" but not "which tokens
 *     does W own" — that's a different question entirely.
 *   • `balanceOf(w)` answers "how many" but not "which".
 *   • ERC-721 Enumerable would give us `tokenOfOwnerByIndex`, but the
 *     ETHSecurity Badge contract does not implement it.
 *   • `totalSupply()` + iterate `ownerOf(1..N)` would work — but this
 *     contract reverts on `totalSupply()`.
 *   • So scanning Transfer(to=wallet) logs is the only standards-
 *     compliant way for this specific contract.
 *
 * Policy: multi-badge holders (balance > 1) cannot submit (one holder =
 * one voting address). We short-circuit that case WITHOUT running the
 * log scan and surface it as a dedicated state the UI can render.
 *
 * Performance:
 *   1. balanceOf — one call.
 *   2. balance === 0 → done (common for most visitors)
 *   3. balance  >  1 → done, "multi_badge" state (blocked)
 *   4. balance === 1 → find the ONE tokenId via parallel chunked log
 *      scan (4 chunks at a time). Early-exit as soon as any match
 *      verifies via ownerOf.
 */
export function useHeldTokenIds(wallet: Address | undefined): HeldTokenIdsState {
  const client = usePublicClient({ chainId: APP_CONFIG.chainId });
  const [state, setState] = useState<HeldTokenIdsState>({ status: "idle" });

  useEffect(() => {
    if (!wallet || !client) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;

    (async () => {
      setState({ status: "loading" });
      try {
        // 1) balanceOf short-circuit
        const balance = (await client
          .readContract({
            address: APP_CONFIG.badgeContract,
            abi: ERC721_ABI,
            functionName: "balanceOf",
            args: [wallet],
          })
          .catch(() => 0n)) as bigint;

        if (cancelled) return;
        if (balance === 0n) {
          setState({ status: "ready", tokenIds: [] });
          return;
        }
        if (balance > 1n) {
          setState({ status: "multi_badge", balance });
          return;
        }

        // 2) balance === 1 → find the single tokenId.
        // Parallel chunked Transfer-log scan. 4 chunks in flight at a
        // time keeps RPC bursts manageable on public endpoints while
        // hiding most of the latency.
        const CHUNK = 49_000n;
        const PARALLEL = 4;
        const MAX_SCAN = APP_CONFIG.maxLogScanBlocks;
        const head = await client.getBlockNumber();
        const floor = head > MAX_SCAN ? head - MAX_SCAN : 0n;

        const windows: Array<{ from: bigint; to: bigint }> = [];
        for (let to = head; to > floor; ) {
          const from = to > floor + CHUNK ? to - CHUNK : floor;
          windows.push({ from, to });
          if (from === floor) break;
          to = from - 1n;
        }

        const found = new Set<bigint>();
        for (let i = 0; i < windows.length && !cancelled; i += PARALLEL) {
          const batch = windows.slice(i, i + PARALLEL);
          const results = await Promise.all(
            batch.map((w) =>
              client.getLogs({
                address: APP_CONFIG.badgeContract,
                event: TRANSFER_EVENT,
                args: { to: wallet },
                fromBlock: w.from,
                toBlock: w.to,
              }),
            ),
          );
          for (const chunk of results) {
            for (const l of chunk) {
              if (typeof l.args.tokenId === "bigint") found.add(l.args.tokenId);
            }
          }
          if (found.size > 0) break; // balance is 1 — one match is enough
        }

        // 3) Verify current ownership (the wallet may have transferred it
        // after the Transfer event we scanned).
        const candidates = Array.from(found);
        const owners = await Promise.all(
          candidates.map((id) =>
            client
              .readContract({
                address: APP_CONFIG.badgeContract,
                abi: ERC721_ABI,
                functionName: "ownerOf",
                args: [id],
              })
              .catch(() => null),
          ),
        );

        const held = candidates
          .filter((_, i) => {
            const owner = owners[i];
            return typeof owner === "string" && owner.toLowerCase() === wallet.toLowerCase();
          })
          .map((id) => id.toString());

        if (!cancelled) setState({ status: "ready", tokenIds: held });
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setState({ status: "error", error: msg });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wallet, client]);

  return state;
}
