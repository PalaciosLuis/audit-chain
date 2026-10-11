import { initLang, isLang, setLang, t, type Lang } from './i18n/t';
import { BLOCKS } from './sections';
import { createBlock, type BlockSpec } from './sections/base';
import { initTheme, setTheme, type Theme } from './theme';

export interface MountOptions {
  readonly lang?: Lang;
  readonly theme?: Theme;
}

const THEME_ICON = '◐';

function shellMarkup(): string {
  return `
    <a class="skip-link" href="#main" data-i18n="shell.skip">Skip to content</a>
    <header class="site-header">
      <div class="wrap site-header__inner">
        <h1 class="brand" data-i18n="app.title">Audit Chain</h1>
        <div class="controls">
          <div class="lang-toggle" role="group" data-i18n-aria-label="shell.lang.aria">
            <button type="button" class="toggle-button" data-lang="es">ES</button>
            <button type="button" class="toggle-button" data-lang="en">EN</button>
          </div>
          <button type="button" class="toggle-button toggle-button--icon" data-action="theme">
            <span aria-hidden="true">${THEME_ICON}</span>
          </button>
        </div>
      </div>
    </header>
    <div class="wrap layout">
      <nav class="side-index" data-i18n-aria-label="shell.index.aria">
        <p class="side-index__title" data-i18n="shell.index">Index</p>
        <p class="side-index__progress-label" data-progress-label></p>
        <div class="progress" aria-hidden="true"><span class="progress__bar" data-progress-bar></span></div>
        <ol class="side-index__list" data-index-list></ol>
      </nav>
      <main id="main" class="content" tabindex="-1"></main>
    </div>
    <footer class="site-footer">
      <div class="wrap">
        <p class="honesty" data-i18n="honesty.seal">
          Everything you see runs in your browser; the hash and the signature are real.
        </p>
      </div>
    </footer>
  `;
}

function createIndexItem(block: BlockSpec): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'side-index__item';

  const link = document.createElement('a');
  link.className = 'side-index__link';
  link.href = `#${block.id}`;

  const num = document.createElement('span');
  num.className = 'side-index__num';
  num.setAttribute('aria-hidden', 'true');
  num.textContent = String(block.num).padStart(2, '0');

  const label = document.createElement('span');
  label.className = 'side-index__label';
  label.dataset.i18n = block.titleKey;
  label.textContent = t(block.titleKey);

  link.append(num, label);
  item.append(link);
  return item;
}

function applyTranslations(scope: ParentNode): void {
  for (const element of scope.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = element.dataset.i18n;
    if (key !== undefined) {
      element.textContent = t(key);
    }
  }
  for (const element of scope.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
    const key = element.dataset.i18nAriaLabel;
    if (key !== undefined) {
      element.setAttribute('aria-label', t(key));
    }
  }
}

function pickActiveBlock(sections: readonly HTMLElement[]): number {
  let active = 0;
  sections.forEach((section, index) => {
    if (section.getBoundingClientRect().top <= 120) {
      active = index;
    }
  });
  return active;
}

/**
 * Mounts the whole application shell into `root`: header with language and theme
 * toggles, a sticky side index with reading progress, the nine numbered blocks
 * and the honesty seal.
 */
export function mountApp(root: HTMLElement, options: MountOptions = {}): void {
  root.innerHTML = shellMarkup();

  let activeLang: Lang = options.lang ?? initLang();
  if (options.lang !== undefined) {
    setLang(options.lang, { persist: false });
  }

  let theme: Theme = options.theme ?? initTheme();
  if (options.theme !== undefined) {
    setTheme(options.theme, { persist: false });
  }

  const main = root.querySelector<HTMLElement>('main');
  const indexList = root.querySelector<HTMLOListElement>('[data-index-list]');
  const progressBar = root.querySelector<HTMLElement>('[data-progress-bar]');
  const progressLabel = root.querySelector<HTMLElement>('[data-progress-label]');
  const themeButton = root.querySelector<HTMLButtonElement>('[data-action="theme"]');
  const langButtons = [...root.querySelectorAll<HTMLButtonElement>('button[data-lang]')];

  if (main !== null) {
    const fragment = document.createDocumentFragment();
    for (const block of BLOCKS) {
      fragment.append(createBlock(block));
    }
    main.append(fragment);
  }

  if (indexList !== null) {
    indexList.replaceChildren(...BLOCKS.map((block) => createIndexItem(block)));
  }

  const sections = [...root.querySelectorAll<HTMLElement>('main .block')];
  const indexLinks = [...root.querySelectorAll<HTMLAnchorElement>('.side-index__link')];

  function applyTheme(next: Theme): void {
    theme = next;
    if (themeButton !== null) {
      themeButton.setAttribute(
        'aria-label',
        theme === 'dark' ? t('shell.theme.toLight') : t('shell.theme.toDark'),
      );
    }
  }

  let progressRatio = 0;
  let progressScheduled = false;

  function renderProgressLabel(): void {
    if (progressLabel !== null) {
      progressLabel.textContent = t('shell.progress.label', {
        percent: Math.round(progressRatio * 100),
      });
    }
  }

  /**
   * Measures the scroll position and the active block. Reading layout here would
   * force a synchronous reflow during the initial render, so the first call is
   * deferred to the next frame through `scheduleProgress()`.
   */
  function updateProgress(): void {
    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    progressRatio = max > 0 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 0;

    if (progressBar !== null) {
      progressBar.style.transform = `scaleX(${progressRatio})`;
    }
    renderProgressLabel();

    const active = pickActiveBlock(sections);
    indexLinks.forEach((link, index) => {
      link.classList.toggle('is-active', index === active);
      if (index === active) {
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  function scheduleProgress(): void {
    if (progressScheduled) {
      return;
    }
    progressScheduled = true;
    const run = (): void => {
      progressScheduled = false;
      updateProgress();
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(run);
    } else {
      run();
    }
  }

  function applyLang(next: Lang): void {
    activeLang = next;
    for (const button of langButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.lang === next));
    }
    const esButton = root.querySelector<HTMLButtonElement>('button[data-lang="es"]');
    const enButton = root.querySelector<HTMLButtonElement>('button[data-lang="en"]');
    if (esButton !== null) {
      esButton.title = t('lang.es');
    }
    if (enButton !== null) {
      enButton.title = t('lang.en');
    }
    applyTranslations(root);
    applyTheme(theme);
    renderProgressLabel();
    scheduleProgress();
  }

  if (themeButton !== null) {
    themeButton.addEventListener('click', () => {
      const next: Theme = theme === 'dark' ? 'light' : 'dark';
      setTheme(next);
      applyTheme(next);
    });
  }

  for (const button of langButtons) {
    button.addEventListener('click', () => {
      const next = button.dataset.lang;
      if (isLang(next)) {
        setLang(next);
        applyLang(next);
      }
    });
  }

  window.addEventListener('scroll', updateProgress, { passive: true });
  window.addEventListener('resize', updateProgress, { passive: true });

  applyLang(activeLang);
}
