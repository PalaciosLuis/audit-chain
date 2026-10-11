/**
 * Public surface of the audit engine.
 *
 * AC-2 ships canonical serialization (`canonical.ts`) and SHA-256
 * (`hash.ts`). AC-3 will add the ledger and the chain verifier on top of these
 * two modules, so this barrel is the import point for the rest of the engine.
 */

export type { CanonicalErrorCode } from './canonical';
export { CanonicalError, canonicalize } from './canonical';
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
export type { HashProvider, HashProviderId, JsonPrimitive, JsonValue, LedgerEntry } from './types';
