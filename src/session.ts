// Session module — the official client for Flowstate widget-session rails.
//
// Group-session widgets (decision sprint, and any future multi-contributor
// widget) run inside the app's /w/[slug] page. The page hands the iframe a
// single-use auth ticket over postMessage (ADR-025: never in the URL on the
// production path), the ticket is redeemed for a session token, and every
// session verb is a REST call against /api/w/:slug on the widget gateway.
//
// This module wraps that whole contract so a widget never hand-rolls the
// bridge:
//
// ```ts
// import { CanvasWidget } from '@goflowstate/widget-sdk';
// const session = await CanvasWidget.initSession();
// if (session) {
//   const state = await session.join();
//   const stop = session.poll((s) => render(s));
//   await session.contribute({ evidence: { pins } });
// } else {
//   // no launch params — standalone dev; use createMockSession()
// }
// ```
//
// The wire vocabulary is the generic session shape the rails speak
// (historically named after the expedition: `tripId`, `myWishlist`, `plan`).
// This module maps it onto neutral names once, here, so widgets never see the
// legacy keys.

// ============================================
// State view
// ============================================

export interface SessionMember {
  userId: string;
  name: string;
  /** Deterministic per-user accent color (hex), stable across sessions. */
  color: string;
  /** True once this member has contributed (sealed) in the current round. */
  sealed: boolean;
  isMe: boolean;
  isHost: boolean;
}

/** Gate policy surfaced to widgets (ADR-047). Optional server-side — links
 *  minted without a gate report null. */
export interface SessionGateView {
  deadlineAt: string | null;
  quorum?: { mode: 'all' | 'count' | 'pct'; min?: number };
}

/** Flow context when this session is a node in a running flow (ADR-047). */
export interface SessionFlowView {
  runId: string;
  nodeIndex: number;
  nodeCount: number;
  nodes: Array<{
    key: string;
    title: string;
    status: 'pending' | 'active' | 'resolved' | 'expired';
    artifactId?: string;
    linkSlug?: string;
  }>;
}

/** The rails' phase model: `setup` until the host commits framing, `open`
 *  while contributions are being collected, `sealed` once quorum is met and
 *  the session awaits close, `resolved` after synthesis produced the
 *  artifact. (Wire values `wishlist`/`plan` are mapped to `open`/`resolved`.) */
export type SessionPhase = 'setup' | 'open' | 'sealed' | 'resolved';

export interface SessionStateView<
  TSetup = Record<string, unknown>,
  TContribution = unknown,
  TDoc = Record<string, unknown>,
> {
  /** The widget-link slug — the session's identity and its /w/:slug URL key. */
  slug: string;
  phase: SessionPhase;
  status: string;
  setup: TSetup | null;
  members: SessionMember[];
  sealedCount: number;
  memberCount: number;
  /** True when every member has sealed (legacy all-hands quorum). */
  allSealed: boolean;
  /** True when the configured quorum policy is satisfied (falls back to
   *  allSealed when the link carries no gate). */
  quorumMet: boolean;
  gate: SessionGateView | null;
  flow: SessionFlowView | null;
  /** Own contribution only — others stay blind until synthesis. */
  myContribution: TContribution | null;
  /** The synthesized document, present once the session resolved. */
  doc: TDoc | null;
  artifactId: string | null;
  /** Widget-specific state-view extension (e.g. the decision sprint's stage
   *  + ballot), passed through verbatim when the server provides one. */
  extension: Record<string, unknown> | null;
}

// ============================================
// Client interface
// ============================================

export interface SessionPollOptions {
  /** Poll cadence in ms. Default 4000 (matches the historical widgets). */
  intervalMs?: number;
}

export interface SessionClient<
  TSetup = Record<string, unknown>,
  TContribution = unknown,
  TDoc = Record<string, unknown>,
