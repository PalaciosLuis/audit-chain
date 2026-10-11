import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  alterEntry,
  append,
  createChain,
  generateKeyPair,
  signChain,
  verifySignedPackage,
} from '../src/engine';
import es from '../src/i18n/es.json';
import { LAB_SEED, newRecord } from '../src/sections/demo-model';
import { mountApp } from '../src/shell';

/**
 * Block 5 is the promise of the page: a real chain that the visitor can break
 * and that verification names precisely. These tests drive the mounted lab with
 * the same native controls a visitor uses, and cross-check the rendered hashes
 * against the engine instead of against the page's own output.
 */

let root: HTMLElement;

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('audit-chain:lang', 'es');
  root = document.createElement('div');
  document.body.append(root);
  mountApp(root);
});

afterEach(() => {
  vi.unstubAllGlobals();
  root.remove();
  window.localStorage.clear();
  document.documentElement.lang = 'es';
});

function query<T extends Element>(scope: ParentNode, selector: string): T {
  const element = scope.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}

function demo(): HTMLElement {
  return query<HTMLElement>(root, '#demo');
}

function entries(scope: ParentNode): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>('[data-demo-entry]')];
}

function entryCount(scope: ParentNode): number {
  return entries(scope).length;
}

function entryHash(scope: ParentNode, index: number): string {
  const row = entries(scope)[index];
  if (row === undefined) {
    throw new Error(`Missing entry ${index}`);
  }
  return query<HTMLElement>(row, '[data-demo-entry-hash]').textContent ?? '';
}

function entryPrev(scope: ParentNode, index: number): string {
  const row = entries(scope)[index];
  if (row === undefined) {
    throw new Error(`Missing entry ${index}`);
  }
  return query<HTMLElement>(row, '[data-demo-entry-prev]').textContent ?? '';
}

function rowStates(scope: ParentNode): string[] {
  return entries(scope).map((row) => row.dataset.state ?? '');
}

async function ready(scope: HTMLElement): Promise<void> {
  await vi.waitFor(() => {
    expect(scope.querySelector('[data-lazy-state="ready"]')).not.toBeNull();
  });
  await vi.waitFor(() => {
    expect(entryCount(scope)).toBe(LAB_SEED.length);
  });
  await vi.waitFor(() => {
    expect(query<HTMLElement>(scope, '[data-demo-count]').textContent).toBe(
      String(LAB_SEED.length),
    );
  });
}

