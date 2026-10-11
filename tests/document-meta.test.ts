import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import en from '../src/i18n/en.json';
import es from '../src/i18n/es.json';
import { initLang, setLang } from '../src/i18n/t';

/**
 * The page title and the meta description are visible copy, so they follow the
 * active language like everything else. Regression guard: switching to English
 * used to leave `document.title` in Spanish.
 */
let description: HTMLMetaElement;

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('audit-chain:lang', 'es');
  description = document.createElement('meta');
  description.setAttribute('name', 'description');
  document.head.append(description);
});

afterEach(() => {
  description.remove();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('language-dependent document metadata', () => {
  it('applies the Spanish title and description on init', () => {
    initLang();

    expect(document.documentElement.lang).toBe('es');
    expect(document.title).toBe(es['doc.title']);
    expect(description.getAttribute('content')).toBe(es['doc.description']);
  });

  it('follows the language toggle', () => {
    initLang();
    setLang('en');

    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe(en['doc.title']);
    expect(document.title).not.toBe(es['doc.title']);
    expect(description.getAttribute('content')).toBe(en['doc.description']);
  });

  it('does not fail when the document has no description meta tag', () => {
    description.remove();

    expect(() => setLang('en')).not.toThrow();
    expect(document.title).toBe(en['doc.title']);
  });
});
