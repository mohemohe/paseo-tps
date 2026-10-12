import { describe, expect, it } from "vitest";
import {
  applyMeterEvent,
  createMeterState,
  isMeterActive,
  meterMetrics,
  type MeterEvent,
  type MeterState,
} from "./meter";

function run(events: MeterEvent[], state: MeterState = createMeterState()): MeterState {
  return events.reduce(applyMeterEvent, state);
}

describe("meter reducer", () => {
  it("starts idle with no rate", () => {
    const metrics = meterMetrics(createMeterState(), 10_000);
    expect(metrics.phase).toBe("idle");
    expect(metrics.tps).toBeNull();
    expect(metrics.ttftMs).toBeNull();
    expect(isMeterActive(createMeterState())).toBe(false);
  });

  it("waits for the first token after a user message", () => {
    const state = run([{ kind: "user-message", at: 0 }]);
    expect(state.phase).toBe("waiting");
    expect(isMeterActive(state)).toBe(true);
    const metrics = meterMetrics(state, 5_000);
    expect(metrics.tps).toBeNull();
    expect(metrics.ttftMs).toBeNull();
  });

  it("measures TTFT and a live rate from the first token", () => {
    const state = run([
      { kind: "user-message", at: 0 },
      { kind: "output", at: 1_000, text: "aaaa" },
    ]);
    expect(state.phase).toBe("streaming");
    expect(state.text).toBe("aaaa");
    const metrics = meterMetrics(state, 2_000);
    expect(metrics.ttftMs).toBe(1_000);
    expect(metrics.tokens).toBe(1);
    // One second of generation so far.
    expect(metrics.tps).toBe(1);
    expect(meterMetrics(state, 3_000).tps).toBe(0.5);
  });

  it("ignores empty output and output outside a turn", () => {
    const idle = run([{ kind: "output", at: 1_000, text: "aaaa" }]);
    expect(idle.phase).toBe("idle");
    const waiting = run([
      { kind: "user-message", at: 0 },
      { kind: "output", at: 500, text: "" },
    ]);
    expect(waiting.phase).toBe("waiting");
    expect(waiting.segmentFirstTokenAt).toBeNull();
  });

  it("accumulates output text but drops text streamed while a tool runs", () => {
    const state = run([
      { kind: "user-message", at: 0 },
      { kind: "output", at: 1_000, text: "aa" },
      { kind: "output", at: 1_100, text: "bb" },
      { kind: "tool-running", at: 2_000, callId: "t1" },
      { kind: "output", at: 2_500, text: "zz" },
    ]);
    expect(state.text).toBe("aabb");
  });

  it("pauses generation while a tool runs and excludes that time", () => {
    const state = run([
      { kind: "user-message", at: 0 },
      { kind: "output", at: 1_000, text: "aaaa " },
      { kind: "tool-running", at: 2_000, callId: "t1" },
      { kind: "output", at: 2_500, text: "ignored" },
      { kind: "tool-ended", at: 5_000, callId: "t1" },
      { kind: "output", at: 6_000, text: "bbbb" },
      { kind: "turn-end", at: 8_000 },
    ]);
    expect(state.phase).toBe("done");
    expect(state.text).toBe("aaaa bbbb");
    const metrics = meterMetrics(state, 99_999);
    expect(metrics.ttftMs).toBe(1_000);
    expect(metrics.tokens).toBe(2);
    // 1000ms before the tool plus 2000ms after it; the 3000ms tool call is excluded.
    expect(metrics.generationMs).toBe(3_000);
    expect(metrics.tps).toBeCloseTo(2 / 3);
  });

  it("keeps paused while any parallel tool is still running", () => {
    const state = run([
      { kind: "user-message", at: 0 },
      { kind: "output", at: 1_000, text: "aaaa " },
      { kind: "tool-running", at: 2_000, callId: "t1" },
      { kind: "tool-running", at: 2_100, callId: "t2" },
      { kind: "tool-ended", at: 5_000, callId: "t1" },
      { kind: "output", at: 5_200, text: "ignored" },
      { kind: "tool-ended", at: 6_000, callId: "t2" },
      { kind: "output", at: 7_000, text: "bbbb" },
      { kind: "turn-end", at: 9_000 },
    ]);
    expect(state.runningTools).toEqual([]);
    const metrics = meterMetrics(state, 0);
    expect(metrics.tokens).toBe(2);
    expect(metrics.generationMs).toBe(3_000);
  });

  it("measures TTFT from the tool end when the first token follows a tool", () => {
    const state = run([
      { kind: "user-message", at: 0 },
      { kind: "tool-running", at: 500, callId: "t1" },
      { kind: "tool-ended", at: 3_000, callId: "t1" },
      { kind: "output", at: 4_000, text: "aaaa" },
    ]);
    expect(state.phase).toBe("streaming");
    expect(meterMetrics(state, 4_000).ttftMs).toBe(1_000);
  });

  it("treats a terminal tool without a running event as a tool boundary", () => {
    const state = run([
      { kind: "user-message", at: 0 },
      { kind: "output", at: 1_000, text: "aaaa" },
      { kind: "tool-ended", at: 4_000, callId: "t1" },
    ]);
    expect(state.phase).toBe("waiting");
    expect(state.segmentStartedAt).toBe(4_000);
    expect(meterMetrics(state, 0).generationMs).toBe(3_000);
  });

  it("ignores output and turn ends outside a turn", () => {
    const state = run([
      { kind: "output", at: 100, text: "aaaa" },
      { kind: "tool-running", at: 200, callId: "t1" },
      { kind: "turn-end", at: 300 },
    ]);
    expect(state).toEqual(createMeterState());
  });

  it("resets on a new user message and on reset", () => {
    const first = run([
      { kind: "user-message", at: 0 },
      { kind: "output", at: 1_000, text: "aaaa" },
      { kind: "turn-end", at: 2_000 },
    ]);
    const second = applyMeterEvent(first, { kind: "user-message", at: 10_000 });
    expect(second).toEqual({
      ...createMeterState(),
      phase: "waiting",
      turnStartedAt: 10_000,
      segmentStartedAt: 10_000,
    });
    expect(applyMeterEvent(second, { kind: "reset" })).toEqual(createMeterState());
  });

  it("prefers the provider's reported output tokens when the turn completes", () => {
    const state = run([
      { kind: "user-message", at: 0 },
      { kind: "output", at: 1_000, text: "aaaa" },
      { kind: "turn-end", at: 2_000, outputTokens: 40 },
    ]);
    const metrics = meterMetrics(state, 99_999);
    expect(metrics.tokens).toBe(40);
    expect(metrics.generationMs).toBe(1_000);
    expect(metrics.tps).toBe(40);
  });

  it("keeps the estimate when a turn reports no or zero usage", () => {
    const noUsage = run([
      { kind: "user-message", at: 0 },
      { kind: "output", at: 1_000, text: "aaaa" },
      { kind: "turn-end", at: 2_000 },
    ]);
    expect(meterMetrics(noUsage, 0).tokens).toBe(1);
    const zero = run([
      { kind: "user-message", at: 0 },
      { kind: "output", at: 1_000, text: "aaaa" },
      { kind: "turn-end", at: 2_000, outputTokens: 0 },
    ]);
    expect(meterMetrics(zero, 0).tokens).toBe(1);
  });

  it("keeps the estimate when the usage correction is turned off", () => {
    const state = run([
      { kind: "user-message", at: 0 },
      { kind: "output", at: 1_000, text: "aaaa" },
      { kind: "turn-end", at: 2_000, outputTokens: 40 },
    ]);
    expect(meterMetrics(state, 0, { correctWithUsage: true }).tokens).toBe(40);
    expect(meterMetrics(state, 0, { correctWithUsage: false }).tokens).toBe(1);
  });

  it("estimates tokens from mixed CJK and latin text", () => {
    const state = run([
      { kind: "user-message", at: 0 },
      { kind: "output", at: 1_000, text: "こんにちは" },
      { kind: "output", at: 1_100, text: " aaaa" },
    ]);
    expect(state.text).toBe("こんにちは aaaa");
    expect(meterMetrics(state, 1_100).tokens).toBe(5);
  });
});
