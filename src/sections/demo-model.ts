/**
 * Data for block 5 — the lab.
 *
 * The lab has to be analysable without opening the console, so everything the
 * copy says about an action is derived from one small, explicit description of
 * that action (`LabEvent`) instead of being hand-written at each call site. The
 * seed records are plausible health-record accesses, the same flavour as block
 * 2, and are deliberately data-only (no translated text) so a language switch
 * can never make a displayed digest disagree with the record it was computed
 * from.
 *
 * This module owns no cryptography: every hash, proof and signature comes from
 * `src/engine`.
 */

import type { BreakKind, RawRecord } from '../engine';
import { t } from '../i18n/t';

/** Anchoring interval, in entries, used by the anchors and export panels. */
export const ANCHOR_EVERY = 3;

/** Longest resource identifier the "add entry" field accepts. */
export const MAX_RESOURCE = 24;

/** One access, 2026-03-02, North Hospital. Timestamps are epoch ms, UTC. */
function at(hour: number, minute: number): number {
  return Date.UTC(2026, 2, 2, hour, minute);
}

/**
 * Eight accesses over health records. Eight is enough that altering "#4" has a
 * real tail in front of it: four rows keep their original hashes, and the
 * forward links are what must expose the change.
 */
export const LAB_SEED: readonly RawRecord[] = [
  {
    timestamp: at(9, 14),
    actor: 'a.ruiz@hospitalnorte',
    action: 'read',
    resource: 'HC-10231',
    payload: { channel: 'web' },
  },
  {
    timestamp: at(9, 22),
    actor: 'enfermeria.t1@hospitalnorte',
    action: 'read',
    resource: 'HC-10442',
    payload: { channel: 'web' },
  },
  {
    timestamp: at(10, 5),
    actor: 'facturacion@hospitalnorte',
    action: 'read',
    resource: 'HC-10231',
    payload: { channel: 'web' },
  },
  {
    timestamp: at(10, 41),
    actor: 'investigacion@hospitalnorte',
    action: 'export',
    resource: 'HC-10908',
    payload: { channel: 'api' },
  },
  {
    timestamp: at(11, 3),
    actor: 'auditoria@hospitalnorte',
    action: 'read',
    resource: 'HC-10231',
    payload: { channel: 'web' },
  },
  {
    timestamp: at(11, 47),
    actor: 'soporte.externo@vendor',
    action: 'read',
    resource: 'HC-10231',
    payload: { channel: 'vpn' },
  },
  {
    timestamp: at(12, 12),
    actor: 'm.sosa@hospitalnorte',
    action: 'read',
    resource: 'HC-10777',
    payload: { channel: 'web' },
  },
  {
    timestamp: at(12, 40),
    actor: 'a.ruiz@hospitalnorte',
    action: 'export',
    resource: 'HC-10231',
    payload: { channel: 'api' },
  },
];

/** The 1-based entry the lab targets by default, per the task table ("#4"). */
export const DEFAULT_TARGET_SEQ = 4;

/** A record appended by the visitor: a fresh read at 13:00 plus one minute each. */
export function newRecord(resource: string, offset: number): RawRecord {
  return {
    timestamp: at(13, 0) + offset * 60_000,
    actor: 'a.ruiz@hospitalnorte',
    action: 'read',
    resource: resource.trim() || `HC-${10500 + offset}`,
    payload: { channel: 'web' },
  };
}

/** The fabricated row the retroactive-insert control squeezes into the log. */
export function forgedRecord(offset: number): RawRecord {
  return {
    timestamp: at(10, 20) + offset,
    actor: 'soporte.externo@vendor',
    action: 'export',
    resource: 'HC-10231',
    payload: { channel: 'api' },
  };
}

/** `09:14` in UTC, so the rendered time never depends on the visitor's zone. */
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(11, 16);
}

/** The next action `alter` writes: a different, plausible value, never the same one. */
export function alternateAction(action: string): string {
  return action === 'read' ? 'export' : 'read';
}

/**
 * What the visitor just did, described once. The copy for each variant is a
 * translation key plus its variables, so the same event can be repainted on a
 * language change without re-running the action.
 */
export type LabEvent =
  | { readonly kind: 'ready'; readonly count: number }
  | { readonly kind: 'added'; readonly seq: number }
  | { readonly kind: 'altered'; readonly seq: number; readonly tail: boolean }
  | { readonly kind: 'deleted'; readonly seq: number }
  | { readonly kind: 'swapped'; readonly left: number; readonly right: number }
  | { readonly kind: 'inserted'; readonly seq: number }
  | { readonly kind: 'verified'; readonly count: number }
  | {
      readonly kind: 'verified-broken';
      readonly seq: number;
      readonly index: number;
      readonly breakKind: BreakKind;
    }
  | { readonly kind: 'reset' };

/** Translation key of the plain-language name of a break kind. */
export function breakKindKey(kind: BreakKind): string {
  return `demo.break.${kind}`;
}

/** The statement for an event: "what happened and why it was detectable". */
export function eventCopy(event: LabEvent): { key: string; vars: Record<string, string | number> } {
  switch (event.kind) {
    case 'ready':
      return { key: 'demo.event.ready', vars: { count: event.count } };
    case 'added':
      return { key: 'demo.event.added', vars: { seq: event.seq } };
    case 'altered':
      return {
        key: event.tail ? 'demo.event.altered-tail' : 'demo.event.altered',
        vars: { seq: event.seq },
      };
    case 'deleted':
      return { key: 'demo.event.deleted', vars: { seq: event.seq } };
    case 'swapped':
      return { key: 'demo.event.swapped', vars: { left: event.left, right: event.right } };
    case 'inserted':
      return { key: 'demo.event.inserted', vars: { seq: event.seq } };
    case 'verified':
      return { key: 'demo.event.verified', vars: { count: event.count } };
    case 'verified-broken':
      return {
        key: 'demo.event.verified-broken',
        vars: {
          seq: event.seq,
          index: event.index + 1,
          kind: t(breakKindKey(event.breakKind)),
        },
      };
    case 'reset':
      return { key: 'demo.event.reset', vars: {} };
  }
}
