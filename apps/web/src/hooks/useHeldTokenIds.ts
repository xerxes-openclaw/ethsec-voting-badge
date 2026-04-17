import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { parseAbiItem, type Address } from "viem";
import { APP_CONFIG } from "../config.js";

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);

const OWNER_OF_ABI = [
  {
    inputs: [{ type: "uint256", name: "tokenId" }],
    name: "ownerOf",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export type HeldTokenIdsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; tokenIds: string[] }
  | { status: "error"; error: string };

/**
 * Detects which tokenIds of the configured badge contract the given wallet
 * currently holds. Works on any ERC-721 without ERC-721Enumerable support by:
 *   1. Scanning Transfer(_, to=wallet, _) logs from block 0.
 *   2. Calling ownerOf(tokenId) on each candidate to confirm it wasn't sent away.
 *
 * Good enough for small/medium collections; for huge ones, swap in an
 * indexer API (Alchemy/Moralis/thirdweb) behind this same interface.
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
        // Public RPCs cap eth_getLogs at ~50k blocks. For the test deployment
        // everything is within the last few days; for a real deployment this
        // whole hook should be swapped for an indexer (Alchemy / Moralis /
        // thirdweb). Scan the most recent CHUNK blocks from head.
        const CHUNK = 49_000n;
        const head = await client.getBlockNumber();
        const from = head > CHUNK ? head - CHUNK : 0n;
        const logs = await client.getLogs({
          address: APP_CONFIG.badgeContract,
          event: TRANSFER_EVENT,
          args: { to: wallet },
          fromBlock: from,
          toBlock: head,
        });

        const candidates = Array.from(
          new Set(
            logs
              .map((l) => l.args.tokenId)
              .filter((id): id is bigint => typeof id === "bigint"),
          ),
        );

        const owners = await Promise.all(
          candidates.map((id) =>
            client
              .readContract({
                address: APP_CONFIG.badgeContract,
                abi: OWNER_OF_ABI,
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
          .map((id) => id.toString())
          .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));

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