> {
  readonly slug: string;
  /** Base URL of the web app (for reveal links and parent navigation). */
  readonly webBase: string;
  /** Base URL of the mobile PWA, when the host provided one via the optional
   *  `mobile` iframe param. Participant-facing join links (e.g. a projected
   *  QR) should prefer it and fall back to `webBase` when absent. Optional so
   *  hand-rolled SessionClient implementations keep compiling. */
  readonly mobileBase?: string | null;

  /** Enter the session: the first identified enter creates the group. */
  join(): Promise<SessionStateView<TSetup, TContribution, TDoc>>;
  /** Fetch the current blind-aware state. */
  state(): Promise<SessionStateView<TSetup, TContribution, TDoc>>;
  /** Poll state on a cadence. Returns a stop function. Errors are passed to
   *  onError (or swallowed) so a transient failure never kills the loop. */
  poll(
    onState: (s: SessionStateView<TSetup, TContribution, TDoc>) => void,
    opts?: SessionPollOptions & { onError?: (err: unknown) => void }
  ): () => void;
  /** Host-only: commit the session framing. */
  commitSetup(setup: TSetup): Promise<SessionStateView<TSetup, TContribution, TDoc>>;
  /** Upsert my contribution (seal). One contribution row per member; widgets
   *  with multi-stage payloads post the merged object every time. */
  contribute(payload: TContribution): Promise<SessionStateView<TSetup, TContribution, TDoc>>;
  /** Host-only close: synthesis runs, the artifact is born. Idempotent. */
  close(): Promise<SessionStateView<TSetup, TContribution, TDoc>>;
  /** Widget-specific verb that returns a session STATE (e.g. the sprint's
   *  /advance). Body is JSON-encoded; the response's state is returned. */
  action(verb: string, body?: unknown): Promise<SessionStateView<TSetup, TContribution, TDoc>>;
  /** Widget-specific verb with a NON-state response (e.g. /assist). Returns
   *  the response's raw `data` value. */
  request<T = unknown>(verb: string, body?: unknown): Promise<T>;
  /** Open a Flowstate URL outside the widget (parent navigation preferred —
   *  the /w page owns the session cookie). */
  openExternal(url: string): void;
  /** Deep link to an artifact reveal on the web app. */
  revealUrl(artifactId: string): string;
}

// ============================================
// Launch params + ticket handshake (ADR-025)
// ============================================

export interface SessionLaunchParams {
  slug: string;
  /** Dev-only fallback: a ticket in the URL. Production receives the ticket
   *  via the parent's `flowstate:init` postMessage — URLs leak into
   *  history/referrers/logs. */
  ticket: string | null;
  apiBase: string;
  webBase: string;
  /** Base URL of the mobile PWA (the optional `mobile` iframe param). Null
   *  when the host didn't send one — legacy hosts never do — so consumers
   *  fall back to `webBase` links. Optional so hand-built params keep
   *  compiling. */
  mobileBase?: string | null;
  /** Origin of the page that FRAMES the widget — the `host` iframe param.
   *  The ready/init ticket handshake and `flowstate:navigate` are addressed
   *  to this origin (0.2.2). Defaults to `webBase` when absent, which is
   *  what every pre-0.2.2 host is: the web /w page framing the widget. The
   *  mobile PWA frames the widget itself (its native lobby) and names itself
   *  here — without it the browser drops every postMessage between them
   *  (target-origin mismatch) and the widget never boots. */
  hostBase?: string;
}

export function readSessionLaunchParams(): SessionLaunchParams | null {
  if (typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  // `tripId` is the historical param name the /w page passes; keep reading it
  // so hosts don't have to change. `slug` is accepted as the modern alias.
  const slug = q.get('slug') ?? q.get('tripId') ?? '';
  if (!slug) return null;
  // `mobile` is optional and has NO default: absent means the host predates
  // the PWA doors (or has none configured) and consumers must keep minting
  // legacy webBase links.
  const mobile = q.get('mobile');
  const webBase = (q.get('web') ?? 'http://localhost:14321').replace(/\/$/, '');
  const host = q.get('host');
  return {
    slug,
    ticket: q.get('ticket'),
    apiBase: (q.get('api') ?? 'http://localhost:13002').replace(/\/$/, ''),
    webBase,
    mobileBase: mobile ? mobile.replace(/\/$/, '') : null,
    hostBase: host ? host.replace(/\/$/, '') : webBase,
  };
}

/** The origin the handshake is addressed to: the framing page. */
export const hostOriginOf = (params: Pick<SessionLaunchParams, 'webBase' | 'hostBase'>): string =>
  new URL(params.hostBase ?? params.webBase).origin;

const SESSION_INIT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 4_000;

/** Announce readiness to the parent (host) page and wait for it to hand over
 *  the single-use session ticket. `hostOrigin` is the framing page's origin
 *  (`hostOriginOf`) — the web /w page or the mobile PWA's native lobby. */
function awaitInitTicket(hostOrigin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || window.parent === window) {
      reject(new Error('no parent page to receive a ticket from'));
      return;
    }
    const webOrigin = hostOrigin;
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('timed out waiting for the session handoff'));
    }, SESSION_INIT_TIMEOUT_MS);
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== webOrigin) return;
      const data = e.data as { type?: string; ticket?: string } | null;
      if (data?.type !== 'flowstate:init' || typeof data.ticket !== 'string') return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(data.ticket);
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'flowstate:ready' }, webOrigin);
  });
}

// ============================================
// Wire mapping
// ============================================

interface WireMember {
  userId: string;
  name: string;
  color: string;
  sealed: boolean;
  isMe: boolean;
  isHost: boolean;
}

