// ============================================
// Canvas Widget SDK — runs inside widget iframes
// ============================================
//
// Usage in a widget:
//   <script src="canvas-widget-sdk.js"></script>
//   <script>
//     const widget = await CanvasWidget.init();
//     widget.onStateChange(state => { ... });
//   </script>

import type {
  CanvasWidgetSDK,
  WidgetDisplayState,
  WidgetEvent,
  InitPayload,
  StateChangePayload,
  EventBroadcastPayload,
  ConsentResult,
  ConsentResultPayload,
  UserContext,
  StorageAPI,
  SettingsAPI,
  WidgetServiceClient,
  AiAPI,
  AiCallOptions,
  AiCompleteResult,
  AiStreamEvent,
  DbAPI,
  DbCollection,
  DbRecord,
  DbListOptions,
} from './types';
import { createServiceClient } from './service';
import { initSession } from './session';

const PROTOCOL = 'canvas-widget-v1';
const DEV_MODE_TOKEN = 'dev-mode-skip';
const INIT_TIMEOUT_MS = 5000;

// crypto.randomUUID only exists in SECURE contexts (HTTPS or localhost). When
// a widget iframe is served over plain http on a LAN IP (e.g. dev-on-phone at
// http://10.0.0.x), it's undefined and init() throws — the widget never
// hands shakes and the host times it out ("failed to load"). Fall back to a
// getRandomValues-based v4 UUID (also secure-context-independent).
function safeRandomUUID(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}

interface CanvasMessage {
  protocol: string;
  type: string;
  widgetId: string;
  nonce: string;
  timestamp: number;
  token: string;
  payload: Record<string, unknown>;
}

// ============================================
// HMAC utilities (mirrored from host side)
// ============================================

let cachedKey: { secret: string; key: CryptoKey } | null = null;

async function getHmacKey(secret: string): Promise<CryptoKey> {
  if (cachedKey && cachedKey.secret === secret) return cachedKey.key;

  const encoded = new TextEncoder().encode(secret);
  const buf = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buf).set(encoded);

  const key = await crypto.subtle.importKey('raw', buf, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);

  cachedKey = { secret, key };
  return key;
}

