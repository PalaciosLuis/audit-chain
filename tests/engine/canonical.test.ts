import { describe, expect, it } from 'vitest';

import { CanonicalError, canonicalize } from '../../src/engine/canonical';
import type { CanonicalErrorCode } from '../../src/engine/canonical';

/**
 * Canonical serialization has to be *injective*: two different values must
 * never produce the same bytes, and two equal values must always produce the
 * same bytes. These tests pin the classic collision pairs, the NFC and number
 * rules, and the typed rejections that carry the offending value's path.
 */

function hex(value: unknown): string {
  let output = '';
  for (const byte of canonicalize(value)) {
    output += byte.toString(16).padStart(2, '0');
  }
  return output;
}

function expectRejection(value: unknown): CanonicalError {
  try {
    canonicalize(value);
  } catch (error) {
    expect(error).toBeInstanceOf(CanonicalError);
    return error as CanonicalError;
  }
  throw new Error('Expected canonicalize() to reject the value');
}

describe('determinism and key order', () => {
  it('is independent of the insertion order of object keys', () => {
    expect(hex({ b: 2, a: 1 })).toBe(hex({ a: 1, b: 2 }));
    expect(hex({ nested: { z: 1, a: [{ y: 2, x: 1 }] } })).toBe(
      hex({ nested: { a: [{ x: 1, y: 2 }], z: 1 } }),
    );
  });

  it('is deterministic across repeated calls', () => {
    const value = { seq: 1, actor: 'ana', payload: { roles: ['admin', 'auditor'] } };
    expect(hex(value)).toBe(hex(value));
    expect(hex(value)).toBe(
      hex({ seq: 1, actor: 'ana', payload: { roles: ['admin', 'auditor'] } }),
    );
  });

  it('returns bytes of a stable length for a fixed value', () => {
    expect(canonicalize(null)).toBeInstanceOf(Uint8Array);
    expect(hex(null)).toBe(hex(null));
  });
});

describe('injectivity on the classic collision pairs', () => {
  const DIFFERENT_PAIRS: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ['array separator ["a","bc"] vs ["ab","c"]', ['a', 'bc'], ['ab', 'c']],
    [
      'object separator {"a":"b","c":"d"} vs {"a":"b,c","d":""}',
      { a: 'b', c: 'd' },
      { a: 'b,c', d: '' },
    ],
    ['array vs joined string', ['a', 'b'], 'a,b'],
    ['key/value blur {"ab":"c"} vs {"a":"b"}', { ab: 'c' }, { a: 'b' }],
    ['embedded NUL', 'a\u0000b', 'a\u0000bc'],
    ['NUL vs empty string', '\u0000', ''],
    ['emoji plus NUL', '😀', '😀\u0000'],
    ['number vs numeric string', 1, '1'],
    ['zero vs false', 0, false],
    ['null vs "null"', null, 'null'],
    ['empty object vs empty array', {}, []],
    ['missing key vs null value', { a: 1 }, { a: 1, b: null }],
    ['empty array vs nested empty array', [], [[]]],
    ['number vs string value', { a: 1 }, { a: '1' }],
    ['sign', -1, 1],
    ['safe integer limits', Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER],
    ['key reordering with different content', { a: 'x', b: 'y' }, { a: 'y', b: 'x' }],
  ];

  for (const [name, left, right] of DIFFERENT_PAIRS) {
    it(`keeps different content different: ${name}`, () => {
      expect(hex(left)).not.toBe(hex(right));
    });
  }
});

describe('equality is preserved', () => {
  const EQUAL_PAIRS: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ['object key order', { b: 2, a: 1 }, { a: 1, b: 2 }],
    ['NFD versus NFC string value', '\u00e9', 'e\u0301'],
    ['NFD versus NFC object key', { '\u00e9': 1 }, { 'e\u0301': 1 }],
    [
      'deeply nested key order',
      { x: { b: [1, { d: 4, c: 3 }] } },
      { x: { b: [1, { c: 3, d: 4 }] } },
    ],
    ['arrays keep order but equal arrays match', [1, 2, 3], [1, 2, 3]],
    ['null', null, null],
    ['negative zero and zero are ===', -0, 0],
  ];

  for (const [name, left, right] of EQUAL_PAIRS) {
    it(`produces identical bytes: ${name}`, () => {
      expect(hex(left)).toBe(hex(right));
    });
  }
});

describe('strings are length-prefixed and NFC-normalized', () => {
  it('cannot forge a separator because every string carries its byte length', () => {
    expect(hex(['a', 'bc'])).not.toBe(hex(['ab', 'c']));
    expect(hex({ a: 'b', c: 'd' })).not.toBe(hex({ a: 'b,c', d: '' }));
  });

  it('normalizes an emoji, a NUL and a combining sequence deterministically', () => {
    expect(hex('🧑\u200d💻')).toBe(hex('🧑\u200d💻'));
    expect(hex('\u0000')).not.toBe(hex(''));
    expect(hex('e\u0301')).toBe(hex('\u00e9'));
  });
});

describe('numbers: safe integers only', () => {
  it('rejects a float with a typed error and the offending path', () => {
    const error = expectRejection({ payload: { amount: 1.5 } });
    expect(error.code).toBe('non_integer_number');
    expect(error.path).toBe('payload.amount');
    expect(error.message).toContain('payload.amount');
  });

  it('rejects NaN and both infinities as non-finite', () => {
    expect(expectRejection({ payload: { score: Number.NaN } }).code).toBe('non_finite_number');
    expect(expectRejection({ payload: { score: Number.POSITIVE_INFINITY } }).code).toBe(
      'non_finite_number',
    );
    expect(expectRejection({ payload: { score: Number.NEGATIVE_INFINITY } }).code).toBe(
      'non_finite_number',
    );
  });

  it('rejects an integer outside the safe range', () => {
    const error = expectRejection({ payload: { amount: Number.MAX_SAFE_INTEGER + 1 } });
    expect(error.code).toBe('unsafe_integer');
    expect(error.path).toBe('payload.amount');
  });

  it('accepts the safe-integer boundaries', () => {
    expect(hex({ amount: Number.MAX_SAFE_INTEGER })).toHaveLength(hex({ amount: 1 }).length);
    expect(() => canonicalize({ amount: Number.MIN_SAFE_INTEGER })).not.toThrow();
  });
});

