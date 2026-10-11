/**
 * SHA-256 behind an injectable provider.
 *
 * Two implementations ship in the same module and are validated against the
 * same NIST/FIPS 180-4 vectors:
 *
 *   - `webcrypto` — `crypto.subtle.digest`, the real path, selected by default
 *     whenever `globalThis.crypto?.subtle` exists. It is constant-time-ish,
 *     hardware-accelerated and maintained by the platform.
 *   - `pure` — a from-scratch SHA-256 over `Uint8Array`/`DataView`. It exists
 *     because `crypto.subtle` is only defined in a **secure context**: opening
 *     the built `index.html` from `file://` leaves `crypto.subtle` undefined and
 *     the demo would silently break. There is no dependency and no vendored
 *     library file; the algorithm is written in this repository.
 *
 * `resolveHashProvider()` picks the default, and callers can force a provider so
 * both can be exercised side by side.
 */

import type { HashProvider, HashProviderId } from './types';

const SHA256 = 'SHA-256';

const textEncoder = new TextEncoder();

/** Raised when a provider is requested that the current context cannot offer. */
export class HashProviderUnavailableError extends Error {
  readonly code = 'hash_provider_unavailable';
  readonly providerId: HashProviderId;

  constructor(providerId: HashProviderId) {
    super(
      providerId === 'webcrypto'
        ? 'Web Crypto (crypto.subtle.digest) is unavailable in this context; use the "pure" provider'
        : `The "${providerId}" hash provider is unavailable`,
    );
    this.name = 'HashProviderUnavailableError';
    this.providerId = providerId;
  }
}

/** UTF-8 bytes of `text`, through the platform `TextEncoder`. */
export function utf8Bytes(text: string): Uint8Array {
  return textEncoder.encode(text);
}

/** Lowercase hex of a byte array, the shape hashes are displayed and compared in. */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/* -------------------------------------------------------------------------- */
/* Pure SHA-256                                                               */
/* -------------------------------------------------------------------------- */

/** First 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** First 32 bits of the fractional parts of the square roots of the first 8 primes. */
const INITIAL_STATE = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function rotateRight(value: number, shift: number): number {
  return ((value >>> shift) | (value << (32 - shift))) >>> 0;
}

/**
 * Pure SHA-256 over bytes.
 *
 * Padding is `0x80`, then zeros, then the message length in **bits** as a 64-bit
 * big-endian integer. That length field is written in two 32-bit words: using a
 * single word (or taking the byte length modulo 2^32) is the classic bug that
 * only shows past 512 MB, where two different messages would share a digest.
 */
export function sha256(bytes: Uint8Array): Uint8Array {
  const state = new Uint32Array(INITIAL_STATE);
  const messageLength = bytes.length;
  const paddedLength = Math.ceil((messageLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[messageLength] = 0x80;

  const view = new DataView(padded.buffer);
  const bitLengthHigh = Math.floor(messageLength / 0x2000_0000); // (length * 8) / 2^32
  const bitLengthLow = (messageLength * 8) >>> 0; // low 32 bits of length * 8
  view.setUint32(paddedLength - 8, bitLengthHigh, false);
  view.setUint32(paddedLength - 4, bitLengthLow, false);

  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = schedule[index - 15] as number;
      const previous2 = schedule[index - 2] as number;
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      schedule[index] =
        ((schedule[index - 16] as number) + sigma0 + (schedule[index - 7] as number) + sigma1) >>>
        0;
    }

    let a = state[0] as number;
    let b = state[1] as number;
    let c = state[2] as number;
    let d = state[3] as number;
    let e = state[4] as number;
    let f = state[5] as number;
    let g = state[6] as number;
    let h = state[7] as number;

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 =
        (h + sum1 + choose + (ROUND_CONSTANTS[index] as number) + (schedule[index] as number)) >>>
        0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] = ((state[0] as number) + a) >>> 0;
    state[1] = ((state[1] as number) + b) >>> 0;
    state[2] = ((state[2] as number) + c) >>> 0;
    state[3] = ((state[3] as number) + d) >>> 0;
    state[4] = ((state[4] as number) + e) >>> 0;
    state[5] = ((state[5] as number) + f) >>> 0;
    state[6] = ((state[6] as number) + g) >>> 0;
    state[7] = ((state[7] as number) + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let index = 0; index < 8; index += 1) {
    digestView.setUint32(index * 4, state[index] as number, false);
  }
  return digest;
}

/* -------------------------------------------------------------------------- */
/* Providers                                                                  */
/* -------------------------------------------------------------------------- */

/** True when this context exposes the asynchronous Web Crypto digest. */
export function hasWebCrypto(): boolean {
  return typeof globalThis.crypto?.subtle?.digest === 'function';
}

/** The real path: the platform's native SHA-256. */
export const webCryptoHashProvider: HashProvider = {
  id: 'webcrypto',
  async digest(bytes: Uint8Array): Promise<Uint8Array> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      throw new HashProviderUnavailableError('webcrypto');
    }
    // `subtle.digest` only accepts ArrayBuffer-backed views, so normalize away
    // a possibly SharedArrayBuffer-backed input with a single copy.
    const buffer = await subtle.digest(SHA256, new Uint8Array(bytes));
    return new Uint8Array(buffer);
  },
};

/** The fallback for non-secure contexts such as `file://`. */
export const pureHashProvider: HashProvider = {
  id: 'pure',
  async digest(bytes: Uint8Array): Promise<Uint8Array> {
    return sha256(bytes);
  },
};

/**
 * Resolves the provider to use.
 *
 * With no argument it returns Web Crypto when available and the pure
 * implementation otherwise. Passing an explicit id forces that provider, so both
 * can be tested (and compared) side by side. Forcing `webcrypto` in a context
 * without `crypto.subtle` throws instead of silently using the other one.
 */
export function resolveHashProvider(requested?: HashProviderId): HashProvider {
  if (requested === 'pure') {
    return pureHashProvider;
  }
  if (requested === 'webcrypto') {
    if (!hasWebCrypto()) {
      throw new HashProviderUnavailableError('webcrypto');
    }
    return webCryptoHashProvider;
  }
  return hasWebCrypto() ? webCryptoHashProvider : pureHashProvider;
}
