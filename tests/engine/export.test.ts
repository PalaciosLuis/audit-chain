import { afterEach, describe, expect, it, vi } from 'vitest';

import { alterEntry, createChain } from '../../src/engine/ledger';
import type { RawRecord } from '../../src/engine/ledger';
import {
  SigningUnavailableError,
  buildExportPackage,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateKeyPair,
  importPrivateKeyJwk,
  importPublicKeyJwk,
  signChain,
  signPackage,
  verifyPackage,
  verifySignedPackage,
} from '../../src/engine/export';

/**
 * The export package is signed with real ECDSA P-256 over the canonical bytes of
 * `{ chain, root, anchors }`. The signature is the last line of defence: it stops
 * verifying the moment any field of the package changes, including a single
 * audit entry. Signing uses `crypto.subtle`, so unlike hashing there is no pure
 * fallback: a context without Web Crypto cannot sign, and the engine says so.
 */

function record(index: number): RawRecord {
  return {
    timestamp: 1_700_000_000_000 + index,
    actor: `actor-${index}`,
    action: 'read',
    resource: `record:HC-${index}`,
    payload: { index, tags: ['audit', `p${index}`] },
  };
}

const RECORDS: readonly RawRecord[] = Array.from({ length: 5 }, (_, index) => record(index));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('key material as JWK', () => {
  it('generates extractable P-256 keys and round-trips them through JWK', async () => {
    const pair = await generateKeyPair();
    const publicJwk = await exportPublicKeyJwk(pair.publicKey);
    const privateJwk = await exportPrivateKeyJwk(pair.privateKey);

    expect(publicJwk.kty).toBe('EC');
    expect(publicJwk.crv).toBe('P-256');
    expect(publicJwk.x).toBeTypeOf('string');
    expect(privateJwk.d).toBeTypeOf('string');

    const importedPublic = await importPublicKeyJwk(publicJwk);
    const importedPrivate = await importPrivateKeyJwk(privateJwk);

    const chain = await createChain(RECORDS);
    const pkg = await buildExportPackage(chain);
    const signature = await signPackage(pkg, importedPrivate);
    expect(await verifyPackage(pkg, signature, importedPublic)).toBe(true);
  });
});

describe('signChain / verifySignedPackage', () => {
  it('signs a package containing the chain, its root and its anchors', async () => {
    const pair = await generateKeyPair();
    const chain = await createChain(RECORDS);
    const signed = await signChain(chain, pair, { every: 2 });

    expect(signed.algorithm).toBe('ECDSA-P256-SHA256');
    expect(signed.package.version).toBe(1);
    expect(signed.package.chain).toHaveLength(RECORDS.length);
    expect(signed.package.root).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.package.anchors.map((anchor) => anchor.entryCount)).toEqual([2, 4, 5]);
    expect(signed.publicKey.kty).toBe('EC');
    expect(signed.signature).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('verifies a signature on an intact chain', async () => {
    const pair = await generateKeyPair();
    const signed = await signChain(await createChain(RECORDS), pair, { every: 2 });
    expect(await verifySignedPackage(signed, pair.publicKey)).toBe(true);
    // The embedded public key is a valid fallback verifier too.
    expect(await verifySignedPackage(signed)).toBe(true);
  });

  it('stops verifying the moment any entry is touched', async () => {
    const pair = await generateKeyPair();
    const chain = await createChain(RECORDS);
    const signed = await signChain(chain, pair, { every: 2 });

    for (let index = 0; index < chain.length; index += 1) {
      const tampered = await alterEntry(chain, index, { action: 'exfiltrate' });
      const tamperedPackage = await buildExportPackage(tampered, { every: 2 });
      expect(await verifyPackage(tamperedPackage, signed.signature, pair.publicKey)).toBe(false);
      const tamperedSigned = { ...signed, package: tamperedPackage };
      expect(await verifySignedPackage(tamperedSigned, pair.publicKey)).toBe(false);
    }
  });

  it('does not verify a signature made with another key', async () => {
    const signer = await generateKeyPair();
    const other = await generateKeyPair();
    const signed = await signChain(await createChain(RECORDS), signer, { every: 2 });

    expect(await verifySignedPackage(signed, other.publicKey)).toBe(false);
    expect(await verifySignedPackage(signed, signer.publicKey)).toBe(true);
  });

  it('rejects a corrupted signature string', async () => {
    const pair = await generateKeyPair();
    const signed = await signChain(await createChain(RECORDS), pair);
    const corrupted = { ...signed, signature: 'AAAA' };
    expect(await verifySignedPackage(corrupted, pair.publicKey)).toBe(false);
  });
});

describe('no pure signing fallback', () => {
  it('throws a typed error when Web Crypto is unavailable', async () => {
    vi.stubGlobal('crypto', {});
    await expect(generateKeyPair()).rejects.toBeInstanceOf(SigningUnavailableError);

    const chain = await createChain(RECORDS);
    vi.unstubAllGlobals();
    const pair = await generateKeyPair();
    vi.stubGlobal('crypto', {});
    await expect(signChain(chain, pair)).rejects.toBeInstanceOf(SigningUnavailableError);
    expect(new SigningUnavailableError().code).toBe('signing_unavailable');
  });
});
