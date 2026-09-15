# Agent guidelines for @goflowstate/widget-sdk

<!-- flowstack:begin -->

## Start here

Any harness (Claude Code, Codex, Cursor) or person: run the setup command, open the hello-world URL, then read the rules document. The rest of this file is policy you need only when you change code. This block is rendered by flowstack's `fs-agents-block`; edit it there, not here.

- Setup: `npm install`, then `npm test` (vitest) and `npm run build`, which writes `dist/canvas-widget-sdk.js`. No lockfile is committed. Needs Node 22. Runtime: not measured.
- Hello world: No standalone hello world: a widget needs a host canvas. Open `examples/hello-world/index.html` in a browser to see the standalone (no SDK) fallback, then follow the flowstatecanvas quickstart to run it inside the canvas. `widget-sdk` is the read-only mirror of this repo, pushed on `widget-sdk-v*` tags; open PRs here.
- First widget: `examples/hello-world`, with `https://github.com/goflowstate/flowstatecanvas/blob/dev/docs/widget-development/quickstart.md`.
- First flow: `n/a`.
- Rules: https://github.com/goflowstate/flowstatecanvas/blob/dev/docs/working-agreement.md
- Canon: https://github.com/goflowstate/flowstate-source-ddd/tree/main/decisions ADR-009 and ADR-056 (widgets, publish scopes) decide what the SDK may expose.
- Repo map: https://github.com/goflowstate/.github/blob/main/REPOS.md
- First hour feedback: https://github.com/goflowstate/flowstatecanvas/issues/new?template=first-hour.yml
- AI harness (Claude Code, Codex, Cursor, or your own): with flowstack installed, run `/flowstack`. Without it: `git clone https://github.com/goflowstate/flowstack.git ~/.claude/skills/flowstack && ~/.claude/skills/flowstack/setup`, then for Codex or Cursor `~/.claude/skills/flowstack/setup --host codex|cursor --project .`, then start a new session. No access to flowstack: read this block, then the rules doc, and stop at the first command that fails.

<!-- flowstack:end -->