async function signToken(
  secret: string,
  type: string,
  widgetId: string,
  nonce: string,
  timestamp: number
): Promise<string> {
  const key = await getHmacKey(secret);
  const data = new TextEncoder().encode(`${type}:${widgetId}:${nonce}:${timestamp}`);
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  const sig = await crypto.subtle.sign('HMAC', key, buf);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================
// SDK Implementation
// ============================================

/** Internal SDK implementation — not exposed directly to widget authors. */
export class CanvasWidgetSDKImpl implements CanvasWidgetSDK {
  private _widgetId: string;
  private _state: WidgetDisplayState;
  private _hmacSecret: string | null;
  private _user: UserContext | null;
  private _namespace: { officeId: string; memberCount: number } | null;
  private _widgetApiUrl: string | null;
  private _widgetApiToken: string | null;
  private _installationId: string;
  private _pendingConsents = new Map<
    string,
    { resolve: (r: ConsentResult) => void; reject: (e: Error) => void }
  >();
  private _cachedJwt: { token: string; expiresAt: number } | null = null;
  private _stateListeners: Array<(state: WidgetDisplayState) => void> = [];
  private _displayState: WidgetDisplayState = 'collapsed';
  private _displayStateCallbacks: Array<(state: WidgetDisplayState) => void> = [];
  private _focused = false;
  private _focusCallbacks: Array<(focused: boolean) => void> = [];
  private _settingsRemoteListeners: Array<(settings: Record<string, unknown>) => void> = [];
  private _eventListeners = new Map<string, Array<(event: WidgetEvent) => void>>();
  private _settings: Record<string, unknown>;
  private _messageHandler: (event: MessageEvent) => void;

  /** Authenticated HTTP client scoped to the widget's declared service URL. Undefined when no service is declared. */
  readonly service: WidgetServiceClient | undefined;

  constructor(init: InitPayload) {
    this._widgetId = init.widgetId;
    this._state = init.state;
    this._hmacSecret = init.hmacSecret;
    this._user = init.user;
    this._namespace = init.namespace ?? null;
    this._widgetApiUrl = init.widgetApiUrl;
    this._widgetApiToken = init.widgetApiToken ?? null;
    this._installationId = init.installationId;
    this._settings = init.settings ?? {};

    // Wire sdk.service when the host provides a service URL from the manifest
    if (init.serviceUrl) {
      this.service = createServiceClient({
        baseUrl: init.serviceUrl,
        getJwt: (forceRefresh?: boolean) => this.getJwt(forceRefresh),
      });
    }

    this._messageHandler = this.handleMessage.bind(this);
    window.addEventListener('message', this._messageHandler);
  }

  /** The unique identifier for this widget instance on the canvas. */
  get widgetId(): string {
    return this._widgetId;
  }

  /** The current display state of the widget (collapsed, expanding, expanded, collapsing). */
  get state(): WidgetDisplayState {
    return this._state;
  }

  /** The authenticated user context, or null when user data access has not been granted. */
  get user(): UserContext | null {
    return this._user;
  }

  /** Namespace (office) context — id and owner-inclusive member count — or
   *  null on a personal canvas. What the `canvas.context` permission grants. */
  get namespace(): { officeId: string; memberCount: number } | null {
    return this._namespace;
  }

  /** Subscribe to display state changes; returns an unsubscribe function. */
  onStateChange(cb: (state: WidgetDisplayState) => void): () => void {
    this._stateListeners.push(cb);
    return () => {
      const idx = this._stateListeners.indexOf(cb);
      if (idx !== -1) this._stateListeners.splice(idx, 1);
    };
  }

  /** Ask the canvas host to expand this widget into its modal view. */
  requestExpand(): void {
    this.send('EXPAND_REQUEST', {});
  }

  /** Ask the canvas host to collapse this widget back to its tile view. */
  requestCollapse(): void {
    this.send('COLLAPSE_REQUEST', {});
  }

  /** Get the current display state */
  getDisplayState(): WidgetDisplayState {
    return this._displayState;
  }

  /** Register a callback for display state changes */
  onDisplayStateChange(callback: (state: WidgetDisplayState) => void): () => void {
    this._displayStateCallbacks.push(callback);
    return () => {
      this._displayStateCallbacks = this._displayStateCallbacks.filter((cb) => cb !== callback);
    };
  }

  /** Is this widget the user's current focus? Updates via FOCUS_CHANGE. */
  isFocused(): boolean {
    return this._focused;
  }

  /** Subscribe to focus transitions. Returns an unsubscribe function. */
  onFocusChange(callback: (focused: boolean) => void): () => void {
    this._focusCallbacks.push(callback);
    return () => {
      this._focusCallbacks = this._focusCallbacks.filter((cb) => cb !== callback);
    };
  }

  /** Request promotion to fullscreen from partial */
  requestFullscreen(): void {
    this.send('FULLSCREEN_REQUEST', {});
  }

  /** Broadcast an event on the given topic to all subscribed widgets on the canvas. */
  emit(topic: string, payload: unknown): void {
    this.send('EVENT_EMIT', { topic, payload });
  }

  /** Subscribe to events on the given topic; returns an unsubscribe function. */
  subscribe(topic: string, cb: (event: WidgetEvent) => void): () => void {
    const list = this._eventListeners.get(topic) ?? [];
    list.push(cb);
    this._eventListeners.set(topic, list);
    return () => {
      const current = this._eventListeners.get(topic);
      if (!current) return;
      const idx = current.indexOf(cb);
      if (idx !== -1) current.splice(idx, 1);
    };
  }

  /** Send a structured log entry to the canvas host for centralized debugging. */
  log(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void {
    this.send('LOG', { level, message, data: data ?? null });
  }

  /** Request user consent for a named data scope; resolves with the consent decision. */
  async requestConsent(scope: string, reason: string): Promise<ConsentResult> {
    return new Promise<ConsentResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingConsents.delete(scope);
        reject(new Error('Consent request timed out'));
      }, 60000);

      this._pendingConsents.set(scope, {
        resolve: (r: ConsentResult) => {
          clearTimeout(timeout);
          resolve(r);
        },
        reject: (e: Error) => {
          clearTimeout(timeout);
          reject(e);
        },
      });

      this.send('CONSENT_REQUEST', { scope, reason });
    });
  }

  /** Return the cached JWT for authenticating requests to external APIs; throws if no token is available. Pass forceRefresh=true to bypass the cache. */
  async getJwt(forceRefresh?: boolean): Promise<string> {
    if (!forceRefresh && this._cachedJwt && Date.now() < this._cachedJwt.expiresAt - 30000) {
      return this._cachedJwt.token;
    }
    throw new Error('No cached JWT — widget must use OAuth flow for token refresh');
  }

  /** Persistent key-value storage scoped to this widget installation. */
  get storage(): StorageAPI {
    return {
      get: (key: string) => this.storageRequest('GET', key),
      set: (key: string, value: unknown) => this.storageRequest('PUT', key, value).then(() => {}),
      delete: (key: string) => this.storageRequest('DELETE', key).then(() => {}),
    };
  }

  /** Ad-hoc collections/records backend scoped to the canvas/room. */
  get db(): DbAPI {
    const req = (path: string, method: string, body?: unknown) => this.widgetApiRequest(path, method, body);
    return {
      collection(name: string): DbCollection {
        const base = `/widget-api/db/${encodeURIComponent(name)}`;
        return {
          create: (data) => req(base, 'POST', data) as Promise<DbRecord>,
          get: (id) => req(`${base}/${encodeURIComponent(id)}`, 'GET') as Promise<DbRecord>,
          list: (opts?: DbListOptions) => {
            const qs = new URLSearchParams();
            if (opts?.limit != null) qs.set('limit', String(opts.limit));
            if (opts?.cursor) qs.set('cursor', opts.cursor);
            if (opts?.sort) qs.set('sort', opts.sort);
            if (opts?.mine) qs.set('mine', 'true');
            const suffix = qs.toString() ? `?${qs.toString()}` : '';
            return req(`${base}${suffix}`, 'GET') as Promise<DbRecord[]>;
          },
          update: (id, patch) => req(`${base}/${encodeURIComponent(id)}`, 'PATCH', patch) as Promise<DbRecord>,
          delete: (id) => (req(`${base}/${encodeURIComponent(id)}`, 'DELETE') as Promise<unknown>).then(() => {}),
        };
      },
    };
  }

  /** Platform LLM access (widget.* aliases only). Requests ride the same
   *  widget-gateway auth as db/storage; the platform meters every call and
   *  attributes it to this widget's publishing org. */
  get ai(): AiAPI {
    const complete = (opts: AiCallOptions): Promise<AiCompleteResult> =>
      this.widgetApiRequest('/widget-api/ai/complete', 'POST', opts) as Promise<AiCompleteResult>;
    const streamRequest = (opts: AiCallOptions): Promise<Response> => this.widgetApiStream(opts);
    return {
      complete,
      // Async generator over the gateway's SSE frames. Ends on [DONE] or
      // stream end; returning early (break) cancels the fetch body, which
      // the gateway sees as a disconnect and aborts the upstream call, so
      // an abandoned stream stops generating and billing.
      async *stream(opts: AiCallOptions): AsyncGenerator<AiStreamEvent> {
        const response = await streamRequest(opts);
        const reader = response.body?.getReader();
        if (!reader) throw new Error('ai.stream: response has no body');
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split('\n\n');
            buffer = frames.pop() ?? '';
            for (const frame of frames) {
              const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
              if (!dataLine) continue;
              const payload = dataLine.slice(5).trim();
              if (!payload || payload === '[DONE]') continue;
              let parsed: AiStreamEvent;
              try {
                parsed = JSON.parse(payload) as AiStreamEvent;
              } catch {
                continue;
              }
              yield parsed;
            }
          }
        } finally {
          // Break/return path: releases the connection so the gateway's
          // req.on('close') fires and the upstream call aborts.
          await reader.cancel().catch(() => {});
        }
      },
    };
  }

  /** Widget configuration settings persisted by the canvas host. */
  get settings(): SettingsAPI {
    return {
      get: () => ({ ...this._settings }),
      set: (newSettings: Record<string, unknown>) => {
        this._settings = { ...this._settings, ...newSettings };
        this.send('SETTINGS_WRITE', { settings: this._settings });
      },
      onRemoteChange: (cb: (settings: Record<string, unknown>) => void) => {
        this._settingsRemoteListeners.push(cb);
        return () => {
          this._settingsRemoteListeners = this._settingsRemoteListeners.filter((fn) => fn !== cb);
        };
      },
    };
  }

  /** Display a toast notification in the canvas host UI. */
  async notify(message: string, opts?: { level?: string; duration?: number }): Promise<void> {
    this.send('NOTIFICATION', {
      message,
      level: opts?.level ?? 'info',
      duration: opts?.duration ?? 5000,
    });
  }

  // ── Private ─────────────────────────────────────────────────

  /** Raw streaming POST against the widget gateway — same auth as
   *  widgetApiRequest, but returns the Response for SSE consumption
   *  instead of parsing a JSON envelope. */
  private async widgetApiStream(body: unknown): Promise<Response> {
    if (!this._widgetApiUrl) {
      throw new Error('Widget API Gateway URL not available');
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this._widgetApiToken) {
      headers['Authorization'] = `Bearer ${this._widgetApiToken}`;
    }
    const response = await fetch(`${this._widgetApiUrl}/widget-api/ai/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as Record<string, string>).message ?? 'ai.stream request failed');
    }
    return response;
  }

  private async widgetApiRequest(path: string, method: string, body?: unknown): Promise<unknown> {
    if (!this._widgetApiUrl) {
      throw new Error('Widget API Gateway URL not available');
    }
    const url = `${this._widgetApiUrl}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this._widgetApiToken) {
      headers['Authorization'] = `Bearer ${this._widgetApiToken}`;
    }
    const opts: RequestInit = { method, headers };
    if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
      opts.body = JSON.stringify(body);
    }
    const response = await fetch(url, opts);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as Record<string, string>).message ?? `Request ${method} ${path} failed`);
    }
    if (method === 'GET' || method === 'POST' || method === 'PATCH') {
      const result = await response.json();
      return (result as Record<string, unknown>).data;
    }
    return undefined;
  }

  private storageRequest(method: string, key: string, value?: unknown): Promise<unknown> {
    return this.widgetApiRequest(`/widget-api/storage/${encodeURIComponent(key)}`, method, value);
  }

  private handleMessage(event: MessageEvent): void {
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || msg.protocol !== PROTOCOL) return;

    switch (msg.type) {
      case 'STATE_CHANGE': {
        const payload = msg.payload as StateChangePayload;
        this._state = payload.state;
        for (const listener of this._stateListeners) {
          listener(payload.state);
        }
        break;
      }
      case 'EVENT_BROADCAST': {
        const payload = msg.payload as EventBroadcastPayload;
        const listeners = this._eventListeners.get(payload.topic);
        if (listeners) {
          const evt: WidgetEvent = {
            topic: payload.topic,
            payload: payload.payload,
            emittedAt: payload.emittedAt,
          };
          for (const listener of listeners) {
            listener(evt);
          }
        }
        break;
      }
      case 'CONSENT_RESULT': {
        const payload = msg.payload as ConsentResultPayload;
        const pending = this._pendingConsents.get(payload.scope);
        if (pending) {
          this._pendingConsents.delete(payload.scope);
          pending.resolve({
            scope: payload.scope,
            granted: payload.granted,
            grantToken: payload.grantToken,
            expiresIn: payload.expiresIn,
          });
        }
        break;
      }
      case 'AUTH_TOKEN_REFRESH': {
        const payload = msg.payload as { token: string; expiresIn: number };
        this._cachedJwt = {
          token: payload.token,
          expiresAt: Date.now() + payload.expiresIn * 1000,
        };
        break;
      }
      case 'DISPLAY_STATE_CHANGE': {
        const newState = msg.payload?.displayState as WidgetDisplayState;
        if (newState) {
          this._displayState = newState;
          this._displayStateCallbacks.forEach((cb) => cb(newState));
        }
        break;
      }
      case 'FOCUS_CHANGE': {
        const next = !!msg.payload?.focused;
        if (next !== this._focused) {
          this._focused = next;
          this._focusCallbacks.forEach((cb) => cb(next));
        }
        break;
      }
      case 'SETTINGS_REMOTE_UPDATE': {
        const p = msg.payload as { settings: Record<string, unknown> };
        this._settings = { ...p.settings };
        for (const fn of this._settingsRemoteListeners) {
          try {
            fn({ ...this._settings });
          } catch {
            // a listener throwing must not break message handling
          }
        }
        break;
      }
      case 'USER_CONTEXT':
      case 'CANVAS_CONTEXT':
        // Phase 3+ — reserved for future use
        break;
    }
  }

  private send(type: string, payload: Record<string, unknown>): void {
    // Fire and forget — sign is async but we don't need to await delivery
    this.buildMessage(type, payload).then((msg) => {
      window.parent.postMessage(msg, '*');
    });
  }

  private async buildMessage(
    type: string,
    payload: Record<string, unknown>
  ): Promise<CanvasMessage> {
    const nonce = safeRandomUUID();
    const timestamp = Date.now();

    let token: string;
    if (this._hmacSecret) {
      token = await signToken(this._hmacSecret, type, this._widgetId, nonce, timestamp);
    } else {
      token = DEV_MODE_TOKEN;
    }

    return {
      protocol: PROTOCOL,
      type,
      widgetId: this._widgetId,
      nonce,
      timestamp,
      token,
      payload,
    };
  }

  /** Tear down the SDK instance, remove all listeners, and reject pending consent requests. */
  destroy(): void {
    window.removeEventListener('message', this._messageHandler);
    this._stateListeners.length = 0;
    this._eventListeners.clear();
    for (const [, pending] of this._pendingConsents) {
      pending.reject(new Error('Widget destroyed'));
    }
    this._pendingConsents.clear();
  }
}

