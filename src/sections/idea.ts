import { bytesToHex } from '../engine/hash';
import type { BlockSpec } from './base';
import { buildChain, changedIndices, preimageBytes, type ChainLink } from './chain-model';
import { el } from './dom';

/**
 * Block 3 — the idea. The one place where the visitor writes something.
 *
 * State is a list of plain-text contents. Every render rebuilds the chain with
 * the engine (`buildChain`: canonical bytes + SHA-256) and then:
 *
 *   - appends rows for new entries and drops rows for removed ones,
 *   - writes each entry's previous hash and digest into its own row,
 *   - shows the preimage of the entry in focus (previous hash, sequence, typed
 *     content, canonical bytes, digest), so the causality is visible,
 *   - marks the entries whose digest changed after an edit and reports how many
 *     were recomputed.
 *
 * Editing an earlier entry therefore rewrites that digest and every digest
 * after it, and the later rows change in front of the visitor. Every digest is
 * a full 64-hex SHA-256; nothing is shortened or mocked. Seed entries are
 * neutral tokens on purpose: they are data, not copy, so switching language
 * never makes a displayed digest disagree with the text it was computed from.
 */

/** The two example entries the block starts with, editable like any other. */
export const SEED_CONTENTS: readonly string[] = ['system:init', 'record:HC-10231:read'];

/** Upper bound on one entry, so the canonical byte view stays readable. */
const MAXLENGTH = 80;

/** No entry was rewritten: the state after an append or a reset. */
const EMPTY: ReadonlySet<number> = new Set<number>();

interface Row {
  readonly item: HTMLLIElement;
  readonly content: HTMLInputElement;
  readonly prev: HTMLElement;
  readonly digest: HTMLElement;
  readonly badge: HTMLElement;
}

interface ChainView {
  readonly list: HTMLOListElement;
  readonly countOutput: HTMLElement;
  readonly note: HTMLElement;
  readonly noteCount: HTMLElement;
  readonly preimagePrev: HTMLElement;
  readonly preimageSeq: HTMLElement;
  readonly preimageContent: HTMLElement;
  readonly preimageBytes: HTMLElement;
  readonly preimageDigest: HTMLElement;
}

interface Controls {
  readonly form: HTMLFormElement;
  readonly input: HTMLInputElement;
  readonly reset: HTMLButtonElement;
}

/** Builds one entry row: an editable content field plus its two hashes. */
function createRow(index: number, onEdit: (index: number, content: string) => void): Row {
  const item = el('li', {
    className: 'chain__link',
    attrs: { 'data-idea-entry': '', role: 'listitem' },
  });
  item.dataset.seq = String(index + 1);

  const badge = el('span', {
    className: 'chain__badge',
    i18n: 'idea.entry.badge',
    attrs: { 'data-entry-badge': '' },
  });
  badge.hidden = true;

  const field = el('label', { className: 'chain__field' });
  const content = el('input', {
    className: 'chain__input',
    attrs: { type: 'text', maxlength: String(MAXLENGTH), 'data-entry-content': '' },
  });
  field.append(
    el('span', { className: 'chain__field-label', i18n: 'idea.field.content' }),
    el('span', { className: 'chain__field-seq', text: `#${index + 1}` }),
    content,
  );

  const prev = el('dd', { className: 'chain__hash', attrs: { 'data-entry-prev': '' } });
  const digest = el('dd', { className: 'chain__hash', attrs: { 'data-entry-digest': '' } });
  const hashes = el('dl', { className: 'chain__hashes' });
  hashes.append(
    el('dt', { i18n: 'idea.entry.prev' }),
    prev,
    el('dt', { i18n: 'idea.entry.digest' }),
    digest,
  );

  item.append(badge, field, hashes);
  content.addEventListener('input', () => {
    onEdit(index, content.value);
  });

  return { item, content, prev, digest, badge };
}

function buildPreimagePanel(): {
  panel: HTMLElement;
  prev: HTMLElement;
  seq: HTMLElement;
  content: HTMLElement;
  bytes: HTMLElement;
  digest: HTMLElement;
} {
  const prev = el('dd', { className: 'preimage__hash', attrs: { 'data-preimage-prev': '' } });
  const seq = el('dd', { className: 'mono', attrs: { 'data-preimage-seq': '' } });
  const content = el('dd', { className: 'mono', attrs: { 'data-preimage-content': '' } });
  const bytes = el('dd', { className: 'preimage__bytes', attrs: { 'data-preimage-bytes': '' } });
  const digest = el('dd', { className: 'preimage__hash', attrs: { 'data-preimage-digest': '' } });

  const fields = el('dl', { className: 'preimage__fields' });
  fields.append(
    el('dt', { i18n: 'idea.entry.prev' }),
    prev,
    el('dt', { i18n: 'idea.entry.label' }),
    seq,
    el('dt', { i18n: 'idea.field.content' }),
    content,
    el('dt', { i18n: 'idea.preimage.bytes' }),
    bytes,
    el('dt', { i18n: 'idea.entry.digest' }),
    digest,
  );

  const panel = el('section', { className: 'preimage' });
  panel.append(
    el('h3', { className: 'preimage__title', i18n: 'idea.preimage.title' }),
    el('p', { className: 'preimage__note', i18n: 'idea.preimage.note' }),
    fields,
  );

  return { panel, prev, seq, content, bytes, digest };
}

