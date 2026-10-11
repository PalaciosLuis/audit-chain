/**
 * Deterministic, injective serialization of an audit record to bytes.
 *
 * The contract has two halves, and both matter:
 *
 *   - **Determinism.** Two equal values always serialize to the same bytes, so
 *     the same record hashes the same everywhere, on every engine and in every
 *     insertion order.
 *   - **Injectivity.** Two *different* values never serialize to the same
 *     bytes. If they could, two distinct audit records would share a hash and
 *     the chain would lose its evidentiary value.
 *
 * `JSON.stringify` provides neither: it preserves insertion order for keys,
 * silently drops `undefined` properties and functions, emits `null` for `NaN`
 * and `Infinity`, throws on `BigInt` and cycles, and lets `["a","bc"]` and
 * `["ab","c"]` share a textual shape. This module replaces it with an explicit,
 * typed-byte format:
 *
 *   ```text
 *   null    -> 0x00
 *   false   -> 0x01
 *   true    -> 0x02
 *   number  -> 0x03 <int64: 8-byte big-endian two's complement>
 *   string  -> 0x04 <u32 byte length> <NFC UTF-8 bytes>
 *   array   -> 0x05 <u32 element count> <element>*
 *   object  -> 0x06 <u32 key count> (<key string> <value>)*
 *   ```
 *
 * Every variable-length piece starts with its own length, so a separator byte
 * can never be forged: `["a","bc"]` carries a different byte sequence from
 * `["ab","c"]`, and `{"a":"b","c":"d"}` from `{"a":"b,c","d":""}`.
 */

const TAG = {
  null: 0x00,
  false: 0x01,
  true: 0x02,
  number: 0x03,
  string: 0x04,
  array: 0x05,
  object: 0x06,
} as const;

const textEncoder = new TextEncoder();

/** Stable, machine-readable reasons a value cannot be canonicalized. */
export type CanonicalErrorCode =
  | 'unsupported_type'
  | 'unsupported_property'
  | 'non_enumerable_property'
  | 'symbol_key'
  | 'non_finite_number'
  | 'non_integer_number'
  | 'unsafe_integer'
  | 'undefined_value'
  | 'unpaired_surrogate'
  | 'duplicate_key'
  | 'cyclic_reference';

/**
 * Typed rejection raised by `canonicalize`.
 *
 * `path` points at the offending value in accessor notation (`payload.amount`,
 * `items[3].price`), with the root rendered as `$`. A UI can use it to focus the
 * exact field that broke the record.
 */
export class CanonicalError extends Error {
  readonly code: CanonicalErrorCode;
  readonly path: string;

