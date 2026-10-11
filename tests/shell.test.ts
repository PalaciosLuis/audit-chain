import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mountApp } from '../src/shell';

let root: HTMLElement;

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('audit-chain:lang', 'es');
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  window.localStorage.clear();
  document.documentElement.lang = 'es';
});

describe('app shell', () => {
  it('mounts the nine content blocks with visible headings', () => {
    mountApp(root);

    const headings = root.querySelectorAll('main h2');
    expect(headings).toHaveLength(9);
    for (const heading of headings) {
      const text = heading.textContent?.trim() ?? '';
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('marks the body of each block with an explicit TODO (AC-N) placeholder', () => {
    mountApp(root);

    const todos = root.querySelectorAll('main .todo');
    expect(todos).toHaveLength(9);
    for (const todo of todos) {
      expect(todo.textContent).toMatch(/^TODO \(AC-\d+\)$/);
    }
  });

  it('changes a visible string immediately when the language toggle is used', () => {
    mountApp(root);

    const heading = root.querySelector('main h2');
    expect(heading).not.toBeNull();
    const before = heading?.textContent ?? '';

    const enButton = root.querySelector<HTMLButtonElement>('button[data-lang="en"]');
    expect(enButton).not.toBeNull();
    enButton?.click();

    expect(heading?.textContent ?? '').not.toBe(before);
    expect(document.documentElement.lang).toBe('en');
  });
});
