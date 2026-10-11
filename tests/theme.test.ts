import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTheme, isTheme, resolveTheme, setTheme } from '../src/theme';

const STORAGE_KEY = 'audit-chain:theme';

/**
 * `src/theme.ts` decides the page theme from `localStorage`, then from the
 * operating-system preference, and falls back to dark. These tests pin the
 * resolution order, the explicit override and the defensive guards for
 * environments without `window`, `document` or `localStorage`.
 */

function mockMatchMedia(matches: boolean): void {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches,
  } as unknown as MediaQueryList);
}

function removeMatchMedia(): () => void {
  const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  Object.defineProperty(window, 'matchMedia', { value: undefined, configurable: true });
  return () => {
    if (original !== undefined) {
      Object.defineProperty(window, 'matchMedia', original);
    }
  };
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('isTheme', () => {
  it('accepts only the two supported themes', () => {
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('light')).toBe(true);
    expect(isTheme('system')).toBe(false);
    expect(isTheme(undefined)).toBe(false);
    expect(isTheme('')).toBe(false);
  });
});

describe('resolveTheme', () => {
  it('prefers the stored explicit choice', () => {
    expect(resolveTheme({ stored: 'dark', prefersLight: true })).toBe('dark');
    expect(resolveTheme({ stored: 'light', prefersLight: false })).toBe('light');
  });

  it('falls back to the system preference when nothing is stored', () => {
    expect(resolveTheme({ stored: null, prefersLight: true })).toBe('light');
    expect(resolveTheme({ stored: null, prefersLight: false })).toBe('dark');
  });

  it('ignores an invalid stored value', () => {
    expect(resolveTheme({ stored: 'sepia', prefersLight: true })).toBe('light');
    expect(resolveTheme({ stored: 'sepia', prefersLight: false })).toBe('dark');
  });

  it('defaults to dark when no signal is available', () => {
    expect(resolveTheme({})).toBe('dark');
  });
});

describe('initTheme', () => {
  it('applies a stored light theme', () => {
    window.localStorage.setItem(STORAGE_KEY, 'light');
    mockMatchMedia(false);

    expect(initTheme()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('lets the stored theme override the system preference', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark');
    mockMatchMedia(true);

    expect(initTheme()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('uses the light system preference when nothing is stored', () => {
    mockMatchMedia(true);

    expect(initTheme()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('falls back to dark when the system prefers dark', () => {
    mockMatchMedia(false);

    expect(initTheme()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('treats an invalid stored value as absent', () => {
    window.localStorage.setItem(STORAGE_KEY, 'sepia');
    mockMatchMedia(true);

    expect(initTheme()).toBe('light');
  });

  it('falls back to dark when matchMedia is unavailable', () => {
    const restore = removeMatchMedia();
    try {
      expect(initTheme()).toBe('dark');
    } finally {
      restore();
    }
  });

  it('does not throw when reading storage fails', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('storage disabled');
      },
    });
    mockMatchMedia(true);

    expect(initTheme()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('resolves dark without a window or storage', () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('localStorage', undefined);

    expect(initTheme()).toBe('dark');
  });
});

describe('setTheme', () => {
  it('applies the theme and persists it by default', () => {
    setTheme('light');

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('light');
  });

  it('applies without persisting when asked not to', () => {
    setTheme('light', { persist: false });

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('does not throw when writing storage fails', () => {
    vi.stubGlobal('localStorage', {
      setItem() {
        throw new Error('storage disabled');
      },
    });

    expect(() => setTheme('light')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('does not throw without localStorage', () => {
    vi.stubGlobal('localStorage', undefined);

    expect(() => setTheme('dark')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('applies safely without a document', () => {
    vi.stubGlobal('document', undefined);

    expect(() => setTheme('light', { persist: false })).not.toThrow();
  });

  it('resolves without a document', () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('localStorage', undefined);

    expect(initTheme()).toBe('dark');
  });
});
