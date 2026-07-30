import { describe, it, expect, vi } from 'vitest';

import { onArtifactIngested } from './ingest';

// The host pushes from the parent frame; in tests window.parent === window,
// so a host message is one whose `source` is the window itself.
const hostMessage = (data: unknown, origin?: string) =>
  new MessageEvent('message', {
    data,
    source: window as unknown as MessageEventSource,
    ...(origin ? { origin } : {}),
  });

describe('onArtifactIngested', () => {
  it('delivers well-formed ingest messages from the host and ignores the rest', () => {
    const cb = vi.fn();
    const unsubscribe = onArtifactIngested(cb);

    window.dispatchEvent(
      hostMessage({ type: 'flowstate:ingest', artifactId: 'a1', kind: 'kanban-board', payload: { cols: [] } })
    );
    window.dispatchEvent(hostMessage({ type: 'flowstate:theme', theme: 'dark' }));
    window.dispatchEvent(hostMessage({ type: 'flowstate:ingest' })); // no artifactId
    window.dispatchEvent(hostMessage({ type: 'flowstate:ingest', artifactId: '' }));
    window.dispatchEvent(hostMessage('not-an-object'));

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ artifactId: 'a1', kind: 'kanban-board', payload: { cols: [] } });

    unsubscribe();
    window.dispatchEvent(hostMessage({ type: 'flowstate:ingest', artifactId: 'a2' }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('drops messages that are not from the host frame', () => {
    const cb = vi.fn();
    const unsubscribe = onArtifactIngested(cb);

    // No source — a hostile frame/opener's message never carries the parent as source.
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'flowstate:ingest', artifactId: 'a1' } }));
    expect(cb).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('pins the host origin when allowedOrigin is passed', () => {
    const cb = vi.fn();
    const unsubscribe = onArtifactIngested(cb, { allowedOrigin: 'https://app.example' });

    window.dispatchEvent(hostMessage({ type: 'flowstate:ingest', artifactId: 'a1' }, 'https://evil.example'));
    expect(cb).not.toHaveBeenCalled();

    window.dispatchEvent(hostMessage({ type: 'flowstate:ingest', artifactId: 'a1' }, 'https://app.example'));
    expect(cb).toHaveBeenCalledWith({ artifactId: 'a1', kind: undefined, payload: undefined });

    unsubscribe();
  });
});
