import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTpsStore, type TpsSnapshot } from "./store";

type Timeline = Parameters<typeof createTpsStore>[0];

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function createFakeTimeline() {
  const handlers = new Set<(update: unknown) => void>();
  let released = 0;
  const timeline = {
    subscribe(handler: (update: unknown) => void) {
      handlers.add(handler);
      return {
        ready: Promise.resolve(),
        release: () => {
          released += 1;
          return Promise.resolve();
        },
      };
    },
  };
  return {
    timeline: timeline as unknown as Timeline,
    emit(update: unknown) {
      for (const handler of handlers) handler(update);
    },
    released: () => released,
  };
}

function item(timestamp: number, event: unknown) {
  return { agentId: "a1", timestamp: iso(timestamp), event };
}

const T0 = new Date("2026-01-01T00:00:00Z").getTime();

describe("tps store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts idle and publishes live metrics while streaming", () => {
    const fake = createFakeTimeline();
    const snapshots: TpsSnapshot[] = [];
    const store = createTpsStore(fake.timeline, (snapshot) => snapshots.push(snapshot));

    expect(store.getSnapshot().label).toBe("-- TPS");
    expect(store.getSnapshot().phase).toBe("idle");

    fake.emit(
      item(T0, { type: "timeline", provider: "claude", item: { type: "user_message", text: "hi" } }),
    );
    expect(store.getSnapshot().phase).toBe("waiting");

    vi.setSystemTime(T0 + 1_000);
    fake.emit(
      item(T0 + 1_000, {
        type: "timeline",
        provider: "claude",
        item: { type: "assistant_message", text: "aaaa" },
      }),
    );
    expect(store.getSnapshot().phase).toBe("streaming");
    expect(store.getSnapshot().ttftMs).toBe(1_000);

    // advanceTimersByTime also moves the fake clock, so one second later the
    // one token gives a rate of 1 token per second.
    vi.advanceTimersByTime(1_000);
    expect(store.getSnapshot().label).toBe("1.0 TPS");

    vi.advanceTimersByTime(1_000);
    expect(store.getSnapshot().label).toBe("0.5 TPS");
    expect(snapshots.length).toBeGreaterThan(0);

    store.dispose();
    expect(fake.released()).toBe(1);
  });

  it("excludes tool time and finishes the turn", () => {
    const fake = createFakeTimeline();
    const store = createTpsStore(fake.timeline, () => {});
    const timelineEvent = (event: unknown, at: number) => fake.emit(item(at, event));

    timelineEvent({ type: "timeline", provider: "claude", item: { type: "user_message", text: "hi" } }, T0);
    vi.setSystemTime(T0 + 1_000);
    timelineEvent(
      { type: "timeline", provider: "claude", item: { type: "assistant_message", text: "aaaa" } },
      T0 + 1_000,
    );
    vi.setSystemTime(T0 + 2_000);
    timelineEvent(
      { type: "timeline", provider: "claude", item: { type: "tool_call", callId: "t1", name: "Read", status: "running", detail: { type: "read", filePath: "a" } } },
      T0 + 2_000,
    );
    expect(store.getSnapshot().phase).toBe("tool");

    vi.setSystemTime(T0 + 6_000);
    timelineEvent(
      { type: "timeline", provider: "claude", item: { type: "tool_call", callId: "t1", name: "Read", status: "completed", detail: { type: "read", filePath: "a" } } },
      T0 + 6_000,
    );
    timelineEvent({ type: "turn_completed", provider: "claude" }, T0 + 6_000);
    expect(store.getSnapshot().phase).toBe("done");
    // 1000ms before the tool, no tokens after it, so 1 token over 1 second.
    expect(store.getSnapshot().label).toBe("1.0 TPS");
  });

  it("corrects the final rate with the provider's reported output tokens", () => {
    const fake = createFakeTimeline();
    const store = createTpsStore(fake.timeline, () => {});
    fake.emit(
      item(T0, { type: "timeline", provider: "claude", item: { type: "user_message", text: "hi" } }),
    );
    vi.setSystemTime(T0 + 1_000);
    fake.emit(
      item(T0 + 1_000, {
        type: "timeline",
        provider: "claude",
        item: { type: "assistant_message", text: "aaaa" },
      }),
    );
    vi.setSystemTime(T0 + 2_000);
    fake.emit(
      item(T0 + 2_000, { type: "turn_completed", provider: "claude", usage: { outputTokens: 100 } }),
    );
    expect(store.getSnapshot().phase).toBe("done");
    // 100 reported tokens over one second of generation.
    expect(store.getSnapshot().label).toBe("100 TPS");

    store.setCorrectWithUsage(false);
    expect(store.getSnapshot().label).toBe("1.0 TPS");

    store.setCorrectWithUsage(true);
    expect(store.getSnapshot().label).toBe("100 TPS");
  });

  it("resets on click and ignores events after disposal", () => {
    const fake = createFakeTimeline();
    let changes = 0;
    const store = createTpsStore(fake.timeline, () => {
      changes += 1;
    });
    fake.emit(item(T0, { type: "timeline", provider: "claude", item: { type: "user_message", text: "hi" } }));
    vi.setSystemTime(T0 + 1_000);
    fake.emit(
      item(T0 + 1_000, { type: "timeline", provider: "claude", item: { type: "assistant_message", text: "abcd" } }),
    );
    expect(store.getSnapshot().phase).toBe("streaming");

    store.reset();
    expect(store.getSnapshot().phase).toBe("idle");
    expect(store.getSnapshot().label).toBe("-- TPS");

    store.dispose();
    const before = changes;
    fake.emit(
      item(T0 + 2_000, { type: "timeline", provider: "claude", item: { type: "assistant_message", text: "abcd" } }),
    );
    expect(changes).toBe(before);
  });

  it("resets the meter on a timeline replacement", () => {
    const fake = createFakeTimeline();
    const store = createTpsStore(fake.timeline, () => {});
    fake.emit(item(T0, { type: "timeline", provider: "claude", item: { type: "user_message", text: "hi" } }));
    expect(store.getSnapshot().phase).toBe("waiting");
    fake.emit({ agentId: "a1", event: { type: "replacement", epoch: "e2" } });
    expect(store.getSnapshot().phase).toBe("idle");
  });
});
