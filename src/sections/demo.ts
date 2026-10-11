/**
 * Block 5 — the lab.
 *
 * A real hash chain of plausible health-record accesses, driven entirely by
 * `src/engine`: the page builds the chain, tampers with it, verifies it,
 * computes a Merkle inclusion proof, checks anchors against a timeline and signs
 * a package with ECDSA P-256. Nothing here reimplements a digest, a proof or a
 * signature, and nothing is faked: every hash shown is the engine's output.
 *
 * The layout is a control bar, the chain, then three panels (Merkle, anchors,
 * signed export). Each control writes a plain-language statement of what
 * happened and why it was detectable, and `Verify` names the break kind, the
 * entry and the expected-vs-found hashes. Rows are marked with words as well as
 * colour, every control is a native element, and all runtime copy is repainted
 * on a language change through `onLangChange`.
 */

import type { Anchor, LedgerChain, MerkleProofNode, VerificationResult } from '../engine';
import {
  SigningUnavailableError,
  alterEntry,
  anchorRoot,
  append,
  buildExportPackage,
  createChain,
  deleteEntry,
  exportPublicKeyJwk,
  generateKeyPair,
  hasWebCrypto,
  insertEntry,
  merkleProof,
  merkleRoot,
  signPackage,
  swapEntries,
  verifyAnchor,
  verifyChain,
  verifyPackage,
  verifyProof,
} from '../engine';
import { onLangChange, t } from '../i18n/t';
import { shortHash } from './chain-model';
import { el } from './dom';
import {
  ANCHOR_EVERY,
  DEFAULT_TARGET_SEQ,
  LAB_SEED,
  MAX_RESOURCE,
  type LabEvent,
  alternateAction,
  breakKindKey,
  eventCopy,
  forgedRecord,
  formatTime,
  newRecord,
} from './demo-model';

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function hashes(chain: LedgerChain): string[] {
  return chain.map((entry) => entry.hash);
}

interface RowRefs {
  readonly item: HTMLLIElement;
  readonly seq: HTMLElement;
  readonly time: HTMLElement;
  readonly badge: HTMLElement;
  readonly actor: HTMLElement;
  readonly action: HTMLElement;
  readonly resource: HTMLElement;
  readonly prev: HTMLElement;
  readonly hash: HTMLElement;
}

function createRow(): RowRefs {
  const item = el('li', { className: 'lab__link', attrs: { 'data-demo-entry': '' } });

  const seq = el('span', { className: 'lab__seq mono' });
  const time = el('span', { className: 'lab__time mono' });
  const badge = el('span', { className: 'lab__badge', attrs: { 'data-demo-entry-badge': '' } });
  badge.hidden = true;
  const head = el('div', { className: 'lab__link-head' });
  head.append(seq, time, badge);

  const actor = el('dd', { className: 'lab__value mono' });
  const action = el('dd', { className: 'lab__value mono' });
  const resource = el('dd', { className: 'lab__value mono' });
  const fields = el('dl', { className: 'lab__fields' });
  fields.append(
    el('dt', { i18n: 'demo.entry.user' }),
    actor,
    el('dt', { i18n: 'demo.entry.action' }),
    action,
    el('dt', { i18n: 'demo.entry.resource' }),
    resource,
  );

  const prev = el('dd', { className: 'lab__hash', attrs: { 'data-demo-entry-prev': '' } });
  const hash = el('dd', { className: 'lab__hash', attrs: { 'data-demo-entry-hash': '' } });
  const hashList = el('dl', { className: 'lab__hashes' });
  hashList.append(
    el('dt', { i18n: 'demo.entry.prev' }),
    prev,
    el('dt', { i18n: 'demo.entry.hash' }),
    hash,
  );

  item.append(head, fields, hashList);
  return { item, seq, time, badge, actor, action, resource, prev, hash };
}

interface ControlRefs {
  readonly group: HTMLElement;
  readonly form: HTMLFormElement;
  readonly input: HTMLInputElement;
  readonly target: HTMLSelectElement;
  readonly alter: HTMLButtonElement;
  readonly remove: HTMLButtonElement;
  readonly swap: HTMLButtonElement;
  readonly insert: HTMLButtonElement;
  readonly verify: HTMLButtonElement;
  readonly reset: HTMLButtonElement;
}

