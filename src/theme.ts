// ============================================
// Widget theme utilities — the Flowstate Theme Contract (ADR-048)
// ============================================
//
// Flowstate has exactly three themes: 'light' | 'dark' | 'glass'.
// Glass is the signature default (the liquid-glass look) — widgets treat it
// as the unthemed plane. The host hands the active theme to external iframe
// widgets in two ways:
//
//   1. Boot:  a `?theme=` query param appended to the iframe src.
//   2. Live:  a `postMessage` of `{ type: 'flowstate:theme', theme }`.
//
// Widgets map the theme onto their own tokens by setting `data-theme` on
// their <html> element ('glass' removes the attribute, so widget CSS keeps
// the glass plane as its default styles).
//
// Usage in a widget entry:
//   import { initWidgetTheme } from '@goflowstate/widget-sdk';
//   initWidgetTheme(); // apply boot theme + follow live host updates

export type WidgetTheme = 'light' | 'dark' | 'glass';

const THEME_MESSAGE_TYPE = 'flowstate:theme';
const DEFAULT_THEME: WidgetTheme = 'glass';

function isWidgetTheme(value: unknown): value is WidgetTheme {
  return value === 'light' || value === 'dark' || value === 'glass';
}

/**
 * Read the theme the host handed the widget at boot via the `?theme=` URL
 * param. Invalid or missing values fall back to 'glass' (the default plane).
 */
export function getInitialTheme(): WidgetTheme {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const param = new URLSearchParams(window.location.search).get('theme');
    return isWidgetTheme(param) ? param : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Subscribe to live theme updates pushed by the host
 * (`postMessage({ type: 'flowstate:theme', theme })`). Non-theme messages
 * and invalid theme values are ignored. Returns an unsubscribe function.
 *
 * Only messages from the embedding host page (`window.parent`) are accepted,
 * mirroring the ingest channel; a hostile sibling frame cannot restyle the
 * widget. Pass `allowedOrigin` to additionally pin the host's origin.
 */
export function onThemeChange(
  cb: (theme: WidgetTheme) => void,
  opts?: { allowedOrigin?: string }
): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: MessageEvent): void => {
    if (event.source !== window.parent) return;
    if (opts?.allowedOrigin && event.origin !== opts.allowedOrigin) return;
    const data: unknown = event.data;
    if (typeof data !== 'object' || data === null) return;
    const message = data as { type?: unknown; theme?: unknown };
    if (message.type !== THEME_MESSAGE_TYPE) return;
    if (!isWidgetTheme(message.theme)) return;
    cb(message.theme);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

/**
 * Apply a theme to the widget document by setting `data-theme` on <html>.
 * 'glass' REMOVES the attribute — widget CSS treats glass as the default
 * plane, with `[data-theme='light']` / `[data-theme='dark']` overrides.
 */
export function applyWidgetTheme(theme: WidgetTheme): void {
  if (typeof document === 'undefined') return;
  if (theme === 'glass') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

/**
 * Convenience boot helper: apply the initial (`?theme=`) theme, then follow
 * live host updates, applying each. Returns the unsubscribe function.
 */
export function initWidgetTheme(): () => void {
  applyWidgetTheme(getInitialTheme());
  return onThemeChange(applyWidgetTheme);
}
