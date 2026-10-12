# Paseo TPS

A Paseo plugin that measures how fast an agent generates tokens and shows it as
a pill above the composer.

- The pill reads `42.3 TPS` (or `-- TPS` before anything is measured).
- Hovering shows both metrics in the tooltip, for example
  `TTFT 1.23s · TPS 42.3 · click to reset`.
- Clicking the pill resets the meter.
- The rate updates live while the agent streams.

## Metrics

| Metric   | Definition                                                                     |
| -------- | ------------------------------------------------------------------------------ |
| **TTFT** | Time from the start of a generation segment to its first output token.         |
| **TPS**  | Output tokens divided by generation time, measured from the first output token to the end of the turn. |

A turn is measured in **segments**. A segment always starts at the user's message
or at the end of a tool call, and ends when a tool call starts or the turn
finishes. Tool call time never counts toward generation time, so a turn that
runs several tools reports the model's real streaming speed. TTFT is measured
from the segment that produced the first token: from the user's message, or from
the last tool end when the model answers only after a tool call.

TTFT uses the segment that produced the turn's first output token, and the
reported TPS aggregates every segment of the turn.

## Token estimation

Paseo does not deliver live token counts to plugins (`usage_updated` never
reaches clients), so the meter estimates output tokens from the text the daemon
streams using [`tokenx`](https://www.npmjs.com/package/tokenx) — a pure-JS
heuristic estimator tuned for OpenAI's `o200k_base` encoding (~95% average
accuracy, with CJK and multi-language rules). `assistant_message` and `reasoning`
text both count; tool call arguments do not.

When a turn completes, the meter replaces the estimate with the provider's
reported `turn_completed.usage.outputTokens` if the provider sends a positive
value, so the final rate matches the provider's own count. Live values remain
estimates until then.

## Settings

Open **Settings → Plugins → paseo-tps → Display**. The plugin has no sidebar
entry; its settings live under the plugin list.

- **Correct the final rate with the provider's usage** (default on): when on, a
  finished turn uses the provider's reported output tokens instead of the
  estimate. Turn it off if a provider reports only its last request's tokens and
  the corrected rate looks too low.

## Behavior to preserve

- The meter starts at the user's message or a tool call's end, never anywhere else.
- Tool time and any text streamed while a tool runs are excluded.
- Parallel tool calls keep the meter paused until every call finishes.
- A turn finishes on `turn_completed`, `turn_failed`, or `turn_canceled`, and its
  final rate stays on the pill until the next turn or a reset.
- A completed turn that reports positive `usage.outputTokens` uses that count for
  its final rate; otherwise the estimate stands. The Display setting toggles this.
- The pill is registered for every active, unarchived agent with a workspace, and
  removed when the agent is archived or the plugin unloads.

## Installation

```sh
paseo plugin install github:mohemohe/paseo-tps
paseo plugin update paseo-tps   # later updates
```

Requires Paseo 0.11.0 or later. The Git source declares a `build` step
(`npm ci --omit=dev`) so the daemon installs the plugin's `tokenx` dependency
during install and update.

## Development

```sh
npm install
npm run check   # tsc --noEmit && vitest run
paseo plugin install .          # install this working copy
paseo plugin reload paseo-tps   # after editing
```

The client entry registers the pill and the Display settings screen; the server
entry only registers the settings document. Paseo loads the plugin source
directly, so there is no build step.
