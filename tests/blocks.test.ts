import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canonicalize } from '../src/engine/canonical';
import { bytesToHex, webCryptoHashProvider } from '../src/engine/hash';
import es from '../src/i18n/es.json';
import { buildHeroChain } from '../src/sections/hero';
import { SEED_CONTENTS } from '../src/sections/idea';
import { mountApp } from '../src/shell';

/**
 * Blocks 1 to 4 are the argument of the page, so they are mounted through the
 * real shell and driven like a visitor would: keyboard-and-pointer controls,
 * real DOM, and digests checked against the engine rather than against the
 * page's own output.
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
  root.remove();
  window.localStorage.clear();
  document.documentElement.lang = 'es';
});

function block(id: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(`#${id}`);
  if (element === null) {
    throw new Error(`Block #${id} is not mounted`);
  }
  return element;
}

function query<T extends Element>(scope: ParentNode, selector: string): T {
  const element = scope.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}

function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`Missing index ${index} in a list of ${items.length}`);
  }
  return value;
}

function ideaEntries(idea: HTMLElement): HTMLElement[] {
  return [...idea.querySelectorAll<HTMLElement>('[data-idea-entry]')];
}

function entryDigests(idea: HTMLElement): string[] {
  return ideaEntries(idea).map(
    (entry) => query<HTMLElement>(entry, '[data-entry-digest]').textContent ?? '',
  );
}

function submitIdea(idea: HTMLElement): void {
  query<HTMLFormElement>(idea, '[data-idea-form]').dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
}

async function ideaWithSeeds(idea: HTMLElement): Promise<void> {
  await vi.waitFor(() => {
    expect(ideaEntries(idea)).toHaveLength(SEED_CONTENTS.length);
  });
  await vi.waitFor(() => {
    expect(entryDigests(idea)[0]).toMatch(/^[0-9a-f]{64}$/);
  });
}

describe('block 1 — the hero chain', () => {
  it('draws six links whose short hashes are real SHA-256 prefixes', async () => {
    const hero = block('hero');
    const diagram = query<HTMLElement>(hero, '[data-hero-diagram]');
    await vi.waitFor(() => {
      expect(diagram.dataset.ready).toBe('true');
    });

    const expected = await buildHeroChain();
    const links = [...hero.querySelectorAll<HTMLElement>('[data-hero-link]')];

    expect(links).toHaveLength(6);
    expect(expected).toHaveLength(6);

    links.forEach((link, index) => {
      const reference = at(expected, index);
      const hash = query<HTMLElement>(link, '[data-hero-hash]');

      expect(reference.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(hash.textContent).toBe(reference.short);
      expect(hash.getAttribute('title')).toBe(reference.digest);
      expect(link.dataset.role).toBe(reference.role);
    });
  });

  it('marks the altered link and propagates the break forward', async () => {
    const hero = block('hero');
    const diagram = query<HTMLElement>(hero, '[data-hero-diagram]');
    await vi.waitFor(() => {
      expect(diagram.dataset.ready).toBe('true');
    });

    const roles = [...hero.querySelectorAll<HTMLElement>('[data-hero-link]')].map(
      (link) => link.dataset.role,
    );

    expect(roles).toEqual(['valid', 'valid', 'valid', 'altered', 'broken', 'broken']);
  });

  it('describes the diagram for assistive technology and hides the decorative list', () => {
    const hero = block('hero');
    const diagram = query<HTMLElement>(hero, '[data-hero-diagram]');

    expect(diagram.getAttribute('role')).toBe('img');
    expect(diagram.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(20);
    expect(query<HTMLElement>(hero, '[data-hero-list]').getAttribute('aria-hidden')).toBe('true');
    expect(query<HTMLElement>(hero, 'figcaption').textContent).not.toBe('');
  });
});

describe('block 2 — the problem', () => {
  it('offers a native button that toggles the revealed state', () => {
    const problem = block('problem');
    const button = query<HTMLButtonElement>(problem, '[data-reveal]');

    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-pressed')).toBe('false');

    const deleted = query<HTMLElement>(problem, '[data-evidence="deleted"]');
    const intactSummary = query<HTMLElement>(problem, '[data-problem-summary="intact"]');
    const revealedSummary = query<HTMLElement>(problem, '[data-problem-summary="revealed"]');

    expect(deleted.hidden).toBe(true);
    expect(revealedSummary.hidden).toBe(true);
    expect(intactSummary.hidden).toBe(false);

    button.click();

    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(deleted.hidden).toBe(false);
    expect(revealedSummary.hidden).toBe(false);
    expect(intactSummary.hidden).toBe(true);
    expect(query<HTMLElement>(problem, '[data-revealed]').dataset.revealed).toBe('true');

    button.click();

    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(deleted.hidden).toBe(true);
    expect(revealedSummary.hidden).toBe(true);
    expect(query<HTMLElement>(problem, '[data-revealed]').dataset.revealed).toBe('false');
  });

  it('names the deletion and the edit in words, not only in colour', () => {
    const problem = block('problem');
    query<HTMLButtonElement>(problem, '[data-reveal]').click();

    const deleted = query<HTMLElement>(problem, '[data-evidence="deleted"]');
    expect(deleted.textContent).toContain('fila borrada');
    expect(deleted.textContent).toContain('soporte.externo@vendor');

    const modified = query<HTMLElement>(problem, '[data-evidence="modified"]');
    expect(modified.hidden).toBe(false);
    expect(modified.textContent).toContain('celda editada');
    expect(query<HTMLElement>(modified, 's, del').textContent).toBe('exportación');
    expect(problem.textContent).toContain('La evidencia dice 7 accesos');
  });

  it('names the reveal button with its own visible label', () => {
    const problem = block('problem');
    const button = query<HTMLButtonElement>(problem, '[data-reveal]');

    // A different aria-label than the visible text fails label-content-name-mismatch.
    expect(button.hasAttribute('aria-label')).toBe(false);
    expect(button.hasAttribute('data-i18n-aria-label')).toBe(false);

    const visible = query<HTMLElement>(button, '.log__toggle-on');
    const hidden = query<HTMLElement>(button, '.log__toggle-off');
    expect(visible.textContent).toBe(es['problem.reveal.show']);
    expect(hidden.textContent).toBe(es['problem.reveal.hide']);
    // Only the label that is visible can reach the accessible name.
    expect(hidden.hidden).toBe(true);
    expect(visible.hidden).toBe(false);

    button.click();
    expect(visible.hidden).toBe(true);
    expect(hidden.hidden).toBe(false);
  });

  it('keeps the log table readable in both states', () => {
    const problem = block('problem');
    const table = query<HTMLTableElement>(problem, '.log__table');

    expect(table.querySelectorAll('thead th')).toHaveLength(4);
    expect(table.querySelectorAll('tbody tr')).toHaveLength(7);
    expect(query<HTMLElement>(table, 'caption').textContent).toContain('Registro de accesos');
  });
});

describe('block 3 — the idea', () => {
  it('exposes a real text input and a submit button inside a form', async () => {
    const idea = block('idea');
    const form = query<HTMLFormElement>(idea, '[data-idea-form]');

    expect(form).toBeInstanceOf(HTMLFormElement);

    const input = query<HTMLInputElement>(idea, '[data-idea-input]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(input.type).toBe('text');

    const submit = query<HTMLButtonElement>(idea, '[data-idea-add]');
    expect(submit).toBeInstanceOf(HTMLButtonElement);
    expect(submit.type).toBe('submit');
    expect(form.contains(submit)).toBe(true);

    const reset = query<HTMLButtonElement>(idea, '[data-idea-reset]');
    expect(reset).toBeInstanceOf(HTMLButtonElement);
    expect(reset.type).toBe('button');

    await ideaWithSeeds(idea);

    for (const entry of ideaEntries(idea)) {
      const rowInput = query<HTMLInputElement>(entry, '[data-entry-content]');
      expect(rowInput).toBeInstanceOf(HTMLInputElement);
      expect(rowInput.type).toBe('text');
    }
  });

  it('shows the preimage that is actually hashed', async () => {
    const idea = block('idea');
    await ideaWithSeeds(idea);

    const prev = query<HTMLElement>(idea, '[data-preimage-prev]').textContent ?? '';
    const seq = Number(query<HTMLElement>(idea, '[data-preimage-seq]').textContent ?? '');
    const content = query<HTMLElement>(idea, '[data-preimage-content]').textContent ?? '';
    const bytes = query<HTMLElement>(idea, '[data-preimage-bytes]').textContent ?? '';
    const digest = query<HTMLElement>(idea, '[data-preimage-digest]').textContent ?? '';
    const preimage = { prev, seq, content };

    expect(prev).toMatch(/^[0-9a-f]{64}$/);
    expect(seq).toBe(SEED_CONTENTS.length);
    expect(content).toBe(at(SEED_CONTENTS, SEED_CONTENTS.length - 1));
    expect(bytes).toBe(bytesToHex(canonicalize(preimage)));
    expect(digest).toBe(bytesToHex(await webCryptoHashProvider.digest(canonicalize(preimage))));
  });

  it('adds an entry and shows the real SHA-256 of its preimage', async () => {
    const idea = block('idea');
    await ideaWithSeeds(idea);

    const input = query<HTMLInputElement>(idea, '[data-idea-input]');
    input.value = 'record:HC-77777:read';
    submitIdea(idea);

    await vi.waitFor(() => {
      expect(ideaEntries(idea)).toHaveLength(SEED_CONTENTS.length + 1);
    });

    const last = at(ideaEntries(idea), SEED_CONTENTS.length);
    const prev = query<HTMLElement>(last, '[data-entry-prev]').textContent ?? '';
    const digest = query<HTMLElement>(last, '[data-entry-digest]').textContent ?? '';
    const expected = bytesToHex(
      await webCryptoHashProvider.digest(
        canonicalize({ prev, seq: SEED_CONTENTS.length + 1, content: 'record:HC-77777:read' }),
      ),
    );

    expect(prev).toBe(at(entryDigests(idea), SEED_CONTENTS.length - 1));
    expect(digest).toBe(expected);
    expect(query<HTMLElement>(idea, '[data-idea-count]').textContent).toBe(
      String(SEED_CONTENTS.length + 1),
    );
  });

  it('recomputes every later digest when an earlier entry is edited', async () => {
    const idea = block('idea');
    await ideaWithSeeds(idea);
    const before = entryDigests(idea);

    const first = query<HTMLInputElement>(at(ideaEntries(idea), 0), '[data-entry-content]');
    first.value = 'system:init:edited';
    first.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      expect(entryDigests(idea)[1]).not.toBe(before[1]);
    });

    const after = entryDigests(idea);
    expect(after[0]).not.toBe(before[0]);
    expect(after).toHaveLength(SEED_CONTENTS.length);

    const note = query<HTMLElement>(idea, '[data-idea-note]');
    expect(note.hidden).toBe(false);
    expect(query<HTMLElement>(note, '[data-idea-note-count]').textContent).toBe('1');

    const secondEntry = at(ideaEntries(idea), 1);
    expect(secondEntry.dataset.recomputed).toBe('true');
    expect(query<HTMLElement>(secondEntry, '[data-entry-badge]').hidden).toBe(false);
  });

  it('restores the original digests when an edit is undone', async () => {
    const idea = block('idea');
    await ideaWithSeeds(idea);
    const seeds = entryDigests(idea);

    const first = query<HTMLInputElement>(at(ideaEntries(idea), 0), '[data-entry-content]');
    first.value = 'system:init:edited';
    first.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => {
      expect(entryDigests(idea)[1]).not.toBe(seeds[1]);
    });

    first.value = at(SEED_CONTENTS, 0);
    first.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      expect(entryDigests(idea)).toEqual(seeds);
    });
    // Undoing the edit rewrote entry 2 again, so the marker stays honest.
    expect(at(ideaEntries(idea), 1).dataset.recomputed).toBe('true');
  });

  it('reports nothing when an edit leaves the digest unchanged', async () => {
    const idea = block('idea');
    await ideaWithSeeds(idea);
    const seeds = entryDigests(idea);

    const first = query<HTMLInputElement>(at(ideaEntries(idea), 0), '[data-entry-content]');
    first.value = at(SEED_CONTENTS, 0);
    first.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.waitFor(() => {
      expect(entryDigests(idea)).toEqual(seeds);
    });
    expect(query<HTMLElement>(idea, '[data-idea-note]').hidden).toBe(true);
    expect(at(ideaEntries(idea), 1).dataset.recomputed).toBe('false');
  });

  it('ignores an empty submission', async () => {
    const idea = block('idea');
    await ideaWithSeeds(idea);

    query<HTMLInputElement>(idea, '[data-idea-input]').value = '   ';
    submitIdea(idea);

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(ideaEntries(idea)).toHaveLength(SEED_CONTENTS.length);
  });

  it('resets back to the seed chain', async () => {
    const idea = block('idea');
    await ideaWithSeeds(idea);
    const seeds = entryDigests(idea);

    const input = query<HTMLInputElement>(idea, '[data-idea-input]');
    input.value = 'record:HC-00001:read';
    submitIdea(idea);
    await vi.waitFor(() => {
      expect(ideaEntries(idea)).toHaveLength(SEED_CONTENTS.length + 1);
    });

    query<HTMLButtonElement>(idea, '[data-idea-reset]').click();

    await vi.waitFor(() => {
      expect(ideaEntries(idea)).toHaveLength(SEED_CONTENTS.length);
    });
    await vi.waitFor(() => {
      expect(entryDigests(idea)).toEqual(seeds);
    });
    expect(query<HTMLElement>(idea, '[data-idea-note]').hidden).toBe(true);
  });
});

describe('block 4 — the comparison', () => {
  it('renders an honest trade-off table with one row per option', () => {
    const comparison = block('comparison');
    const table = query<HTMLTableElement>(comparison, '[data-compare-table]');

    expect(table.querySelectorAll('thead th')).toHaveLength(6);

    const rows = [...table.querySelectorAll<HTMLTableRowElement>('tbody tr')];
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.querySelector('th')?.getAttribute('scope')).toBe('row');
      expect(row.querySelectorAll('td')).toHaveLength(5);
      for (const cell of row.querySelectorAll('td')) {
        expect((cell.textContent ?? '').trim().length).toBeGreaterThan(10);
      }
    }
  });

  it('states the limitations of a hash chain instead of hiding them', () => {
    const comparison = block('comparison');
    const rows = [...comparison.querySelectorAll<HTMLTableRowElement>('tbody tr')];
    const chainRow = at(rows, 2).textContent ?? '';

    expect(chainRow).toContain('Cadena de hashes');
    expect(chainRow).toContain('cortar la cola');
    expect(chainRow).toContain('anclaje');

    const permissionRow = at(rows, 0).textContent ?? '';
    expect(permissionRow).toContain('Nada');
  });

  it('lets a keyboard user scroll the table', () => {
    const comparison = block('comparison');
    const scroll = query<HTMLElement>(comparison, '[data-compare-scroll]');

    expect(scroll.getAttribute('role')).toBe('region');
    expect(scroll.getAttribute('tabindex')).toBe('0');
    expect(scroll.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(3);
    expect(query<HTMLElement>(comparison, '[data-compare-table] caption').textContent).not.toBe('');
  });
});

describe('the four blocks together', () => {
  it('uses native controls for every new interaction', async () => {
    await ideaWithSeeds(block('idea'));

    const selectors = [
      '[data-reveal]',
      '[data-idea-input]',
      '[data-idea-add]',
      '[data-idea-reset]',
      '[data-entry-content]',
    ];

    for (const selector of selectors) {
      const controls = [...root.querySelectorAll(selector)];
      expect(controls.length, `${selector} has no control`).toBeGreaterThan(0);
      for (const control of controls) {
        expect(['BUTTON', 'INPUT'], `${selector} is a ${control.tagName}`).toContain(
          control.tagName,
        );
      }
    }

    expect(root.querySelectorAll('[role="button"], [onclick]')).toHaveLength(0);
  });

  it('translates every new string in both languages and leaks no raw key', async () => {
    const hero = block('hero');
    await vi.waitFor(() => {
      expect(hero.querySelectorAll('[data-hero-link]')).toHaveLength(6);
    });

    for (const lang of ['es', 'en'] as const) {
      query<HTMLButtonElement>(root, `button[data-lang="${lang}"]`).click();

      for (const element of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
        const key = element.dataset.i18n ?? '';
        const text = element.textContent ?? '';
        expect(text, `${key} is empty`).not.toBe('');
        expect(text, `${key} was not translated`).not.toBe(key);
      }
      for (const element of root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
        const label = element.getAttribute('aria-label') ?? '';
        expect(label).not.toBe(element.dataset.i18nAriaLabel);
        expect(label).not.toBe('');
      }
    }
  });

  it('normalises the Spanish hero headline to neutral tuteo', () => {
    expect(es['block.hero.title']).not.toMatch(/Comprobalo/);
    expect(es['block.hero.title']).toContain('Compruébalo');
  });
});
