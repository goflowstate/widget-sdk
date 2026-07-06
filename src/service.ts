// packages/widget-sdk/src/service.ts

import type { WidgetServiceClient } from './types';

export interface CreateServiceClientOptions {
  baseUrl: string;
  getJwt: (forceRefresh?: boolean) => Promise<string>;
  fetchImpl?: typeof fetch;
}

export function createServiceClient(opts: CreateServiceClientOptions): WidgetServiceClient {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');

  async function call(path: string, init: RequestInit, token: string): Promise<Response> {
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    if (init.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return fetchImpl(url, { ...init, headers });
  }

  return {
    async fetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
      let token = await opts.getJwt(false);
      let res = await call(path, init, token);

      if (res.status === 401) {
        token = await opts.getJwt(true);
        res = await call(path, init, token);
      }

      if (!res.ok) {
        let body: { message?: string } = {};
        try {
          body = (await res.json()) as { message?: string };
        } catch {
          // non-JSON body — ignore
        }
        throw new Error(`Widget service request failed (${res.status}): ${body.message ?? ''}`);
      }
      return (await res.json()) as T;
    },
  };
}
