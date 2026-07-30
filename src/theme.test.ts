import { describe, it, expect, afterEach, vi } from 'vitest';

import { getInitialTheme, applyWidgetTheme, onThemeChange } from './theme';

afterEach(() => {
  delete document.documentElement.dataset.theme;
  window.history.replaceState(null, '', window.location.pathname);
});

describe('getInitialTheme', () => {
  it('defaults to glass when no ?theme= param is present', () => {
    expect(getInitialTheme()).toBe('glass');
  });

  it('reads a valid ?theme= param', () => {
    window.history.replaceState(null, '', '?theme=light');
    expect(getInitialTheme()).toBe('light');
    window.history.replaceState(null, '', '?theme=dark');
    expect(getInitialTheme()).toBe('dark');
  });

  it('falls back to glass on an invalid ?theme= value', () => {
    window.history.replaceState(null, '', '?theme=neon');
    expect(getInitialTheme()).toBe('glass');
  });
});

describe('applyWidgetTheme', () => {
  it('sets data-theme on <html> for light and dark', () => {
    applyWidgetTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    applyWidgetTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('removes the attribute for glass (the default plane)', () => {
    applyWidgetTheme('dark');
    applyWidgetTheme('glass');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('onThemeChange', () => {
  // The host pushes from the parent frame; in tests window.parent === window,
  // so a host message is one whose `source` is the window itself.
  const hostMessage = (data: unknown) =>
    new MessageEvent('message', { data, source: window as unknown as MessageEventSource });

  it('invokes the callback for flowstate:theme messages and ignores others', () => {
    const cb = vi.fn();
    const unsubscribe = onThemeChange(cb);

    window.dispatchEvent(hostMessage({ type: 'flowstate:theme', theme: 'dark' }));
    window.dispatchEvent(hostMessage({ type: 'flowstate:init' }));
    window.dispatchEvent(hostMessage({ type: 'flowstate:theme', theme: 'neon' }));
    window.dispatchEvent(hostMessage('not-an-object'));

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('dark');

    unsubscribe();
    window.dispatchEvent(hostMessage({ type: 'flowstate:theme', theme: 'light' }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('drops messages that are not from the host frame', () => {
    const cb = vi.fn();
    const unsubscribe = onThemeChange(cb);

    // No source (a hostile frame's message never carries the parent as source).
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'flowstate:theme', theme: 'dark' } }));
    expect(cb).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('pins the host origin when allowedOrigin is passed', () => {
    const cb = vi.fn();
    const unsubscribe = onThemeChange(cb, { allowedOrigin: 'https://app.example' });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'flowstate:theme', theme: 'dark' },
        source: window as unknown as MessageEventSource,
        origin: 'https://evil.example',
      })
    );
    expect(cb).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'flowstate:theme', theme: 'dark' },
        source: window as unknown as MessageEventSource,
        origin: 'https://app.example',
      })
    );
    expect(cb).toHaveBeenCalledWith('dark');

    unsubscribe();
  });
});