interface WireSessionState {
  tripId: string;
  phase: 'setup' | 'wishlist' | 'sealed' | 'plan';
  status: string;
  setup: Record<string, unknown> | null;
  members: WireMember[];
  sealedCount: number;
  memberCount: number;
  allSealed: boolean;
  quorumMet?: boolean;
  gate?: SessionGateView | null;
  flow?: SessionFlowView | null;
  myWishlist: unknown;
  plan: Record<string, unknown> | null;
  artifactId: string | null;
  extension?: Record<string, unknown> | null;
}

const WIRE_PHASE: Record<WireSessionState['phase'], SessionPhase> = {
  setup: 'setup',
  wishlist: 'open',
  sealed: 'sealed',
  plan: 'resolved',
};

function toStateView<TSetup, TContribution, TDoc>(
  s: WireSessionState
): SessionStateView<TSetup, TContribution, TDoc> {
  return {
    slug: s.tripId,
    phase: WIRE_PHASE[s.phase] ?? 'open',
    status: s.status,
    setup: (s.setup as TSetup | null) ?? null,
    members: s.members,
    sealedCount: s.sealedCount,
    memberCount: s.memberCount,
    allSealed: s.allSealed,
    quorumMet: s.quorumMet ?? s.allSealed,
    gate: s.gate ?? null,
    flow: s.flow ?? null,
    myContribution: (s.myWishlist as TContribution | null) ?? null,
    doc: (s.plan as TDoc | null) ?? null,
    artifactId: s.artifactId,
    extension: s.extension ?? null,
  };
}

// ============================================
// HTTP client over the session rails
// ============================================

type ExternalOpener = (url: string) => void;

const parentOpener = (hostOrigin: string): ExternalOpener => {
  return (url) => {
    if (typeof window !== 'undefined' && window.parent !== window) {
      // Ask the host page to navigate itself (the web /w page shares the
      // session cookie; the PWA lobby routes reveals natively).
      window.parent.postMessage({ type: 'flowstate:navigate', url }, hostOrigin);
      return;
    }
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
  };
};

