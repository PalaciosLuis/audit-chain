import { describe, expect, it } from 'vitest';

import {
  GENESIS_HASH,
  alterEntry,
  createChain,
  deleteEntry,
  hashEntry,
  insertEntry,
  swapEntries,
} from '../../src/engine/ledger';
import type { ChainedEntry, LedgerChain, RawRecord } from '../../src/engine/ledger';
import { verifyChain } from '../../src/engine/verify';
import type { ChainBreak } from '../../src/engine/verify';

/**
 * `verifyChain` is the point of the whole engine: it does not just say "invalid",
 * it names *what* happened and *where*. Every attack test asserts the exact
 * `kind` and the exact `index` of the primary break, because "the lab can name
 * what happened, not just say invalid" is the contract.
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

/** Index the tests deliberately break, in the middle of the chain. */
const TARGET = 2;

function primary(chainBreaks: readonly ChainBreak[]): ChainBreak {
  const first = chainBreaks[0];
  if (!first) throw new Error('expected at least one break');
  return first;
}

describe('an intact chain', () => {
  it('verifies, counts every entry and reports no breaks', async () => {
    const chain = await createChain(RECORDS);
    const result = await verifyChain(chain);

    expect(result.ok).toBe(true);
    expect(result.checked).toBe(RECORDS.length);
    expect(result.breaks).toEqual([]);
    expect(result.root).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies an empty chain', async () => {
    const result = await verifyChain([]);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(0);
    expect(result.breaks).toEqual([]);
    expect(result.root).toBe('');
  });

  it('verifies a single entry anchored to genesis', async () => {
    const firstRecord = RECORDS[0];
    if (!firstRecord) throw new Error('expected a record');
    const chain = await createChain([firstRecord]);
    const result = await verifyChain(chain);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(1);
  });
});

describe('attack classification: one assertion per break kind', () => {
  it('content_tampered: a field changed without recomputing the row hash', async () => {
    const chain = await createChain(RECORDS);
    // An attacker who only edits the database row, leaving the stored hash stale.
    const tampered: LedgerChain = chain.map((entry, index) =>
      index === TARGET ? { ...entry, actor: 'mallory' } : entry,
    );

    const result = await verifyChain(tampered);
    const first = primary(result.breaks);
    expect(result.ok).toBe(false);
    expect(first.kind).toBe('content_tampered');
    expect(first.index).toBe(TARGET);
    expect(first.seq).toBe(TARGET + 1);
    expect(first.expected).not.toBe(first.actual);
    expect(first.actual).toBe(chain[TARGET]?.hash);
  });

  it('entry_deleted: a middle row removed, leaving a sequence gap', async () => {
    const chain = await createChain(RECORDS);
    const result = await verifyChain(deleteEntry(chain, TARGET));
    const first = primary(result.breaks);

    expect(result.ok).toBe(false);
    expect(first.kind).toBe('entry_deleted');
    expect(first.index).toBe(TARGET);
    expect(first.seq).toBe(TARGET + 2);
  });

  it('entries_reordered: two rows swapped, so a link points to the wrong predecessor', async () => {
    const chain = await createChain(RECORDS);
    const result = await verifyChain(swapEntries(chain, TARGET, TARGET + 1));
    const first = primary(result.breaks);

    expect(result.ok).toBe(false);
    expect(first.kind).toBe('entries_reordered');
    expect(first.index).toBe(TARGET);
  });

  it('entry_inserted: a fabricated row squeezed in, so the next link skips it', async () => {
    const chain = await createChain(RECORDS);
    const inserted = await insertEntry(
      chain,
      TARGET,
      record({ actor: 'mallory', action: 'grant' }),
    );
    const result = await verifyChain(inserted);
    const first = primary(result.breaks);

    expect(result.ok).toBe(false);
    expect(first.kind).toBe('entry_inserted');
    expect(first.index).toBe(TARGET + 1);
  });

  it('entry_inserted: a fabricated row squeezed in at the head of the chain', async () => {
    const chain = await createChain(RECORDS);
    const inserted = await insertEntry(chain, 0, record({ actor: 'mallory', action: 'grant' }));
    const result = await verifyChain(inserted);
    const first = primary(result.breaks);

    expect(result.ok).toBe(false);
    expect(first.kind).toBe('entry_inserted');
    expect(first.index).toBe(1);
  });

  it('genesis_mismatch: the first entry does not start at the genesis hash', async () => {
    const chain = await createChain(RECORDS);
    const forked = [...chain];
    forked[0] = { ...(chain[0] as ChainedEntry), prev: 'f'.repeat(64) };
    const result = await verifyChain(forked);
    const first = primary(result.breaks);

    expect(result.ok).toBe(false);
    expect(first.kind).toBe('genesis_mismatch');
    expect(first.index).toBe(0);
    expect(first.expected).toBe(GENESIS_HASH);
    expect(first.actual).toBe('f'.repeat(64));
  });
});

describe('the subtle point: recomputing your own hash is not enough', () => {
  it('still fails, because the following link no longer matches', async () => {
    const chain = await createChain(RECORDS);
    const tampered = await alterEntry(chain, TARGET, { action: 'grant' });
    const result = await verifyChain(tampered);
    const first = primary(result.breaks);

    expect(result.ok).toBe(false);
    expect(first.kind).toBe('content_tampered');
    // The break is reported at the altered entry: its stored hash is no longer
    // the value its successor committed to.
    expect(first.index).toBe(TARGET);
    expect(first.actual).toBe(tampered[TARGET]?.hash);
    expect(first.expected).toBe(tampered[TARGET + 1]?.prev);
    expect(first.expected).not.toBe(first.actual);
    // The altered row is internally consistent, which is exactly why the naive
    // checks cannot see it; only the forward link does.
    const altered = tampered[TARGET];
    if (!altered) throw new Error('expected the altered entry');
    expect(altered.hash).toBe(await hashEntry(altered.prev, altered));
    // Nothing before the attack is reported as broken.
    expect(result.breaks.every((entry) => entry.index >= TARGET)).toBe(true);
  });

  it('does not mutate the intact chain it verified', async () => {
    const chain = await createChain(RECORDS);
    const before = structuredClone(chain);
    await verifyChain(chain);
    await alterEntry(chain, TARGET, { action: 'grant' });
    expect(chain).toEqual(before);
  });
});

describe('reports the first break precisely and lists the rest', () => {
  it('lists every inconsistent link after swapping two rows', async () => {
    const chain = await createChain(RECORDS);
    const result = await verifyChain(swapEntries(chain, TARGET, TARGET + 1));

    expect(result.breaks.length).toBeGreaterThan(1);
    expect(primary(result.breaks).index).toBe(TARGET);
    expect(result.breaks.map((entry) => entry.index)).toContain(TARGET + 1);
  });

  it('keeps a tampered tail undetectable by the chain alone', async () => {
    // The last entry commits to its predecessor but nothing commits to it, so
    // rewriting it and recomputing its own hash leaves the link walk clean.
    const chain = await createChain(RECORDS);
    const tampered = await alterEntry(chain, chain.length - 1, { action: 'exfiltrate' });
    const result = await verifyChain(tampered);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(RECORDS.length);
  });
});
