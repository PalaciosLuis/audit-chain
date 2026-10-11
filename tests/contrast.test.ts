import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * WCAG 2.x contrast invariant.
 *
 * This is the regression guard for the accessibility defect found during review:
 * the light theme and the faint-dark text tokens did not reach the 4.5:1 AA
 * threshold on the surfaces they are actually painted on. Token values alone are
 * not enough to prove that, because the page body paints a radial accent tint
 * (`base.css`) and several callouts paint translucent surfaces on top of it, so
 * the test composites every layer exactly like the browser does and only then
 * measures the ratio.
 *
 * It reads the real `tokens.css` and `base.css`, so changing a hex value or the
 * tint alpha re-runs the math. Every text pair below is traceable to a selector
 * in `base.css`; the pairs that set `color` directly are cross-checked against
 * the parsed stylesheet so the matrix cannot silently drift from reality.
 */

const here = dirname(fileURLToPath(import.meta.url));
const stylesDir = resolve(here, '../src/styles');

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const tokensCss = stripComments(readFileSync(resolve(stylesDir, 'tokens.css'), 'utf8'));
const baseCss = stripComments(readFileSync(resolve(stylesDir, 'base.css'), 'utf8'));

/** sRGB color: 0-255 channels and an alpha in [0, 1]. */
type Rgba = readonly [number, number, number, number];

function parseHex(hex: string): Rgba {
  const value = hex.slice(1);
  const full =
    value.length === 3
      ? value
          .split('')
          .map((digit) => `${digit}${digit}`)
          .join('')
      : value;
  const channels = [0, 2, 4].map((index) => Number.parseInt(full.slice(index, index + 2), 16));
  const [r, g, b] = channels;
  if (r === undefined || g === undefined || b === undefined || channels.some(Number.isNaN)) {
    throw new Error(`Unsupported hex color: ${hex}`);
  }
  return [r, g, b, 1];
}

function parseColor(raw: string): Rgba {
  const value = raw.trim();
  if (value.startsWith('#')) {
    return parseHex(value);
  }
  const match = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (match === null) {
    throw new Error(`Unsupported color value: ${raw}`);
  }
  const parts = (match[1] ?? '').split(',').map((part) => Number.parseFloat(part.trim()));
  const [r, g, b, a] = parts;
  if (r === undefined || g === undefined || b === undefined) {
    throw new Error(`Incomplete color value: ${raw}`);
  }
  return [r, g, b, a ?? 1];
}

/** Returns the declaration body of the first `selector { ... }` block. */
function extractBlock(css: string, selector: string): string {
  const marker = `${selector} {`;
  const start = css.indexOf(marker);
  if (start === -1) {
    throw new Error(`Selector not found in stylesheet: ${selector}`);
  }
  const open = start + marker.length - 1;
  const close = css.indexOf('}', open);
  if (close === -1) {
    throw new Error(`Unclosed block for selector: ${selector}`);
  }
  return css.slice(open + 1, close);
}

/** Parses every `--color-*` token in a block into an `Rgba` value. */
function parseColorTokens(block: string): Map<string, Rgba> {
  const tokens = new Map<string, Rgba>();
  const declaration = /(--color-[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  for (const match of block.matchAll(declaration)) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) {
      tokens.set(name, parseColor(value));
    }
  }
  return tokens;
}

const darkTokens = parseColorTokens(extractBlock(tokensCss, ':root'));
const lightTokens = parseColorTokens(extractBlock(tokensCss, ':root[data-theme="light"]'));
const mediaLightTokens = parseColorTokens(extractBlock(tokensCss, ':root:not([data-theme])'));

function mustToken(tokens: Map<string, Rgba>, name: string): Rgba {
  const value = tokens.get(name);
  if (value === undefined) {
    throw new Error(`Missing color token ${name}`);
  }
  return value;
}

/** Alpha-composites `fg` over an opaque `bg`, returning an opaque color. */
function composite(fg: Rgba, bg: Rgba): Rgba {
  const alpha = fg[3];
  return [
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
    1,
  ];
}

