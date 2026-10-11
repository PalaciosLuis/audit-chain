/**
 * Shared test environment.
 *
 * happy-dom ships an `IntersectionObserver` stub that never fires its callback,
 * so a block mounted lazily would stay pending forever in the DOM tests. The
 * lab documents and relies on the "no IntersectionObserver → load immediately"
 * fallback, so the tests exercise exactly that path by removing the stub. The
 * observer path itself is covered by `tests/lazy.test.ts`.
 */
Reflect.deleteProperty(globalThis, 'IntersectionObserver');
