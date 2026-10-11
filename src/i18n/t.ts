import en from './en.json';
import es from './es.json';

export type Lang = 'es' | 'en';

/** A flat key to string dictionary. Both languages share the exact same keys. */
export type Dictionary = Record<string, string>;

const dictionaries: Record<Lang, Dictionary> = { es, en };

const STORAGE_KEY = 'audit-chain:lang';
const DEFAULT_LANG: Lang = 'es';

let currentLang: Lang = DEFAULT_LANG;

export function isLang(value: unknown): value is Lang {
  return value === 'es' || value === 'en';
}

/**
 * Maps a raw language source (`es-AR`, `en-US`, ...) to one of the two
 * supported languages. Returns `undefined` when nothing matches.
 */
export function normalizeLang(value: string | null | undefined): Lang | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const lower = value.toLowerCase();
  if (lower.startsWith('es')) {
    return 'es';
  }
  if (lower.startsWith('en')) {
    return 'en';
  }
  return undefined;
}

/**
 * Resolution order, per the project spec:
 * `?lang=` in the URL, then `localStorage`, then `navigator.language`.
 * Falls back to Spanish.
 */
export function resolveLang(sources: {
  readonly search?: string | undefined;
  readonly stored?: string | null | undefined;
  readonly navigatorLanguage?: string | undefined;
}): Lang {
  const params = new URLSearchParams(sources.search ?? '');
  return (
    normalizeLang(params.get('lang')) ??
    normalizeLang(sources.stored) ??
    normalizeLang(sources.navigatorLanguage) ??
    DEFAULT_LANG
  );
}

export function getLang(): Lang {
  return currentLang;
}

function readStoredLang(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Keeps the language-dependent document metadata in sync with the active
 * language: the `lang` attribute, the page title and the meta description.
 * The static HTML ships Spanish as the no-JS fallback; this runs as soon as
 * JavaScript boots and on every language change.
 */
function syncDocumentMeta(): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.lang = currentLang;
  document.title = t('doc.title');

  const description = document.querySelector('meta[name="description"]');
  if (description !== null) {
    description.setAttribute('content', t('doc.description'));
  }
}

/** Resolves the initial language from URL, storage and the browser, without persisting it. */
export function initLang(): Lang {
  currentLang = resolveLang({
    search: typeof window === 'undefined' ? '' : window.location.search,
    stored: readStoredLang(),
    navigatorLanguage: typeof navigator === 'undefined' ? undefined : navigator.language,
  });
  syncDocumentMeta();
  return currentLang;
}

/**
 * Activates a language immediately and, unless `persist` is disabled, writes the
 * choice back to both `localStorage` and the `?lang=` query parameter.
 */
export function setLang(lang: Lang, options: { persist?: boolean } = {}): void {
  currentLang = lang;
  syncDocumentMeta();

  if (options.persist === false) {
    return;
  }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, lang);
    }
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('lang', lang);
      window.history.replaceState(null, '', url);
    }
  } catch {
    // Persistence is best-effort; the in-memory choice still applies.
  }
}

/**
 * Tiny translator. Looks the key up in the active dictionary, falls back to
 * Spanish and finally to the key itself, then substitutes `{placeholder}` vars.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const dictionary = dictionaries[currentLang];
  const template = dictionary[key] ?? dictionaries[DEFAULT_LANG][key] ?? key;

  if (vars === undefined) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = vars[name];
    return value === undefined ? placeholder : String(value);
  });
}
