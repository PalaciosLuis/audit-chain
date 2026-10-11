/**
 * Signed export: a real ECDSA P-256 signature over the canonical bytes of the
 * package `{ version, root, anchors, chain }`.
 *
 * The signature is the last line of defence. It covers the whole package, so it
 * stops verifying the moment *any* field changes — including a single audit
 * entry. Someone who rewrites the chain and re-signs it with their own key can
 * only produce a signature that verifies under *their* public key, never under
 * the original one.
 *
 * **Secure-context requirement.** Signing and key generation go through
 * `crypto.subtle`, which only exists in a secure context (`https://`,
 * `localhost`, a packaged app). The engine has a pure-SHA-256 fallback for
 * *hashing* so the page still works from `file://`, but there is deliberately no
 * pure signing fallback: hand-rolling ECDSA is not something a teaching demo
 * should do. Where `crypto.subtle` is missing, the signing functions throw
 * {@link SigningUnavailableError} instead of failing quietly.
 *
 * Keys are generated extractable and can be exported/imported as JWK, so the lab
 * can show the public key next to the verification result.
 */

import { anchorRoot } from './anchor';
import type { Anchor } from './anchor';
import { canonicalize } from './canonical';
import { hasWebCrypto } from './hash';
import type { ChainedEntry, LedgerChain } from './ledger';
import { merkleRoot } from './merkle';
import type { HashProvider } from './types';

const ECDSA: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_PARAMS: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' };
const ALGORITHM = 'ECDSA-P256-SHA256' as const;
const DEFAULT_ANCHOR_EVERY = 100;

/** Raised when signing is attempted without `crypto.subtle`. */
export class SigningUnavailableError extends Error {
  readonly code = 'signing_unavailable';

  constructor() {
    super(
      'ECDSA signing requires Web Crypto (crypto.subtle), which only exists in a secure context. ' +
        'The engine has a pure SHA-256 fallback for hashing but no pure signing fallback.',
    );
    this.name = 'SigningUnavailableError';
  }
}

function requireSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!hasWebCrypto() || !subtle) {
    throw new SigningUnavailableError();
  }
  return subtle;
}

/** The unsigned artifact: everything the signature has to cover. */
export interface ExportPackage {
  readonly version: 1;
  /** Merkle root over the entry hashes. */
  readonly root: string;
  /** Anchors over chain prefixes. */
  readonly anchors: readonly Anchor[];
  /** The full chain, so the signature covers every entry, not just the root. */
  readonly chain: readonly ChainedEntry[];
}

/** The signed artifact, portable as JSON. */
export interface SignedPackage {
  readonly algorithm: typeof ALGORITHM;
  readonly package: ExportPackage;
  /** Base64 ECDSA P-256 / SHA-256 signature over `canonicalize(package)`. */
  readonly signature: string;
  /** The signer's public key as JWK, shown next to the verification result. */
  readonly publicKey: JsonWebKey;
}

/** Options shared by package building and signing. */
export interface ExportOptions {
  /** Anchoring interval, in entries. Defaults to 100. */
  readonly every?: number;
  readonly provider?: HashProvider;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** True when a key-like value is a JWK (has `kty`) rather than a `CryptoKey`. */
function isJwk(key: CryptoKey | JsonWebKey): key is JsonWebKey {
  return 'kty' in key;
}

/** Generates an extractable ECDSA P-256 key pair. */
export async function generateKeyPair(): Promise<CryptoKeyPair> {
  const subtle = requireSubtle();
  return subtle.generateKey(ECDSA, true, ['sign', 'verify']);
}

/** Exports a public key as JWK (also usable inside `JSON.stringify`). */
export async function exportPublicKeyJwk(key: CryptoKey): Promise<JsonWebKey> {
  const subtle = requireSubtle();
  return subtle.exportKey('jwk', key);
}

/** Exports a private key as JWK. */
export async function exportPrivateKeyJwk(key: CryptoKey): Promise<JsonWebKey> {
  const subtle = requireSubtle();
  return subtle.exportKey('jwk', key);
}

/** Imports a public key from JWK. */
export async function importPublicKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  const subtle = requireSubtle();
  return subtle.importKey('jwk', jwk, ECDSA, true, ['verify']);
}

/** Imports a private key from JWK. */
export async function importPrivateKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  const subtle = requireSubtle();
  return subtle.importKey('jwk', jwk, ECDSA, true, ['sign']);
}

/** Builds the export package (chain + root + anchors) without signing it. */
export async function buildExportPackage(
  chain: LedgerChain,
  options: ExportOptions = {},
): Promise<ExportPackage> {
  const every = options.every ?? DEFAULT_ANCHOR_EVERY;
  const root = await merkleRoot(
    chain.map((entry) => entry.hash),
    options.provider,
  );
  const anchors = await anchorRoot(chain, every, options.provider);
  return { version: 1, root, anchors, chain };
}

/** Signs the canonical bytes of a package, returning a base64 signature. */
export async function signPackage(pkg: ExportPackage, privateKey: CryptoKey): Promise<string> {
  const subtle = requireSubtle();
  // Copy into a fresh ArrayBuffer-backed view: `subtle.sign` wants a
  // `BufferSource<ArrayBuffer>`, and `canonicalize` may be backed by either.
  const bytes = new Uint8Array(canonicalize(pkg));
  const signature = await subtle.sign(SIGN_PARAMS, privateKey, bytes);
  return bytesToBase64(new Uint8Array(signature));
}

/** Verifies a base64 signature over the canonical bytes of a package. */
export async function verifyPackage(
  pkg: ExportPackage,
  signature: string,
  publicKey: CryptoKey,
): Promise<boolean> {
  const subtle = requireSubtle();
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64ToBytes(signature);
  } catch {
    return false;
  }
  return subtle.verify(
    SIGN_PARAMS,
    publicKey,
    new Uint8Array(signatureBytes),
    new Uint8Array(canonicalize(pkg)),
  );
}

/** Builds and signs the export package in one step. */
export async function signChain(
  chain: LedgerChain,
  keyPair: CryptoKeyPair,
  options: ExportOptions = {},
): Promise<SignedPackage> {
  const pkg = await buildExportPackage(chain, options);
  const signature = await signPackage(pkg, keyPair.privateKey);
  const publicKey = await exportPublicKeyJwk(keyPair.publicKey);
  return { algorithm: ALGORITHM, package: pkg, signature, publicKey };
}

/**
 * Verifies a signed package. Pass the expected public key (as a `CryptoKey` or
 * a JWK) to be sure of *who* signed; omit it to use the key embedded in the
 * artifact, which proves integrity but not authorship.
 */
export async function verifySignedPackage(
  signed: SignedPackage,
  publicKey?: CryptoKey | JsonWebKey,
): Promise<boolean> {
  const key =
    publicKey === undefined
      ? await importPublicKeyJwk(signed.publicKey)
      : isJwk(publicKey)
        ? await importPublicKeyJwk(publicKey)
        : publicKey;
  return verifyPackage(signed.package, signed.signature, key);
}
