# @goflowstate/widget-sdk

SDK for building widgets that run inside the Flowstate Canvas.

## Installation

```bash
npm install @goflowstate/widget-sdk
```

Or via CDN (no bundler required):

```html
<script src="https://unpkg.com/@goflowstate/widget-sdk/dist/canvas-widget-sdk.js"></script>
```

## Quick Start

### ESM (bundler / TypeScript)

```ts
import { CanvasWidget } from '@goflowstate/widget-sdk';

const widget = await CanvasWidget.init();

// React to display state changes
widget.onStateChange((state) => {
  console.log('Widget state:', state); // 'collapsed' | 'expanding' | 'expanded' | 'collapsing'
});

// Expand into modal view
document.getElementById('open-btn')?.addEventListener('click', () => {
  widget.requestExpand();
});
```

### Script tag (no bundler)

```html
<script src="canvas-widget-sdk.js"></script>
<script>
  CanvasWidget.init().then((widget) => {
    widget.onStateChange((state) => console.log(state));
  });
</script>
```

## Emitting and Subscribing to Events

```ts
const widget = await CanvasWidget.init();

// Broadcast to other widgets on the same canvas
widget.emit('timer:tick', { remaining: 60 });

// Listen for events from other widgets
const unsub = widget.subscribe('timer:tick', (event) => {
  console.log(event.topic, event.payload);
});

// Stop listening
unsub();
```

## Persistent Storage

```ts
const widget = await CanvasWidget.init();

// Store a value (scoped to this widget installation)
await widget.storage.set('count', 42);

// Retrieve a value
const count = await widget.storage.get('count');

// Remove a value
await widget.storage.delete('count');
```

## AI Completions

Call the platform's models without holding any provider key. Every call is
metered and attributed to your publishing org.

```ts
const widget = await CanvasWidget.init();

// One-shot completion
const res = await widget.ai.complete({
  alias: 'widget.gpt-mini', // widget.* aliases only — never raw model ids
  system: 'You summarise kanban boards in one sentence.',
  messages: [{ role: 'user', content: boardAsText }],
});
console.log(res.text, res.inputTokens, res.outputTokens);

// Streaming
for await (const ev of widget.ai.stream({
  alias: 'widget.haiku',
  messages: [{ role: 'user', content: 'Brainstorm three icebreakers.' }],
})) {
  if (ev.type === 'text') appendToUi(ev.text);
  if (ev.type === 'done') console.log('tokens:', ev.inputTokens, ev.outputTokens);
  if (ev.type === 'error') showError(ev.message);
}
```

Available aliases: `widget.gpt` (OpenAI, strongest), `widget.gpt-mini`
(OpenAI, fast), `widget.haiku` (Anthropic, fast), `widget.sonnet`
(Anthropic, strongest). Aliases are platform-managed; the model behind one
can improve without a code change on your side.

Notes:

- `maxTokens` is clamped server-side to [256, 4096] (default 1024). The
  floor exists because the OpenAI aliases are reasoning models: a tiny
  budget gets consumed entirely by invisible reasoning and returns empty
  text with `stopReason: 'length'`. If you see empty text, raise the budget.
- Breaking out of a `stream()` loop cancels the upstream call, so you are
  not billed for text you stopped reading.
- Budget errors surface with messages starting `usage limit reached` —
  catch them to show your own copy.

## User Context and Consent

```ts
const widget = await CanvasWidget.init();

// Request access to user data
const result = await widget.requestConsent('user:profile', 'Needed to personalise your experience');
if (result.granted) {
  console.log('User:', widget.user?.displayName);
}
```

## Notifications

```ts
widget.notify('Saved!', { level: 'info', duration: 3000 });
```

## Full API Reference

See [`docs/widget-development/`](../../docs/widget-development/) for the complete API reference, manifest format, and hosting guide.

## License

MIT