function linearize(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: Rgba): number {
  return 0.2126 * linearize(color[0]) + 0.7152 * linearize(color[1]) + 0.0722 * linearize(color[2]);
}

function contrastRatio(a: Rgba, b: Rgba): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/**
 * Builds the surfaces text is actually painted on. `base.css` paints a radial
 * `--color-accent-soft` tint over the page background, so the "under the accent
 * tint" entries composite that gradient's strongest stop and then stack the
 * translucent callout surfaces on top of it.
 */
function buildSurfaces(tokens: Map<string, Rgba>) {
  const background = mustToken(tokens, '--color-bg');
  const elevated = mustToken(tokens, '--color-bg-elevated');
  const raised = mustToken(tokens, '--color-bg-raised');
  const inset = mustToken(tokens, '--color-bg-inset');
  const accentSoft = mustToken(tokens, '--color-accent-soft');
  const surface = mustToken(tokens, '--color-surface');
  const surfaceHover = mustToken(tokens, '--color-surface-hover');
  const integritySoft = mustToken(tokens, '--color-integrity-soft');
  const tintedBackground = composite(accentSoft, background);

  return {
    background,
    elevated,
    raised,
    inset,
    'background under the accent tint': tintedBackground,
    'surface under the accent tint': composite(surface, tintedBackground),
    'hover surface under the accent tint': composite(surfaceHover, tintedBackground),
    'integrity wash over the background': composite(integritySoft, background),
    'integrity wash under the accent tint': composite(integritySoft, tintedBackground),
    'integrity wash over elevated': composite(integritySoft, elevated),
    'surface over elevated': composite(surface, elevated),
    'hover surface over elevated': composite(surfaceHover, elevated),
    'accent wash over elevated': composite(accentSoft, elevated),
  };
}

type Surfaces = ReturnType<typeof buildSurfaces>;
type SurfaceName = keyof Surfaces;

/** Every design-system color that is painted as text somewhere in the page. */
const TEXT_TOKENS = [
  '--color-text',
  '--color-text-muted',
  '--color-text-faint',
  '--color-integrity',
  '--color-tampered',
  '--color-tampered-strong',
  '--color-accent',
] as const;

/** The four opaque surfaces plus the tinted page background. */
const BASE_SURFACES = [
  'background',
  'elevated',
  'raised',
  'inset',
  'background under the accent tint',
] as const satisfies readonly SurfaceName[];

interface TextPair {
  readonly label: string;
  readonly fg: string;
  readonly surface: SurfaceName;
  /** Selector in `base.css` that sets `color`; cross-checked when present. */
  readonly selector?: string;
}

const SYSTEMATIC_PAIRS: readonly TextPair[] = TEXT_TOKENS.flatMap((fg) =>
  BASE_SURFACES.map((surface) => ({ label: `${fg} on ${surface}`, fg, surface })),
);

