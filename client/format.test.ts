import { describe, expect, it } from "vitest";
import { formatDuration, formatTps, pillLabel, pillTitle } from "./format";

describe("formatting", () => {
  it("formats the token rate for the pill", () => {
    expect(formatTps(null)).toBe("--");
    expect(formatTps(Number.NaN)).toBe("--");
    expect(formatTps(0)).toBe("0.0");
    expect(formatTps(42.34)).toBe("42.3");
    expect(formatTps(123.4)).toBe("123");
  });

  it("formats durations", () => {
    expect(formatDuration(null)).toBe("--");
    expect(formatDuration(820)).toBe("820ms");
    expect(formatDuration(1_230)).toBe("1.23s");
  });

  it("labels the pill with a trailing TPS suffix", () => {
    expect(pillLabel(42.34)).toBe("42.3 TPS");
    expect(pillLabel(null)).toBe("-- TPS");
  });

  it("shows TTFT and TPS together in the tooltip", () => {
    expect(pillTitle(42.3, 1_230, "streaming")).toBe("TTFT 1.23s · TPS 42.3 · click to reset");
    expect(pillTitle(null, null, "waiting")).toBe("TTFT -- · TPS -- · waiting for first token");
    expect(pillTitle(10, 900, "tool")).toBe("TTFT 900ms · TPS 10.0 · tool running, timer paused");
    expect(pillTitle(null, null, "idle")).toBe("TPS meter: no measurement yet. Click to reset.");
  });
});
