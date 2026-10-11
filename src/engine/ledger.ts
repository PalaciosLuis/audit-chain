/**
 * The ledger: building the hash chain, and the tamper operations that break it.
 *
 * Every entry stores two hashes:
 *
 *   - `prev` — the hash of the entry before it, or {@link GENESIS_HASH} for the
 *     first entry. This is the link.
 *   - `hash` — `SHA-256(canonicalize({ prev, ...entryFields }))`, the entry's own
 *     digest.
 *
 * Because `hash` covers `prev`, entry `n` commits to entry `n-1`: rewriting any
 * entry changes its own digest and every digest downstream of it.
 *
 * The tamper operations below are *data functions*, not animations. They return
 * new chains that are deliberately inconsistent and that {@link verifyChain}
 * classifies. `alterEntry` is the important one: it recomputes the altered
 * entry's own hash, exactly as an attacker with database access would. The row
 * is self-consistent afterwards, which is precisely why it can only be caught
 * through the forward link in the next entry.
 */

import { canonicalize } from './canonical';
import { bytesToHex, resolveHashProvider } from './hash';
import type { HashProvider, JsonValue, LedgerEntry } from './types';

/** The `prev` value of the first entry: 32 zero bytes, in hex. */
export const GENESIS_HASH = '0'.repeat(64);

/** A ledger entry with its link and its own digest already computed. */
export interface ChainedEntry {
  readonly seq: number;
  readonly timestamp: number;
  readonly actor: string;
  readonly action: string;
  readonly resource: string;
  readonly payload: JsonValue;
  /** Digest of the entry before this one, or {@link GENESIS_HASH}. */
  readonly prev: string;
  /** Hex SHA-256 of this entry's canonical preimage. */
  readonly hash: string;
}

/** An ordered, immutable chain of entries. */
export type LedgerChain = readonly ChainedEntry[];

/** A record before the chain assigns its sequence number and hashes it. */
export type RawRecord = Omit<LedgerEntry, 'seq'>;

/**
 * Canonical bytes fed to SHA-256 for one entry.
 *
 * The fields are written explicitly rather than spread from `entry` so a
 * `ChainedEntry` (which also carries `prev` and `hash`) never leaks its stored
 * link or digest into the preimage of its own hash.
 */
export function entryPreimage(prev: string, entry: LedgerEntry): Uint8Array {
  return canonicalize({
    prev,
    seq: entry.seq,
    timestamp: entry.timestamp,
    actor: entry.actor,
    action: entry.action,
    resource: entry.resource,
    payload: entry.payload,
  });
}

/** Hex SHA-256 of one entry's canonical preimage, linked to `prev`. */
export async function hashEntry(
  prev: string,
  entry: LedgerEntry,
  provider?: HashProvider,
): Promise<string> {
  const hashProvider = provider ?? resolveHashProvider();
  return bytesToHex(await hashProvider.digest(entryPreimage(prev, entry)));
}

/**
 * Builds a whole chain from raw records, assigning sequence numbers 1..n and
 * linking each entry to the previous digest. The provider is resolved once so a
 * long chain does not re-resolve it per entry.
 */
export async function createChain(
  records: readonly RawRecord[],
  provider?: HashProvider,
): Promise<LedgerChain> {
  const hashProvider = provider ?? resolveHashProvider();
  const chain: ChainedEntry[] = [];
  let prev = GENESIS_HASH;

  for (const [index, record] of records.entries()) {
    const entry: LedgerEntry = { seq: index + 1, ...record };
    const hash = await hashEntry(prev, entry, hashProvider);
    chain.push({ ...entry, prev, hash });
    prev = hash;
  }

  return chain;
}

/**
 * Appends one record, linking it to the current head (or to genesis when the
 * chain is empty) and assigning the next contiguous sequence number.
 */
