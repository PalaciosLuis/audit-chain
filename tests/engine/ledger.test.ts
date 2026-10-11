import { describe, expect, it } from 'vitest';

import { canonicalize } from '../../src/engine/canonical';
import { bytesToHex, pureHashProvider, webCryptoHashProvider } from '../../src/engine/hash';
import {
  GENESIS_HASH,
  alterEntry,
  append,
  createChain,
  deleteEntry,
  entryPreimage,
  hashEntry,
  insertEntry,
  swapEntries,
} from '../../src/engine/ledger';
import type { RawRecord } from '../../src/engine/ledger';

/**
 * The ledger builds a hash chain from raw records. Each entry commits to its
 * predecessor: `hash = SHA-256(canonicalize({ prev, ...fields }))`. These tests
 * pin the link, the genesis constant and the four tamper operations, which are
 * the same data functions the lab and the verifier tests drive.
 */

function record(overrides: Partial<RawRecord> = {}): RawRecord {
  return {
    timestamp: 1_700_000_000_000,
    actor: 'ana',
    action: 'read',
    resource: 'record:HC-1',
    payload: { ip: '10.0.0.1' },
    ...overrides,
  };
}

const RECORDS: readonly RawRecord[] = [
  record({ timestamp: 1_700_000_000_000, actor: 'ana', action: 'read', resource: 'record:HC-1' }),
  record({
    timestamp: 1_700_000_000_001,
    actor: 'luis',
    action: 'update',
    resource: 'record:HC-2',
  }),
  record({
    timestamp: 1_700_000_000_002,
    actor: 'marta',
    action: 'delete',
    resource: 'record:HC-3',
  }),
  record({
    timestamp: 1_700_000_000_003,
    actor: 'system',
    action: 'export',
    resource: 'report:Q3',
  }),
  record({ timestamp: 1_700_000_000_004, actor: 'ana', action: 'read', resource: 'record:HC-4' }),
];

