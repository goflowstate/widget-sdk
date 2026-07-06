import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { CanvasWidgetSDKImpl } from './sdk';

const PROTOCOL = 'canvas-widget-v1';

const init = {
  widgetId: 'w',
  state: 'expanded' as const,
  hmacSecret: null,
  user: null,
  widgetApiUrl: 'http://localhost',
  serviceUrl: null,
  installationId: 'i',
  settings: {},
};

const envelope = (type: string, payload: unknown) => ({
  protocol: PROTOCOL,
  type,
  widgetId: 'w',
  nonce: 'test-nonce',
  timestamp: Date.now(),
  token: 'dev-mode-skip',
  payload,
});

const fireMessage = (data: unknown) => {
  window.dispatchEvent(new MessageEvent('message', { data }));
};

describe('WidgetSDK focus', () => {
  let sdk: CanvasWidgetSDKImpl;

  beforeEach(() => {
    sdk = new CanvasWidgetSDKImpl(init);
  });

  afterEach(() => {
    sdk.destroy();
  });

  it('is unfocused by default', () => {
    expect(sdk.isFocused()).toBe(false);
  });

  it('onFocusChange fires on transitions only', () => {
    const cb = vi.fn();
    sdk.onFocusChange(cb);

    fireMessage(envelope('FOCUS_CHANGE', { focused: true }));
    fireMessage(envelope('FOCUS_CHANGE', { focused: false }));
    fireMessage(envelope('FOCUS_CHANGE', { focused: false })); // duplicate — no fire

    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenNthCalledWith(1, true);
    expect(cb).toHaveBeenNthCalledWith(2, false);
  });

  it('unsubscribe stops further callbacks', () => {
    const cb = vi.fn();
    const unsub = sdk.onFocusChange(cb);
    unsub();
    fireMessage(envelope('FOCUS_CHANGE', { focused: true }));
    expect(cb).not.toHaveBeenCalled();
  });

  it('isFocused reflects the latest state', () => {
    fireMessage(envelope('FOCUS_CHANGE', { focused: true }));
    expect(sdk.isFocused()).toBe(true);
    fireMessage(envelope('FOCUS_CHANGE', { focused: false }));
    expect(sdk.isFocused()).toBe(false);
  });
});
