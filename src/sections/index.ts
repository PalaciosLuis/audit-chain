import type { BlockSpec } from './base';
import { checklistBlock } from './checklist';
import { codeBlock } from './code';
import { comparisonBlock } from './comparison';
import { demoBlock } from './demo';
import { heroBlock } from './hero';
import { ideaBlock } from './idea';
import { mistakesBlock } from './mistakes';
import { problemBlock } from './problem';
import { useCasesBlock } from './use-cases';

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
