# Repository Guidelines

## Project overview

Paseo TPS is a Paseo plugin that measures an agent's generation speed and shows
it as a composer pill. The pill shows `XXX TPS`; its hover tooltip shows TTFT and
TPS together; clicking it resets the meter. The manifest requires Paseo >= 0.11.0.
The client entry registers the pill and the Display settings screen; the server
entry only registers the host-scoped settings document. There is no build step:
Paseo loads the plugin source directly.

The project uses strict TypeScript, React types, npm, and Vitest. Paseo supplies
the runtime SDK; the local packages are development dependencies only.

## Development commands

Run these from the repository root:

```sh
npm install
npm run check          # tsc --noEmit && vitest run
npm run typecheck      # tsc --noEmit
npm test               # vitest run
npm test -- client/meter.test.ts
paseo plugin install .              # install this working copy (directory source)
paseo plugin reload paseo-tps
```

The published source is `github:mohemohe/paseo-tps`. A directory source does not
run the manifest's `build` step; a Git source does.

`npm install` needs `--legacy-peer-deps` (already set in `.npmrc`) because npm
10.9.x crashes on this peer graph.

## Dependencies

`tokenx` is a runtime dependency. Paseo's plugin compiler bundles `node_modules`
imports into the client bundle (only Node builtins and host modules are
restricted), so `tokenx` must stay installed in the plugin directory. It is pure
JS with no dependencies and no Node builtins, and the daemon compiles it at
plugin load.

`paseo-plugin.json` therefore declares `"build": [["npm", "ci", "--omit=dev"]]`
so a Git install fetches `tokenx`. Paseo runs `build` only for Git and npm
sources, not for directory sources, so local development keeps its dev
dependencies. Keep `package-lock.json` in sync: `npm ci` fails on drift.

Note: `tokenx` builds regexes with Unicode property escapes at module load. These
work in the Electron/web (V8) client; verify on React Native (Hermes) before
relying on mobile clients.

## Repository layout

| Path                  | Responsibility                                                              |
| --------------------- | --------------------------------------------------------------------------- |
| `paseo-plugin.json`   | Plugin ID and minimum Paseo version.                                        |
| `index.client.tsx`    | Client entry; registers the pill and the Display settings screen.           |
| `index.server.ts`     | Server entry; registers the host-scoped settings document.                  |
| `shared/settings.ts`  | Host-scoped settings document (`correctWithUsage`, default `true`).         |
| `client/meter.ts`     | Pure reducer: turn state, segments, TTFT, generation time, live metrics.    |
| `client/tokens.ts`    | Wrapper around `tokenx` for the streamed-text token estimate.               |
| `client/format.ts`    | Pill label and tooltip text.                                                |
| `client/store.ts`     | Per-agent store: timeline subscription, clock offset, live tick, reset.     |
| `client/pill.tsx`     | Pill icon; relays the correction setting to the registration layer.         |
| `client/settings-screen.tsx` | Display settings screen under Settings → Plugins.                    |
| `client/register.ts`  | Agent-directory observation and composer pill registration.                 |
| `client/*.test.ts`    | Colocated Vitest tests.                                                     |
| `README.md`, `README.ja.md` | English and Japanese user documentation.                              |

## Behavior to preserve

- A generation segment always starts at the user's message or a tool call's end,
  and ends at a tool call's start or the turn's end. Tool time never counts
  toward generation time.
- TTFT is measured from the segment that produced the turn's first output token.
  TPS aggregates every segment of the turn.
- `assistant_message` and `reasoning` text count as output; tool call arguments
  do not. The meter accumulates that text and estimates tokens with `tokenx`
  because Paseo does not deliver live token counts to plugins.
- A completed turn that reports a positive `turn_completed.usage.outputTokens`
  uses that count for its final rate; otherwise the estimate stands. The Display
  setting (`correctWithUsage`, default on) toggles this, and the pill icon and
  settings screen relay its value to every registered store.
- Parallel tool calls keep the meter paused until every call finishes. A terminal
  tool state without a running event still closes the current segment.
- `turn_completed`, `turn_failed`, and `turn_canceled` finish the turn and stop
  the tick timer. The final rate stays until the next turn or a reset.
- The store subscribes once per registered pill and releases the subscription,
  timer, and retries on disposal. It retries a failed observation with capped
  backoff. A timeline `replacement` resets the meter.
- Pills are registered for active, unarchived agents with a workspace and removed
  on archive, removal, workspace change, or plugin unload.

## Code and verification conventions

- Follow the existing two-space indentation, double quotes, semicolons, named
  exports, and `import type` usage. Keep the entry point's default export.
- Derive timeline and SDK types from the installed `@getpaseo/plugin` and
  `@getpaseo/client` declarations rather than redefining them.
- Keep the reducer in `client/meter.ts` pure and free of timers or SDK types so it
  stays easy to test; put subscriptions and timers in `client/store.ts`.
- Write UI text in English. Paseo does not expose the app language to plugins.
- Add or adjust colocated tests for changed timing, tool, and cleanup behavior.
  Store tests use fake timers; remember that `advanceTimersByTime` also moves the
  fake clock.
- Run `npm run check` after changes, then `paseo plugin reload paseo-tps` and
  `paseo plugin logs paseo-tps` to confirm the plugin still loads.
- Update both READMEs when user-visible behavior or requirements change.

## Official documentation

- SDK API reference: https://github.com/getpaseo/paseo/blob/main/public-docs/sdk/reference.md
- SDK events: https://github.com/getpaseo/paseo/blob/main/public-docs/sdk/events.md
- Plugin reference (composer pills, button descriptor):
  https://github.com/getpaseo/paseo/blob/main/public-docs/plugins/reference.md
