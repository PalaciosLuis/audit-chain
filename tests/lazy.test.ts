import { afterEach, describe, expect, it, vi } from 'vitest';

import { mountLazyBlock } from '../src/sections/lazy';

/**
 * The lazy mount is what keeps the heaviest block out of the first paint. Two
 * contracts matter: the first render never pays for the body, and the body is
 * never permanently missing — neither when the observer fires late nor when it
 * cannot fire at all.
 */

interface FakeEntry {
  readonly isIntersecting: boolean;
  readonly target: Element;
}

class FakeObserver {
  static latest: FakeObserver | null = null;

  readonly observed: Element[] = [];
  disconnected = false;

  private readonly notify: (entries: readonly FakeEntry[]) => void;

  constructor(callback: (entries: readonly FakeEntry[]) => void) {
    this.notify = callback;
    FakeObserver.latest = this;
  }

  observe(target: Element): void {
    this.observed.push(target);
  }

  unobserve(): void {
    // Not needed by the lazy mount.
  }

  disconnect(): void {
    this.disconnected = true;
  }

  takeRecords(): readonly FakeEntry[] {
    return [];
  }

  report(isIntersecting: boolean): void {
    this.notify(this.observed.map((target) => ({ isIntersecting, target })));
  }
}

function target(): HTMLElement {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakeObserver.latest = null;
});

describe('mountLazyBlock', () => {
  it('renders a placeholder and loads immediately when IntersectionObserver is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const container = target();
    const loader = vi.fn();

    mountLazyBlock(container, { loader });

    expect(container.dataset.lazyState).toBe('loading');
    expect((container.textContent ?? '').trim().length).toBeGreaterThan(0);

    await vi.waitFor(() => {
      expect(container.dataset.lazyState).toBe('ready');
    });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(container.textContent?.trim()).toBe('');
  });

  it('stays pending until the observer reports an intersection, then loads once', async () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const container = target();
    const loader = vi.fn();

    mountLazyBlock(container, { loader });
    const observer = FakeObserver.latest;
    expect(observer).not.toBeNull();
    expect(observer?.observed).toContain(container);
    expect(container.dataset.lazyState).toBe('pending');
    expect(loader).not.toHaveBeenCalled();

    observer?.report(false);
    expect(loader).not.toHaveBeenCalled();

    observer?.report(true);
    await vi.waitFor(() => {
      expect(container.dataset.lazyState).toBe('ready');
    });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(observer?.disconnected).toBe(true);
  });

  it('marks a rejected load instead of leaving the block pending forever', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const container = target();
    const failure = new Error('boom');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    mountLazyBlock(container, {
      loader: () => {
        throw failure;
      },
    });

    await vi.waitFor(() => {
      expect(container.dataset.lazyState).toBe('failed');
    });
    expect(logged).toHaveBeenCalled();
    expect((container.textContent ?? '').trim().length).toBeGreaterThan(0);
  });
});
