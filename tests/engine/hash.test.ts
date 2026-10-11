import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HashProviderUnavailableError,
  bytesToHex,
  hasWebCrypto,
  pureHashProvider,
  resolveHashProvider,
  utf8Bytes,
  webCryptoHashProvider,
} from '../../src/engine/hash';
import type { HashProvider } from '../../src/engine/types';

/**
 * The engine ships two SHA-256 providers: Web Crypto (the real path) and a
 * from-scratch implementation for non-secure contexts such as `file://`, where
 * `crypto.subtle` does not exist. Both are validated against the same official
 * NIST/FIPS 180-4 vectors. A vector that passes in only one provider does not
 * count: the two must agree byte for byte.
 */

interface NistVector {
  readonly name: string;
  readonly input: string;
  readonly digest: string;
}

const NIST_VECTORS: readonly NistVector[] = [
  {
    name: 'empty string',
    input: '',
    digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  },
  {
    name: '"abc"',
    input: 'abc',
    digest: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  },
  {
    name: '448-bit two-block message',
    input: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    digest: '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  },
  {
    name: '896-bit three-block message',
    input:
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
    digest: 'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
  },
  {
    name: 'one million "a" characters',
    input: 'a'.repeat(1_000_000),
    digest: 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
  },
];

const BOUNDARY_LENGTHS: readonly number[] = [0, 1, 55, 56, 63, 64, 65, 119, 120];

/** A deterministic, visibly patterned message of exactly `length` bytes. */
function messageOfLength(length: number): string {
  const pattern = 'abcdefghij';
  return pattern.repeat(Math.ceil(length / pattern.length)).slice(0, length);
}

async function digestAsHex(provider: HashProvider, input: string): Promise<string> {
  return bytesToHex(await provider.digest(utf8Bytes(input)));
}

/** Small LCG so the property test is deterministic and reproducible. */
function pseudoRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const ALPHABET: readonly string[] = [
  'a',
  'Z',
  '0',
  ' ',
  '\n',
  '\u0000',
  'é',
  'e\u0301',
  '漢',
  '😀',
  '🧑\u200d💻',
  '"',
  ',',
  '[',
  ']',
];

describe('environment', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has Web Crypto available, so the real path is exercised', () => {
    // happy-dom maps `window.crypto` onto the Node 22 global, so `crypto.subtle`
    // exists here without any test-setup shim. If that ever changes, this test
    // fails loudly instead of silently skipping the real provider.
    expect(hasWebCrypto()).toBe(true);
  });
});

describe('SHA-256 NIST/FIPS 180-4 vectors', () => {
  for (const vector of NIST_VECTORS) {
    it(`"${vector.name}": Web Crypto matches the published digest`, async () => {
      expect(await digestAsHex(webCryptoHashProvider, vector.input)).toBe(vector.digest);
    });

    it(`"${vector.name}": pure provider matches the published digest`, async () => {
      expect(await digestAsHex(pureHashProvider, vector.input)).toBe(vector.digest);
    });

    it(`"${vector.name}": both providers agree`, async () => {
      const fromWebCrypto = await webCryptoHashProvider.digest(utf8Bytes(vector.input));
      const fromPure = await pureHashProvider.digest(utf8Bytes(vector.input));
      expect(bytesToHex(fromPure)).toBe(bytesToHex(fromWebCrypto));
      expect(fromPure).toHaveLength(32);
    });
  }
});

describe('length boundaries and padding', () => {
  it('agrees across providers at 0, 1, 55, 56, 63, 64, 65, 119 and 120 bytes', async () => {
    for (const length of BOUNDARY_LENGTHS) {
      const message = messageOfLength(length);
      const fromWebCrypto = await digestAsHex(webCryptoHashProvider, message);
      const fromPure = await digestAsHex(pureHashProvider, message);
      expect(fromPure, `agreement at ${length} bytes`).toBe(fromWebCrypto);
      expect(fromWebCrypto).toHaveLength(64);
    }
  });

  it('hashes the whole message, so no boundary byte is silently dropped', async () => {
    for (const length of BOUNDARY_LENGTHS) {
      if (length === 0) {
        continue;
      }
      const full = await digestAsHex(pureHashProvider, messageOfLength(length));
      const shortened = await digestAsHex(pureHashProvider, messageOfLength(length - 1));
      expect(full, `length ${length} must differ from ${length - 1}`).not.toBe(shortened);
    }
  });

  it('distinguishes a trailing byte at the exact 64-byte block edge', async () => {
    const base = messageOfLength(64);
    const extended = `${base}\u0000`;
    expect(await digestAsHex(pureHashProvider, base)).not.toBe(
      await digestAsHex(pureHashProvider, extended),
    );
  });

  it('distinguishes the 56-byte padding edge from the 55-byte one', async () => {
    const at55 = await digestAsHex(pureHashProvider, messageOfLength(55));
    const at56 = await digestAsHex(pureHashProvider, messageOfLength(56));
    expect(at55).not.toBe(at56);
  });
});

