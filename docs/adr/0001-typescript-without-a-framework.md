# 0001. TypeScript without a framework

## Context

`audit-chain` is an interactive explainer about tamper-evident audit logs. The page ships a real
cryptographic engine (SHA-256 hash chain, Merkle tree, ECDSA-signed export) that runs in the
visitor's browser, and it must deploy as static files with no server, no database and no backend.
Two things are part of the message: the engine has to be real and auditable, and the page has to
feel like a purpose-built tool rather than a scaffolded app. The surrounding portfolio also builds
other pages where complex state justifies a framework, so this page is where the platform itself
is on display.

## Decision

Build the page with Vite + TypeScript and the DOM APIs directly. No UI framework, no runtime
dependencies, no animation, charting or i18n libraries. TypeScript runs in strict mode with
`noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch` and
`verbatimModuleSyntax`.

## Consequences

- The first render stays tiny, which is itself a claim the page makes and has to prove.
- The engine (`src/engine/`) is written as plain, testable TypeScript with no framework coupling,
  so it can be validated against official NIST vectors in isolation.
- Every DOM update is explicit. There is no reactivity to lean on, so re-rendering has to be
  intentional and tested (for example, the language toggle re-applies copy to `[data-i18n]` nodes).
- More hand-written wiring than a framework would require, and no component model to hide it.
- Accessibility, focus management and reduced-motion handling are our responsibility end to end.
- The build stays a single static directory that any static host can serve.

## Alternatives considered

- **Vue 3 + Pinia.** Used elsewhere in this portfolio for pages with genuinely complex state.
  Rejected here because the interactive state (a chain plus a few toggles) is small, and adding a
  runtime to a page whose thesis is "you can prove this with the platform" would undercut it.
- **React.** Same reasoning, plus a larger runtime and a build/config surface we do not need.
- **Svelte.** Compiles away and has a small runtime, but the same DOM wiring is already short
  enough here, and the engine would still be framework-independent either way.
- **No build step.** Rejected because we want type checking, a predictable bundler and a bundle
  budget gate in CI.
