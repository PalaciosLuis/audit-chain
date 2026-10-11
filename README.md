# audit-chain

Interactive explainer: **a tamper-evident audit log**. A real SHA-256 hash chain, Merkle tree,
root anchoring and an ECDSA-signed export run in your browser with Web Crypto — there is no
server, ever.

## 1. Demo

**Live:** https://audit-chain-six.vercel.app

Status: the scaffold is published and redeploys on every push. The page currently renders the
nine content blocks with explicit `TODO` markers; the engine (AC-2 to AC-5) and the interactive
lab and animated hero (AC-6, AC-7) are the next work units, and a recorded demo GIF lands with
AC-9.

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

The lab controls (add entries, alter entry #4, delete a row, reorder, insert retroactively, inspect
the Merkle tree and the anchor timeline, export a signed package) are not implemented yet, which is
why the live page is read-only today: it is the shell, not the demo. When AC-7 lands, this section
lists the exact clicks and what should happen after each one.

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

The injectable hash provider ADR (Web Crypto with a pure-TypeScript fallback, both validated
against NIST vectors) is part of AC-2 and is not written yet.

## 7. Evidence

Measured on the AC-1 scaffold with `pnpm build` and `pnpm budget` (Node 22.23.3, Vite 8.3.4);
`pnpm budget` is the source of truth for these numbers, and they were regenerated after the
accessibility token fix:

| Metric | Measured | Budget | Result |
| --- | --- | --- | --- |
| Initial JS (gzip) | 3.38 KB | < 60 KB | OK |
| CSS (gzip) | 2.69 KB | < 20 KB | OK |
| Largest single asset (raw) | 9.94 KB | < 200 KB | OK |
| Whole `dist` (raw) | 20.82 KB | < 400 KB | OK |

| Lighthouse (performance / accessibility / best-practices / SEO) | 99 / 100 / 96 / 100 | ≥ 0.95 each | OK |

The four Lighthouse categories are asserted in CI on every push, so they cannot regress silently.
Still pending, each added by the task that produces it: the NIST vectors the hash provider must
satisfy (AC-2), the handled tampering types with the test that proves each one (AC-3), and the
verification time for a 10,000-entry chain (AC-4).

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
