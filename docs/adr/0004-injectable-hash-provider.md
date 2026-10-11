# 0004. Injectable hash provider: Web Crypto with a pure fallback

## Context

The page's honesty seal says the hash the visitor sees is computed in their browser with real Web
Crypto, and there is no server. That means SHA-256 is not an illustration; it is the product. The
hash function therefore has to be correct, and the chain in AC-3 has to produce the same digest on
every machine and in every context the page is opened in.

One context breaks the assumption: `crypto.subtle` is only exposed in a **secure context**
(`https://`, `localhost`, or a packaged app). A visitor who downloads the built `dist/index.html`
and opens it from `file://` gets `globalThis.crypto` but not `crypto.subtle`. If the engine calls
`subtle.digest` unconditionally, the demo fails exactly where a curious visitor is most likely to
try it: offline, from a local file.

The requirements also make testing non-negotiable. The engine must be checked against official NIST
vectors, and the whole point of a hash is that "it looked fine in the demo" is not evidence.

## Decision

Put SHA-256 behind a small `HashProvider` interface in `src/engine/hash.ts` and ship two
implementations:

```ts
interface HashProvider {
  readonly id: 'webcrypto' | 'pure';
  digest(bytes: Uint8Array): Promise<Uint8Array>;
}
```

- **`webcryptoHashProvider`** (`id: 'webcrypto'`) wraps `crypto.subtle.digest('SHA-256', bytes)`.
  This is the real path and the default whenever `globalThis.crypto?.subtle` exists.
- **`pureHashProvider`** (`id: 'pure'`) is a from-scratch SHA-256 written in this repository over
  `Uint8Array` and `DataView`. It has no dependency and no vendored library file. Its padding
  writes the message length as a **64-bit big-endian** value in two 32-bit words; a single 32-bit
  word (or byte length modulo 2^32) is the classic bug that only appears past 512 MB. Input strings
  go through `TextEncoder`, so multi-byte and astral characters are handled by the platform.

`resolveHashProvider(requested?)` returns Web Crypto when available and the pure provider otherwise.
Passing an explicit id forces one provider, so both can be exercised side by side; forcing
`'webcrypto'` where `subtle` is missing throws a typed `HashProviderUnavailableError` instead of
silently downgrading. `digest` is `async` on both providers so callers never branch on which one
they hold.

Both providers are validated against the same NIST/FIPS 180-4 vectors: the empty string, `"abc"`,
the 448-bit and 896-bit multi-block messages, and the one-million-character message, plus a
cross-provider property test over generated inputs. A vector that passes in only one provider is a
failure, not a partial pass.

## Consequences

- The demo works from `https://`, `localhost` and `file://`. The pure provider is the only reason
  the third case works, and it is a first-class, tested path rather than a development stub.
- The security boundary is explicit: the pure provider is not constant-time and is not intended for
  adversarial input in production. It is a demo fallback whose correctness is proven by vectors; the
  README and the page copy say so rather than implying the pure path is production-grade.
- Two implementations of the same algorithm stay honest because the test suite compares them
  directly. Any divergence at a length boundary fails CI immediately.
- Slightly more code than a one-line `subtle.digest` call, and the pure implementation is a
  maintenance surface: it must never drift from the algorithm, which is what the NIST vectors and
  the cross-provider property test are for.
- The same interface is the seam AC-3 (ledger and chain verification), AC-4 (Merkle and anchoring)
  and AC-5 (ECDSA-signed export) build on, so none of them hard-code a global.

## Alternatives considered

- **Web Crypto only.** Least code and fastest, but the built page fails when opened from `file://`,
  which is a context visitors use, and testing would depend entirely on the host providing
  `crypto.subtle`.
- **Pure TypeScript implementation only.** Works everywhere and is fully deterministic, but it
  throws away the platform primitive and contradicts the page's claim that the browser's real Web
  Crypto does the work. It is also slower and not constant-time.
- **Bundle a small SHA-256 library (`js-sha256`, `hash-wasm`).** Well-tested and fast (`hash-wasm`
  is WASM-backed), but it is a dependency for ~100 lines of code, against the zero-dependency
  decision in ADR-0001, and a WASM blob complicates the bundle budget and the `file://` story. As a
  benefit we would lose the "the implementation is right here and validated against NIST" evidence.
- **Use the platform `SubtleCrypto` polyfill.** A polyfill file is still a vendored implementation
  with the same trust question, plus an API-shape layer we do not need.
- **Compute hashes on the server.** Impossible by design: there is no server.