function buildControls(): ControlRefs {
  const input = el('input', {
    className: 'lab__input',
    attrs: {
      type: 'text',
      maxlength: String(MAX_RESOURCE),
      'data-demo-new': '',
      autocomplete: 'off',
    },
  });
  input.value = 'HC-10512';
  const add = el('button', {
    className: 'button button--primary',
    i18n: 'demo.add',
    attrs: { type: 'submit', 'data-demo-add': '' },
  });
  const addField = el('label', { className: 'lab__field' });
  addField.append(el('span', { className: 'lab__field-label', i18n: 'demo.new.label' }), input);
  const form = el('form', {
    className: 'lab__add',
    attrs: { 'data-demo-add-form': '', novalidate: '' },
  });
  form.append(addField, add);

  const target = el('select', {
    className: 'lab__select',
    i18nAriaLabel: 'demo.target.label',
    attrs: { 'data-demo-target': '' },
  });
  const targetField = el('label', { className: 'lab__field lab__field--target' });
  targetField.append(
    el('span', { className: 'lab__field-label', i18n: 'demo.target.label' }),
    target,
  );

  const alter = el('button', {
    className: 'button button--tamper',
    attrs: { type: 'button', 'data-demo-alter': '' },
  });
  const remove = el('button', {
    className: 'button button--tamper',
    i18n: 'demo.delete',
    attrs: { type: 'button', 'data-demo-delete': '' },
  });
  const swap = el('button', {
    className: 'button button--tamper',
    attrs: { type: 'button', 'data-demo-swap': '' },
  });
  const insert = el('button', {
    className: 'button button--tamper',
    i18n: 'demo.insert',
    attrs: { type: 'button', 'data-demo-insert': '' },
  });
  const verify = el('button', {
    className: 'button button--primary',
    i18n: 'demo.verify',
    attrs: { type: 'button', 'data-demo-verify': '' },
  });
  const reset = el('button', {
    className: 'button',
    i18n: 'demo.reset',
    attrs: { type: 'button', 'data-demo-reset': '' },
  });

  const group = el('div', {
    className: 'lab__controls',
    i18nAriaLabel: 'demo.controls.aria',
    attrs: { role: 'group' },
  });
  group.append(form, targetField, alter, remove, swap, insert, verify, reset);

  return { group, form, input, target, alter, remove, swap, insert, verify, reset };
}

interface MerkleRefs {
  readonly root: HTMLElement;
  readonly saved: HTMLElement;
  readonly relation: HTMLElement;
  readonly leaf: HTMLSelectElement;
  readonly proof: HTMLUListElement;
  readonly privacy: HTMLElement;
  readonly check: HTMLButtonElement;
  readonly result: HTMLElement;
}

interface AnchorRefs {
  readonly capture: HTMLButtonElement;
  readonly timeline: HTMLOListElement;
  readonly summary: HTMLElement;
}

interface ExportRefs {
  readonly sign: HTMLButtonElement;
  readonly publicKey: HTMLElement;
  readonly signature: HTMLElement;
  readonly result: HTMLElement;
}

function buildVerifyPanel(): {
  panel: HTMLElement;
  summary: HTMLElement;
  breaks: HTMLUListElement;
} {
  const summary = el('p', {
    className: 'lab__verify-summary',
    attrs: { 'data-demo-verify-summary': '', 'aria-live': 'polite' },
  });
  const breaks = el('ul', { className: 'lab__breaks', attrs: { 'data-demo-breaks': '' } });
  const panel = el('section', {
    className: 'lab__verify',
    attrs: { 'data-demo-verify-panel': '' },
  });
  panel.append(
    el('h3', { className: 'lab__panel-subtitle', i18n: 'demo.verify.title' }),
    summary,
    breaks,
  );
  return { panel, summary, breaks };
}

