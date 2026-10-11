/**
 * Public surface of the audit engine.
 *
 * AC-2 ships canonical serialization (`canonical.ts`) and SHA-256 (`hash.ts`).
 * AC-3 to AC-5 add the chain (`ledger.ts`), the classifier (`verify.ts`), the
 * Merkle tree (`merkle.ts`), anchoring (`anchor.ts`) and the signed export
 * (`export.ts`). This barrel is the import point for the rest of the engine.
 */

export type { Anchor, AnchorCheck } from './anchor';
export { anchorRoot, verifyAnchor } from './anchor';
export type { CanonicalErrorCode } from './canonical';
export { CanonicalError, canonicalize } from './canonical';
export type { ExportOptions, ExportPackage, SignedPackage } from './export';
export {
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
} from './export';
export {
  HashProviderUnavailableError,
  bytesToHex,
  hasWebCrypto,
  pureHashProvider,
  resolveHashProvider,
  sha256,
  utf8Bytes,
  webCryptoHashProvider,
} from './hash';
export type { ChainedEntry, LedgerChain, RawRecord } from './ledger';
export {
  GENESIS_HASH,
  alterEntry,
  append,
  createChain,
  deleteEntry,
  entryPreimage,
  hashEntry,
  insertEntry,
  swapEntries,
} from './ledger';
export type { MerkleProofNode, ProofSide } from './merkle';
export { EMPTY_ROOT, merkleProof, merkleRoot, verifyProof } from './merkle';
export type { HashProvider, HashProviderId, JsonPrimitive, JsonValue, LedgerEntry } from './types';
export type { BreakKind, ChainBreak, VerificationResult } from './verify';
export { verifyChain } from './verify';
