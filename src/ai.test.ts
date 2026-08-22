import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CanvasWidgetSDKImpl } from './sdk';
import type { InitPayload, AiStreamEvent } from './types';

function makeSdk() {
  const init = {
    widgetId: 'w1',
    installationId: 'i1',
    state: 'expanded',
    hmacSecret: null,
    user: null,
    widgetApiUrl: 'https://gw.test',
    widgetApiToken: 'tok-1',
    settings: {},
  } as unknown as InitPayload;
  return new CanvasWidgetSDKImpl(init);
}

const okJson = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);

/** A Response whose body streams the given chunks — enough ReadableStream
 *  for the SDK's reader loop, same spirit as db.test.ts's okJson. */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const cancel = vi.fn(() => Promise.resolve());
  const body = {
    getReader: () => ({
      read: () =>
        i < chunks.length
          ? Promise.resolve({ done: false, value: encoder.encode(chunks[i++]) })
          : Promise.resolve({ done: true, value: undefined }),
      cancel,
    }),
  };
  return { ok: true, status: 200, body } as unknown as Response;
}

beforeEach(() => vi.restoreAllMocks());

describe('widget.ai.complete', () => {
  it('POSTs to /widget-api/ai/complete with auth and returns the result', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockReturnValue(okJson({ data: { text: 'OK', inputTokens: 3, outputTokens: 1 } }));
    const sdk = makeSdk();
    const res = await sdk.ai.complete({
      alias: 'widget.gpt-mini',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res).toEqual({ text: 'OK', inputTokens: 3, outputTokens: 1 });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://gw.test/widget-api/ai/complete');
    expect(opts?.method).toBe('POST');
    expect(new Headers(opts?.headers).get('authorization')).toBe('Bearer tok-1');
    expect(JSON.parse(opts?.body as string).alias).toBe('widget.gpt-mini');
  });

  it('throws the gateway message on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ error: 'Unavailable', message: 'No model key is available' }),
    } as Response);
    const sdk = makeSdk();
    await expect(
      sdk.ai.complete({ alias: 'widget.haiku', messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow('No model key is available');
  });
});

describe('widget.ai.stream', () => {
  it('yields parsed events across chunk boundaries and stops at [DONE]', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        'data: {"type":"text","text":"he"}\n\ndata: {"type":"te',
        'xt","text":"y"}\n\n',
        'data: {"type":"done","inputTokens":5,"outputTokens":2,"stopReason":"stop","contentBlocks":[]}\n\ndata: [DONE]\n\n',
      ])
    );
    const sdk = makeSdk();
    const events: AiStreamEvent[] = [];
    for await (const ev of sdk.ai.stream({
      alias: 'widget.gpt-mini',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      events.push(ev);
    }
    expect(events).toEqual([
      { type: 'text', text: 'he' },
      { type: 'text', text: 'y' },
      { type: 'done', inputTokens: 5, outputTokens: 2, stopReason: 'stop', contentBlocks: [] },
    ]);
  });

  it('cancels the body reader when the consumer breaks early', async () => {
    const response = sseResponse([
      'data: {"type":"text","text":"a"}\n\n',
      'data: {"type":"text","text":"b"}\n\n',
    ]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const sdk = makeSdk();
    const reader = response.body!.getReader() as unknown as { cancel: ReturnType<typeof vi.fn> };
    for await (const ev of sdk.ai.stream({
      alias: 'widget.haiku',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      void ev;
      break; // abandon after the first event
    }
    // The SDK's finally block released the connection — that is what lets
    // the gateway abort the upstream call and stop billing.
    expect(reader.cancel).toHaveBeenCalled();
  });

  it('throws before streaming on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ message: 'alias must be a widget.* alias' }),
    } as Response);
    const sdk = makeSdk();
    const gen = sdk.ai.stream({
      alias: 'widget.nope!',
      messages: [{ role: 'user', content: 'hi' }],
    });
    await expect(gen.next()).rejects.toThrow('alias must be a widget.* alias');
  });
});
