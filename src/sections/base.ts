import { t } from '../i18n/t';

/**
 * Static description of one of the nine didactic blocks. Each block module
 * exports one `BlockSpec`; the shell turns it into a `<section>`.
 */
export interface BlockSpec {
  /** 1-based position, rendered as "01".."09". */
  readonly num: number;
  /** Stable DOM id and URL fragment. */
  readonly id: string;
  /** Translation key for the block heading. */
  readonly titleKey: string;
  /** Explicit placeholder marker for the body, filled in by a later task. */
  readonly todo: string;
}

export function createBlock(spec: BlockSpec): HTMLElement {
  const section = document.createElement('section');
  section.className = 'block';
  section.id = spec.id;
  section.setAttribute('aria-labelledby', `${spec.id}-title`);

  const head = document.createElement('header');
  head.className = 'block__head';

  const num = document.createElement('span');
  num.className = 'block__num';
  num.setAttribute('aria-hidden', 'true');
  num.textContent = String(spec.num).padStart(2, '0');

  const title = document.createElement('h2');
  title.className = 'block__title';
  title.id = `${spec.id}-title`;
  title.dataset.i18n = spec.titleKey;
  title.textContent = t(spec.titleKey);

  head.append(num, title);

  const todo = document.createElement('p');
  todo.className = 'todo';
  todo.textContent = spec.todo;

  section.append(head, todo);
  return section;
}
