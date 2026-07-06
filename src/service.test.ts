// packages/widget-sdk/src/service.test.ts

import { describe, expect, it, vi } from 'vitest';
import { createServiceClient } from './service';

describe('createServiceClient', () => {
  it('attaches Bearer JWT to the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    const client = createServiceClient({
      baseUrl: 'https://kanban.example',
      getJwt: async () => 'tok-1',
      fetchImpl: fetchMock,
    });

    const result = await client.fetch<{ ok: boolean }>('/api/echo');
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://kanban.example/api/echo');
    const initHeaders = (init as RequestInit).headers as Record<string, string>;
    // Headers may be a Headers object or a plain dict — normalize:
    if (initHeaders instanceof Headers) {
      expect(initHeaders.get('authorization')).toBe('Bearer tok-1');
    } else {
      expect(
        (initHeaders.authorization ?? initHeaders.Authorization ?? ''),
      ).toBe('Bearer tok-1');
    }
  });

  it('refreshes JWT and retries once on 401', async () => {
    const tokens = ['stale', 'fresh'];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    let issued = 0;
    const client = createServiceClient({
      baseUrl: 'https://kanban.example',
      getJwt: async (forceRefresh?: boolean) => {
        if (forceRefresh) issued++;
        return tokens[issued];
      },
      fetchImpl: fetchMock,
    });

    await client.fetch('/api/echo');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallInit = fetchMock.mock.calls[1][1] as RequestInit;
    const headers = secondCallInit.headers;
    if (headers instanceof Headers) {
      expect(headers.get('authorization')).toBe('Bearer fresh');
    } else {
      const dict = headers as Record<string, string>;
      expect(dict.authorization ?? dict.Authorization).toBe('Bearer fresh');
    }
  });

  it('does NOT retry beyond once on 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ message: 'still nope' }) });

    const client = createServiceClient({
      baseUrl: 'https://kanban.example',
      getJwt: async () => 'tok',
      fetchImpl: fetchMock,
    });

    await expect(client.fetch('/api/echo')).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
