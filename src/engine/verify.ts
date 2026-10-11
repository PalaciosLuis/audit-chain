/**
 * The chain verifier: it does not just say "invalid", it says *what* happened and
 * *where*.
 *
 * The walk recomputes every entry's own digest from its stored `prev` and its
 * fields (in parallel — the recomputation does not depend on the walk), then
 * follows the links. A break is classified into one of five kinds, because the
 * lab has to be able to name the manipulation:
 *
 *   - `content_tampered`  — the entry's stored hash is not the digest its own
 *     preimage (or its successor's link) demands.
 *   - `entry_deleted`     — a sequence gap: the link jumps past a removed row.
 *   - `entries_reordered` — a link points at a predecessor that has moved
 *     forward in the chain, or the sequence runs backwards.
 *   - `entry_inserted`    — a link does not connect to its immediate
 *     predecessor; it points to an older row, or repeats a sequence number.
 *   - `genesis_mismatch`  — the first entry does not start at the genesis hash.
 *
 * The verifier reports the first break precisely and lists the rest.
 *
 * One honest limitation: the *last* entry is committed to by nobody. Rewriting
 * it and recomputing its own hash leaves the link walk clean, which is exactly
 * why a real deployment anchors the head periodically (see `anchor.ts`).
 */

import { resolveHashProvider } from './hash';
import { GENESIS_HASH, hashEntry } from './ledger';
import type { ChainedEntry, LedgerChain } from './ledger';
import { merkleRoot } from './merkle';
import type { HashProvider } from './types';

/** The five classified ways a chain can be broken. */
export type BreakKind =
  | 'content_tampered'
  | 'entry_deleted'
  | 'entries_reordered'
  | 'entry_inserted'
  | 'genesis_mismatch';

/** One precise, classifiable break in the chain. */
export interface ChainBreak {
  /** Position in the verified array (0-based). */
  readonly index: number;
  /** Sequence number stored in the flagged entry. */
  readonly seq: number;
  readonly kind: BreakKind;
  /** The hash the chain demands at this position. */
  readonly expected: string;
  /** The hash actually found there. */
  readonly actual: string;
}

/** The result of a full chain verification. */
export interface VerificationResult {
  readonly ok: boolean;
  /** Number of entries examined. */
  readonly checked: number;
  /** Merkle root over the stored entry hashes (so it can be compared with anchors). */
  readonly root: string;
  /** The first break first; every later inconsistency after it. */
  readonly breaks: readonly ChainBreak[];
}

/**
 * Classifies a link break at `index > 0` (`entry.prev !== chain[index-1].hash`).
 *
 * The entry at `index` is already known to be internally consistent, so the
 * question is only *why* the link does not connect. The discriminators are the
 * sequence numbers and where the stored `prev` points:
 *
 *   - to an entry that is now later in the chain, or a backwards sequence →
 *     `entries_reordered`;
 *   - a forward sequence gap with a `prev` that is gone → `entry_deleted`;
 *   - to an entry even earlier than the immediate predecessor (the link skipped
 *     a slot), or a repeated/never-present genesis link → `entry_inserted`;
 *   - otherwise the predecessor's stored hash itself changed → report
 *     `content_tampered` at the predecessor, whose hash the successor no longer
 *     accepts.
 */
function classifyLinkBreak(chain: LedgerChain, index: number): ChainBreak {
  const entry = chain[index] as ChainedEntry;
  const previous = chain[index - 1] as ChainedEntry;
  const storedPrev = entry.prev;

  const pointsForward = chain.some(
    (candidate, position) => position > index && candidate.hash === storedPrev,
  );
  const pointsEarlier = chain.some(
    (candidate, position) => position < index - 1 && candidate.hash === storedPrev,
  );
  const seqGap = entry.seq > previous.seq + 1;
  const seqRegression = entry.seq < previous.seq;

  if (pointsForward || seqRegression) {
    return {
      index,
      seq: entry.seq,
      kind: 'entries_reordered',
      expected: previous.hash,
      actual: storedPrev,
    };
  }

  if (seqGap) {
    return {
      index,
      seq: entry.seq,
      kind: 'entry_deleted',
      expected: previous.hash,
      actual: storedPrev,
    };
  }

  if (pointsEarlier || (storedPrev === GENESIS_HASH && index > 0)) {
    return {
      index,
      seq: entry.seq,
      kind: 'entry_inserted',
      expected: previous.hash,
      actual: storedPrev,
    };
  }

  return {
    index: index - 1,
    seq: previous.seq,
    kind: 'content_tampered',
    expected: storedPrev,
    actual: previous.hash,
  };
}

/**
 * Verifies a whole chain and classifies every break.
 *
 * The `root` in the result is the Merkle root of the chain's *stored* hashes, so
 * a caller can compare it against an anchored root.
 */
export async function verifyChain(
  chain: LedgerChain,
  provider?: HashProvider,
): Promise<VerificationResult> {
  const hashProvider = provider ?? resolveHashProvider();
  const storedHashes = chain.map((entry) => entry.hash);
  // Recomputation is independent per entry, so it runs in parallel. The walk
  // below stays sequential because classification depends on order.
  const recomputed = await Promise.all(
    chain.map((entry) => hashEntry(entry.prev, entry, hashProvider)),
  );
  const root = await merkleRoot(storedHashes, hashProvider);
  const breaks: ChainBreak[] = [];

  for (let index = 0; index < chain.length; index += 1) {
    const entry = chain[index] as ChainedEntry;
    const selfHash = recomputed[index] as string;

    if (index === 0 && entry.prev !== GENESIS_HASH) {
      breaks.push({
        index: 0,
        seq: entry.seq,
        kind: 'genesis_mismatch',
        expected: GENESIS_HASH,
        actual: entry.prev,
      });
    }

    if (selfHash !== entry.hash) {
      breaks.push({
        index,
        seq: entry.seq,
        kind: 'content_tampered',
        expected: selfHash,
        actual: entry.hash,
      });
      continue;
    }

    if (index === 0) {
      continue;
    }

    const previous = chain[index - 1] as ChainedEntry;
    if (entry.prev !== previous.hash) {
      breaks.push(classifyLinkBreak(chain, index));
    }
  }

  return { ok: breaks.length === 0, checked: chain.length, root, breaks };
}
