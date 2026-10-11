/**
 * The teaching chain behind blocks 1 and 3: real SHA-256 over the canonical
 * bytes of `{ prev, seq, content }`.
 *
 * The engine owns serialization (`canonicalize`) and the injectable hash
 * provider; this module only decides *what* the page hashes and keeps the small
 * display helpers around it. Every digest produced here is the real thing — no
 * truncation, no placeholder, no cached constant — which is why the block can
 * claim that changing an entry rewrites every digest after it.
 *
 * The preimage of entry `n` is:
 *
 *     { prev: hash(n-1), seq: n, content: "<what the visitor typed>" }
 *
 * `prev` is the link: entry `n` commits to entry `n-1`, so rewriting any entry
 * changes its own digest and every digest downstream. The first entry commits to
 * `GENESIS_HASH` because there is nothing before it. A production ledger hashes
 * the same shape with more fields (timestamp, actor, action, resources);
 * see `odd/tasks/audit-chain.md` §3 and the block's own note.
 */

import { canonicalize } from '../engine/canonical';
import { bytesToHex, resolveHashProvider } from '../engine/hash';
import type { HashProvider } from '../engine/types';

/** The `prev` value of the first entry: 32 zero bytes, in hex. */
export const GENESIS_HASH = '0'.repeat(64);

/** One entry of the page's chain, with its digest already computed. */
export interface ChainLink {
  /** 1-based position in the chain. */
  readonly seq: number;
  /** What the visitor typed (or the seed token). */
  readonly content: string;
  /** Digest of the entry before this one, or `GENESIS_HASH`. */
  readonly prevHash: string;
  /** Hex SHA-256 of this entry's canonical preimage. */
  readonly digest: string;
}

/** Canonical bytes fed to SHA-256 for one entry. */
export function preimageBytes(prevHash: string, seq: number, content: string): Uint8Array {
  return canonicalize({ prev: prevHash, seq, content });
}

/** Hex SHA-256 of one entry's preimage, through the engine. */
export async function digestFor(
  prevHash: string,
  seq: number,
  content: string,
  provider?: HashProvider,
): Promise<string> {
  const hashProvider = provider ?? resolveHashProvider();
  return bytesToHex(await hashProvider.digest(preimageBytes(prevHash, seq, content)));
}

/**
 * Builds the whole chain from its contents, in order. The provider is resolved
 * once per build so a long chain does not re-resolve it per entry.
 */
export async function buildChain(
  contents: readonly string[],
  provider?: HashProvider,
): Promise<ChainLink[]> {
  const hashProvider = provider ?? resolveHashProvider();
  const links: ChainLink[] = [];
  let prevHash = GENESIS_HASH;

  for (const [index, content] of contents.entries()) {
    const seq = index + 1;
    const digest = bytesToHex(await hashProvider.digest(preimageBytes(prevHash, seq, content)));
    links.push({ seq, content, prevHash, digest });
    prevHash = digest;
  }

  return links;
}

/**
 * Positions whose digest differs between two builds. A position that does not
 * exist in `before` counts as changed, so appending an entry reports the new
 * entry and an edit reports that entry plus everything after it.
 */
export function changedIndices(
  before: readonly ChainLink[],
  after: readonly ChainLink[],
): number[] {
  const changed: number[] = [];
  for (const [index, link] of after.entries()) {
    const previous = before[index];
    if (previous === undefined || previous.digest !== link.digest) {
      changed.push(index);
    }
  }
  return changed;
}

/**
 * The first `length` hex characters plus an ellipsis.
 *
 * This is a real prefix of a real digest, and callers keep the full value in the
 * element's `title` and accessible description. It is an abbreviation for
 * display, never a stand-in for the digest itself.
 */
export function shortHash(digest: string, length = 12): string {
  return `${digest.slice(0, length)}…`;
}
