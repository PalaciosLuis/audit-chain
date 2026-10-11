import type { BlockSpec } from './base';
import { el, type ElementOptions } from './dom';

/**
 * Block 2 — the problem.
 *
 * One access log over health records, shown exactly as the attacker left it:
 * six rows, nothing flagged, every query still answering. The toggle reveals
 * what actually happened — one row deleted and one cell rewritten — and the
 * table keeps its shape, because that is the whole point: a log without a hash
 * chain looks identical before and after tampering.
 *
 * The evidence is marked with words as well as colour (`fila borrada`,
 * `celda editada`, struck-through original value), so the meaning survives
 * without colour vision. The reveal control is a native `<button aria-pressed>`
 * whose accessible name is its own visible label; the inactive label span is
 * hidden so it never leaks into that name.
 */

interface LogRow {
  readonly time: string;
  readonly actor: string;
  readonly record: string;
  /** Translation key of the action, so the column follows the language. */
  readonly action: string;
  /** This row no longer exists in the table, although the access happened. */
  readonly deleted?: boolean;
  /** The action of this row was rewritten; the original is kept as evidence. */
  readonly modified?: boolean;
}

const COLUMNS: readonly string[] = [
  'problem.col.time',
  'problem.col.actor',
  'problem.col.action',
  'problem.col.resource',
];

/**
 * Seven accesses happened. The table below shows six of them: the 11:47 row was
 * deleted and the 10:41 action was rewritten from "exportación" to "lectura".
 * Every event happened on 2 March 2026 at Hospital Norte.
 */
const ACCESS_LOG: readonly LogRow[] = [
  {
    time: '09:14',
    actor: 'a.ruiz@hospitalnorte',
    record: 'HC-10231',
    action: 'problem.action.read',
  },
  {
    time: '09:22',
    actor: 'enfermeria.t1@hospitalnorte',
    record: 'HC-10442',
    action: 'problem.action.read',
  },
  {
    time: '10:05',
    actor: 'facturacion@hospitalnorte',
    record: 'HC-10231',
    action: 'problem.action.read',
  },
  {
    time: '10:41',
    actor: 'investigacion@hospitalnorte',
    record: 'HC-10908',
    action: 'problem.action.read',
    modified: true,
  },
  {
    time: '11:03',
    actor: 'auditoria@hospitalnorte',
    record: 'HC-10231',
    action: 'problem.action.read',
  },
  {
    time: '11:47',
    actor: 'soporte.externo@vendor',
    record: 'HC-10231',
    action: 'problem.action.read',
    deleted: true,
  },
  {
    time: '12:12',
    actor: 'm.sosa@hospitalnorte',
    record: 'HC-10777',
    action: 'problem.action.read',
  },
];

function cell(options: ElementOptions, tag: 'td' | 'th' = 'td'): HTMLTableCellElement {
  return el(tag, options);
}

interface BuiltRow {
  readonly element: HTMLTableRowElement;
  /** Nodes that only exist in the revealed state. */
  readonly evidence: readonly HTMLElement[];
}

function buildRow(row: LogRow): BuiltRow {
  const tr = el('tr');
  const evidence: HTMLElement[] = [];

  if (row.deleted === true) {
    tr.dataset.evidence = 'deleted';
    tr.className = 'log__row--deleted';
    tr.hidden = true;
    evidence.push(tr);
  }

  const action = cell({});
  action.append(el('span', { i18n: row.action }));

  if (row.modified === true) {
    const original = el('span', {
      className: 'log__original',
      attrs: { 'data-evidence': 'modified' },
    });
    original.append(
      el('s', { i18n: 'problem.action.export' }),
      el('span', { className: 'evidence', i18n: 'problem.badge.modified' }),
    );
    original.hidden = true;
    action.append(original);
    evidence.push(original);
  }

  if (row.deleted === true) {
    action.append(el('span', { className: 'evidence', i18n: 'problem.badge.deleted' }));
  }

  tr.append(
    cell({ className: 'mono', text: row.time }),
    cell({ className: 'mono', text: row.actor }),
    action,
    cell({ className: 'mono', text: row.record }),
  );

  return { element: tr, evidence };
}

function buildProblem(body: HTMLElement): void {
  const lead = el('p', { className: 'prose', i18n: 'problem.lead' });

  const toggle = el('button', {
    className: 'log__toggle',
    attrs: { type: 'button', 'data-reveal': '', 'aria-pressed': 'false' },
  });
  const showLabel = el('span', { className: 'log__toggle-on', i18n: 'problem.reveal.show' });
  const hideLabel = el('span', { className: 'log__toggle-off', i18n: 'problem.reveal.hide' });
  // The inactive span is hidden for real, not only with CSS: it must never leak
  // into the accessible name, which is the visible label itself.
  hideLabel.hidden = true;
  toggle.append(showLabel, hideLabel);

  const summary = el('p', { className: 'log__summary', attrs: { 'aria-live': 'polite' } });
  const intactSummary = el('span', { i18n: 'problem.summary.intact' });
  const revealedSummary = el('span', { i18n: 'problem.summary.revealed' });
  intactSummary.dataset.problemSummary = 'intact';
  revealedSummary.dataset.problemSummary = 'revealed';
  revealedSummary.hidden = true;
  summary.append(intactSummary, revealedSummary);

  const table = el('table', { className: 'log__table', attrs: { 'data-problem-table': '' } });
  const headRow = el('tr');
  headRow.append(...COLUMNS.map((key) => cell({ i18n: key, attrs: { scope: 'col' } }, 'th')));
  const thead = el('thead');
  thead.append(headRow);
  const tbody = el('tbody');
  const built = ACCESS_LOG.map((row) => buildRow(row));
  tbody.append(...built.map((row) => row.element));
  table.append(el('caption', { i18n: 'problem.log.caption' }), thead, tbody);

  const scroll = el('div', {
    className: 'table-scroll',
    i18nAriaLabel: 'problem.table.aria',
    attrs: { role: 'region', tabindex: '0' },
  });
  scroll.append(table);

  const findings = el('ul', { className: 'log__findings' });
  findings.dataset.problemFindings = '';
  findings.append(
    el('li', { i18n: 'problem.finding.deleted' }),
    el('li', { i18n: 'problem.finding.modified' }),
  );
  findings.hidden = true;

  const point = el('p', { className: 'prose', i18n: 'problem.finding.point' });
  const bridge = el('p', { className: 'prose', i18n: 'problem.finding.contrast' });

  body.append(lead, toggle, summary, scroll, findings, point, bridge);

  const evidence = built.flatMap((row) => row.evidence);

  toggle.addEventListener('click', () => {
    const revealed = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', String(revealed));
    body.dataset.revealed = String(revealed);

    showLabel.hidden = revealed;
    hideLabel.hidden = !revealed;

    for (const node of evidence) {
      node.hidden = !revealed;
    }
    intactSummary.hidden = revealed;
    revealedSummary.hidden = !revealed;
    findings.hidden = !revealed;
  });
}

export const problemBlock: BlockSpec = {
  num: 2,
  id: 'problem',
  titleKey: 'block.problem.title',
  build: buildProblem,
};
