// ============================================
// Public types for widget developers
// ============================================
// These are standalone (no dependency on @flowstate/shared)
// so that widget developers don't need the monorepo.

/** The visual lifecycle state of a widget on the canvas. */
export type WidgetDisplayState = 'collapsed' | 'expanding' | 'expanded' | 'collapsing';

/** Authenticated user information passed to the widget by the canvas host. */
export interface UserContext {
  /** The user's unique identifier. */
  id: string;
  /** The user's display name, or null if not set. */
  displayName: string | null;
}

/** The result of a consent request for a named data scope. */
export interface ConsentResult {
  /** The scope that was requested. */
  scope: string;
  /** Whether the user granted or denied consent. */
  granted: boolean;
  /** Opaque token the widget can pass to the API to prove consent was granted. */
  grantToken?: string;
  /** Seconds until the grant token expires. */
  expiresIn?: number;
}

export interface DbRecord<T = Record<string, unknown>> {
  id: string;
  data: T;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DbListOptions {
  limit?: number;
  cursor?: string;
  sort?: 'createdAt:asc' | 'createdAt:desc';
  mine?: boolean;
}

export interface DbCollection {
  create(data: Record<string, unknown>): Promise<DbRecord>;
  get(id: string): Promise<DbRecord>;
  list(opts?: DbListOptions): Promise<DbRecord[]>;
  update(id: string, patch: Record<string, unknown>): Promise<DbRecord>;
  delete(id: string): Promise<void>;
}

export interface DbAPI {
  collection(name: string): DbCollection;
}

/** Persistent key-value storage API scoped to this widget installation. */
export interface StorageAPI {
  /** Retrieve a value by key; resolves with undefined if the key does not exist. */
  get(key: string): Promise<unknown>;
  /** Store a value under the given key. */
  set(key: string, value: unknown): Promise<void>;
  /** Remove a key from storage. */
  delete(key: string): Promise<void>;
}

/** Widget settings API — reads and writes the configuration persisted by the canvas host. */
export interface SettingsAPI {
  /** Returns a shallow copy of the current settings object. */
  get(): Record<string, unknown>;
  /** Merges new values into the current settings and persists them via the canvas host. */
  set(settings: Record<string, unknown>): void;
  /**
   * Subscribe to settings changes made on another of the user's devices.
   * The handler receives the full new settings object. Returns an unsubscribe function.
   */
  onRemoteChange(cb: (settings: Record<string, unknown>) => void): () => void;
}

/** The public interface of an initialized SDK instance returned by {@link CanvasWidget.init}. */
export interface CanvasWidgetSDK {
  // Phase 1
  /** The unique identifier for this widget instance on the canvas. */
  readonly widgetId: string;
  /** The current display state of the widget. */
  readonly state: WidgetDisplayState;

  /** Subscribe to display state changes; returns an unsubscribe function. */
  onStateChange(cb: (state: WidgetDisplayState) => void): () => void;
  /** Ask the canvas host to expand this widget into its modal view. */
  requestExpand(): void;
  /** Ask the canvas host to collapse this widget back to its tile view. */
  requestCollapse(): void;

  /** Broadcast an event on the given topic to all subscribed widgets on the canvas. */
  emit(topic: string, payload: unknown): void;
  /** Subscribe to events on the given topic; returns an unsubscribe function. */
  subscribe(topic: string, cb: (event: WidgetEvent) => void): () => void;

  /** Send a structured log entry to the canvas host for centralized debugging. */
  log(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void;

  // Phase 2
  /** The authenticated user context, or null when user data access has not been granted. */
  readonly user: UserContext | null;
  /** Request user consent for a named data scope; resolves with the consent decision. */
  requestConsent(scope: string, reason: string): Promise<ConsentResult>;
  /** Return the cached JWT for authenticating requests to external APIs. Pass forceRefresh=true to bypass the cache. */
  getJwt(forceRefresh?: boolean): Promise<string>;
  /** Persistent key-value storage scoped to this widget installation. */
  storage: StorageAPI;
  /** Ad-hoc collections/records backend scoped to the canvas/room. */
  db: DbAPI;
  /** Widget configuration settings persisted by the canvas host. */
  settings: SettingsAPI;
  /** Display a toast notification in the canvas host UI. */
  notify(message: string, opts?: { level?: string; duration?: number }): Promise<void>;
  /** Authenticated HTTP client scoped to this widget's declared service URL. Present only when manifest.service.url is set. */
  service?: WidgetServiceClient;
}

/** An event received from another widget or the canvas host via the event bus. */
export interface WidgetEvent {
  /** The topic this event was emitted on. */
  topic: string;
  /** Arbitrary event payload. */
  payload: unknown;
  /** Unix timestamp (ms) when the event was emitted. */
  emittedAt: number;
}

/** Initialization payload delivered by the canvas host in the INIT message. */
export interface InitPayload {
  widgetId: string;
  installationId: string;
  state: WidgetDisplayState;
  hmacSecret: string | null;
  widgetApiUrl: string | null;
  /** Short-lived access token for authenticated widget-api requests */
  widgetApiToken?: string | null;
  /** Base URL for the widget's declared service (from manifest.service.url). Null when not declared. */
  serviceUrl: string | null;
  user: UserContext | null;
  settings: Record<string, unknown> | null;
}

/** Payload delivered when the widget's display state changes. */
export interface StateChangePayload {
  state: WidgetDisplayState;
  previousState: WidgetDisplayState;
}

/** Payload delivered when a cross-widget event is broadcast on a subscribed topic. */
export interface EventBroadcastPayload {
  topic: string;
  payload: unknown;
  emittedAt: number;
}

/** Payload delivered in response to a consent request. */
export interface ConsentResultPayload {
  scope: string;
  granted: boolean;
  grantToken?: string;
  expiresIn?: number;
}

export interface WidgetManifestDisplay {
  expandPreset?: 'collapsed-only' | 'all' | 'portable' | 'immersive';
  allowedModes?: Array<'right' | 'left' | 'bottom' | 'float' | 'fullscreen'>;
  defaultMode?: 'right' | 'left' | 'bottom' | 'float' | 'fullscreen';
  defaultSize?: { width: number; height: number };
  minSize?: { width: number; height: number };
  maxSize?: { width: number; height: number };
}

// ============================================================================
// Service-backed widgets (Phase 2)
// ============================================================================

export interface WidgetManifestServiceScope {
  name: string;
  reason: string;
}

export interface WidgetManifestServiceBlock {
  url: string;
  jwksOverride?: string | null;
  scopes: WidgetManifestServiceScope[];
  events?: { in?: string[]; out?: string[] };
  rateLimit?: { perSecond?: number; perMinute?: number };
}

export interface WidgetServiceClient {
  /** Joins `path` against `manifest.service.url`, attaches Bearer JWT, returns parsed JSON. */
  fetch<T = unknown>(path: string, init?: RequestInit): Promise<T>;
}
