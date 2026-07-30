// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createMockSession, initSession, readSessionLaunchParams } from './session';

describe('readSessionLaunchParams', () => {
  it('returns null without a slug', () => {
    window.history.replaceState(null, '', '/');
    expect(readSessionLaunchParams()).toBeNull();
  });

  it('reads the historical tripId param and strips trailing slashes', () => {
    window.history.replaceState(
      null,
      '',
      '/?tripId=abc123&api=http://gw.local:13002/&web=http://web.local:14321/'
    );
    const p = readSessionLaunchParams();
    expect(p).toEqual({
      slug: 'abc123',
      ticket: null,
      apiBase: 'http://gw.local:13002',
      webBase: 'http://web.local:14321',
    });
  });

  it('prefers the modern slug alias and carries the dev ticket', () => {
    window.history.replaceState(null, '', '/?slug=xyz&tripId=old&ticket=t1');
    const p = readSessionLaunchParams();
    expect(p?.slug).toBe('xyz');
    expect(p?.ticket).toBe('t1');
  });
});

describe('initSession', () => {
  it('returns null in a standalone context (no launch params)', () => {
    window.history.replaceState(null, '', '/');
    expect(initSession()).toBeNull();
  });
});

describe('createMockSession', () => {
  it('walks setup → open → sealed → resolved', async () => {
    const session = createMockSession<{ question: string }, { pick: string }, { winner: string }>(
      { synthesize: () => ({ winner: 'friday' }) }
    );

    let s = await session.join();
    expect(s.phase).toBe('setup');
    expect(s.members).toHaveLength(1);
    expect(s.members[0].isHost).toBe(true);

    s = await session.commitSetup({ question: 'Which dates?' });
    expect(s.phase).toBe('open');
    expect(s.setup?.question).toBe('Which dates?');

    s = await session.contribute({ pick: 'friday' });
    expect(s.phase).toBe('sealed'); // single member → contributing seals all
    expect(s.myContribution?.pick).toBe('friday');
    expect(s.quorumMet).toBe(true);

    s = await session.close();
    expect(s.phase).toBe('resolved');
    expect(s.doc?.winner).toBe('friday');
    expect(s.artifactId).toBe('mock-artifact');
  });

  it('stays open until every member seals when others exist', async () => {
    const session = createMockSession({ others: ['Ren', 'Mika'] });
    await session.commitSetup({});
    const s = await session.contribute({ pins: [] });
    expect(s.phase).toBe('open');
    expect(s.sealedCount).toBe(1);
    expect(s.memberCount).toBe(3);
    expect(s.allSealed).toBe(false);
  });

  it('poll emits immediately and stops cleanly', () => {
    vi.useFakeTimers();
    const session = createMockSession();
    const seen: unknown[] = [];
    const stop = session.poll((s) => seen.push(s), { intervalMs: 1000 });
    expect(seen).toHaveLength(1);
    vi.advanceTimersByTime(2500);
    expect(seen).toHaveLength(3);
    stop();
    vi.advanceTimersByTime(5000);
    expect(seen).toHaveLength(3);
    vi.useRealTimers();
  });
});
