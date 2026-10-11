import { describe, expect, it } from 'vitest';

import { alterEntry, createChain } from '../../src/engine/ledger';
import type { RawRecord } from '../../src/engine/ledger';
import { anchorRoot, verifyAnchor } from '../../src/engine/anchor';

/**
 * Anchors are the answer to "when". An anchor pins the Merkle root of a prefix,
 * so a change to that prefix is detectable afterwards: the old anchor still
 * verifies against the untouched prefix and fails once the prefix moves. An
 * anchor taken *after* a change, of course, matches the changed prefix — which
 * is why an anchor is only evidence if it predates the manipulation.
 */

function record(index: number): RawRecord {
  return {
    timestamp: 1_700_000_000_000 + index,
    actor: `actor-${index}`,
    action: 'read',
    resource: `record:HC-${index}`,
    payload: { index },
  };
}

const RECORDS: readonly RawRecord[] = Array.from({ length: 5 }, (_, index) => record(index));

describe('anchorRoot', () => {
  it('anchors every N entries and includes the final partial prefix', async () => {
    const chain = await createChain(RECORDS);
    const anchors = await anchorRoot(chain, 2);

    expect(anchors.map((anchor) => anchor.entryCount)).toEqual([2, 4, 5]);
    expect(anchors.map((anchor) => anchor.atSeq)).toEqual([2, 4, 5]);
    for (const anchor of anchors) {
      expect(anchor.root).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('anchors the whole chain once when it is shorter than the interval', async () => {
    const chain = await createChain(RECORDS.slice(0, 3));
    const anchors = await anchorRoot(chain, 10);
    expect(anchors).toEqual([{ atSeq: 3, root: anchors[0]?.root, entryCount: 3 }]);
  });

  it('produces no anchors for an empty chain', async () => {
    expect(await anchorRoot([], 2)).toEqual([]);
  });

  it('rejects a non-positive interval', async () => {
    const chain = await createChain(RECORDS);
    await expect(anchorRoot(chain, 0)).rejects.toBeInstanceOf(RangeError);
    await expect(anchorRoot(chain, -1)).rejects.toBeInstanceOf(RangeError);
  });
});

describe('verifyAnchor', () => {
  it('verifies every anchor while the chain is untouched', async () => {
    const chain = await createChain(RECORDS);
    const anchors = await anchorRoot(chain, 2);

    for (const anchor of anchors) {
      const check = await verifyAnchor(chain, anchor);
      expect(check.ok).toBe(true);
      expect(check.currentRoot).toBe(anchor.root);
      expect(check.anchoredRoot).toBe(anchor.root);
    }
  });

  it('fails after a change to the anchored prefix', async () => {
    const chain = await createChain(RECORDS);
    const [first, second] = await anchorRoot(chain, 2);
    if (!first || !second) throw new Error('expected anchors');

    const tampered = await alterEntry(chain, 1, { action: 'exfiltrate' });
    const prefixCheck = await verifyAnchor(tampered, first);
    expect(prefixCheck.ok).toBe(false);
    expect(prefixCheck.currentRoot).not.toBe(first.root);
    expect(prefixCheck.anchoredRoot).toBe(first.root);
  });

  it('leaves an anchor taken after the change verifying against the changed prefix', async () => {
    const chain = await createChain(RECORDS);
    const tampered = await alterEntry(chain, 1, { action: 'exfiltrate' });

    // Whoever owns the chain re-anchors after the manipulation: the new anchor
    // is consistent with the tampered prefix, which is exactly the point.
    const [freshAnchor] = await anchorRoot(tampered, 2);
    if (!freshAnchor) throw new Error('expected a fresh anchor');
    const check = await verifyAnchor(tampered, freshAnchor);
    expect(check.ok).toBe(true);

    // But the old anchor from before the change no longer matches.
    const [oldAnchor] = await anchorRoot(chain, 2);
    if (!oldAnchor) throw new Error('expected the original anchor');
    expect(oldAnchor.root).not.toBe(freshAnchor.root);
    const oldCheck = await verifyAnchor(tampered, oldAnchor);
    expect(oldCheck.ok).toBe(false);
  });

  it('reports a mismatch when the anchored prefix was truncated', async () => {
    const chain = await createChain(RECORDS);
    const [last] = (await anchorRoot(chain, 2)).slice(-1);
    if (!last) throw new Error('expected an anchor');

    const shortened = chain.slice(0, 1);
    const check = await verifyAnchor(shortened, last);
    expect(check.ok).toBe(false);
    expect(check.entryCount).toBe(last.entryCount);
  });
});
