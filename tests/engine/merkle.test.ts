import { describe, expect, it } from 'vitest';

import { bytesToHex, pureHashProvider, webCryptoHashProvider } from '../../src/engine/hash';
import { EMPTY_ROOT, merkleProof, merkleRoot, verifyProof } from '../../src/engine/merkle';

/**
 * Merkle inclusion proofs. The property under test is the one the lab depends
 * on: every valid proof of an untouched tree verifies against the root, and a
 * single changed leaf invalidates the tree.
 *
 * The odd-node rule is duplication of the last node. That is the common
 * convention and it is the reason no proof ever needs to special-case a missing
 * sibling: an unpaired node is paired with itself. The trade-off is written up
 * in ADR-0006.
 */

async function leaves(count: number, salt = 'leaf'): Promise<string[]> {
  const hashes: string[] = [];
  for (let index = 0; index < count; index += 1) {
    hashes.push(
      bytesToHex(await webCryptoHashProvider.digest(new TextEncoder().encode(`${salt}-${index}`))),
    );
  }
  return hashes;
}

const SIZES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 13, 16];

describe('merkleRoot', () => {
  it('defines the empty tree root as the empty string, which is not any leaf hash', async () => {
    expect(EMPTY_ROOT).toBe('');
    expect(await merkleRoot([])).toBe(EMPTY_ROOT);
    // A non-empty tree never has the empty root.
    expect(await merkleRoot(await leaves(1))).not.toBe(EMPTY_ROOT);
  });

  it('is the leaf itself for a single-leaf tree', async () => {
    const [leaf] = await leaves(1);
    expect(await merkleRoot([leaf as string])).toBe(leaf);
  });

  it('is deterministic and provider-independent', async () => {
    const hashes = await leaves(7);
    const viaWebCrypto = await merkleRoot(hashes, webCryptoHashProvider);
    const viaPure = await merkleRoot(hashes, pureHashProvider);
    expect(viaPure).toBe(viaWebCrypto);
    expect(await merkleRoot(hashes, webCryptoHashProvider)).toBe(viaWebCrypto);
  });

  it('changes when any single leaf changes', async () => {
    const hashes = await leaves(6);
    const root = await merkleRoot(hashes);
    for (let index = 0; index < hashes.length; index += 1) {
      const changed = [...hashes];
      changed[index] = hashes[(index + 1) % hashes.length] as string;
      expect(await merkleRoot(changed)).not.toBe(root);
    }
  });

  it('is order-sensitive: reordering leaves changes the root', async () => {
    const hashes = await leaves(4);
    const swapped = [hashes[1], hashes[0], hashes[2], hashes[3]] as string[];
    expect(await merkleRoot(swapped)).not.toBe(await merkleRoot(hashes));
  });

  it('duplicates an unpaired trailing node and therefore [a,b,c] and [a,b,c,c] share a root', async () => {
    const hashes = await leaves(3);
    const duplicated = [...hashes, hashes[2] as string];
    expect(await merkleRoot(duplicated)).toBe(await merkleRoot(hashes));
  });
});

describe('inclusion proofs', () => {
  for (const size of SIZES) {
    it(`proves every index of a ${size}-leaf tree`, async () => {
      const hashes = await leaves(size);
      if (size === 0) {
        await expect(merkleProof(hashes, 0)).rejects.toBeInstanceOf(RangeError);
        return;
      }
      const root = await merkleRoot(hashes);
      for (let index = 0; index < size; index += 1) {
        const proof = await merkleProof(hashes, index);
        expect(await verifyProof(proof, root, hashes[index] as string)).toBe(true);
      }
    });
  }

  it('rejects an out-of-range index', async () => {
    const hashes = await leaves(3);
    await expect(merkleProof(hashes, 3)).rejects.toBeInstanceOf(RangeError);
    await expect(merkleProof(hashes, -1)).rejects.toBeInstanceOf(RangeError);
  });

  it('returns no siblings for a single leaf', async () => {
    const hashes = await leaves(1);
    expect(await merkleProof(hashes, 0)).toEqual([]);
  });

  it('fails a proof after its leaf changes', async () => {
    const hashes = await leaves(7);
    const root = await merkleRoot(hashes);
    const index = 4;
    const proof = await merkleProof(hashes, index);

    expect(await verifyProof(proof, root, hashes[index] as string)).toBe(true);
    expect(await verifyProof(proof, root, 'a'.repeat(64))).toBe(false);
  });

  it('fails every old proof once a leaf changes and the root is recomputed', async () => {
    const hashes = await leaves(6);
    const proofs = await Promise.all(hashes.map((_, index) => merkleProof(hashes, index)));
    const changed = [...hashes];
    changed[2] = 'b'.repeat(64);
    const newRoot = await merkleRoot(changed);

    for (let index = 0; index < hashes.length; index += 1) {
      expect(await verifyProof(proofs[index] ?? [], newRoot, hashes[index] as string)).toBe(false);
    }
    // The proof of the changed leaf against its own new root does verify.
    const changedProof = await merkleProof(changed, 2);
    expect(await verifyProof(changedProof, newRoot, changed[2] as string)).toBe(true);
  });

  it('does not verify a proof against a foreign root', async () => {
    const hashes = await leaves(5);
    const other = await leaves(5, 'other');
    const proof = await merkleProof(hashes, 1);
    expect(await verifyProof(proof, await merkleRoot(other), hashes[1] as string)).toBe(false);
  });
});