export async function append(
  chain: LedgerChain,
  record: RawRecord,
  provider?: HashProvider,
): Promise<LedgerChain> {
  const hashProvider = provider ?? resolveHashProvider();
  const previous = chain[chain.length - 1];
  const prev = previous ? previous.hash : GENESIS_HASH;
  const seq = previous ? previous.seq + 1 : 1;
  const entry: LedgerEntry = { seq, ...record };
  const hash = await hashEntry(prev, entry, hashProvider);

  return [...chain, { ...entry, prev, hash }];
}

/* -------------------------------------------------------------------------- */
/* Tamper operations                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Alters the entry at `index` and *recomputes its own hash* from the changed
 * fields and its stored `prev`. The result is a plausible-looking chain: the
 * altered entry is internally consistent again, and every entry after it still
 * carries its original digest. Only the forward link — the next entry's `prev`
 * pointing at the old digest — gives the change away.
 */
export async function alterEntry(
  chain: LedgerChain,
  index: number,
  changes: Partial<LedgerEntry>,
  provider?: HashProvider,
): Promise<LedgerChain> {
  const target = chain[index];
  if (!target) {
    throw new RangeError(`No entry at index ${index}`);
  }

  const hashProvider = provider ?? resolveHashProvider();
  const altered: LedgerEntry = {
    seq: changes.seq ?? target.seq,
    timestamp: changes.timestamp ?? target.timestamp,
    actor: changes.actor ?? target.actor,
    action: changes.action ?? target.action,
    resource: changes.resource ?? target.resource,
    payload: changes.payload ?? target.payload,
  };
  const hash = await hashEntry(target.prev, altered, hashProvider);

  const next = [...chain];
  next[index] = { ...altered, prev: target.prev, hash };
  return next;
}

/**
 * Deletes the entry at `index`, leaving every other entry byte-identical. The
 * survivors keep their original sequence numbers and links, so the removal shows
 * up as a sequence gap and a dangling `prev`.
 */
export function deleteEntry(chain: LedgerChain, index: number): LedgerChain {
  if (index < 0 || index >= chain.length) {
    throw new RangeError(`No entry at index ${index}`);
  }
  return chain.filter((_, position) => position !== index);
}

/**
 * Swaps two entries and changes nothing else. The hashes are not recomputed, so
 * each moved entry now points at a predecessor that is no longer where the chain
 * says it is.
 */
export function swapEntries(chain: LedgerChain, left: number, right: number): LedgerChain {
  if (left < 0 || left >= chain.length || right < 0 || right >= chain.length) {
    throw new RangeError(
      `Cannot swap indexes ${left} and ${right} of a ${chain.length}-entry chain`,
    );
  }
  const next = [...chain];
  const atLeft = next[left];
  const atRight = next[right];
  if (!atLeft || !atRight) {
    throw new RangeError(`Cannot swap indexes ${left} and ${right}`);
  }
  next[left] = atRight;
  next[right] = atLeft;
  return next;
}

/**
 * Inserts a fabricated record at `index`, linking it to whatever entry is
 * currently before that position and giving it the next contiguous sequence
 * number. The inserted entry is internally consistent; the original entry it
 * pushed forward keeps its own sequence number and its own stale link, so the
 * chain skips over the fake row.
 */
export async function insertEntry(
  chain: LedgerChain,
  index: number,
  record: RawRecord,
  provider?: HashProvider,
): Promise<LedgerChain> {
  if (index < 0 || index > chain.length) {
    throw new RangeError(`Cannot insert at index ${index} of a ${chain.length}-entry chain`);
  }

  const hashProvider = provider ?? resolveHashProvider();
  const previous = index > 0 ? chain[index - 1] : undefined;
  const prev = previous ? previous.hash : GENESIS_HASH;
  const seq = previous ? previous.seq + 1 : 1;
  const entry: LedgerEntry = { seq, ...record };
  const hash = await hashEntry(prev, entry, hashProvider);

  return [...chain.slice(0, index), { ...entry, prev, hash }, ...chain.slice(index)];
}