function buildChainBuilder(body: HTMLElement): { view: ChainView; controls: Controls } {
  const formula = el('p', { className: 'chain__formula' });
  formula.append(el('code', { i18n: 'idea.formula' }));

  const input = el('input', {
    className: 'chain__input',
    attrs: { type: 'text', maxlength: String(MAXLENGTH), 'data-idea-input': '' },
  });
  const field = el('label', { className: 'chain__field chain__field--new' });
  field.append(el('span', { className: 'chain__field-label', i18n: 'idea.field.new' }), input);

  const add = el('button', {
    className: 'button button--primary',
    i18n: 'idea.add',
    attrs: { type: 'submit', 'data-idea-add': '' },
  });
  const reset = el('button', {
    className: 'button',
    i18n: 'idea.reset',
    attrs: { type: 'button', 'data-idea-reset': '' },
  });
  const form = el('form', {
    className: 'chain__form',
    attrs: { 'data-idea-form': '', novalidate: '' },
  });
  form.append(field, add, reset);

  const preimage = buildPreimagePanel();

  const noteCount = el('span', {
    className: 'mono',
    attrs: { 'data-idea-note-count': '' },
    text: '0',
  });
  const note = el('p', { className: 'chain__note', attrs: { 'aria-live': 'polite' } });
  note.dataset.ideaNote = '';
  note.append(el('span', { i18n: 'idea.note.label' }), noteCount);
  note.hidden = true;

  const list = el('ol', { className: 'chain', attrs: { 'data-idea-list': '' } });
  const countOutput = el('span', {
    className: 'mono',
    attrs: { 'data-idea-count': '' },
    text: '0',
  });
  const count = el('p', { className: 'chain__count' });
  count.append(el('span', { i18n: 'idea.count.label' }), countOutput);

  body.append(
    el('p', { className: 'prose', i18n: 'idea.lead' }),
    formula,
    form,
    preimage.panel,
    note,
    list,
    count,
    el('p', { className: 'prose', i18n: 'idea.seed.note' }),
    el('p', { className: 'prose', i18n: 'idea.limit.note' }),
    el('p', { className: 'prose chain__next', i18n: 'idea.next' }),
  );

  return {
    view: {
      list,
      countOutput,
      note,
      noteCount,
      preimagePrev: preimage.prev,
      preimageSeq: preimage.seq,
      preimageContent: preimage.content,
      preimageBytes: preimage.bytes,
      preimageDigest: preimage.digest,
    },
    controls: { form, input, reset },
  };
}

function buildIdea(body: HTMLElement): void {
  const { view, controls } = buildChainBuilder(body);

  let contents: string[] = [...SEED_CONTENTS];
  let chain: ChainLink[] = [];
  const rows: Row[] = [];
  /** Entry whose preimage the panel shows: the last one until something else is touched. */
  let focus = contents.length - 1;
  /** Guards against a slow digest landing after a newer render started. */
  let renderToken = 0;

  function ensureRows(): void {
    while (rows.length > contents.length) {
      rows.pop()?.item.remove();
    }
    while (rows.length < contents.length) {
      const index = rows.length;
      const row = createRow(index, onEdit);
      rows.push(row);
      view.list.append(row.item);
    }
  }

  function renderPreimage(): void {
    const link = chain[focus];
    if (link === undefined) {
      return;
    }
    view.preimagePrev.textContent = link.prevHash;
    view.preimageSeq.textContent = String(link.seq);
    view.preimageContent.textContent = link.content;
    view.preimageBytes.textContent = bytesToHex(
      preimageBytes(link.prevHash, link.seq, link.content),
    );
    view.preimageDigest.textContent = link.digest;
  }

  function renderRows(changed: ReadonlySet<number>): void {
    for (const [index, link] of chain.entries()) {
      const row = rows[index];
      if (row === undefined) {
        break;
      }
      if (row.content.value !== link.content) {
        row.content.value = link.content;
      }
      row.prev.textContent = link.prevHash;
      row.digest.textContent = link.digest;
      const recomputed = changed.has(index);
      row.item.dataset.recomputed = String(recomputed);
      row.badge.hidden = !recomputed;
    }
    view.countOutput.textContent = String(chain.length);
  }

  /**
   * Rebuilds the chain and repaints. `editIndex` marks the entry the visitor
   * just changed, so the entries after it can be flagged as recomputed.
   */
  async function render(editIndex: number | null): Promise<void> {
    renderToken += 1;
    const token = renderToken;
    const previous = chain;
    const rebuilt = await buildChain(contents);
    if (token !== renderToken) {
      return;
    }

    let changed: ReadonlySet<number> = EMPTY;
    if (editIndex !== null) {
      const rewritten = new Set(
        changedIndices(previous, rebuilt).filter((index) => index > editIndex),
      );
      changed = rewritten;
      view.noteCount.textContent = String(rewritten.size);
      view.note.hidden = rewritten.size === 0;
    }

    chain = rebuilt;
    ensureRows();
    renderRows(changed);
    renderPreimage();
  }

  function onEdit(index: number, content: string): void {
    contents = contents.map((value, position) => (position === index ? content : value));
    focus = index;
    view.note.hidden = true;
    void render(index);
  }

  function append(): void {
    const value = controls.input.value.trim();
    if (value === '') {
      return;
    }
    contents = [...contents, value];
    focus = contents.length - 1;
    controls.input.value = '';
    view.note.hidden = true;
    void render(null);
  }

  function reset(): void {
    contents = [...SEED_CONTENTS];
    focus = contents.length - 1;
    controls.input.value = '';
    view.note.hidden = true;
    void render(null);
  }

  controls.form.addEventListener('submit', (event) => {
    event.preventDefault();
    append();
  });
  controls.reset.addEventListener('click', reset);

  void render(null);
}

export const ideaBlock: BlockSpec = {
  num: 3,
  id: 'idea',
  titleKey: 'block.idea.title',
  build: buildIdea,
};
