import type { HashProvider } from '../engine/types';
import type { BlockSpec } from './base';
import { GENESIS_HASH, digestFor, shortHash } from './chain-model';
import { el } from './dom';

/**
 * Block 1 — the hero.
 *
 * A six-link chain that draws itself and then breaks: link 4 was rewritten and
 * re-hashed (exactly what an attacker with database access does), so links 5
 * and 6 no longer match the hash they point at and turn red, one after the
 * other.
 *
 * The digests are real SHA-256 over the same canonical preimage block 3
 * explains; the diagram only shows a prefix of each digest and keeps the full
 * value in the `title` and in the accessible description. All motion is CSS
 * (`@keyframes` with per-link delays); `prefers-reduced-motion` drops the
 * animation and the final state is what the stylesheet paints by default.
 */

/** The six entries the hero draws. Neutral tokens, so both languages show the same hashes. */
const HERO_CONTENTS: readonly string[] = [
  'system:init',
  'record:HC-10231:read',
  'record:HC-10442:read',
  'lab:HC-10908:export',
  'invoice:HC-10231:audit',
  'audit:HC-10231:review',
];

/** What the attacker wrote into entry 4 before anyone looked. */
const ALTERED_CONTENT = 'lab:HC-10908:read';

/** 0-based position of the altered entry. */
const ALTERED_INDEX = 3;

/** What one drawn link represents. */
export type HeroLinkRole = 'valid' | 'altered' | 'broken';

export interface HeroLink {
  readonly seq: number;
  readonly digest: string;
  readonly short: string;
  readonly role: HeroLinkRole;
}

/**
 * Builds the chain the hero draws.
 *
 * Entry 4 is hashed twice: once from the content that was there, once from the
 * content the attacker left. The drawn chain carries the recomputed digest for
 * entry 4, while entries 5 and 6 keep the digests they were built with — so
 * they still point at the *old* entry 4 and no longer chain. That mismatch is
 * the break the animation propagates; without it the story would be false.
 */
export async function buildHeroChain(provider?: HashProvider): Promise<HeroLink[]> {
  const links: HeroLink[] = [];
  let prevHash = GENESIS_HASH;

  for (const [index, content] of HERO_CONTENTS.entries()) {
    const seq = index + 1;
    const original = await digestFor(prevHash, seq, content, provider);

    if (index === ALTERED_INDEX) {
      const recomputed = await digestFor(prevHash, seq, ALTERED_CONTENT, provider);
      links.push({
        seq,
        digest: recomputed,
        short: shortHash(recomputed),
        role: 'altered',
      });
    } else {
      links.push({
        seq,
        digest: original,
        short: shortHash(original),
        role: index > ALTERED_INDEX ? 'broken' : 'valid',
      });
    }

    // Entries 5 and 6 were built over the *original* digest of entry 4.
    prevHash = original;
  }

  return links;
}

/** One dash for a broken link, a tick for a sound one; colour is never the only cue. */
function flagMark(role: HeroLinkRole): string {
  return role === 'valid' ? '✓' : '✗';
}

interface HeroRow {
  readonly item: HTMLLIElement;
  readonly hash: HTMLElement;
  readonly flag: HTMLElement;
}

function createRow(index: number): HeroRow {
  const item = el('li', {
    className: 'hero__link',
    attrs: { 'data-hero-link': '', role: 'listitem' },
  });
  item.style.setProperty('--i', String(index));

  const seq = el('span', { className: 'hero__seq', text: `#${index + 1}` });
  const hash = el('span', {
    className: 'hero__hash',
    attrs: { 'data-hero-hash': '' },
  });
  const flag = el('span', {
    className: 'hero__flag',
    attrs: { 'data-hero-flag': '', 'aria-hidden': 'true' },
    text: '·',
  });

  const head = el('span', { className: 'hero__head' });
  head.append(seq, flag);
  item.append(head, hash);

  return { item, hash, flag };
}

function buildHero(body: HTMLElement): void {
  const figure = el('figure', { className: 'hero' });
  const diagram = el('div', {
    className: 'hero__diagram',
    i18nAriaLabel: 'hero.figure.label',
    attrs: { 'data-hero-diagram': '', role: 'img' },
  });
  const list = el('ol', {
    className: 'hero__chain',
    attrs: { 'data-hero-list': '', 'aria-hidden': 'true' },
  });

  const rows = HERO_CONTENTS.map((_content, index) => createRow(index));
  list.append(...rows.map((row) => row.item));
  diagram.append(list);

  const caption = el('figcaption', {
    className: 'hero__caption',
    i18n: 'hero.figure.caption',
  });
  const note = el('p', { className: 'hero__note', i18n: 'hero.note' });

  const next = el('a', {
    className: 'hero__next',
    i18n: 'hero.next',
    attrs: { href: '#idea' },
  });
  const cta = el('p', { className: 'hero__cta' });
  cta.append(next);

  figure.append(el('p', { className: 'prose', i18n: 'hero.lead' }), diagram, caption, note, cta);
  body.append(figure);

  void (async () => {
    const chain = await buildHeroChain();
    chain.forEach((link, index) => {
      const row = rows[index];
      if (row === undefined) {
        return;
      }
      row.hash.textContent = link.short;
      row.hash.title = link.digest;
      row.flag.textContent = flagMark(link.role);
      row.item.dataset.role = link.role;
      row.item.dataset.seq = String(link.seq);
    });
    diagram.dataset.ready = 'true';
  })();
}

export const heroBlock: BlockSpec = {
  num: 1,
  id: 'hero',
  titleKey: 'block.hero.title',
  build: buildHero,
};
