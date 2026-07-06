import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CanvasWidgetSDKImpl } from './sdk';
import type { InitPayload } from './types';

function makeSdk(widgetApiToken?: string | null) {
  const init = {
    widgetId: 'w1', installationId: 'i1', state: 'expanded',
    hmacSecret: null, user: null, widgetApiUrl: 'https://gw.test', settings: {},
    ...(widgetApiToken !== undefined ? { widgetApiToken } : {}),
  } as unknown as InitPayload;
  return new CanvasWidgetSDKImpl(init);
}

const okJson = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);

beforeEach(() => vi.restoreAllMocks());

describe('widget.db', () => {
  it('create POSTs to /widget-api/db/:collection and returns the record', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(okJson({ data: { id: 'r1', data: { a: 1 } } }));
    const sdk = makeSdk();
    const rec = await sdk.db.collection('blueprint').create({ a: 1 });
    expect(rec.id).toBe('r1');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://gw.test/widget-api/db/blueprint');
    expect(opts?.method).toBe('POST');
    expect(JSON.parse(opts?.body as string)).toEqual({ a: 1 });
  });

  it('list GETs with query params and returns the array', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(okJson({ data: [{ id: 'r1' }], pagination: {} }));
    const sdk = makeSdk();
    const rows = await sdk.db.collection('blueprint').list({ mine: true, limit: 10 });
    expect(rows).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/widget-api/db/blueprint?');
    expect(fetchMock.mock.calls[0][0]).toContain('mine=true');
  });

  it('delete DELETEs /:collection/:id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(okJson({ data: { success: true } }));
    const sdk = makeSdk();
    await sdk.db.collection('blueprint').delete('r1');
    expect(fetchMock.mock.calls[0][0]).toBe('https://gw.test/widget-api/db/blueprint/r1');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE');
  });
});

describe('widget-api auth header', () => {
  it('sends Authorization: Bearer <token> when widgetApiToken is provided', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(
      okJson({ data: { id: 'r1', data: {} } }),
    );
    const sdk = makeSdk('tok-abc123');
    await sdk.db.collection('items').create({ x: 1 });
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok-abc123');
  });

  it('does NOT send Authorization header when no widgetApiToken', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(
      okJson({ data: [{ id: 'r1' }], pagination: {} }),
    );
    const sdk = makeSdk(); // no token
    await sdk.db.collection('items').list();
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('does NOT send Authorization header when widgetApiToken is null', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(
      okJson({ data: [{ id: 'r1' }], pagination: {} }),
    );
    const sdk = makeSdk(null);
    await sdk.db.collection('items').list();
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });
});
