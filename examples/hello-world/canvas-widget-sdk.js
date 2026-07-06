// @goflowstate/widget-sdk v0.1.0
// https://github.com/starteryllp/goflowstate-sdk

'use strict';
var CanvasWidgetSDK = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all) __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if ((from && typeof from === 'object') || typeof from === 'function') {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, {
            get: () => from[key],
            enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
          });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, '__esModule', { value: true }), mod);

  // src/sdk.ts
  var sdk_exports = {};
  __export(sdk_exports, {
    CanvasWidget: () => CanvasWidget,
  });
  var PROTOCOL = 'canvas-widget-v1';
  var DEV_MODE_TOKEN = 'dev-mode-skip';
  var INIT_TIMEOUT_MS = 5e3;
  var cachedKey = null;
  async function getHmacKey(secret) {
    if (cachedKey && cachedKey.secret === secret) return cachedKey.key;
    const encoded = new TextEncoder().encode(secret);
    const buf = new ArrayBuffer(encoded.byteLength);
    new Uint8Array(buf).set(encoded);
    const key = await crypto.subtle.importKey(
      'raw',
      buf,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    cachedKey = { secret, key };
    return key;
  }
  async function signToken(secret, type, widgetId, nonce, timestamp) {
    const key = await getHmacKey(secret);
    const data = new TextEncoder().encode(`${type}:${widgetId}:${nonce}:${timestamp}`);
    const buf = new ArrayBuffer(data.byteLength);
    new Uint8Array(buf).set(data);
    const sig = await crypto.subtle.sign('HMAC', key, buf);
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  var CanvasWidgetSDKImpl = class {
    _widgetId;
    _state;
    _hmacSecret;
    _stateListeners = [];
    _eventListeners = /* @__PURE__ */ new Map();
    _messageHandler;
    constructor(init) {
      this._widgetId = init.widgetId;
      this._state = init.state;
      this._hmacSecret = init.hmacSecret;
      this._messageHandler = this.handleMessage.bind(this);
      window.addEventListener('message', this._messageHandler);
    }
    get widgetId() {
      return this._widgetId;
    }
    get state() {
      return this._state;
    }
    onStateChange(cb) {
      this._stateListeners.push(cb);
      return () => {
        const idx = this._stateListeners.indexOf(cb);
        if (idx !== -1) this._stateListeners.splice(idx, 1);
      };
    }
    requestExpand() {
      this.send('EXPAND_REQUEST', {});
    }
    requestCollapse() {
      this.send('COLLAPSE_REQUEST', {});
    }
    emit(topic, payload) {
      this.send('EVENT_EMIT', { topic, payload });
    }
    subscribe(topic, cb) {
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
    log(level, message, data) {
      this.send('LOG', { level, message, data: data ?? null });
    }
    // ── Private ─────────────────────────────────────────────────
    handleMessage(event) {
      const msg = event.data;
      if (!msg || typeof msg !== 'object' || msg.protocol !== PROTOCOL) return;
      switch (msg.type) {
        case 'STATE_CHANGE': {
          const payload = msg.payload;
          this._state = payload.state;
          for (const listener of this._stateListeners) {
            listener(payload.state);
          }
          break;
        }
        case 'EVENT_BROADCAST': {
          const payload = msg.payload;
          const listeners = this._eventListeners.get(payload.topic);
          if (listeners) {
            const evt = {
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
        case 'USER_CONTEXT':
        case 'CANVAS_CONTEXT':
        case 'AUTH_TOKEN_REFRESH':
        case 'CONSENT_RESULT':
          break;
      }
    }
    send(type, payload) {
      this.buildMessage(type, payload).then((msg) => {
        window.parent.postMessage(msg, '*');
      });
    }
    async buildMessage(type, payload) {
      const nonce = crypto.randomUUID();
      const timestamp = Date.now();
      let token;
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
    destroy() {
      window.removeEventListener('message', this._messageHandler);
      this._stateListeners.length = 0;
      this._eventListeners.clear();
    }
  };
  var CanvasWidget = {
    /**
     * Initialize the SDK. Sends READY to the host, waits for INIT response.
     * Resolves with an initialized SDK instance.
     * Rejects after 5 seconds if no INIT is received.
     */
    init() {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          window.removeEventListener('message', handler);
          reject(
            new Error('CanvasWidget.init() timed out \u2014 no INIT received from host within 5s')
          );
        }, INIT_TIMEOUT_MS);
        const handler = (event) => {
          const msg = event.data;
          if (!msg || typeof msg !== 'object' || msg.protocol !== PROTOCOL) return;
          if (msg.type !== 'INIT') return;
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          const payload = msg.payload;
          const sdk = new CanvasWidgetSDKImpl(payload);
          resolve(sdk);
        };
        window.addEventListener('message', handler);
        const readyMsg = {
          protocol: PROTOCOL,
          type: 'READY',
          widgetId: '',
          // Not yet known — host identifies us by iframe source
          nonce: crypto.randomUUID(),
          timestamp: Date.now(),
          token: DEV_MODE_TOKEN,
          // READY is always allowed, token doesn't matter
          payload: { manifestVersion: '1' },
        };
        window.parent.postMessage(readyMsg, '*');
      });
    },
  };
  return __toCommonJS(sdk_exports);
})();

// Expose CanvasWidget on the global scope
if (typeof window !== 'undefined') {
  window.CanvasWidget = CanvasWidgetSDK.CanvasWidget;
}
//# sourceMappingURL=canvas-widget-sdk.js.map