function buildMerklePanel(): { panel: HTMLElement; refs: MerkleRefs } {
  const root = el('dd', { className: 'lab__hash', attrs: { 'data-demo-merkle-root': '' } });
  const saved = el('dd', { className: 'lab__hash', attrs: { 'data-demo-merkle-saved': '' } });
  const relation = el('p', {
    className: 'lab__value',
    attrs: { 'data-demo-merkle-relation': '' },
  });

  const leaf = el('select', {
    className: 'lab__select',
    i18nAriaLabel: 'demo.merkle.leaf',
    attrs: { 'data-demo-merkle-leaf': '' },
  });
  const proof = el('ul', { className: 'lab__proof', attrs: { 'data-demo-merkle-proof': '' } });
  const privacy = el('p', { className: 'lab__note', attrs: { 'data-demo-merkle-privacy': '' } });
  const result = el('p', {
    className: 'lab__result',
    attrs: { 'data-demo-merkle-result': '', 'aria-live': 'polite' },
  });
  const check = el('button', {
    className: 'button',
    i18n: 'demo.merkle.check',
    attrs: { type: 'button', 'data-demo-merkle-check': '' },
  });

  const leafField = el('dd', { className: 'lab__field-value' });
  leafField.append(leaf);
  const proofField = el('dd', { className: 'lab__field-value' });
  proofField.append(proof);

  const fields = el('dl', { className: 'lab__fields lab__fields--panel' });
  fields.append(
    el('dt', { i18n: 'demo.merkle.current' }),
    root,
    el('dt', { i18n: 'demo.merkle.saved' }),
    saved,
    el('dt', { i18n: 'demo.merkle.leaf' }),
    leafField,
    el('dt', { i18n: 'demo.merkle.proof' }),
    proofField,
  );

  const panel = el('section', {
    className: 'lab__panel',
    attrs: { 'data-demo-merkle-panel': '' },
  });
  panel.append(
    el('h3', { className: 'lab__panel-title', i18n: 'demo.merkle.title' }),
    el('p', { className: 'lab__note', i18n: 'demo.merkle.note' }),
    fields,
    relation,
    privacy,
    check,
    result,
  );

  return { panel, refs: { root, saved, relation, leaf, proof, privacy, check, result } };
}

function buildAnchorPanel(): { panel: HTMLElement; refs: AnchorRefs } {
  const timeline = el('ol', {
    className: 'lab__timeline',
    attrs: { 'data-demo-anchor-timeline': '' },
  });
  const summary = el('p', {
    className: 'lab__result',
    attrs: { 'data-demo-anchor-summary': '', 'aria-live': 'polite' },
  });
  const capture = el('button', {
    className: 'button',
    i18n: 'demo.anchor.capture',
    attrs: { type: 'button', 'data-demo-anchor-capture': '' },
  });

  const panel = el('section', {
    className: 'lab__panel',
    attrs: { 'data-demo-anchor-panel': '' },
  });
  panel.append(
    el('h3', { className: 'lab__panel-title', i18n: 'demo.anchor.title' }),
    el('p', { className: 'lab__note', i18n: 'demo.anchor.note' }),
    el('p', { className: 'lab__note lab__note--blind', i18n: 'demo.anchor.blindspot' }),
    capture,
    timeline,
    summary,
  );

  return { panel, refs: { capture, timeline, summary } };
}

