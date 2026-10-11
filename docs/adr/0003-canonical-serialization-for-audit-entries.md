# 0003. Canonical serialization for audit entries

## Context

Every audit entry has to be reduced to a byte string before it can be hashed, and the audit chain
compares hashes to decide whether a record was altered. That makes the serialization a security
boundary: if two different entries can produce the same bytes, they share a hash and the chain
stops being evidence. Both properties are required, and neither is optional:

- **Determinism** — equal values always produce identical bytes, on any engine, whatever order the
  object keys were inserted in.
- **Injectivity** — different values always produce different bytes.

`JSON.stringify` is the obvious candidate and fails on both counts. It preserves insertion order
for keys, so `{a: 1, b: 2}` and `{b: 2, a: 1}` have different bytes. It silently drops
`undefined` properties, functions and symbol-keyed properties, so a missing value and an absent key
are indistinguishable. It turns `NaN` and `Infinity` into `null`. It throws on `BigInt` and on
cycles, but only sometimes, and without a typed failure. It does not normalize Unicode, so
`"\u00e9"` and `"e\u0301"` — the same text — produce different bytes, while `["a","bc"]` and
`["ab","c"]` compress to the same JSON text. And floats such as `0.1 + 0.2` are not exactly
representable, which makes monetary amounts in JSON unreliable across engines.

## Decision

Ship a dependency-free canonical serializer in `src/engine/canonical.ts`, and hash its bytes only.

The format is explicit and self-delimiting, one tag per type:

```text
null    -> 0x00
false   -> 0x01
true    -> 0x02
number  -> 0x03 <int64: 8-byte big-endian two's complement>
string  -> 0x04 <u32 byte length> <NFC UTF-8 bytes>
array   -> 0x05 <u32 element count> <element>*
object  -> 0x06 <u32 key count> (<key string> <value>)*
```

Rules, and the reasoning behind each:

- **Objects: keys sorted recursively by code-unit order.** The sort is applied to the normalized
  keys, and uses `<` on strings (UTF-16 code units) rather than `localeCompare`, so the bytes do not
  depend on the host locale. Arrays keep their order, because order is meaning.
- **Strings: NFC-normalized UTF-8, length-prefixed.** The 32-bit byte-length prefix is what makes
  the format injective where concatenation would not be: `["a","bc"]` and `["ab","c"]` carry
  different length prefixes, and `{"a":"b","c":"d"}` and `{"a":"b,c","d":""}` cannot be confused.
  NFC makes the two Unicode spellings of the same text hash identically.
- **Numbers: safe integers only.** Non-integers, `NaN`, `Infinity` and `-Infinity` are rejected with
  a typed error. This is a deliberate constraint on the entry format: money and counters travel as
  integer minor units (cents, milliseconds, counts), which are exactly representable and therefore
  hash-stable. Integers beyond ±2^53-1 are rejected too, because JavaScript cannot represent them
  exactly. `-0` encodes as `0`, since `-0 === 0`.
- **`null` and booleans are accepted; `undefined` is rejected, never dropped.** An explicit
  rejection means a missing value can never be confused with an absent key. Unowned / exotic states
  fail loudly instead of disappearing.
- **Reject `Date`, `Map`, `Set`, functions, symbols, `BigInt`, typed arrays, class instances and
  cyclic references** with a typed `CanonicalError`. Each carries a stable `code` and the `path` of
  the offending value (`payload.amount`, `items[3].price`, root as `$`), so the UI can point at the
  exact field. Accessor properties, non-enumerable own properties, symbol keys and unpaired UTF-16
  surrogates are rejected as well, because each would either invoke hidden behavior or silently lose
  information. Two keys that normalize to the same NFC string are rejected rather than silently
  merged.

## Consequences

- A record has exactly one hash. The chain can only be recomputed identically if the serializer is
  byte-stable, and it is.
- The entry schema has hard edges: no floats, no `Date`, no `undefined`. Callers convert at the
  boundary (timestamps to epoch milliseconds, amounts to minor units) and the type system documents
  this through `LedgerEntry` and `JsonValue`.
- A violation produces a `CanonicalError` with a `code` and a `path`, so the demo can show "the
  field that broke it" instead of a generic hash mismatch.
- The format is versioned by construction: any future change to the tag bytes or the rules is a
  format break and needs a version marker in the entry, not a silent edit.
- We own the format and its edge cases. There is no library behavior to audit; there is a test file
  with the classic collision pairs, the NIST-related boundary cases and every rejection.

## Alternatives considered

- **Plain `JSON.stringify`.** Simplest, but it fails determinism (key order), loses information
  (`undefined`, symbols, functions), corrupts numbers (`NaN`/`Infinity` to `null`) and is not
  injective on arrays and strings. It cannot be the security boundary.
- **Sorted JSON with a custom replacer.** Fixes key order and can reject some values, but stays a
  string format with no length prefix, so `["a","bc"]` vs `["ab","c"]` and the object/separator
  pairs remain ambiguous, and number handling is inherited from JSON.
- **Length-prefixed concatenation of fields (TLV-style).** Injective when done carefully, but it
  only serializes a fixed record shape. Adding a nested `payload` means re-implementing the entire
  recursive serializer with a hand-maintained field order, which is exactly the fragility we are
  trying to avoid.
- **CBOR / MessagePack / BSON.** Well-specified, injective when canonical subsets are used, but each
  is a dependency (or a vendored file) and the canonical subset rules are subtle. This repository is
  zero-dependency by design (see ADR-0001), and the format above is a few dozen lines whose
  invariants are directly testable.
- **A cryptographic canonicalization standard aimed at signatures (JCS, RFC 8785).** RFC 8785 is a
  good fit for JSON documents, but it still permits floats and expects a JSON value space; it would
  not give us the "safe integers only" rule or the typed, path-carrying rejections the demo needs.
