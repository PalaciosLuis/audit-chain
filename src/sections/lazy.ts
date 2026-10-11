import { t } from '../i18n/t';

/** Lifecycle of a lazily mounted block, mirrored on `data-lazy-state`. */
export type LazyState = 'pending' | 'loading' | 'ready' | 'failed';

export interface LazyBlockOptions {
  /** Builds the real body once, the first time the block is needed. */
  readonly loader: () => Promise<void> | void;
  /** Distance ahead of the viewport at which the block starts loading. */
  readonly rootMargin?: string;
}

/** Attribute that carries the current `LazyState`, so tests can wait on it. */
export const LAZY_STATE_ATTRIBUTE = 'data-lazy-state';

function setState(container: HTMLElement, state: LazyState): void {
  container.setAttribute(LAZY_STATE_ATTRIBUTE, state);
}

/**
 * Mounts a heavy block body only when it approaches the viewport.
 *
 * The first paint never pays for the real body: a lightweight placeholder is
 * rendered instead, and the loader runs once, the first time the block is
 * within `rootMargin` of the viewport. The block's load state is mirrored on
 * `data-lazy-state` (`pending`, `loading`, `ready`, `failed`) so the DOM tests
 * can wait for `ready`.
 *
 * The fallback is deliberately safe: when `IntersectionObserver` is not
 * available the loader starts immediately, rather than never.
 */
export function mountLazyBlock(container: HTMLElement, options: LazyBlockOptions): void {
  const placeholder = document.createElement('p');
  placeholder.className = 'block__placeholder';
  placeholder.dataset.i18n = 'lazy.pending';
  placeholder.textContent = t('lazy.pending');
  container.append(placeholder);
  setState(container, 'pending');

  let started = false;

  const start = (): void => {
    if (started) {
      return;
    }
    started = true;
    setState(container, 'loading');
    void Promise.resolve()
      .then(() => options.loader())
      .then(() => {
        placeholder.remove();
        setState(container, 'ready');
      })
      .catch((error: unknown) => {
        // A block that failed to load must not look like a block that loaded
        // nothing, so the placeholder stays and the failure is logged.
        setState(container, 'failed');
        console.error('The lazy block failed to load', error);
      });
  };

  const observerCtor = globalThis.IntersectionObserver;
  if (typeof observerCtor !== 'function') {
    start();
    return;
  }

  const observer = new observerCtor(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        start();
      }
    },
    { rootMargin: options.rootMargin ?? '200px 0px' },
  );
  observer.observe(container);
}