/** Real usages that paint something translucent under the text. */
const OVERLAY_PAIRS: readonly TextPair[] = [
  {
    label: '.side-index__title (faint on the tinted page)',
    fg: '--color-text-faint',
    surface: 'background under the accent tint',
    selector: '.side-index__title',
  },
  {
    label: '.side-index__progress-label (faint on the tinted page)',
    fg: '--color-text-faint',
    surface: 'background under the accent tint',
    selector: '.side-index__progress-label',
  },
  {
    label: '.side-index__num (faint on the tinted page)',
    fg: '--color-text-faint',
    surface: 'background under the accent tint',
    selector: '.side-index__num',
  },
  {
    label: '.side-index__link (muted on the tinted page)',
    fg: '--color-text-muted',
    surface: 'background under the accent tint',
    selector: '.side-index__link',
  },
  {
    label: '.side-index__link.is-active (text on its own surface under the tint)',
    fg: '--color-text',
    surface: 'surface under the accent tint',
    selector: '.side-index__link.is-active',
  },
  {
    label: '.todo (faint on a translucent surface under the tint)',
    fg: '--color-text-faint',
    surface: 'surface under the accent tint',
    selector: '.todo',
  },
  {
    label: '.block__num (integrity on an integrity wash under the tint)',
    fg: '--color-integrity',
    surface: 'integrity wash under the accent tint',
    selector: '.block__num',
  },
  {
    label: '.honesty (muted on an integrity wash over elevated)',
    fg: '--color-text-muted',
    surface: 'integrity wash over elevated',
    selector: '.honesty',
  },
  {
    label: '.skip-link (text on elevated)',
    fg: '--color-text',
    surface: 'elevated',
    selector: '.skip-link',
  },
  {
    label: '.brand::before (integrity on elevated)',
    fg: '--color-integrity',
    surface: 'elevated',
    selector: '.brand::before',
  },
  {
    label: '.toggle-button (muted on a translucent surface over elevated)',
    fg: '--color-text-muted',
    surface: 'surface over elevated',
    selector: '.toggle-button',
  },
  {
    label: '.toggle-button:hover (text on the hover surface over elevated)',
    fg: '--color-text',
    surface: 'hover surface over elevated',
    selector: '.toggle-button:hover',
  },
  {
    label: '.toggle-button[aria-pressed] (text on the accent wash over elevated)',
    fg: '--color-text',
    surface: 'accent wash over elevated',
    selector: '.toggle-button[aria-pressed="true"]',
  },
  {
    label: '.block__title (inherited text on the tinted page)',
    fg: '--color-text',
    surface: 'background under the accent tint',
  },
  {
    label: '.prose (muted body copy on the tinted page)',
    fg: '--color-text-muted',
    surface: 'background under the accent tint',
    selector: '.prose',
  },
  {
    label: '.hero__caption (text on the hero panel)',
    fg: '--color-text',
    surface: 'elevated',
    selector: '.hero__caption',
  },
  {
    label: '.hero__note (muted on the hero panel)',
    fg: '--color-text-muted',
    surface: 'elevated',
    selector: '.hero__note',
  },
  {
    label: '.hero__hash (muted prefix on a link card)',
    fg: '--color-text-muted',
    surface: 'raised',
    selector: '.hero__hash',
  },
  {
    label: '.hero__flag (integrity tick on a link card)',
    fg: '--color-integrity',
    surface: 'raised',
    selector: '.hero__flag',
  },
  {
    label: '.hero__link[data-role="altered"] .hero__flag (tampered cross on a link card)',
    fg: '--color-tampered',
    surface: 'raised',
    selector: '.hero__link[data-role="altered"] .hero__flag',
  },
  {
    label: '.hero__next (accent link on the tinted page)',
    fg: '--color-accent',
    surface: 'background under the accent tint',
    selector: '.hero__next',
  },
  {
    label: '.log__summary (muted summary on the tinted page)',
    fg: '--color-text-muted',
    surface: 'background under the accent tint',
    selector: '.log__summary',
  },
  {
    label: '[data-revealed="true"] .log__summary (text summary on the tinted page)',
    fg: '--color-text',
    surface: 'background under the accent tint',
    selector: '[data-revealed="true"] .log__summary',
  },
  {
    label: '.log__original (faint struck-through value on the table)',
    fg: '--color-text-faint',
    surface: 'elevated',
    selector: '.log__original',
  },
  {
    label: '.evidence (tampered badge on its raised chip)',
    fg: '--color-tampered',
    surface: 'raised',
    selector: '.evidence',
  },
  {
    label: '.log__findings li (text inside a tampered finding)',
    fg: '--color-text',
    surface: 'raised',
    selector: '.log__findings li',
  },
  {
    label: '.chain__field-label (muted field label on the tinted page)',
    fg: '--color-text-muted',
    surface: 'background under the accent tint',
    selector: '.chain__field-label',
  },
  {
    label: '.chain__input (typed content on the inset field)',
    fg: '--color-text',
    surface: 'inset',
    selector: '.chain__input',
  },
  {
    label: '.preimage__hash (digest on the preimage panel)',
    fg: '--color-text',
    surface: 'raised',
    selector: '.preimage__hash',
  },
  {
    label: '.preimage__bytes (canonical bytes on the inset block)',
    fg: '--color-text-muted',
    surface: 'inset',
    selector: '.preimage__bytes',
  },
  {
    label: '.chain__badge (recomputed badge on its chip)',
    fg: '--color-accent',
    surface: 'inset',
    selector: '.chain__badge',
  },
  {
    label: '.chain__hash (entry hashes on a chain card)',
    fg: '--color-text',
    surface: 'raised',
    selector: '.chain__hash',
  },
  {
    label: '.button (button label on its raised surface)',
    fg: '--color-text',
    surface: 'raised',
    selector: '.button',
  },
  {
    label: '.table-scroll thead th (column header on the raised header row)',
    fg: '--color-text',
    surface: 'raised',
    selector: '.table-scroll thead th',
  },
  {
    label: '.table-scroll caption (caption on the table surface)',
    fg: '--color-text-muted',
    surface: 'elevated',
    selector: '.table-scroll caption',
  },
];

