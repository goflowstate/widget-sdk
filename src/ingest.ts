// ============================================
// Widget ingest channel — ADR-043 in-place delivery
// ============================================
//
// When an artifact is dropped on (or sent to) a widget and the ingestion
// transform produces a result, the HOST pushes the produced artifact into
// any open iframe of the target widget:
//
//   postMessage({ type: 'flowstate:ingest', artifactId, kind?, payload? })
//
// `payload` is the produced artifact's parsed JSON content when the host
// could fetch it (small structured artifacts like kanban boards); widgets
// without a payload can show an affordance around `artifactId` instead.
// Same channel shape as the theme handoff (`flowstate:theme`).
//
// Usage in a widget entry:
//   import { onArtifactIngested } from '@goflowstate/widget-sdk';
//   onArtifactIngested(({ payload }) => mergeBoard(payload));

export const INGEST_MESSAGE_TYPE = 'flowstate:ingest';

export interface IngestedArtifact {
  /** The produced artifact's id (host route: /a/:id). */
  artifactId: string;
  /** The produced artifact kind (e.g. 'kanban-board'), when known. */
  kind?: string;
  /** Parsed JSON content of the produced artifact, when the host fetched it. */
  payload?: unknown;
}

/**
 * Subscribe to ingestion results pushed by the host. Non-ingest messages and
 * malformed payloads are ignored. Returns an unsubscribe function.
 *
 * Only messages from the embedding host page (`window.parent`) are accepted —
 * a hostile sibling frame or opener cannot inject into the channel. Pass
 * `allowedOrigin` to additionally pin the host's origin (the session module
 * derives the same value from `webBase`).
 */
export function onArtifactIngested(
  cb: (artifact: IngestedArtifact) => void,
  opts?: { allowedOrigin?: string }
): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: MessageEvent): void => {
    if (event.source !== window.parent) return;
    if (opts?.allowedOrigin && event.origin !== opts.allowedOrigin) return;
    const data: unknown = event.data;
    if (typeof data !== 'object' || data === null) return;
    const message = data as { type?: unknown; artifactId?: unknown; kind?: unknown; payload?: unknown };
    if (message.type !== INGEST_MESSAGE_TYPE) return;
    if (typeof message.artifactId !== 'string' || !message.artifactId) return;
    cb({
      artifactId: message.artifactId,
      kind: typeof message.kind === 'string' ? message.kind : undefined,
      payload: message.payload,
    });
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
