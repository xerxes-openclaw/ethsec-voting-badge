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
  | { status: "loading"; scannedBlocks: bigint }
  | { status: "ready"; tokenIds: string[] }
  | { status: "error"; error: string };

/**
 * Detects which tokenIds of the configured badge contract the given wallet
 * currently holds.
 *
 *   1. Short-circuit via balanceOf — if the wallet holds zero badges, skip
 *      the log scan entirely. Saves seconds of RPC calls.
 *   2. Otherwise scan Transfer(_, to=wallet, _) logs, chunking backwards
 *      from `latest` in 49k-block batches (most public RPCs cap at 50k).
 *      Stop as soon as we've discovered as many tokens as balanceOf says
 *      the wallet holds, or when we've covered the contract's full
 *      plausible history.
 *   3. Verify each candidate via ownerOf so we don't include tokens the
 *      wallet has since transferred away.
 *
 * Good enough for small/medium collections over months of history. For
 * huge collections or years of history, swap to an NFT-indexer API
 * (Alchemy getNFTsForOwner / Moralis / thirdweb) behind this interface.
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
      setState({ status: "loading", scannedBlocks: 0n });
      try {
        // Step 1 — balanceOf short-circuit.
        const balance = (await client
          .readContract({
            address: APP_CONFIG.badgeContract,
            abi: ERC721_ABI,
            functionName: "balanceOf",
            args: [wallet],
          })
          .catch(() => 0n)) as bigint;

        if (balance === 0n) {
          if (!cancelled) setState({ status: "ready", tokenIds: [] });
          return;
        }

        // Step 2 — chunked log scan walking backwards from head.
        const CHUNK = 49_000n;
        // Max history to cover before giving up, in blocks. Default ≈ 2M
        // blocks (roughly 8 months on mainnet). Override via env when a
        // contract is older than that.
        const MAX_SCAN = APP_CONFIG.maxLogScanBlocks;
        const head = await client.getBlockNumber();
        const floor = head > MAX_SCAN ? head - MAX_SCAN : 0n;

        const foundIds = new Set<bigint>();
        let cursor = head;
        while (cursor > floor && !cancelled) {
          const from = cursor > floor + CHUNK ? cursor - CHUNK : floor;
          const chunk = await client.getLogs({
            address: APP_CONFIG.badgeContract,
            event: TRANSFER_EVENT,
            args: { to: wallet },
            fromBlock: from,
            toBlock: cursor,
          });
          for (const l of chunk) {
            if (typeof l.args.tokenId === "bigint") foundIds.add(l.args.tokenId);
          }
          if (!cancelled) {
            setState({ status: "loading", scannedBlocks: head - from });
          }
          // Early exit once we've discovered as many tokens as balanceOf
          // says this wallet currently holds — even if some are later
          // filtered out by the ownerOf check, we'll still find all the
          // ones they hold now.
          if (BigInt(foundIds.size) >= balance) break;
          if (from === floor) break;
          cursor = from - 1n;
        }

        // Step 3 — verify current ownership.
        const candidates = Array.from(foundIds);
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