function buildExportPanel(): { panel: HTMLElement; refs: ExportRefs } {
  const publicKey = el('pre', {
    className: 'lab__key',
    i18nAriaLabel: 'demo.export.publicKey',
    attrs: { 'data-demo-export-key': '', role: 'region', tabindex: '0' },
  });
  const signature = el('pre', {
    className: 'lab__key',
    i18nAriaLabel: 'demo.export.signature',
    attrs: { 'data-demo-export-signature': '', role: 'region', tabindex: '0' },
  });
  const result = el('p', {
    className: 'lab__result',
    attrs: { 'data-demo-export-result': '', 'aria-live': 'polite' },
  });
  const sign = el('button', {
    className: 'button button--primary',
    i18n: 'demo.export.sign',
    attrs: { type: 'button', 'data-demo-export-sign': '' },
  });

  const keyField = el('dd', { className: 'lab__field-value' });
  keyField.append(publicKey);
  const signatureField = el('dd', { className: 'lab__field-value' });
  signatureField.append(signature);

  const fields = el('dl', { className: 'lab__fields lab__fields--panel' });
  fields.append(
    el('dt', { i18n: 'demo.export.algorithm' }),
    el('dd', { className: 'lab__value mono', text: 'ECDSA-P256-SHA256' }),
    el('dt', { i18n: 'demo.export.publicKey' }),
    keyField,
    el('dt', { i18n: 'demo.export.signature' }),
    signatureField,
  );

  const panel = el('section', {
    className: 'lab__panel',
    attrs: { 'data-demo-export-panel': '' },
  });
  panel.append(
    el('h3', { className: 'lab__panel-title', i18n: 'demo.export.title' }),
    el('p', { className: 'lab__note', i18n: 'demo.export.note' }),
    sign,
    fields,
    result,
  );

  return { panel, refs: { sign, publicKey, signature, result } };
}

/* -------------------------------------------------------------------------- */
/* The lab                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Builds the lab body. Loaded on demand through `mountLazyBlock` (see
 * `src/sections/index.ts`), so this module is code-split out of the first paint.
 * Resolves once the first full paint is done, which is what the marker attribute
 * waits on.
 */
