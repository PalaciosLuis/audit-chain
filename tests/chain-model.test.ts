import { describe, expect, it } from 'vitest';

import { canonicalize } from '../src/engine/canonical';
import { bytesToHex, pureHashProvider, sha256, webCryptoHashProvider } from '../src/engine/hash';
import {
  GENESIS_HASH,
  buildChain,
  changedIndices,
  digestFor,
  preimageBytes,
  shortHash,
} from '../src/sections/chain-model';

/**
 * The chain the page builds in block 3 is not a mock: every digest comes from
 * the engine (`canonicalize` + SHA-256). These tests pin the two properties the
 * block claims to teach — same input, same digests; earlier change, later
 * digests change — and cross-check one digest against a hand-built preimage so
 * a stand-in implementation cannot pass.
 */

const CONTENTS: readonly string[] = ['alpha', 'beta', 'gamma'];

describe('buildChain', () => {
  it('produces the same digests for the same contents in the same order', async () => {
    const first = await buildChain(CONTENTS);
    const second = await buildChain(CONTENTS);

    expect(first.map((link) => link.digest)).toEqual(second.map((link) => link.digest));
    expect(first).toEqual(second);
  });

  it('starts at the zero hash and chains every entry to the previous digest', async () => {
    const chain = await buildChain(CONTENTS);

    expect(chain.map((link) => link.seq)).toEqual([1, 2, 3]);
    expect(chain.map((link) => link.content)).toEqual([...CONTENTS]);
    expect(chain[0]?.prevHash).toBe(GENESIS_HASH);
    expect(chain[1]?.prevHash).toBe(chain[0]?.digest);
    expect(chain[2]?.prevHash).toBe(chain[1]?.digest);
    for (const link of chain) {
      expect(link.digest).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('is the real SHA-256 of the canonical preimage', async () => {
    const chain = await buildChain(['alpha']);
    const preimage = { prev: GENESIS_HASH, seq: 1, content: 'alpha' };

    expect(preimageBytes(GENESIS_HASH, 1, 'alpha')).toEqual(canonicalize(preimage));
    expect(chain[0]?.digest).toBe(bytesToHex(sha256(canonicalize(preimage))));
    expect(await digestFor(GENESIS_HASH, 1, 'alpha')).toBe(chain[0]?.digest);
  });

  it('agrees across the Web Crypto and the pure provider', async () => {
    const viaWebCrypto = await buildChain(CONTENTS, webCryptoHashProvider);
    const viaPure = await buildChain(CONTENTS, pureHashProvider);

    expect(viaPure).toEqual(viaWebCrypto);
  });

  it('changes every later digest when an earlier entry changes', async () => {
    const original = await buildChain(CONTENTS);
    const edited = await buildChain(['ALPHA', ...CONTENTS.slice(1)]);

    expect(edited[0]?.digest).not.toBe(original[0]?.digest);
    expect(edited[1]?.digest).not.toBe(original[1]?.digest);
    expect(edited[2]?.digest).not.toBe(original[2]?.digest);
    expect(edited[0]?.content).toBe('ALPHA');
  });

  it('keeps the digests before the edit untouched', async () => {
    const original = await buildChain(CONTENTS);
    const edited = await buildChain(['alpha', 'BETA', 'gamma']);

    expect(edited[0]).toEqual(original[0]);
    expect(edited[1]?.prevHash).toBe(original[0]?.digest);
    expect(edited[1]?.digest).not.toBe(original[1]?.digest);
    expect(edited[2]?.digest).not.toBe(original[2]?.digest);
    expect(edited[2]?.prevHash).toBe(edited[1]?.digest);
  });

  it('handles an empty chain', async () => {
    expect(await buildChain([])).toEqual([]);
  });
});

describe('changedIndices', () => {
  it('reports exactly the positions whose digest changed', async () => {
    const before = await buildChain(CONTENTS);
    const after = await buildChain(['alpha', 'BETA', 'gamma']);

    expect(changedIndices(before, after)).toEqual([1, 2]);
  });

  it('reports nothing when nothing changed', async () => {
    const before = await buildChain(CONTENTS);
    const after = await buildChain(CONTENTS);

    expect(changedIndices(before, after)).toEqual([]);
  });

  it('counts positions that did not exist before', async () => {
    const before = await buildChain(['alpha']);
    const after = await buildChain(CONTENTS);

    expect(changedIndices(before, after)).toEqual([1, 2]);
  });
});

describe('shortHash', () => {
  it('is a real prefix of the digest, never a substitute', async () => {
    const chain = await buildChain(['alpha']);
    const digest = chain[0]?.digest ?? '';

    expect(shortHash(digest)).toBe(`${digest.slice(0, 12)}…`);
    expect(shortHash(digest, 8)).toBe(`${digest.slice(0, 8)}…`);
    expect(digest.startsWith(shortHash(digest).replace('…', ''))).toBe(true);
  });
});