class HttpSessionClient<TSetup, TContribution, TDoc>
  implements SessionClient<TSetup, TContribution, TDoc>
{
  readonly slug: string;
  readonly webBase: string;
  readonly mobileBase: string | null;
  private readonly apiBase: string;
  private readonly tokenPromise: Promise<string>;
  private readonly opener: ExternalOpener;

  constructor(params: SessionLaunchParams, opener?: ExternalOpener) {
    this.slug = params.slug;
    this.webBase = params.webBase;
    this.mobileBase = params.mobileBase ?? null;
    this.apiBase = params.apiBase;
    this.opener = opener ?? parentOpener(hostOriginOf(params));
    // Redeem eagerly: the ticket is single-use + short-lived; trade it for a
    // session token before the user spends time in the widget.
    this.tokenPromise = this.acquireTicket(params).then((t) => this.redeem(t));
  }

  private async acquireTicket(params: SessionLaunchParams): Promise<string> {
    if (params.ticket) return params.ticket; // dev fallback
    return awaitInitTicket(hostOriginOf(params));
  }

  private async redeem(ticket: string): Promise<string> {
    const res = await fetch(`${this.apiBase}/api/auth/ticket/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticket }),
    });
    if (!res.ok) throw new Error(`ticket redeem failed (${res.status})`);
    const json = (await res.json()) as { data: { token: string } };
    return json.data.token;
  }

  private async call(
    path: string,
    init: RequestInit = {}
  ): Promise<SessionStateView<TSetup, TContribution, TDoc>> {
    const token = await this.tokenPromise;
    const res = await fetch(`${this.apiBase}/api/w/${this.slug}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? `session service ${res.status}`);
    }
    const json = (await res.json()) as {
      data: WireSessionState | { state: WireSessionState };
    };
    const data = json.data as Record<string, unknown>;
    return toStateView((data.state ?? data) as WireSessionState);
  }

  join() {
    return this.call('/enter', { method: 'POST' });
  }

  state() {
    return this.call('/state');
  }

  poll(
    onState: (s: SessionStateView<TSetup, TContribution, TDoc>) => void,
    opts?: SessionPollOptions & { onError?: (err: unknown) => void }
  ): () => void {
    const interval = opts?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const s = await this.state();
        if (!stopped) onState(s);
      } catch (err) {
        opts?.onError?.(err);
      }
      if (!stopped) timer = setTimeout(tick, interval);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }

  commitSetup(setup: TSetup) {
    return this.call('/setup', { method: 'POST', body: JSON.stringify({ setup }) });
  }

  contribute(payload: TContribution) {
    return this.call('/contribute', { method: 'POST', body: JSON.stringify({ payload }) });
  }

  close() {
    return this.call('/close', { method: 'POST' });
  }

  action(verb: string, body?: unknown) {
    return this.call(`/${verb.replace(/^\//, '')}`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    });
  }

  async request<T = unknown>(verb: string, body?: unknown): Promise<T> {
    const token = await this.tokenPromise;
    const res = await fetch(`${this.apiBase}/api/w/${this.slug}/${verb.replace(/^\//, '')}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(errBody.message ?? `session service ${res.status}`);
    }
    const json = (await res.json()) as { data: T };
    return json.data;
  }

  openExternal(url: string): void {
    this.opener(url);
  }

  revealUrl(artifactId: string): string {
    return `${this.webBase}/a/${artifactId}`;
  }
}

// ============================================
// Standalone mock (widget dev outside the canvas)
// ============================================

export interface MockSessionOptions<TSetup, TDoc> {
  /** Display name for the single mock member. Default "You". */
  me?: string;
  /** Extra fake members (all unsealed initially). */
  others?: string[];
  setup?: TSetup | null;
  /** Called on close() to synthesize the mock doc. */
  synthesize?: (contributions: unknown[]) => TDoc;
}

/** In-memory SessionClient for standalone dev — same interface, no host, no
 *  network. The mock's "host" is always you. */
export function createMockSession<
  TSetup = Record<string, unknown>,
  TContribution = unknown,
  TDoc = Record<string, unknown>,
>(opts: MockSessionOptions<TSetup, TDoc> = {}): SessionClient<TSetup, TContribution, TDoc> {
  const palette = ['#8b7ef8', '#f8a34d', '#4dc9a4', '#f26d8f', '#5aa9e6'];
  const members: SessionMember[] = [
    { userId: 'mock-me', name: opts.me ?? 'You', color: palette[0], sealed: false, isMe: true, isHost: true },
    ...(opts.others ?? []).map((name, i) => ({
      userId: `mock-${i + 1}`,
      name,
      color: palette[(i + 1) % palette.length],
      sealed: false,
      isMe: false,
      isHost: false,
    })),
  ];
  let setup: TSetup | null = opts.setup ?? null;
  let myContribution: TContribution | null = null;
  let doc: TDoc | null = null;
  let status = 'open';

  const view = (): SessionStateView<TSetup, TContribution, TDoc> => {
    const sealedCount = members.filter((m) => m.sealed).length;
    const allSealed = members.length > 0 && sealedCount >= members.length;
    const phase: SessionPhase =
      status === 'closed' && doc ? 'resolved' : !setup ? 'setup' : allSealed ? 'sealed' : 'open';
    return {
      slug: 'mock-session',
      phase,
      status,
      setup,
      members: members.map((m) => ({ ...m })),
      sealedCount,
      memberCount: members.length,
      allSealed,
      quorumMet: allSealed,
      gate: null,
      flow: null,
      myContribution,
      doc,
      artifactId: doc ? 'mock-artifact' : null,
      extension: null,
    };
  };

  return {
    slug: 'mock-session',
    webBase: 'http://localhost:14321',
    async join() {
      return view();
    },
    async state() {
      return view();
    },
    poll(onState, pollOpts) {
      const interval = pollOpts?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
      const timer = setInterval(() => onState(view()), interval);
      onState(view());
      return () => clearInterval(timer);
    },
    async commitSetup(s: TSetup) {
      setup = s;
      return view();
    },
    async contribute(payload: TContribution) {
      myContribution = payload;
      const me = members.find((m) => m.isMe);
      if (me) me.sealed = true;
      return view();
    },
    async close() {
      status = 'closed';
      doc = opts.synthesize
        ? opts.synthesize([myContribution])
        : ({ mock: true } as unknown as TDoc);
      return view();
    },
    async action() {
      return view();
    },
    async request<T = unknown>() {
      return {} as T;
    },
    openExternal(url: string) {
      if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
    },
    revealUrl(artifactId: string) {
      return `http://localhost:14321/a/${artifactId}`;
    },
  };
}

// ============================================
// Entry point
// ============================================

/**
 * Initialize a widget-session client from the launch context.
 *
 * Returns `null` when the page carries no session launch params (standalone
 * dev, or a canvas-hosted widget that has no group session) — callers fall
 * back to {@link createMockSession} or their own local state.
 */
export function initSession<
  TSetup = Record<string, unknown>,
  TContribution = unknown,
  TDoc = Record<string, unknown>,
>(): SessionClient<TSetup, TContribution, TDoc> | null {
  const params = readSessionLaunchParams();
  if (!params) return null;
  return new HttpSessionClient<TSetup, TContribution, TDoc>(params);
}
