import { describe, expect, it } from 'vitest';

import { createChain } from '../../src/engine/ledger';
import type { RawRecord } from '../../src/engine/ledger';
import { verifyChain } from '../../src/engine/verify';

/**
 * The README needs a real number for "how long does it take to verify a 10,000
 * entry chain", measured on the same machine that runs the suite. The number is
 * printed so it can be copied into the README; the assertion only guards against
 * a pathological regression, not against a slow CI box.
 */

const SIZE = 10_000;

function records(): RawRecord[] {
  return Array.from({ length: SIZE }, (_, index) => ({
    timestamp: 1_700_000_000_000 + index,
    actor: `actor-${index % 10}`,
    action: index % 2 === 0 ? 'read' : 'update',
    resource: `record:HC-${index}`,
    payload: { index, tags: ['audit'] },
  }));
}

describe('10,000-entry verification time', () => {
  it('verifies a 10,000-entry chain and reports the wall-clock time', async () => {
    const chain = await createChain(records());
    expect(chain).toHaveLength(SIZE);

    const start = performance.now();
    const result = await verifyChain(chain);
    const elapsedMs = performance.now() - start;

    console.log(
      `verifyChain(10,000 entries): ${elapsedMs.toFixed(1)} ms — provider: webcrypto (happy-dom under Node)`,
    );

    expect(result.ok).toBe(true);
    expect(result.checked).toBe(SIZE);
    expect(result.breaks).toEqual([]);
    expect(elapsedMs).toBeLessThan(60_000);
  }, 300_000);
});
