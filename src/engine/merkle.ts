/**
 * Merkle tree over the entry hashes, and inclusion proofs.
 *
 * The tree is built bottom-up. A parent is
 *
 *     SHA-256("audit-chain:merkle:node:" ‖ left ‖ right)
 *
 * with both children written as fixed-width 64-hex strings, so the
 * concatenation is unambiguous even without an explicit length prefix. The
 * domain tag also keeps an internal node's preimage from ever looking like a
 * leaf's preimage (an entry hash is `SHA-256(canonicalize(...))`), so a leaf and
 * an internal node cannot collide by construction.
 *
 * **Odd node rule: the last node is duplicated** and paired with itself. It is
 * the common convention and it keeps every proof local: an unpaired node never
 * has to be promoted to the next level, so `verifyProof` never needs to know
 * where the tree ends. See `docs/adr/0006-merkle-odd-node-rule.md` for the
 * trade-off this buys and what it does not protect against.
 *
 * **Empty tree rule:** the root of a tree with no leaves is the empty string,
 * which is not the hash of any leaf, so an empty tree can never be confused
 * with a non-empty one.
 */

import { bytesToHex, resolveHashProvider, utf8Bytes } from './hash';
import type { HashProvider } from './types';

/** Root of the tree with no leaves. Not a valid hash of any leaf. */
export const EMPTY_ROOT = '';

/** Domain separator so internal nodes never share a preimage shape with leaves. */
const NODE_DOMAIN = 'audit-chain:merkle:node:';

/** Which side of a parent a proof sibling sits on. */
export type ProofSide = 'left' | 'right';

/** One sibling on the path from a leaf to the root. */
export interface MerkleProofNode {
  /** Hex hash of the sibling subtree. */
  readonly hash: string;
  /** Where the sibling sits: `left` means it comes before the current node. */
  readonly side: ProofSide;
}

function hashNode(left: string, right: string, provider: HashProvider): Promise<Uint8Array> {
  return provider.digest(utf8Bytes(`${NODE_DOMAIN}${left}${right}`));
}

/** Parents of one level, duplicating an unpaired trailing node. */
async function nextLevel(level: readonly string[], provider: HashProvider): Promise<string[]> {
  const parents: Array<Promise<string>> = [];
  for (let index = 0; index < level.length; index += 2) {
    const left = level[index] as string;
    const right = index + 1 < level.length ? (level[index + 1] as string) : left;
    parents.push(hashNode(left, right, provider).then(bytesToHex));
  }
  return Promise.all(parents);
}

/**
 * Root of the Merkle tree over `hashes`. Returns {@link EMPTY_ROOT} for an empty
 * leaf list and the leaf itself for a single leaf.
 */
export async function merkleRoot(
  hashes: readonly string[],
  provider?: HashProvider,
): Promise<string> {
  if (hashes.length === 0) {
    return EMPTY_ROOT;
  }
  const hashProvider = provider ?? resolveHashProvider();
  let level: readonly string[] = hashes;
  while (level.length > 1) {
    level = await nextLevel(level, hashProvider);
  }
  return level[0] as string;
}

/**
 * Inclusion proof for the leaf at `index`: the sibling hashes from the leaf up
 * to the root. This is the whole point of a Merkle tree — a proof is
 * `O(log n)` hashes instead of the whole log.
 *
 * @throws {RangeError} when `index` is not a valid leaf position.
 */
export async function merkleProof(
  hashes: readonly string[],
  index: number,
  provider?: HashProvider,
): Promise<MerkleProofNode[]> {
  if (!Number.isInteger(index) || index < 0 || index >= hashes.length) {
    throw new RangeError(`No leaf at index ${index} of a ${hashes.length}-leaf tree`);
  }

  const hashProvider = provider ?? resolveHashProvider();
  const proof: MerkleProofNode[] = [];
  let level: readonly string[] = hashes;
  let position = index;

  while (level.length > 1) {
    const sibling = position ^ 1;
    const siblingHash =
      sibling < level.length ? (level[sibling] as string) : (level[position] as string);
    proof.push({ hash: siblingHash, side: sibling < position ? 'left' : 'right' });
    level = await nextLevel(level, hashProvider);
    position = Math.floor(position / 2);
  }

  return proof;
}

/**
 * Recomputes the root from `leafHash` and `proof` and compares it with `root`.
 * A valid proof of an untouched tree verifies; a proof whose leaf changed, or a
 * proof checked against a foreign root, does not.
 */
export async function verifyProof(
  proof: readonly MerkleProofNode[],
  root: string,
  leafHash: string,
  provider?: HashProvider,
): Promise<boolean> {
  const hashProvider = provider ?? resolveHashProvider();
  let current = leafHash;
  for (const node of proof) {
    const bytes =
      node.side === 'left'
        ? await hashNode(node.hash, current, hashProvider)
        : await hashNode(current, node.hash, hashProvider);
    current = bytesToHex(bytes);
  }
  return current === root;
}
