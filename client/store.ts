import type { PluginClientContext } from "@getpaseo/plugin/client";
import { pillLabel, pillTitle } from "./format";
import {
  applyMeterEvent,
  createMeterState,
  isMeterActive,
  meterMetrics,
  type MeterEvent,
  type MeterPhase,
} from "./meter";

type Timeline = ReturnType<PluginClientContext["paseo"]["agents"]["ref"]>["timeline"];
type TimelineEvent = Parameters<Parameters<Timeline["subscribe"]>[0]>[0];
type TimelineSubscription = ReturnType<Timeline["subscribe"]>;
type StreamUpdate = Extract<TimelineEvent, { timestamp: string }>;
type StreamEvent = StreamUpdate["event"];

/** Live stream events carry a daemon timestamp; replacement and error notices do not. */
function isStreamUpdate(update: TimelineEvent): update is StreamUpdate {
  return "timestamp" in update;
}

const TICK_MS = 200;

export interface TpsSnapshot {
  phase: MeterPhase;
  tps: number | null;
  ttftMs: number | null;
  tokens: number;
  generationMs: number;
  label: string;
  title: string;
}

export interface TpsStore {
  getSnapshot(): TpsSnapshot;
  reset(): void;
  /** Toggles whether a finished turn uses the provider's reported output tokens. */
  setCorrectWithUsage(value: boolean): void;
  dispose(): void;
}

export interface TpsStoreOptions {
  onError?(error: unknown): void;
}

function parseTimestamp(timestamp: string | undefined): number | null {
  if (timestamp === undefined) return null;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Measures one agent's generation speed from its live timeline. It subscribes
 * for as long as the pill exists and ticks while a turn is in flight.
 */
export function createTpsStore(
  timeline: Timeline,
  onChange: (snapshot: TpsSnapshot) => void,
  { onError }: TpsStoreOptions = {},
): TpsStore {
  let state = createMeterState();
  let offsetMs = 0;
  let correctWithUsage = true;
  let snapshot = build();
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  let subscriptionGeneration = 0;
  let subscription: TimelineSubscription | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryAttempt = 0;

  function now(): number {
    return Date.now() - offsetMs;
  }

  function build(): TpsSnapshot {
    const metrics = meterMetrics(state, now(), { correctWithUsage });
    return {
      ...metrics,
      label: pillLabel(metrics.tps),
      title: pillTitle(metrics.tps, metrics.ttftMs, metrics.phase),
    };
  }

  function publish() {
    if (disposed) return;
    const next = build();
    if (
      next.label === snapshot.label &&
      next.title === snapshot.title &&
      next.generationMs === snapshot.generationMs
    ) {
      return;
    }
    snapshot = next;
    onChange(snapshot);
  }

  function syncTimer() {
    const active = isMeterActive(state);
    if (active && timer === undefined) {
      timer = setInterval(publish, TICK_MS);
    } else if (!active && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  function dispatch(event: MeterEvent) {
    state = applyMeterEvent(state, event);
    syncTimer();
    publish();
  }

  function applyStreamEvent(event: StreamEvent, at: number) {
    switch (event.type) {
      case "turn_completed":
        dispatch({ kind: "turn-end", at, outputTokens: event.usage?.outputTokens });
        return;
      case "turn_failed":
      case "turn_canceled":
        dispatch({ kind: "turn-end", at });
        return;
      case "timeline":
        break;
      default:
        return;
    }
    const { item } = event;
    switch (item.type) {
      case "user_message":
        dispatch({ kind: "user-message", at });
        return;
      case "assistant_message":
      case "reasoning":
        dispatch({ kind: "output", at, text: item.text });
        return;
      case "tool_call":
        if (item.status === "running") {
          dispatch({ kind: "tool-running", at, callId: item.callId });
        } else if (item.status === "completed" || item.status === "failed" || item.status === "canceled") {
          dispatch({ kind: "tool-ended", at, callId: item.callId });
        }
        return;
      default:
        return;
    }
  }

  function receive(update: TimelineEvent, currentGeneration: number) {
    if (disposed || currentGeneration !== subscriptionGeneration) return;
    if (update.event.type === "replacement") {
      dispatch({ kind: "reset" });
      return;
    }
    if (update.event.type === "subscription_restored") return;
    if (update.event.type === "error") {
      fail(new Error(update.event.error), currentGeneration);
      return;
    }
    if (!isStreamUpdate(update)) return;
    const at = parseTimestamp(update.timestamp);
    if (at !== null) offsetMs = Date.now() - at;
    applyStreamEvent(update.event, at ?? now());
  }

  function scheduleRetry() {
    if (disposed || retryTimer !== undefined) return;
    const delay = Math.min(1_000 * 2 ** retryAttempt, 30_000);
    retryAttempt = Math.min(retryAttempt + 1, 5);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      startSubscription();
    }, delay);
  }

  function fail(error: unknown, currentGeneration: number) {
    if (disposed || currentGeneration !== subscriptionGeneration) return;
    subscriptionGeneration++;
    const failed = subscription;
    subscription = undefined;
    void failed?.release().catch(() => {});
    onError?.(error);
    scheduleRetry();
  }

  function startSubscription() {
    if (disposed) return;
    const currentGeneration = ++subscriptionGeneration;
    let created: TimelineSubscription;
    try {
      created = timeline.subscribe((update) => receive(update, currentGeneration));
    } catch (error) {
      fail(error, currentGeneration);
      return;
    }
    if (disposed || currentGeneration !== subscriptionGeneration) {
      void created.release().catch(() => {});
      return;
    }
    subscription = created;
    void created.ready.then(
      () => {
        if (!disposed && currentGeneration === subscriptionGeneration) retryAttempt = 0;
      },
      (error: unknown) => fail(error, currentGeneration),
    );
  }

  startSubscription();

  return {
    getSnapshot: () => snapshot,
    reset() {
      dispatch({ kind: "reset" });
    },
    setCorrectWithUsage(value: boolean) {
      if (disposed || value === correctWithUsage) return;
      correctWithUsage = value;
      publish();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      subscriptionGeneration++;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      void subscription?.release().catch(() => {});
      subscription = undefined;
    },
  };
}