describe('genesis and the link', () => {
  it('defines the genesis hash as 64 zeros', () => {
    expect(GENESIS_HASH).toBe('0'.repeat(64));
    expect(GENESIS_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  it('assigns contiguous sequence numbers starting at 1', async () => {
    const chain = await createChain(RECORDS);
    expect(chain.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('links every entry to the previous stored hash and the first to genesis', async () => {
    const chain = await createChain(RECORDS);
    expect(chain[0]?.prev).toBe(GENESIS_HASH);
    for (let index = 1; index < chain.length; index += 1) {
      expect(chain[index]?.prev).toBe(chain[index - 1]?.hash);
    }
  });

  it('produces real 64-hex SHA-256 digests', async () => {
    const chain = await createChain(RECORDS);
    for (const entry of chain) {
      expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('is exactly SHA-256 over the canonical preimage', async () => {
    const chain = await createChain(RECORDS);
    const first = chain[0];
    if (!first) throw new Error('expected a first entry');

    const preimage = {
      prev: GENESIS_HASH,
      seq: first.seq,
      timestamp: first.timestamp,
      actor: first.actor,
      action: first.action,
      resource: first.resource,
      payload: first.payload,
    };
    expect(entryPreimage(GENESIS_HASH, first)).toEqual(canonicalize(preimage));
    const digest = await webCryptoHashProvider.digest(entryPreimage(GENESIS_HASH, first));
    expect(first.hash).toBe(bytesToHex(digest));
  });

  it('is deterministic and independent of the hash provider', async () => {
    const viaWebCrypto = await createChain(RECORDS, webCryptoHashProvider);
    const viaPure = await createChain(RECORDS, pureHashProvider);
    expect(viaPure).toEqual(viaWebCrypto);
    const again = await createChain(RECORDS, pureHashProvider);
    expect(again).toEqual(viaPure);
  });

  it('builds an empty chain from nothing', async () => {
    expect(await createChain([])).toEqual([]);
  });
});

describe('append', () => {
  it('extends the chain with the next contiguous sequence', async () => {
    const chain = await createChain(RECORDS);
    const grown = await append(chain, record({ actor: 'audit', resource: 'record:HC-5' }));

    expect(grown).toHaveLength(chain.length + 1);
    const last = grown[grown.length - 1];
    expect(last?.seq).toBe(6);
    expect(last?.prev).toBe(chain[chain.length - 1]?.hash);
    expect(last?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('starts a chain from genesis when appending to an empty chain', async () => {
    const grown = await append([], record({ actor: 'first' }));
    expect(grown).toHaveLength(1);
    expect(grown[0]?.prev).toBe(GENESIS_HASH);
    expect(grown[0]?.seq).toBe(1);
  });

  it('does not mutate the original chain', async () => {
    const chain = await createChain(RECORDS);
    const before = structuredClone(chain);
    await append(chain, record({ actor: 'audit' }));
    expect(chain).toEqual(before);
  });
});

describe('hashEntry', () => {
  it('agrees with SHA-256 over the canonical preimage for an arbitrary previous hash', async () => {
    const entry = { seq: 9, ...record({ actor: 'zoe' }) };
    const prev = 'a'.repeat(64);
    const expected = bytesToHex(
      await webCryptoHashProvider.digest(canonicalize({ prev, ...entry })),
    );
    expect(await hashEntry(prev, entry)).toBe(expected);
  });
});

describe('tamper operations', () => {
  it('alter recomputes the altered entry hash while keeping its stored predecessor link', async () => {
    const chain = await createChain(RECORDS);
    const target = chain[2];
    if (!target) throw new Error('expected an entry');
    const tampered = await alterEntry(chain, 2, { action: 'read', actor: 'mallory' });

    const altered = tampered[2];
    if (!altered) throw new Error('expected an altered entry');
    expect(altered.actor).toBe('mallory');
    expect(altered.prev).toBe(target.prev);
    expect(altered.hash).not.toBe(target.hash);
    // The attacker recalculated the hash of the route they touched, so the row
    // is self-consistent again: only the forward link gives it away.
    expect(altered.hash).toBe(await hashEntry(altered.prev, altered));
    // Everything else is byte-identical.
    expect(tampered[0]).toEqual(chain[0]);
    expect(tampered[1]).toEqual(chain[1]);
    expect(tampered[3]).toEqual(chain[3]);
    expect(tampered[4]).toEqual(chain[4]);
  });

  it('delete removes one entry and leaves the rest untouched', async () => {
    const chain = await createChain(RECORDS);
    const trimmed = deleteEntry(chain, 2);

    expect(trimmed).toHaveLength(4);
    expect(trimmed.map((entry) => entry.seq)).toEqual([1, 2, 4, 5]);
    expect(trimmed[0]).toEqual(chain[0]);
    expect(trimmed[1]).toEqual(chain[1]);
    expect(trimmed[2]).toEqual(chain[3]);
    expect(trimmed[3]).toEqual(chain[4]);
  });

  it('swap exchanges two entries without recomputing anything', async () => {
    const chain = await createChain(RECORDS);
    const swapped = swapEntries(chain, 2, 3);

    expect(swapped[2]).toEqual(chain[3]);
    expect(swapped[3]).toEqual(chain[2]);
    expect(swapped[0]).toEqual(chain[0]);
    expect(swapped[1]).toEqual(chain[1]);
    expect(swapped[4]).toEqual(chain[4]);
  });

  it('insert retroactively adds a self-consistent entry that duplicates the next sequence', async () => {
    const chain = await createChain(RECORDS);
    const inserted = await insertEntry(chain, 2, record({ actor: 'mallory', action: 'grant' }));

    expect(inserted).toHaveLength(6);
    const fake = inserted[2];
    if (!fake) throw new Error('expected the inserted entry');
    expect(fake.seq).toBe(3);
    expect(fake.prev).toBe(chain[1]?.hash);
    expect(fake.hash).toBe(await hashEntry(chain[1]?.hash ?? '', fake));
    // The original entry keeps its own (now duplicated) sequence number.
    expect(inserted[3]?.seq).toBe(3);
    expect(inserted[3]).toEqual(chain[2]);
  });

  it('rejects out-of-range indexes instead of producing a corrupt chain', async () => {
    const chain = await createChain(RECORDS);
    await expect(alterEntry(chain, 9, { actor: 'x' })).rejects.toBeInstanceOf(RangeError);
    expect(() => deleteEntry(chain, 9)).toThrow(RangeError);
    expect(() => swapEntries(chain, 0, 9)).toThrow(RangeError);
    await expect(insertEntry(chain, 9, record())).rejects.toBeInstanceOf(RangeError);
  });
});
