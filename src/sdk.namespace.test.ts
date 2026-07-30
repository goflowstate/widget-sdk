import { describe, expect, it, afterEach } from 'vitest';
import { CanvasWidgetSDKImpl } from './sdk';
import type { InitPayload } from './types';

const baseInit: InitPayload = {
  widgetId: 'w',
  state: 'expanded',
  hmacSecret: null,
  user: null,
  widgetApiUrl: 'http://localhost',
  serviceUrl: null,
  installationId: 'i',
  settings: {},
};

describe('WidgetSDK namespace', () => {
  let sdk: CanvasWidgetSDKImpl;

  afterEach(() => {
    sdk.destroy();
  });

  it('is null when the INIT payload omits namespace (personal canvas)', () => {
    sdk = new CanvasWidgetSDKImpl(baseInit);
    expect(sdk.namespace).toBeNull();
  });

  it('is null when the INIT payload explicitly sends null', () => {
    sdk = new CanvasWidgetSDKImpl({ ...baseInit, namespace: null });
    expect(sdk.namespace).toBeNull();
  });

  it('surfaces officeId and owner-inclusive memberCount on an office canvas', () => {
    sdk = new CanvasWidgetSDKImpl({
      ...baseInit,
      namespace: { officeId: 'office-123', memberCount: 2 },
    });
    expect(sdk.namespace).toEqual({ officeId: 'office-123', memberCount: 2 });
  });
});
