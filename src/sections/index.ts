import type { BlockSpec } from './base';
import { checklistBlock } from './checklist';
import { codeBlock } from './code';
import { comparisonBlock } from './comparison';
import { heroBlock } from './hero';
import { ideaBlock } from './idea';
import { mountLazyBlock } from './lazy';
import { mistakesBlock } from './mistakes';
import { problemBlock } from './problem';
import { useCasesBlock } from './use-cases';

/**
 * Block 5 — the lab — is by far the heaviest block: it builds a hash chain, a
 * Merkle tree and three panels with real Web Crypto. It is code-split and its
 * body is mounted only once it approaches the viewport, so the first paint does
 * not pay for it.
 */
const demoBlock: BlockSpec = {
  num: 5,
  id: 'demo',
  titleKey: 'block.demo.title',
  build: (body) => {
    mountLazyBlock(body, {
      loader: async () => {
        const { buildDemo } = await import('./demo');
        await buildDemo(body);
      },
    });
  },
};

/** The nine didactic blocks, in reading order. */
export const BLOCKS: readonly BlockSpec[] = [
  heroBlock,
  problemBlock,
  ideaBlock,
  comparisonBlock,
  demoBlock,
  useCasesBlock,
  codeBlock,
  mistakesBlock,
  checklistBlock,
];