const TEXT_PAIRS: readonly TextPair[] = [...SYSTEMATIC_PAIRS, ...OVERLAY_PAIRS];

const FOCUS_TOKEN = '--color-focus';
const FOCUS_SURFACES = [
  'background',
  'elevated',
  'raised',
  'inset',
  'background under the accent tint',
  'accent wash over elevated',
  'surface under the accent tint',
] as const satisfies readonly SurfaceName[];

function measureFailures(
  theme: string,
  tokens: Map<string, Rgba>,
  pairs: readonly TextPair[],
  threshold: number,
): string[] {
  const surfaces = buildSurfaces(tokens);
  const failures: string[] = [];
  for (const pair of pairs) {
    const ratio = contrastRatio(mustToken(tokens, pair.fg), surfaces[pair.surface]);
    if (ratio < threshold) {
      failures.push(
        `${pair.label} — ${pair.fg} on ${pair.surface} = ${ratio.toFixed(2)}:1 (needs ${threshold}:1)`,
      );
    }
  }
  return failures.map((failure) => `[${theme}] ${failure}`);
}

/** Parses the `property: var(--color-*)` declaration of every top-level rule. */
function collectDeclarations(css: string, property: string): Map<string, string> {
  const declarations = new Map<string, string>();
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  const pattern = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*var\\((--color-[a-z-]+)\\)`, 'm');
  for (const match of css.matchAll(rule)) {
    const selector = (match[1] ?? '').trim().replace(/\s+/g, ' ');
    const body = match[2] ?? '';
    if (selector === '' || selector.startsWith('@')) {
      continue;
    }
    const value = pattern.exec(body);
    if (value?.[1] !== undefined) {
      declarations.set(selector, value[1]);
    }
  }
  return declarations;
}

/**
 * The background each callout or control paints, so the surface a pair is
 * measured against stays tied to the stylesheet instead of an assumption.
 */
const BACKGROUND_WIRING: ReadonlyArray<{ readonly selector: string; readonly token: string }> = [
  { selector: '.site-header', token: '--color-bg-elevated' },
  { selector: '.site-footer', token: '--color-bg-elevated' },
  { selector: '.skip-link', token: '--color-bg-elevated' },
  { selector: '.lang-toggle', token: '--color-surface' },
  { selector: '.side-index__link.is-active', token: '--color-surface' },
  { selector: '.toggle-button:hover', token: '--color-surface-hover' },
  { selector: '.toggle-button[aria-pressed="true"]', token: '--color-accent-soft' },
  { selector: '.todo', token: '--color-surface' },
  { selector: '.block__num', token: '--color-integrity-soft' },
  { selector: '.honesty', token: '--color-integrity-soft' },
  { selector: '.table-scroll', token: '--color-bg-elevated' },
  { selector: '.table-scroll thead th', token: '--color-bg-raised' },
  { selector: '.hero__diagram', token: '--color-bg-elevated' },
  { selector: '.hero__link', token: '--color-bg-raised' },
  { selector: '.evidence', token: '--color-bg-raised' },
  { selector: '.log__findings li', token: '--color-bg-raised' },
  { selector: '.button', token: '--color-bg-raised' },
  { selector: '.chain__input', token: '--color-bg-inset' },
  { selector: '.preimage', token: '--color-bg-raised' },
  { selector: '.preimage__bytes', token: '--color-bg-inset' },
  { selector: '.chain__note', token: '--color-bg-raised' },
  { selector: '.chain__link', token: '--color-bg-raised' },
  { selector: '.chain__badge', token: '--color-bg-inset' },
  { selector: '.compare__row--best', token: '--color-bg-raised' },
];

describe('WCAG 2.x contrast', () => {
  it('computes the reference ratios correctly', () => {
    const black: Rgba = [0, 0, 0, 1];
    const white: Rgba = [255, 255, 255, 1];
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
    // #767676 is the canonical 4.54:1 grey on white.
    expect(contrastRatio([0x76, 0x76, 0x76, 1], white)).toBeGreaterThanOrEqual(4.5);
  });

  it('composites translucent colors over their backdrop', () => {
    const halfBlack: Rgba = [0, 0, 0, 0.5];
    expect(composite(halfBlack, [255, 255, 255, 1])).toEqual([127.5, 127.5, 127.5, 1]);
    expect(composite([255, 0, 0, 0], [10, 20, 30, 1])).toEqual([10, 20, 30, 1]);
  });

  it('keeps the explicit and media-query light token blocks in sync', () => {
    expect([...lightTokens.entries()].sort()).toEqual([...mediaLightTokens.entries()].sort());
  });

  it('defines every text token in both themes', () => {
    for (const token of TEXT_TOKENS) {
      expect(darkTokens.has(token), `dark theme is missing ${token}`).toBe(true);
      expect(lightTokens.has(token), `light theme is missing ${token}`).toBe(true);
    }
    expect(darkTokens.has(FOCUS_TOKEN)).toBe(true);
    expect(lightTokens.has(FOCUS_TOKEN)).toBe(true);
  });

  it('paints every text overlay on the background the matrix composites', () => {
    const declared = collectDeclarations(baseCss, 'color');
    for (const pair of OVERLAY_PAIRS) {
      if (pair.selector === undefined) {
        continue;
      }
      expect(declared.get(pair.selector), `${pair.selector} must set color: var(${pair.fg})`).toBe(
        pair.fg,
      );
    }
    // No text color in base.css may be left out of the matrix.
    const covered = new Set(TEXT_PAIRS.map((pair) => pair.fg));
    for (const token of declared.values()) {
      expect(covered.has(token), `${token} is painted as text but not asserted`).toBe(true);
    }
  });

  it('derives every surface from the background the stylesheet declares', () => {
    const backgrounds = collectDeclarations(baseCss, 'background');
    for (const { selector, token } of BACKGROUND_WIRING) {
      expect(backgrounds.get(selector), `${selector} must set background: var(${token})`).toBe(
        token,
      );
    }
  });

  it('meets AA 4.5:1 for every text pair in the light theme', () => {
    expect(measureFailures('light', lightTokens, TEXT_PAIRS, 4.5)).toEqual([]);
  });

  it('meets AA 4.5:1 for every text pair in the dark theme', () => {
    expect(measureFailures('dark', darkTokens, TEXT_PAIRS, 4.5)).toEqual([]);
  });

  it('meets 3:1 for the focus indicator in both themes', () => {
    const focusPairs = (): TextPair[] =>
      FOCUS_SURFACES.map((surface) => ({
        label: `${FOCUS_TOKEN} on ${surface}`,
        fg: FOCUS_TOKEN,
        surface,
      }));
    const failures = [
      ...measureFailures('light', lightTokens, focusPairs(), 3),
      ...measureFailures('dark', darkTokens, focusPairs(), 3),
    ];
    expect(failures).toEqual([]);
  });
});
