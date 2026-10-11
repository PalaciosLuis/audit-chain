import { t } from '../i18n/t';

/** Declarative description of one element, so blocks stay readable. */
export interface ElementOptions {
  readonly className?: string;
  /** Literal, language-neutral text (data, numbers, hashes). */
  readonly text?: string;
  /** Translation key: the shell re-renders the element on a language change. */
  readonly i18n?: string;
  /** Translation key for `aria-label`, same re-render rule. */
  readonly i18nAriaLabel?: string;
  readonly attrs?: Readonly<Record<string, string>>;
}

/**
 * Creates one element.
 *
 * `i18n` and `i18nAriaLabel` mark the node so the shell's `applyTranslations()`
 * keeps it in the active language; the key is looked up through `t()` with the
 * same fallback chain as everywhere else. Hashes and other data go through
 * `text` and are never translated.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (options.className !== undefined) {
    node.className = options.className;
  }
  if (options.i18n !== undefined) {
    node.dataset.i18n = options.i18n;
    node.textContent = t(options.i18n);
  }
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  if (options.i18nAriaLabel !== undefined) {
    node.dataset.i18nAriaLabel = options.i18nAriaLabel;
    node.setAttribute('aria-label', t(options.i18nAriaLabel));
  }
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    node.setAttribute(name, value);
  }

  return node;
}