  constructor(code: CanonicalErrorCode, path: string, detail: string) {
    super(`Cannot canonicalize ${path}: ${detail}`);
    this.name = 'CanonicalError';
    this.code = code;
    this.path = path;
  }
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function joinKey(parent: string, key: string): string {
  if (IDENTIFIER.test(key)) {
    return parent === '$' ? key : `${parent}.${key}`;
  }
  return `${parent}[${JSON.stringify(key)}]`;
}

/**
 * True when the string contains an unpaired UTF-16 surrogate.
 *
 * `TextEncoder` replaces a lone surrogate with U+FFFD, which would make
 * `"\uD83D"` and `"\uFFFD"` collide. Rejecting is the only way to stay
 * injective.
 */
function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** Validates well-formedness, then returns the NFC form used on the wire. */
function normalizeString(value: string, path: string): string {
  if (hasUnpairedSurrogate(value)) {
    throw new CanonicalError(
      'unpaired_surrogate',
      path,
      'the string contains an unpaired UTF-16 surrogate',
    );
  }
  return value.normalize('NFC');
}

function writeUint32(out: number[], value: number): void {
  out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function writeString(out: number[], value: string): void {
  const bytes = textEncoder.encode(value);
  writeUint32(out, bytes.length);
  for (const byte of bytes) {
    out.push(byte);
  }
}

function writeNumber(out: number[], value: number): void {
  out.push(TAG.number);
  // Safe integers fit in 64 bits; two's complement big-endian keeps the mapping
  // order-preserving and collision-free. `-0` and `0` are `===`, so both encode
  // as 0n.
  const buffer = new Uint8Array(8);
  new DataView(buffer.buffer).setBigInt64(0, BigInt(value === 0 ? 0 : value), false);
  for (const byte of buffer) {
    out.push(byte);
  }
}

function encodeNumber(value: number, path: string, out: number[]): void {
  if (!Number.isFinite(value)) {
    throw new CanonicalError(
      'non_finite_number',
      path,
      'NaN and Infinity have no exact numeric form; use a safe integer',
    );
  }
  if (!Number.isInteger(value)) {
    throw new CanonicalError(
      'non_integer_number',
      path,
      'only safe integers are accepted; carry money and counters as integer minor units',
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new CanonicalError(
      'unsafe_integer',
      path,
      'the integer is outside the ±2^53-1 range JavaScript can represent exactly',
    );
  }
  writeNumber(out, value);
}

function encodeArray(
  value: readonly unknown[],
  path: string,
  ancestors: Set<object>,
  out: number[],
): void {
  if (ancestors.has(value)) {
    throw new CanonicalError('cyclic_reference', path, 'the value references itself');
  }
  ancestors.add(value);
  out.push(TAG.array);
  writeUint32(out, value.length);
  for (let index = 0; index < value.length; index += 1) {
    encode(value[index], `${path}[${index}]`, ancestors, out);
  }
  ancestors.delete(value);
}

function encodeObject(value: object, path: string, ancestors: Set<object>, out: number[]): void {
  if (ancestors.has(value)) {
    throw new CanonicalError('cyclic_reference', path, 'the value references itself');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new CanonicalError(
      'symbol_key',
      path,
      'symbol-keyed properties cannot be serialized or hashed',
    );
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (Object.getOwnPropertyNames(record).length !== keys.length) {
    throw new CanonicalError(
      'non_enumerable_property',
      path,
      'non-enumerable own properties are not part of the serialized value',
    );
  }

  ancestors.add(value);
  const pairs: Array<readonly [string, unknown]> = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const keyPath = joinKey(path, key);
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor && (descriptor.get !== undefined || descriptor.set !== undefined)) {
      throw new CanonicalError(
        'unsupported_property',
        keyPath,
        'accessor properties are not serializable; store the value instead',
      );
    }
    const normalizedKey = normalizeString(key, keyPath);
    if (seen.has(normalizedKey)) {
      throw new CanonicalError(
        'duplicate_key',
        keyPath,
        'two keys normalize to the same NFC string, which would merge them',
      );
    }
    seen.add(normalizedKey);
    pairs.push([normalizedKey, record[key]]);
  }

  // Code-unit order (`<` on strings) is locale-independent, unlike
  // `localeCompare`, which would make the bytes depend on the host locale.
  pairs.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));

  out.push(TAG.object);
  writeUint32(out, pairs.length);
  for (const [key, child] of pairs) {
    const childPath = joinKey(path, key);
    writeString(out, key);
    encode(child, childPath, ancestors, out);
  }
  ancestors.delete(value);
}

function encode(value: unknown, path: string, ancestors: Set<object>, out: number[]): void {
  if (value === null) {
    out.push(TAG.null);
    return;
  }

  switch (typeof value) {
    case 'boolean':
      out.push(value ? TAG.true : TAG.false);
      return;
    case 'number':
      encodeNumber(value, path, out);
      return;
    case 'string':
      out.push(TAG.string);
      writeString(out, normalizeString(value, path));
      return;
    case 'undefined':
      throw new CanonicalError(
        'undefined_value',
        path,
        'undefined is not serializable; a missing value must not look like an absent key',
      );
    case 'bigint':
    case 'function':
    case 'symbol':
      throw new CanonicalError(
        'unsupported_type',
        path,
        `a ${typeof value} value has no canonical byte representation`,
      );
    case 'object':
      break;
  }

  if (Array.isArray(value)) {
    encodeArray(value, path, ancestors, out);
    return;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    // Date, Map, Set, typed arrays, class instances: all have prototype state
    // that a key/value listing would silently lose.
    throw new CanonicalError(
      'unsupported_type',
      path,
      `only plain objects are serializable, received ${value.constructor?.name ?? 'an exotic object'}`,
    );
  }

  encodeObject(value, path, ancestors, out);
}

/**
 * Serializes `value` to canonical bytes.
 *
 * @throws {CanonicalError} when the value cannot be represented injectively;
 * the error carries a stable `code` and the `path` of the offending value.
 */
export function canonicalize(value: unknown): Uint8Array {
  const out: number[] = [];
  encode(value, '$', new Set<object>(), out);
  return Uint8Array.from(out);
}