export function buildDemo(body: HTMLElement): Promise<void> {
  let chain: LedgerChain = [];
  let baselineRoot = '';
  let anchorRounds: { id: number; anchors: readonly Anchor[] }[] = [];
  let anchorRoundId = 0;

  let target = DEFAULT_TARGET_SEQ - 1;
  let merkleTarget = target;
  let merkleCheck: boolean | null = null;

  let keyPair: CryptoKeyPair | null = null;
  let signature: string | null = null;
  let publicKey: JsonWebKey | null = null;
  let exportValid: boolean | null = null;
  let exportUnavailable = false;

  let verifyResult: VerificationResult | null = null;
  let stateEvent: LabEvent = { kind: 'ready', count: 0 };
  let renderToken = 0;

  const controls = buildControls();
  const merklePanel = buildMerklePanel();
  const anchorPanel = buildAnchorPanel();
  const exportPanel = buildExportPanel();
  const verifyPanel = buildVerifyPanel();

  const statement = el('p', {
    className: 'lab__statement',
    attrs: { 'data-demo-statement': '', 'aria-live': 'polite' },
  });
  const count = el('span', { className: 'lab__count mono', attrs: { 'data-demo-count': '' } });
  const countLine = el('p', { className: 'lab__count-line' });
  countLine.append(el('span', { i18n: 'demo.count.label' }), count);
  const list = el('ol', { className: 'lab__list', attrs: { 'data-demo-list': '' } });

  const chainBlock = el('div', { className: 'lab__chain' });
  chainBlock.append(
    el('h3', { className: 'lab__panel-title', i18n: 'demo.chain.title' }),
    el('p', { className: 'lab__note', i18n: 'demo.chain.note' }),
    controls.group,
    countLine,
    statement,
    list,
  );

  body.append(
    el('p', { className: 'prose lab__lead', i18n: 'demo.lead' }),
    chainBlock,
    verifyPanel.panel,
    merklePanel.panel,
    anchorPanel.panel,
    exportPanel.panel,
  );

  const rowRefs: RowRefs[] = [];

  function ensureRows(): void {
    while (rowRefs.length > chain.length) {
      rowRefs.pop()?.item.remove();
    }
    while (rowRefs.length < chain.length) {
      const row = createRow();
      rowRefs.push(row);
      list.append(row.item);
    }
  }

  function renderRows(): void {
    rowRefs.forEach((row, index) => {
      const entry = chain[index];
      if (entry === undefined) {
        return;
      }
      row.seq.textContent = `#${entry.seq}`;
      row.time.textContent = formatTime(entry.timestamp);
      row.actor.textContent = entry.actor;
      row.action.textContent = entry.action;
      row.resource.textContent = entry.resource;
      row.prev.textContent = entry.prev;
      row.hash.textContent = entry.hash;
      row.prev.title = entry.prev;
      row.hash.title = entry.hash;
    });
  }

  function applyVerifyStates(): void {
    const firstBreak =
      verifyResult !== null && !verifyResult.ok ? (verifyResult.breaks[0]?.index ?? -1) : -1;
    rowRefs.forEach((row, index) => {
      let state: 'valid' | 'broken' | 'invalid' | '' = '';
      if (verifyResult === null) {
        state = '';
      } else if (verifyResult.ok || index < firstBreak) {
        state = 'valid';
      } else if (index === firstBreak) {
        state = 'broken';
      } else {
        state = 'invalid';
      }
      row.item.dataset.state = state;
      row.badge.hidden = state === '';
      row.badge.dataset.state = state;
      row.badge.textContent = state === '' ? '' : t(`demo.entry.state.${state}`);
    });
  }

  function syncSelect(select: HTMLSelectElement, selected: number): void {
    while (select.options.length > chain.length) {
      select.remove(select.options.length - 1);
    }
    while (select.options.length < chain.length) {
      select.append(document.createElement('option'));
    }
    [...select.options].forEach((option, index) => {
      option.value = String(index);
      option.textContent = t('demo.target.option', { seq: chain[index]?.seq ?? index + 1 });
    });
    select.value = String(clamp(selected, 0, Math.max(0, chain.length - 1)));
  }

  function renderStatement(): void {
    const copy = eventCopy(stateEvent);
    statement.textContent = t(copy.key, copy.vars);
  }

  function renderControls(): void {
    const entry = chain[target];
    const targetSeq = entry?.seq ?? 1;
    const forward = target < chain.length - 1;
    const left = forward ? target : Math.max(0, target - 1);
    const right = forward ? target + 1 : target;
    const leftSeq = chain[left]?.seq ?? targetSeq;
    const rightSeq = chain[right]?.seq ?? leftSeq;

    controls.alter.textContent = t('demo.alter', { seq: targetSeq });
    controls.swap.textContent = t('demo.swap', { seq: leftSeq, next: rightSeq });
    controls.alter.disabled = entry === undefined;
    controls.remove.disabled = entry === undefined;
    controls.insert.disabled = entry === undefined;
    controls.swap.disabled = chain.length < 2;
    controls.verify.disabled = chain.length === 0;
  }

  function renderVerifyPanel(): void {
    if (verifyResult === null) {
      verifyPanel.summary.textContent = t('demo.verify.none');
      verifyPanel.breaks.replaceChildren();
      verifyPanel.breaks.hidden = true;
      return;
    }
    if (verifyResult.ok) {
      verifyPanel.summary.textContent = t('demo.verify.intact', { count: verifyResult.checked });
      verifyPanel.breaks.replaceChildren();
      verifyPanel.breaks.hidden = true;
      return;
    }

    verifyPanel.summary.textContent = t('demo.verify.broken', {
      count: verifyResult.breaks.length,
    });
    verifyPanel.breaks.hidden = false;
    verifyPanel.breaks.replaceChildren(
      ...verifyResult.breaks.map((item) => {
        const breakItem = el('li', {
          className: 'lab__break',
          attrs: {
            'data-demo-break': '',
            'data-kind': item.kind,
            'data-index': String(item.index),
            'data-seq': String(item.seq),
          },
        });
        breakItem.append(
          el('p', { className: 'lab__break-kind', text: t(breakKindKey(item.kind)) }),
          el('p', {
            className: 'lab__break-where',
            text: t('demo.verify.where', { seq: item.seq, position: item.index + 1 }),
          }),
        );
        const pairs = el('dl', { className: 'lab__hashes lab__hashes--break' });
        pairs.append(
          el('dt', { i18n: 'demo.verify.expected' }),
          el('dd', {
            className: 'lab__hash',
            text: item.expected,
            attrs: { title: item.expected },
          }),
          el('dt', { i18n: 'demo.verify.actual' }),
          el('dd', { className: 'lab__hash', text: item.actual, attrs: { title: item.actual } }),
        );
        breakItem.append(pairs);
        return breakItem;
      }),
    );
  }

  function renderMerkleResult(): void {
    const entry = chain[merkleTarget];
    if (merkleCheck === null || entry === undefined) {
      merklePanel.refs.result.textContent = t('demo.merkle.idle');
      merklePanel.refs.result.dataset.valid = 'idle';
      return;
    }
    merklePanel.refs.result.textContent = merkleCheck
      ? t('demo.merkle.ok', { seq: entry.seq })
      : t('demo.merkle.fail', { seq: entry.seq });
    merklePanel.refs.result.dataset.valid = String(merkleCheck);
  }

  function renderExportText(): void {
    exportPanel.refs.publicKey.textContent =
      publicKey === null ? '—' : JSON.stringify(publicKey, null, 2);
    exportPanel.refs.signature.textContent = signature ?? '—';
    if (exportUnavailable) {
      exportPanel.refs.result.textContent = t('demo.export.unavailable');
      exportPanel.refs.result.dataset.valid = 'unavailable';
      return;
    }
    if (exportValid === null) {
      exportPanel.refs.result.textContent = t('demo.export.idle');
      exportPanel.refs.result.dataset.valid = 'idle';
      return;
    }
    exportPanel.refs.result.textContent = exportValid
      ? t('demo.export.valid')
      : t('demo.export.invalid');
    exportPanel.refs.result.dataset.valid = String(exportValid);
  }

  function renderText(): void {
    renderStatement();
    renderControls();
    syncSelect(controls.target, target);
    syncSelect(merklePanel.refs.leaf, merkleTarget);
    renderVerifyPanel();
    renderMerkleResult();
    renderExportText();
    count.textContent = String(chain.length);
  }

  function renderProofNode(node: MerkleProofNode): HTMLElement {
    const item = el('li', { className: 'lab__proof-node' });
    item.append(
      el('span', { className: 'lab__proof-side', text: t(`demo.merkle.side.${node.side}`) }),
      el('span', { className: 'lab__hash', text: node.hash, attrs: { title: node.hash } }),
    );
    return item;
  }

  async function refreshMerkle(token: number): Promise<void> {
    const currentHashes = hashes(chain);
    const root = await merkleRoot(currentHashes);
    if (token !== renderToken) {
      return;
    }

    merkleTarget = clamp(merkleTarget, 0, Math.max(0, chain.length - 1));
    const proof = currentHashes.length > 0 ? await merkleProof(currentHashes, merkleTarget) : [];
    if (token !== renderToken) {
      return;
    }

    merklePanel.refs.root.textContent = root;
    merklePanel.refs.root.title = root;
    merklePanel.refs.saved.textContent = baselineRoot;
    merklePanel.refs.saved.title = baselineRoot;
    merklePanel.refs.relation.textContent =
      root === baselineRoot ? t('demo.merkle.same') : t('demo.merkle.different');
    merklePanel.refs.proof.replaceChildren(...proof.map(renderProofNode));
    merklePanel.refs.privacy.textContent = t('demo.merkle.privacy', { count: proof.length });
  }

  async function refreshAnchors(token: number): Promise<void> {
    const rounds = await Promise.all(
      anchorRounds.map(async (round) => ({
        id: round.id,
        entries: await Promise.all(
          round.anchors.map(async (anchor) => ({
            anchor,
            check: await verifyAnchor(chain, anchor),
          })),
        ),
      })),
    );
    if (token !== renderToken) {
      return;
    }

    anchorPanel.refs.timeline.replaceChildren(
      ...rounds.map((round) => {
        const item = el('li', {
          className: 'lab__round',
          attrs: { 'data-anchor-round': String(round.id) },
        });
        item.append(
          el('p', {
            className: 'lab__round-title',
            text: t('demo.anchor.round', { id: round.id }),
          }),
        );
        const entries = el('ul', { className: 'lab__anchor-list' });
        for (const { anchor, check } of round.entries) {
          const entry = el('li', {
            className: 'lab__anchor',
            attrs: { 'data-anchor-entry': '', 'data-ok': String(check.ok) },
          });
          entry.append(
            el('span', {
              className: 'lab__anchor-covers',
              text: t('demo.anchor.covers', { count: anchor.entryCount, seq: anchor.atSeq }),
            }),
            el('span', {
              className: 'lab__anchor-root mono',
              text: shortHash(anchor.root, 16),
              attrs: { title: anchor.root },
            }),
            el('span', {
              className: 'lab__anchor-status',
              text: check.ok ? t('demo.anchor.ok') : t('demo.anchor.fail'),
              attrs: { 'data-anchor-status': '', 'data-ok': String(check.ok) },
            }),
          );
          entries.append(entry);
        }
        item.append(entries);
        return item;
      }),
    );

    if (rounds.length === 0) {
      anchorPanel.refs.summary.textContent = t('demo.anchor.summary.none');
      return;
    }
    const failing = rounds.find((round) => round.entries.some((entry) => !entry.check.ok));
    if (failing === undefined) {
      anchorPanel.refs.summary.textContent = t('demo.anchor.summary.all');
      return;
    }
    const latest = rounds[rounds.length - 1];
    if (
      latest !== undefined &&
      latest.id !== failing.id &&
      latest.entries.every((entry) => entry.check.ok)
    ) {
      anchorPanel.refs.summary.textContent = t('demo.anchor.summary.split', {
        old: failing.id,
        recent: latest.id,
      });
      return;
    }
    anchorPanel.refs.summary.textContent = t('demo.anchor.summary.old', { old: failing.id });
  }

  async function refreshExport(token: number): Promise<void> {
    if (signature === null || keyPair === null) {
      renderExportText();
      return;
    }
    const pkg = await buildExportPackage(chain, { every: ANCHOR_EVERY });
    if (token !== renderToken) {
      return;
    }
    exportValid = await verifyPackage(pkg, signature, keyPair.publicKey);
    if (token !== renderToken) {
      return;
    }
    renderExportText();
  }

  async function paint(): Promise<void> {
    const token = ++renderToken;
    ensureRows();
    renderRows();
    applyVerifyStates();
    renderText();
    await refreshMerkle(token);
    await refreshAnchors(token);
    await refreshExport(token);
  }

  function setChain(next: LedgerChain, event: LabEvent): void {
    chain = next;
    stateEvent = event;
    verifyResult = null;
    merkleCheck = null;
    target = clamp(target, 0, Math.max(0, chain.length - 1));
    merkleTarget = clamp(merkleTarget, 0, Math.max(0, chain.length - 1));
    void paint();
  }

  async function bootstrap(): Promise<void> {
    chain = await createChain(LAB_SEED);
    baselineRoot = await merkleRoot(hashes(chain));
    anchorRounds = [{ id: ++anchorRoundId, anchors: await anchorRoot(chain, ANCHOR_EVERY) }];
    target = clamp(DEFAULT_TARGET_SEQ - 1, 0, chain.length - 1);
    merkleTarget = target;
    stateEvent = { kind: 'ready', count: chain.length };
    await paint();
  }

  async function addEntry(): Promise<void> {
    const next = await append(chain, newRecord(controls.input.value, chain.length));
    controls.input.value = '';
    const added = next[next.length - 1];
    setChain(next, { kind: 'added', seq: added?.seq ?? next.length });
  }

  async function alter(): Promise<void> {
    const entry = chain[target];
    if (entry === undefined) {
      return;
    }
    const tail = target === chain.length - 1;
    const next = await alterEntry(chain, target, { action: alternateAction(entry.action) });
    setChain(next, { kind: 'altered', seq: entry.seq, tail });
  }

  function removeEntry(): void {
    const entry = chain[target];
    if (entry === undefined) {
      return;
    }
    setChain(deleteEntry(chain, target), { kind: 'deleted', seq: entry.seq });
  }

  function swap(): void {
    if (chain.length < 2) {
      return;
    }
    const forward = target < chain.length - 1;
    const left = forward ? target : target - 1;
    const right = forward ? target + 1 : target;
    const leftSeq = chain[left]?.seq ?? left + 1;
    const rightSeq = chain[right]?.seq ?? right + 1;
    setChain(swapEntries(chain, left, right), { kind: 'swapped', left: leftSeq, right: rightSeq });
  }

  async function insert(): Promise<void> {
    const entry = chain[target];
    if (entry === undefined) {
      return;
    }
    const next = await insertEntry(chain, target, forgedRecord(chain.length));
    setChain(next, { kind: 'inserted', seq: entry.seq });
  }

  async function verify(): Promise<void> {
    const result = await verifyChain(chain);
    verifyResult = result;
    if (result.ok) {
      stateEvent = { kind: 'verified', count: result.checked };
    } else {
      const first = result.breaks[0];
      if (first !== undefined) {
        stateEvent = {
          kind: 'verified-broken',
          seq: first.seq,
          index: first.index,
          breakKind: first.kind,
        };
      }
    }
    applyVerifyStates();
    renderText();
  }

  async function reset(): Promise<void> {
    chain = await createChain(LAB_SEED);
    baselineRoot = await merkleRoot(hashes(chain));
    anchorRounds = [{ id: ++anchorRoundId, anchors: await anchorRoot(chain, ANCHOR_EVERY) }];
    target = clamp(DEFAULT_TARGET_SEQ - 1, 0, chain.length - 1);
    merkleTarget = target;
    verifyResult = null;
    merkleCheck = null;
    keyPair = null;
    signature = null;
    publicKey = null;
    exportValid = null;
    exportUnavailable = false;
    stateEvent = { kind: 'reset' };
    await paint();
  }

  async function checkMerkle(): Promise<void> {
    const entry = chain[merkleTarget];
    if (entry === undefined) {
      return;
    }
    const proof = await merkleProof(hashes(chain), merkleTarget);
    merkleCheck = await verifyProof(proof, baselineRoot, entry.hash);
    renderMerkleResult();
  }

  async function captureAnchor(): Promise<void> {
    const anchors = await anchorRoot(chain, ANCHOR_EVERY);
    anchorRounds = [...anchorRounds, { id: ++anchorRoundId, anchors }];
    await paint();
  }

  async function sign(): Promise<void> {
    if (!hasWebCrypto()) {
      exportUnavailable = true;
      renderExportText();
      return;
    }
    try {
      const pair = await generateKeyPair();
      const pkg = await buildExportPackage(chain, { every: ANCHOR_EVERY });
      const created = await signPackage(pkg, pair.privateKey);
      keyPair = pair;
      signature = created;
      publicKey = await exportPublicKeyJwk(pair.publicKey);
      exportValid = await verifyPackage(pkg, created, pair.publicKey);
      exportUnavailable = false;
    } catch (error) {
      if (error instanceof SigningUnavailableError) {
        exportUnavailable = true;
      } else {
        throw error;
      }
    }
    renderExportText();
  }

  controls.form.addEventListener('submit', (event) => {
    event.preventDefault();
    void addEntry();
  });
  controls.alter.addEventListener('click', () => {
    void alter();
  });
  controls.remove.addEventListener('click', removeEntry);
  controls.swap.addEventListener('click', swap);
  controls.insert.addEventListener('click', () => {
    void insert();
  });
  controls.verify.addEventListener('click', () => {
    void verify();
  });
  controls.reset.addEventListener('click', () => {
    void reset();
  });
  controls.target.addEventListener('change', () => {
    target = clamp(Number(controls.target.value), 0, Math.max(0, chain.length - 1));
    renderControls();
  });
  merklePanel.refs.leaf.addEventListener('change', () => {
    merkleTarget = clamp(Number(merklePanel.refs.leaf.value), 0, Math.max(0, chain.length - 1));
    merkleCheck = null;
    void paint();
  });
  merklePanel.refs.check.addEventListener('click', () => {
    void checkMerkle();
  });
  anchorPanel.refs.capture.addEventListener('click', () => {
    void captureAnchor();
  });
  exportPanel.refs.sign.addEventListener('click', () => {
    void sign();
  });

  onLangChange(() => {
    if (body.isConnected) {
      void paint();
    }
  });

  return bootstrap();
}