// ============================================
// Public API: CanvasWidget.init()
// ============================================

/**
 * Entry point for the Flowstate Canvas Widget SDK.
 *
 * Usage:
 * ```ts
 * import { CanvasWidget } from '@goflowstate/widget-sdk';
 * const widget = await CanvasWidget.init();
 * ```
 */
export const CanvasWidget = {
  /**
   * Initialize a group-session client for widgets hosted on the /w/[slug]
   * session page (ticket handshake + session REST rails). Returns null when
   * the launch context carries no session params — see `initSession` in
   * ./session for details and `createMockSession` for standalone dev.
   */
  initSession,

  /**
   * Initialize the SDK and establish communication with the canvas host.
   *
   * Sends a READY message to the host and waits for an INIT response.
   * Resolves with a fully initialized {@link CanvasWidgetSDK} instance.
   * Rejects after 5 seconds if no INIT is received from the host.
   */
  init(): Promise<CanvasWidgetSDK> {
    return new Promise<CanvasWidgetSDK>((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error('CanvasWidget.init() timed out — no INIT received from host within 5s'));
      }, INIT_TIMEOUT_MS);

      const handler = (event: MessageEvent) => {
        const msg = event.data;
        if (!msg || typeof msg !== 'object' || msg.protocol !== PROTOCOL) return;
        if (msg.type !== 'INIT') return;

        clearTimeout(timeout);
        window.removeEventListener('message', handler);

        const payload = msg.payload as InitPayload;
        const sdk = new CanvasWidgetSDKImpl(payload);
        resolve(sdk);
      };

      window.addEventListener('message', handler);

      // Send READY to host — the host will respond with INIT
      const readyMsg: CanvasMessage = {
        protocol: PROTOCOL,
        type: 'READY',
        widgetId: '', // Not yet known — host identifies us by iframe source
        nonce: safeRandomUUID(),
        timestamp: Date.now(),
        token: DEV_MODE_TOKEN, // READY is always allowed, token doesn't matter
        payload: { manifestVersion: '1' },
      };

      window.parent.postMessage(readyMsg, '*');
    });
  },
};