describe('cross-provider property', () => {
  it('always agrees on 200 generated inputs, including astral characters and NUL', async () => {
    const random = pseudoRandom(0x5eed);
    for (let sample = 0; sample < 200; sample += 1) {
      const length = Math.floor(random() * 300);
      let message = '';
      while (message.length < length) {
        const index = Math.floor(random() * ALPHABET.length);
        message += ALPHABET[index] ?? 'a';
      }
      const fromWebCrypto = await digestAsHex(webCryptoHashProvider, message);
      const fromPure = await digestAsHex(pureHashProvider, message);
      expect(fromPure, `sample ${sample}`).toBe(fromWebCrypto);
    }
  });
});

describe('UTF-8 encoding', () => {
  it('encodes multi-byte and astral characters through TextEncoder', () => {
    expect(Array.from(utf8Bytes(''))).toEqual([]);
    expect(Array.from(utf8Bytes('\u0000'))).toEqual([0x00]);
    expect(Array.from(utf8Bytes('é'))).toEqual([0xc3, 0xa9]);
    expect(Array.from(utf8Bytes('😀'))).toEqual([0xf0, 0x9f, 0x98, 0x80]);
  });

  it('hashes an astral character as its four UTF-8 bytes', async () => {
    expect(await digestAsHex(pureHashProvider, '😀')).toBe(
      await digestAsHex(webCryptoHashProvider, '😀'),
    );
  });
});

describe('provider resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to Web Crypto when subtle is available', () => {
    expect(resolveHashProvider().id).toBe('webcrypto');
  });

  it('honours an explicit provider request so both can be tested side by side', () => {
    expect(resolveHashProvider('webcrypto').id).toBe('webcrypto');
    expect(resolveHashProvider('pure').id).toBe('pure');
  });

  it('falls back to the pure provider when crypto.subtle is missing', () => {
    vi.stubGlobal('crypto', {});
    expect(hasWebCrypto()).toBe(false);
    expect(resolveHashProvider().id).toBe('pure');
    expect(resolveHashProvider('pure').id).toBe('pure');
  });

  it('throws a typed error when Web Crypto is requested but unavailable', () => {
    vi.stubGlobal('crypto', {});
    expect(() => resolveHashProvider('webcrypto')).toThrow(HashProviderUnavailableError);
    try {
      resolveHashProvider('webcrypto');
    } catch (error) {
      expect(error).toBeInstanceOf(HashProviderUnavailableError);
      expect((error as HashProviderUnavailableError).code).toBe('hash_provider_unavailable');
    }
  });

  it('exposes the unavailable provider id and a distinct message per provider', () => {
    const webCryptoError = new HashProviderUnavailableError('webcrypto');
    expect(webCryptoError.code).toBe('hash_provider_unavailable');
    expect(webCryptoError.providerId).toBe('webcrypto');
    expect(webCryptoError.message).toContain('pure');
    const pureError = new HashProviderUnavailableError('pure');
    expect(pureError.providerId).toBe('pure');
    expect(pureError.message).toContain('pure');
  });

  it('rejects at call time when the Web Crypto provider runs without subtle', async () => {
    vi.stubGlobal('crypto', {});
    await expect(webCryptoHashProvider.digest(utf8Bytes('abc'))).rejects.toBeInstanceOf(
      HashProviderUnavailableError,
    );
  });
});

describe('pure provider performance', () => {
  it('hashes one million bytes quickly enough for the browser demo', async () => {
    const input = utf8Bytes('a'.repeat(1_000_000));
    const started = performance.now();
    const digest = await pureHashProvider.digest(input);
    const elapsedMs = performance.now() - started;
    process.stdout.write(
      `[hash.test] pure SHA-256 over 1,000,000 bytes: ${elapsedMs.toFixed(1)} ms\n`,
    );
    expect(bytesToHex(digest)).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
    expect(elapsedMs).toBeLessThan(10_000);
  });
});
