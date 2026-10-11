import type { BlockSpec } from './base';
import { el } from './dom';

/**
 * Block 4 — the comparison.
 *
 * Four ways to protect an audit log, scored on what each one actually proves,
 * what it does not prevent, how keys are managed, what it costs and how complex
 * it is to run. The columns are the same for every option, so a reader can
 * compare like with like; the hash-chain row is marked as the recommended
 * option for an audit log *and* states its limitation (a truncated tail still
 * verifies, which is why the root gets anchored and signed).
 *
 * Copy lives in the dictionaries; the table is a real `<table>` with column
 * headers, row headers and a caption, inside a scroll region that a keyboard
 * user can focus and scroll.
 */

interface Option {
  /** Translation key of the row header. */
  readonly id: string;
  /** Translation keys of the five cells, in column order. */
  readonly cells: readonly string[];
}

const COLUMNS: readonly string[] = [
  'comparison.col.proves',
  'comparison.col.blind',
  'comparison.col.keys',
  'comparison.col.cost',
  'comparison.col.complexity',
];

const OPTIONS: readonly Option[] = [
  {
    id: 'comparison.row.permissions',
    cells: [
      'comparison.cell.permissions.proves',
      'comparison.cell.permissions.blind',
      'comparison.cell.permissions.keys',
      'comparison.cell.permissions.cost',
      'comparison.cell.permissions.complexity',
    ],
  },
  {
    id: 'comparison.row.signatures',
    cells: [
      'comparison.cell.signatures.proves',
      'comparison.cell.signatures.blind',
      'comparison.cell.signatures.keys',
      'comparison.cell.signatures.cost',
      'comparison.cell.signatures.complexity',
    ],
  },
  {
    id: 'comparison.row.chain',
    cells: [
      'comparison.cell.chain.proves',
      'comparison.cell.chain.blind',
      'comparison.cell.chain.keys',
      'comparison.cell.chain.cost',
      'comparison.cell.chain.complexity',
    ],
  },
  {
    id: 'comparison.row.blockchain',
    cells: [
      'comparison.cell.blockchain.proves',
      'comparison.cell.blockchain.blind',
      'comparison.cell.blockchain.keys',
      'comparison.cell.blockchain.cost',
      'comparison.cell.blockchain.complexity',
    ],
  },
];

/** The hash chain is where the chain row sits, and the one this page recommends. */
const BEST_OPTION_ID = 'comparison.row.chain';

function buildComparison(body: HTMLElement): void {
  const table = el('table', { className: 'compare', attrs: { 'data-compare-table': '' } });

  const headRow = el('tr');
  headRow.append(
    el('th', { i18n: 'comparison.col.option', attrs: { scope: 'col' } }),
    ...COLUMNS.map((key) => el('th', { i18n: key, attrs: { scope: 'col' } })),
  );
  const thead = el('thead');
  thead.append(headRow);

  const tbody = el('tbody');
  for (const option of OPTIONS) {
    const row = el('tr');
    if (option.id === BEST_OPTION_ID) {
      row.className = 'compare__row--best';
    }
    row.append(el('th', { i18n: option.id, attrs: { scope: 'row' } }));
    for (const key of option.cells) {
      row.append(el('td', { i18n: key }));
    }
    tbody.append(row);
  }

  table.append(el('caption', { i18n: 'comparison.table.caption' }), thead, tbody);

  const scroll = el('div', {
    className: 'table-scroll',
    i18nAriaLabel: 'comparison.table.scroll',
    attrs: { role: 'region', tabindex: '0', 'data-compare-scroll': '' },
  });
  scroll.append(table);

  body.append(
    el('p', { className: 'prose', i18n: 'comparison.lead' }),
    scroll,
    el('p', { className: 'prose prose--rule', i18n: 'comparison.footnote' }),
  );
}

export const comparisonBlock: BlockSpec = {
  num: 4,
  id: 'comparison',
  titleKey: 'block.comparison.title',
  build: buildComparison,
};
