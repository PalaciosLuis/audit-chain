# 0002. Own the i18n layer instead of adding a library

## Context

The page is bilingual (Spanish and English) with a visible ES/EN toggle. Copy lives in per-project
JSON dictionaries, the active language comes from `?lang=` in the URL, then `localStorage`, then
`navigator.language`, and the toggle has to re-render the visible copy immediately. The project
also treats the toggle as a piece of frontend craft that is demonstrated, not hidden. The whole
page must run with zero runtime dependencies and stay inside a tight bundle budget.

## Decision

Write a small, dependency-free i18n layer: `src/i18n/es.json`, `src/i18n/en.json`, and a `t(key,
vars?)` helper in `src/i18n/t.ts`. Language resolution and persistence live in the same module.
The shell marks translatable nodes with `data-i18n` / `data-i18n-aria-label`, and a single
`applyTranslations()` pass re-applies every string when the language changes. A test asserts that
both dictionaries share exactly the same key set and that every key referenced by the shell exists
in both.

## Consequences

- Zero added runtime weight and no supply-chain surface for a feature that is ~60 lines of code.
- The behaviour is fully testable: key parity, key coverage, variable substitution and the toggle
  are all covered by `tests/i18n.test.ts` and `tests/shell.test.ts`.
- We own the edge cases. Missing keys fall back to Spanish and then to the key itself, which is easy
  to reason about but is not a substitute for a schema at build time.
- No pluralisation, ICU message format, date/number localisation or lazy per-locale bundles. If the
  copy ever needs those, this decision should be revisited.
- Key parity is enforced by a test rather than by the type system; a missing key fails CI, not the
  editor.

## Alternatives considered

- **i18next.** Mature and feature-rich, but it is a runtime dependency with configuration we do not
  need for two flat dictionaries.
- **FormatJS / react-intl.** Oriented around ICU messages and a React tree; neither applies here.
- **vue-i18n.** Tied to the framework we deliberately did not adopt (see ADR-0001).
- **`node-polyglot`.** Small, but still a dependency for behaviour we can implement in a few lines.
- **Build-time code generation from the dictionaries.** Attractive for type safety, but it adds a
  generation step before dev and test; the parity test gives us the guarantee at lower cost for now.
