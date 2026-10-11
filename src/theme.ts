export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'audit-chain:theme';
const DEFAULT_THEME: Theme = 'dark';

export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

/**
 * Resolution order: stored explicit choice, then the operating system
 * preference (`prefers-color-scheme`). Dark is the page default.
 */
export function resolveTheme(sources: {
  readonly stored?: string | null;
  readonly prefersLight?: boolean;
}): Theme {
  if (isTheme(sources.stored)) {
    return sources.stored;
  }
  if (sources.prefersLight === true) {
    return 'light';
  }
  return DEFAULT_THEME;
}

function readStoredTheme(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function systemPrefersLight(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  );
}

function apply(theme: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
  }
}

export function initTheme(): Theme {
  const theme = resolveTheme({ stored: readStoredTheme(), prefersLight: systemPrefersLight() });
  apply(theme);
  return theme;
}

export function setTheme(theme: Theme, options: { persist?: boolean } = {}): void {
  apply(theme);

  if (options.persist === false) {
    return;
  }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, theme);
    }
  } catch {
    // Persistence is best-effort.
  }
}
