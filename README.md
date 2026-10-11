# audit-chain

Interactive explainer: **a tamper-evident audit log**. A real SHA-256 hash chain, Merkle tree,
root anchoring and an ECDSA-signed export run in your browser with Web Crypto — there is no
server, ever.

## 1. Demo

**Live:** https://audit-chain-six.vercel.app

Status: the engine and the first four blocks are published and redeploy on every push. Blocks 1 to
4 carry the argument and a working chain builder that shows real digests; blocks 5 to 9 still render
explicit `TODO` markers, and a recorded demo GIF lands with AC-9.

## 2. Problem

A log that anyone with database access can edit or delete without leaving a trace is not
evidence. The access history looks intact even after someone removed a health-record access and
changed a transaction. Cryptography fixes that: a hash chain makes every entry depend on the one
before it, and any change breaks the chain from that point forward.

This page shows both sides — the untouched table, and what really happened — and then lets you
tamper with a real chain and watch the verification break exactly where it should.

## 3. Constraints

- **Static deploy on Vercel Hobby.** No server, no database, no queue, no Docker. Everything runs
  in the browser.
- **Real engine, not an animation.** Hashing and signing use Web Crypto on the visitor's machine.
- **Zero runtime dependencies.** No animation, charting or i18n libraries. System fonts only, so
  the page pulls no web fonts, and there are no third-party requests: the only image the browser
  fetches is the same-origin `/favicon.svg`.
- **Bilingual ES/EN** with a visible toggle, without an i18n library.
- **Performance is budgeted** and enforced in CI, alongside accessibility, keyboard support and
  `prefers-reduced-motion`.

## 4. Try it in 30 seconds

<!-- TODO (AC-7): replace this with the exact clicks and the expected result once block 5 lands. -->

Block 3 is already interactive: type the content of an entry, add it to the chain and watch its real
SHA-256 appear, linked to the previous hash, with the canonical bytes that were hashed shown right
above it. Edit an earlier entry and every later digest changes.

The lab controls in block 5 (alter entry #4, delete a row, reorder, insert retroactively, inspect the
Merkle tree and the anchor timeline, export a signed package) are not implemented yet; AC-7 adds
them, and this section will list the exact clicks and what should happen after each one.

## 5. What it teaches

- Why an unprotected audit log is not evidence, and how a hash chain fixes it.
- Why recomputing the hash of a tampered row is not enough: the forward links still break.
- How a Merkle tree lets you prove a single entry is included in the log.
- How periodically anchoring the root proves *when* tampering happened.
- How an ECDSA-signed export becomes invalid the moment the chain is touched.

## 6. Key decisions

| ADR | Decision |
| --- | --- |
| [ADR-0001](docs/adr/0001-typescript-without-a-framework.md) | TypeScript and the DOM directly, no UI framework |
| [ADR-0002](docs/adr/0002-own-i18n-layer-without-a-library.md) | A hand-written i18n layer instead of an i18n library |
| [ADR-0003](docs/adr/0003-canonical-serialization-for-audit-entries.md) | Canonical serialization of an entry before hashing |
| [ADR-0004](docs/adr/0004-injectable-hash-provider.md) | Injectable hash provider: Web Crypto with a pure SHA-256 fallback, both against NIST vectors |
| [ADR-0005](docs/adr/0005-chain-scope-per-tenant-partition.md) | One chain per tenant or partition, not one global chain |
| [ADR-0006](docs/adr/0006-merkle-odd-node-rule.md) | Merkle odd-node rule: duplicate the last node |

## 7. Evidence

Measured after the engine landed, with `pnpm build` and `pnpm budget` (Node 22.23.3, Vite 8.3.4);
`pnpm budget` is the source of truth for these numbers:

| Metric | Measured | Budget | Result |
| --- | --- | --- | --- |
| Initial JS (gzip) | 14.59 KB | < 60 KB | OK |
| CSS (gzip) | 3.96 KB | < 20 KB | OK |
| Largest single asset (raw) | 41.93 KB | < 200 KB | OK |
| Whole `dist` (raw) | 62.01 KB | < 400 KB | OK |

| Lighthouse (performance / accessibility / best-practices / SEO) | 99 / 100 / 96 / 100 | ≥ 0.95 each | OK |

The four Lighthouse categories are asserted in CI on every push, so they cannot regress silently.

The engine evidence is measured, not asserted:

- **NIST vectors.** Both SHA-256 providers (`webcrypto` and `pure`) match the FIPS 180-4 vectors for
the empty string, `"abc"`, the 448-bit and 896-bit multi-block messages and the one-million-byte
message (`tests/engine/hash.test.ts`).
- **Five classified tampering kinds.** `verifyChain` names what happened and where:
`content_tampered`, `entry_deleted`, `entries_reordered`, `entry_inserted` and `genesis_mismatch`.
Each has a test that asserts the exact `kind` *and* the exact `index` (`tests/engine/verify.test.ts`),
including the subtle case where an attacker recomputes the altered row's own hash and is still
caught by the forward link.
- **10,000-entry verification time: 530.9 ms** (wall clock, `verifyChain` only, no chain
construction; Node 22.23.3 under happy-dom using `crypto.subtle.digest`, the same Web Crypto API the
browser runs — not yet re-measured in a browser). See `tests/engine/performance.test.ts`.
- **Merkle proofs.** Every index of several trees (including odd leaf counts) verifies against the
root, a changed leaf invalidates the tree's proofs, and the empty and single-leaf cases are pinned
(`tests/engine/merkle.test.ts`).
- **Anchors.** An old anchor verifies against an untouched prefix and stops verifying once that
prefix moves; an anchor taken *after* a change still verifies (`tests/engine/anchor.test.ts`).
- **Signed export.** A real ECDSA P-256 signature over the canonical bytes of the package verifies
on an intact chain, fails after any entry is touched, and does not verify under another key
(`tests/engine/export.test.ts`).

## 8. How to run it

```bash
pnpm install
pnpm dev     # http://localhost:5173
pnpm test    # the Vitest suite
```

## 9. What I'd do differently

The scaffold keeps language and theme state in module-level variables so the DOM stays trivial.
That is fine for two booleans, but the moment the lab needs shared state I would introduce a small
explicit store rather than more module singletons. I would also add the injectable hash provider
boundary (AC-2) before writing any UI, so the demo depends on a tested interface instead of a
concrete Web Crypto call.