function setTarget(scope: HTMLElement, seq: number): void {
  const select = query<HTMLSelectElement>(scope, '[data-demo-target]');
  select.value = String(seq - 1);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function click(scope: HTMLElement, selector: string): void {
  query<HTMLButtonElement>(scope, selector).click();
}

function submitAdd(scope: HTMLElement, resource: string): void {
  query<HTMLInputElement>(scope, '[data-demo-new]').value = resource;
  query<HTMLFormElement>(scope, '[data-demo-add-form]').dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
}

async function waitForBreak(scope: HTMLElement): Promise<HTMLElement> {
  await vi.waitFor(() => {
    expect(scope.querySelector('[data-demo-break]')).not.toBeNull();
  });
  return query<HTMLElement>(scope, '[data-demo-break]');
}

describe('block 5 — the lab chain', () => {
  it('renders the seeded chain with a real hash and a link per entry', async () => {
    const lab = demo();
    await ready(lab);

    const expected = await createChain(LAB_SEED);
    expect(expected).toHaveLength(LAB_SEED.length);

    entries(lab).forEach((_row, index) => {
      const reference = expected[index];
      expect(reference).toBeDefined();
      expect(entryHash(lab, index)).toBe(reference?.hash);
      expect(entryPrev(lab, index)).toBe(reference?.prev);
      if (index > 0) {
        expect(entryPrev(lab, index)).toBe(entryHash(lab, index - 1));
      }
    });
  });

  it('adds an entry that the engine confirms', async () => {
    const lab = demo();
    await ready(lab);
    const seed = await createChain(LAB_SEED);

    submitAdd(lab, 'HC-10512');
    await vi.waitFor(() => {
      expect(entryCount(lab)).toBe(LAB_SEED.length + 1);
    });

    const grown = await append(seed, newRecord('HC-10512', seed.length));
    expect(entryHash(lab, seed.length)).toBe(grown[seed.length]?.hash);

    click(lab, '[data-demo-verify]');
    await vi.waitFor(() => {
      expect(query<HTMLElement>(lab, '[data-demo-verify-summary]').textContent).toBe(
        es['demo.verify.intact'].replace('{count}', String(LAB_SEED.length + 1)),
      );
    });
    expect(lab.querySelector('[data-demo-break]')).toBeNull();
  });

  it('alters a chosen entry and names content_tampered at that entry', async () => {
    const lab = demo();
    await ready(lab);
    const before = entryHash(lab, 3);

    setTarget(lab, 4);
    click(lab, '[data-demo-alter]');
    await vi.waitFor(() => {
      expect(entryHash(lab, 3)).not.toBe(before);
    });

    click(lab, '[data-demo-verify]');
    const breakItem = await waitForBreak(lab);

    expect(breakItem.dataset.kind).toBe('content_tampered');
    expect(breakItem.dataset.index).toBe('3');
    expect(breakItem.dataset.seq).toBe('4');
    expect(breakItem.textContent).toContain(es['demo.break.content_tampered']);
    expect(breakItem.textContent).toContain(es['demo.verify.expected']);
    expect(breakItem.textContent).toContain(es['demo.verify.actual']);
  });

  it('deletes a middle row and names entry_deleted at the sequence gap', async () => {
    const lab = demo();
    await ready(lab);

    setTarget(lab, 4);
    click(lab, '[data-demo-delete]');
    await vi.waitFor(() => {
      expect(entryCount(lab)).toBe(LAB_SEED.length - 1);
    });

    click(lab, '[data-demo-verify]');
    const breakItem = await waitForBreak(lab);

    expect(breakItem.dataset.kind).toBe('entry_deleted');
    expect(breakItem.dataset.index).toBe('3');
    expect(breakItem.dataset.seq).toBe('5');
    expect(breakItem.textContent).toContain(es['demo.break.entry_deleted']);
  });

  it('swaps two rows and names entries_reordered at the moved entry', async () => {
    const lab = demo();
    await ready(lab);
    const fourth = entryHash(lab, 3);
    const fifth = entryHash(lab, 4);

    setTarget(lab, 4);
    click(lab, '[data-demo-swap]');
    await vi.waitFor(() => {
      expect(entryHash(lab, 3)).toBe(fifth);
    });
    expect(entryHash(lab, 4)).toBe(fourth);

    click(lab, '[data-demo-verify]');
    const breakItem = await waitForBreak(lab);

    expect(breakItem.dataset.kind).toBe('entries_reordered');
    expect(breakItem.dataset.index).toBe('3');
    expect(breakItem.textContent).toContain(es['demo.break.entries_reordered']);
  });

  it('inserts a row retroactively and names entry_inserted right after it', async () => {
    const lab = demo();
    await ready(lab);

    setTarget(lab, 4);
    click(lab, '[data-demo-insert]');
    await vi.waitFor(() => {
      expect(entryCount(lab)).toBe(LAB_SEED.length + 1);
    });

    click(lab, '[data-demo-verify]');
    const breakItem = await waitForBreak(lab);

    expect(breakItem.dataset.kind).toBe('entry_inserted');
    expect(breakItem.dataset.index).toBe('4');
    expect(breakItem.dataset.seq).toBe('4');
    expect(breakItem.textContent).toContain(es['demo.break.entry_inserted']);
  });

  it('keeps the entries before the break valid and marks the rest invalid', async () => {
    const lab = demo();
    await ready(lab);
    const seed = await createChain(LAB_SEED);
    const untouched = seed.slice(0, 3).map((entry) => entry.hash);

    setTarget(lab, 4);
    click(lab, '[data-demo-alter]');
    await vi.waitFor(() => {
      expect(entryHash(lab, 3)).not.toBe(seed[3]?.hash);
    });
    click(lab, '[data-demo-verify]');
    await waitForBreak(lab);

    expect(rowStates(lab)).toEqual([
      'valid',
      'valid',
      'valid',
      'broken',
      'invalid',
      'invalid',
      'invalid',
      'invalid',
    ]);

    // The promise: everything before the break is byte-identical to the seed.
    const before = seed.slice(0, 3).map((entry) => entry.hash);
    expect(untouched).toEqual(before);
    expect(
      entries(lab)
        .slice(0, 3)
        .map((_row, index) => entryHash(lab, index)),
    ).toEqual(before);
  });

  it('resets the chain and the anchors to the seeded state', async () => {
    const lab = demo();
    await ready(lab);
    const seed = await createChain(LAB_SEED);
    const seedHashes = seed.map((entry) => entry.hash);

    setTarget(lab, 4);
    click(lab, '[data-demo-alter]');
    await vi.waitFor(() => {
      expect(entryHash(lab, 3)).not.toBe(seedHashes[3]);
    });

    click(lab, '[data-demo-reset]');
    await vi.waitFor(() => {
      expect(entryCount(lab)).toBe(LAB_SEED.length);
    });
    await vi.waitFor(() => {
      expect(entries(lab).map((_row, index) => entryHash(lab, index))).toEqual(seedHashes);
    });
    expect(rowStates(lab).every((state) => state === '')).toBe(true);
  });

  it('exposes native controls with visible text for every state', async () => {
    const lab = demo();
    await ready(lab);

    const buttons = [...lab.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.length).toBeGreaterThan(6);
    for (const button of buttons) {
      expect(['button', 'submit']).toContain(button.type);
      expect((button.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
    expect(lab.querySelectorAll('[role="button"], [onclick]')).toHaveLength(0);

    const before = entryHash(lab, 3);
    setTarget(lab, 4);
    click(lab, '[data-demo-alter]');
    await vi.waitFor(() => {
      expect(entryHash(lab, 3)).not.toBe(before);
    });
    click(lab, '[data-demo-verify]');
    await waitForBreak(lab);

    const badges = entries(lab).map(
      (row) => query<HTMLElement>(row, '[data-demo-entry-badge]').textContent ?? '',
    );
    expect(badges).toContain(es['demo.entry.state.broken']);
    expect(badges).toContain(es['demo.entry.state.invalid']);
  });
});

describe('block 5 — semantic fields', () => {
  it('keeps every definition list to term/description pairs and no orphan dd', async () => {
    const lab = demo();
    await ready(lab);

    const lists = [...lab.querySelectorAll('dl')];
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) {
      for (const child of list.children) {
        expect(
          ['DT', 'DD'],
          `${list.className} contains a <${child.tagName.toLowerCase()}>`,
        ).toContain(child.tagName);
      }
    }

    for (const value of lab.querySelectorAll('dd')) {
      expect(value.parentElement?.tagName, '<dd> must live inside a <dl>').toBe('DL');
    }
  });
});

describe('block 5 — Merkle panel', () => {
  it('verifies an inclusion proof on the intact chain and stops after the leaf changes', async () => {
    const lab = demo();
    await ready(lab);
    const rootBefore = query<HTMLElement>(lab, '[data-demo-merkle-root]').textContent ?? '';

    click(lab, '[data-demo-merkle-check]');
    await vi.waitFor(() => {
      expect(query<HTMLElement>(lab, '[data-demo-merkle-result]').dataset.valid).toBe('true');
    });
    expect(lab.querySelectorAll('[data-demo-merkle-proof] li').length).toBeGreaterThan(0);
    expect(query<HTMLElement>(lab, '[data-demo-merkle-relation]').textContent).toBe(
      es['demo.merkle.same'],
    );

    setTarget(lab, 4);
    click(lab, '[data-demo-alter]');
    await vi.waitFor(() => {
      expect(query<HTMLElement>(lab, '[data-demo-merkle-root]').textContent).not.toBe(rootBefore);
    });
    expect(query<HTMLElement>(lab, '[data-demo-merkle-relation]').textContent).toBe(
      es['demo.merkle.different'],
    );

    click(lab, '[data-demo-merkle-check]');
    await vi.waitFor(() => {
      expect(query<HTMLElement>(lab, '[data-demo-merkle-result]').dataset.valid).toBe('false');
    });
  });
});

describe('block 5 — anchors panel', () => {
  it('shows a stale pre-manipulation anchor next to a fresh one that matches', async () => {
    const lab = demo();
    await ready(lab);
    const before = entryHash(lab, 3);

    setTarget(lab, 4);
    click(lab, '[data-demo-alter]');
    await vi.waitFor(() => {
      expect(entryHash(lab, 3)).not.toBe(before);
    });
    click(lab, '[data-demo-anchor-capture]');

    await vi.waitFor(() => {
      expect(lab.querySelector('[data-anchor-round="2"]')).not.toBeNull();
    });

    const roundOne = query<HTMLElement>(lab, '[data-anchor-round="1"]');
    expect(roundOne.querySelector('[data-anchor-status][data-ok="false"]')).not.toBeNull();

    const roundTwo = query<HTMLElement>(lab, '[data-anchor-round="2"]');
    for (const status of roundTwo.querySelectorAll('[data-anchor-status]')) {
      expect(status.getAttribute('data-ok')).toBe('true');
    }

    const summary = query<HTMLElement>(lab, '[data-demo-anchor-summary]').textContent ?? '';
    expect(summary).toContain('ronda 1');
    expect(summary).toContain('ronda 2');
  });

  it('catches a rewritten tail that chain verification alone lets through', async () => {
    const lab = demo();
    await ready(lab);

    setTarget(lab, LAB_SEED.length);
    click(lab, '[data-demo-alter]');
    await vi.waitFor(() => {
      expect(query<HTMLElement>(lab, '[data-demo-statement]').textContent).toBe(
        es['demo.event.altered-tail'],
      );
    });

    click(lab, '[data-demo-verify]');
    await vi.waitFor(() => {
      expect(query<HTMLElement>(lab, '[data-demo-verify-summary]').textContent).toBe(
        es['demo.verify.intact'].replace('{count}', String(LAB_SEED.length)),
      );
    });
    expect(lab.querySelector('[data-demo-break]')).toBeNull();

    const roundOne = query<HTMLElement>(lab, '[data-anchor-round="1"]');
    expect(roundOne.querySelector('[data-anchor-status][data-ok="false"]')).not.toBeNull();
  });
});

describe('block 5 — signed export panel', () => {
  it('verifies the signature on the intact chain and fails after a change', async () => {
    const lab = demo();
    await ready(lab);

    click(lab, '[data-demo-export-sign]');
    await vi.waitFor(
      () => {
        expect(query<HTMLElement>(lab, '[data-demo-export-result]').dataset.valid).toBe('true');
      },
      { timeout: 5000 },
    );
    expect(query<HTMLElement>(lab, '[data-demo-export-key]').textContent).toContain('"kty"');
    expect(query<HTMLElement>(lab, '[data-demo-export-signature]').textContent).not.toBe('—');

    setTarget(lab, 4);
    click(lab, '[data-demo-alter]');
    await vi.waitFor(
      () => {
        expect(query<HTMLElement>(lab, '[data-demo-export-result]').dataset.valid).toBe('false');
      },
      { timeout: 5000 },
    );
    expect(query<HTMLElement>(lab, '[data-demo-export-result]').textContent).toBe(
      es['demo.export.invalid'],
    );
  });

  it('shows an explicit message when crypto.subtle is unavailable', async () => {
    const lab = demo();
    await ready(lab);

    vi.stubGlobal('crypto', {});
    click(lab, '[data-demo-export-sign]');
    await vi.waitFor(() => {
      expect(query<HTMLElement>(lab, '[data-demo-export-result]').dataset.valid).toBe(
        'unavailable',
      );
    });
    expect(query<HTMLElement>(lab, '[data-demo-export-result]').textContent).toBe(
      es['demo.export.unavailable'],
    );
  });

  it('does not verify a signature made with a foreign key', async () => {
    const seed = await createChain(LAB_SEED);
    const signer = await generateKeyPair();
    const foreign = await generateKeyPair();
    const signed = await signChain(seed, signer, { every: 3 });

    expect(await verifySignedPackage(signed, signer.publicKey)).toBe(true);
    expect(await verifySignedPackage(signed, foreign.publicKey)).toBe(false);
  });

  it('rejects a signature over a tampered chain even with the right key', async () => {
    const seed = await createChain(LAB_SEED);
    const pair = await generateKeyPair();
    const signed = await signChain(seed, pair, { every: 3 });
    const tampered = await alterEntry(seed, 3, { action: 'read' });

    expect(
      await verifySignedPackage({ ...signed, package: { ...signed.package, chain: tampered } }),
    ).toBe(false);
  });
});

describe('block 5 — language', () => {
  it('keeps the runtime statement in the active language', async () => {
    const lab = demo();
    await ready(lab);

    setTarget(lab, 4);
    click(lab, '[data-demo-alter]');
    await vi.waitFor(() => {
      expect(query<HTMLElement>(lab, '[data-demo-statement]').textContent).toBe(
        es['demo.event.altered'].replace('{seq}', '4'),
      );
    });
    click(lab, '[data-demo-verify]');
    await waitForBreak(lab);
    const spanish = query<HTMLElement>(lab, '[data-demo-statement]').textContent ?? '';
    expect(spanish).toContain(es['demo.break.content_tampered']);

    query<HTMLButtonElement>(root, 'button[data-lang="en"]').click();
    await vi.waitFor(() => {
      expect(query<HTMLElement>(lab, '[data-demo-statement]').textContent).not.toBe(spanish);
    });
    const english = query<HTMLElement>(lab, '[data-demo-statement]').textContent ?? '';
    expect(english).toContain('Tampered content');
  });
});
