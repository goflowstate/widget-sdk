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
