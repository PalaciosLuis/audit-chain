/**
 * Shared types for the audit engine (AC-2 and AC-3).
 *
 * The engine hashes *canonical bytes*, never a language-native object graph.
 * Everything that crosses into the hashing layer is therefore described here as
 * data: JSON-compatible values only, and an injectable SHA-256 provider so the
 * real Web Crypto path and the pure fallback are interchangeable.
 */

/** The primitive values an audit payload may contain. */
export type JsonPrimitive = string | number | boolean | null;

/**
 * A JSON-compatible value. `number` is deliberately narrowed by convention to
 * **safe integers** (see `canonical.ts`): money and counters travel as integer
 * minor units so serialization stays exact and injective.
 */
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * One ledger record, the unit AC-3 will chain.
 *
 * `timestamp` is epoch milliseconds as a safe integer, never a `Date`: a `Date`
 * carries a time zone and a mutable prototype, while the format has to be
 * unambiguous and byte-stable. `seq` is the 0-based or 1-based position in the
 * chain, and `payload` is the free-form (`JsonValue`) detail of the event.
 */
export interface LedgerEntry {
  readonly seq: number;
  readonly timestamp: number;
  readonly actor: string;
  readonly action: string;
  readonly resource: string;
  readonly payload: JsonValue;
}

/** Stable identifiers for the two SHA-256 implementations the engine ships. */
export type HashProviderId = 'webcrypto' | 'pure';

/**
 * A SHA-256 implementation.
 *
 * `digest` is async because the real provider wraps `crypto.subtle.digest`,
 * which is promise-based. The pure provider is synchronous internally but
 * implements the same interface so callers and tests can use either one without
 * branching.
 */
export interface HashProvider {
  readonly id: HashProviderId;
  digest(bytes: Uint8Array): Promise<Uint8Array>;
}
