import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import en from '../src/i18n/en.json';
import es from '../src/i18n/es.json';
import { setLang, t } from '../src/i18n/t';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listSourceFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Collects every translation key the application code can ask for, by scanning
 * the source for `data-i18n*="key"` attributes, `t('key')` calls and the
 * `titleKey: 'key'` fields of the block definitions.
 */
function referencedKeys(): string[] {
  const patterns = [
    /data-i18n(?:-[a-z-]+)?="([^"]+)"/g,
    /\bt\(\s*['"]([^'"]+)['"]/g,
    /\btitleKey:\s*['"]([^'"]+)['"]/g,
  ];
  const keys = new Set<string>();
  for (const file of listSourceFiles(srcDir)) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match = pattern.exec(source);
      while (match !== null) {
        const key = match[1];
        if (key !== undefined) {
          keys.add(key);
        }
        match = pattern.exec(source);
      }
    }
  }
  return [...keys].sort();
}

describe('i18n dictionaries', () => {
  it('exposes exactly the same key set in Spanish and English', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
  });

  it('contains every key referenced by the shell in both languages', () => {
    const keys = referencedKeys();
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(es, `es.json is missing "${key}"`).toHaveProperty(key);
      expect(en, `en.json is missing "${key}"`).toHaveProperty(key);
    }
  });

  it('defines a heading key for each of the nine content blocks', () => {
    const blockKeys = referencedKeys().filter((key) => key.startsWith('block.'));
    expect(blockKeys).toHaveLength(9);
  });
});

describe('t()', () => {
  it('substitutes {placeholder} variables in the active language', () => {
    setLang('es');
    expect(t('shell.progress.label', { percent: 42 })).toBe('42% leído');

    setLang('en');
    expect(t('shell.progress.label', { percent: 42 })).toBe('42% read');
  });

  it('falls back to the key itself when the key is missing', () => {
    setLang('es');
    expect(t('this.key.does.not.exist')).toBe('this.key.does.not.exist');
  });
});