describe('typed rejections carry a stable code and a path', () => {
  it('rejects undefined inside an object instead of dropping the key', () => {
    const error = expectRejection({ a: 1, b: undefined });
    expect(error.code).toBe('undefined_value');
    expect(error.path).toBe('b');
  });

  it('rejects a root-level undefined at the root path', () => {
    const error = expectRejection(undefined);
    expect(error.code).toBe('undefined_value');
    expect(error.path).toBe('$');
  });

  it('rejects a hole in a sparse array at the index path', () => {
    const sparse = new Array<unknown>(3);
    sparse[0] = 1;
    sparse[2] = 3; // index 1 stays a hole
    const error = expectRejection(sparse);
    expect(error.code).toBe('undefined_value');
    expect(error.path).toBe('$[1]');
  });

  it('rejects a Date', () => {
    const error = expectRejection({ payload: { when: new Date(0) } });
    expect(error.code).toBe('unsupported_type');
    expect(error.path).toBe('payload.when');
  });

  it('rejects Map, Set, typed arrays, functions, bigint, symbols and class instances', () => {
    const cases: ReadonlyArray<readonly [unknown, string]> = [
      [new Map(), 'unsupported_type'],
      [new Set(), 'unsupported_type'],
      [new Uint8Array([1, 2]), 'unsupported_type'],
      [() => 1, 'unsupported_type'],
      [1n, 'unsupported_type'],
      [Symbol('audit'), 'unsupported_type'],
      [new (class Record {})() as unknown, 'unsupported_type'],
    ];
    for (const [value, code] of cases) {
      expect(expectRejection(value).code, typeof value).toBe(code);
    }
  });

  it('names an exotic object without a constructor in the error message', () => {
    // Prototype is neither Object.prototype nor null, and the prototype chain
    // has no `constructor`, so the message falls back to a generic noun.
    const exotic = Object.create(Object.create(null)) as Record<string, unknown>;
    exotic.field = 1;
    const error = expectRejection(exotic);
    expect(error.code).toBe('unsupported_type');
    expect(error.message).toContain('an exotic object');
  });

  it('rejects a cyclic reference at the property that closes the loop', () => {
    const entry: Record<string, unknown> = { actor: 'ana' };
    entry.payload = { resource: 'record:42', self: entry };
    const error = expectRejection(entry);
    expect(error.code).toBe('cyclic_reference');
    expect(error.path).toBe('payload.self');
  });

  it('rejects a directly self-referencing array', () => {
    const list: unknown[] = [];
    list.push(list);
    const error = expectRejection(list);
    expect(error.code).toBe('cyclic_reference');
    expect(error.path).toBe('$[0]');
  });

  it('rejects an unpaired surrogate value instead of silently replacing it', () => {
    const high = expectRejection({ actor: '\uD83D' });
    expect(high.code).toBe('unpaired_surrogate');
    expect(high.path).toBe('actor');
    const low = expectRejection({ actor: '\uDC00' });
    expect(low.code).toBe('unpaired_surrogate');
    expect(low.path).toBe('actor');
    // A well-formed pair and U+FFFD are both valid and must stay accepted.
    expect(() => canonicalize({ actor: '\uD83D\uDE00' })).not.toThrow();
    expect(() => canonicalize({ actor: '\uFFFD' })).not.toThrow();
  });

  it('rejects a symbol-keyed property even though Object.keys hides it', () => {
    const value = { visible: 1 };
    Object.defineProperty(value, Symbol('hidden'), { value: 2, enumerable: true });
    const error = expectRejection(value);
    expect(error.code).toBe('symbol_key');
    expect(error.path).toBe('$');
  });

  it('rejects a non-enumerable own property that would be dropped', () => {
    const value = { visible: 1 };
    Object.defineProperty(value, 'hidden', { value: 2, enumerable: false });
    const error = expectRejection(value);
    expect(error.code).toBe('non_enumerable_property');
    expect(error.path).toBe('$');
  });

  it('rejects an accessor property rather than invoking a getter', () => {
    const value: Record<string, unknown> = {};
    Object.defineProperty(value, 'computed', {
      enumerable: true,
      get: () => 1,
    });
    const error = expectRejection(value);
    expect(error.code).toBe('unsupported_property');
    expect(error.path).toBe('computed');
  });

  it('rejects two keys that normalize to the same NFC string', () => {
    const error = expectRejection({ '\u00e9': 1, 'e\u0301': 2 });
    expect(error.code).toBe('duplicate_key');
    // The key is not an ASCII identifier, so it is rendered in bracket notation.
    expect(error.path).toBe('$["e\u0301"]');
  });

  it('uses bracket notation for keys that are not identifiers', () => {
    const error = expectRejection({ 'weird.key': 1.5 });
    expect(error.code).toBe('non_integer_number');
    expect(error.path).toBe('$["weird.key"]');
  });

  it('exposes the code and path as stable, machine-readable fields', () => {
    const error = expectRejection({ payload: { amount: 2.25 } });
    const code: CanonicalErrorCode = error.code;
    expect(code).toBe('non_integer_number');
    expect(typeof error.path).toBe('string');
    expect(error.name).toBe('CanonicalError');
  });
});
