/**
 * Anchoring: proving *when* something changed.
 *
 * Anchoring periodically pins the Merkle root of a chain prefix. An old anchor
 * is a commitment made at a point in time: as long as it verifies, the prefix it
 * covers has not changed since. Once it stops matching, a manipulation happened
 * **after** the anchor was taken — which the chain alone cannot tell you, because
 * an attacker who is careful can re-anchor every prefix.
 *
 * The value of an anchor is therefore entirely in *who holds it*. This module
 * only computes and checks roots; publishing an anchor somewhere the log owner
 * cannot rewrite is the deployment question, not an engine one.
 */

import { EMPTY_ROOT, merkleRoot } from './merkle';
import type { LedgerChain } from './ledger';
import type { HashProvider } from './types';

/** A root commitment over the first `entryCount` entries. */
export interface Anchor {
  /** Sequence number of the last entry covered by the anchor. */
  readonly atSeq: number;
  /** Merkle root over the covered entry hashes. */
  readonly root: string;
  /** How many entries the anchor covers. */
  readonly entryCount: number;
}

/** Whether an anchor still matches the chain, with both roots for display. */
export interface AnchorCheck {
  readonly ok: boolean;
  /** Sequence number of the last entry covered by the anchor. */
  readonly atSeq: number;
  readonly entryCount: number;
  /** Root recorded in the anchor. */
  readonly anchoredRoot: string;
  /** Root recomputed from the current chain prefix. */
  readonly currentRoot: string;
}

/**
 * Anchors the root of the chain every `every` entries, plus the final partial
 * prefix when the length is not a multiple of `every`. A short chain therefore
 * still gets one anchor covering everything.
 *
 * @throws {RangeError} when `every` is not a positive integer.
 */
export async function anchorRoot(
  chain: LedgerChain,
  every: number,
  provider?: HashProvider,
): Promise<Anchor[]> {
  if (!Number.isInteger(every) || every <= 0) {
    throw new RangeError(`The anchoring interval must be a positive integer, received ${every}`);
  }

  const hashes = chain.map((entry) => entry.hash);
  const anchors: Anchor[] = [];

  for (let count = every; count <= chain.length; count += every) {
    anchors.push({
      atSeq: (chain[count - 1] as { seq: number }).seq,
      root: await merkleRoot(hashes.slice(0, count), provider),
      entryCount: count,
    });
  }

  if (chain.length > 0 && chain.length % every !== 0) {
    const count = chain.length;
    anchors.push({
      atSeq: (chain[count - 1] as { seq: number }).seq,
      root: await merkleRoot(hashes, provider),
      entryCount: count,
    });
  }

  return anchors;
}

/**
 * Checks an anchor against a chain. `ok` is true only when the covered prefix
 * still hashes to the anchored root *and* it is still in place (same length,
 * same `atSeq`). A prefix that was truncated, extended or edited fails.
 */
export async function verifyAnchor(
  chain: LedgerChain,
  anchor: Anchor,
  provider?: HashProvider,
): Promise<AnchorCheck> {
  const available = Math.min(anchor.entryCount, chain.length);
  const currentRoot =
    available > 0
      ? await merkleRoot(
          chain.slice(0, available).map((entry) => entry.hash),
          provider,
        )
      : EMPTY_ROOT;
  const lastCovered = available > 0 ? chain[available - 1] : undefined;
  const ok =
    anchor.entryCount <= chain.length &&
    currentRoot === anchor.root &&
    lastCovered?.seq === anchor.atSeq;

  return {
    ok,
    atSeq: anchor.atSeq,
    entryCount: anchor.entryCount,
    anchoredRoot: anchor.root,
    currentRoot,
  };
}
