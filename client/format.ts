import type { MeterPhase } from "./meter";

const PLACEHOLDER = "--";

/** Formats a token rate for the pill label, for example `42.3`. */
export function formatTps(tps: number | null): string {
  if (tps === null || !Number.isFinite(tps)) return PLACEHOLDER;
  if (tps >= 100) return Math.round(tps).toString();
  return tps.toFixed(1);
}

/** Formats a duration for the tooltip, for example `820ms` or `1.23s`. */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return PLACEHOLDER;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** The composer pill's visible text, for example `42.3 TPS`. */
export function pillLabel(tps: number | null): string {
  return `${formatTps(tps)} TPS`;
}

/** The composer pill's hover tooltip, always showing TTFT and TPS together. */
export function pillTitle(tps: number | null, ttftMs: number | null, phase: MeterPhase): string {
  if (phase === "idle") return "TPS meter: no measurement yet. Click to reset.";
  const detail = `TTFT ${formatDuration(ttftMs)} · TPS ${formatTps(tps)}`;
  if (phase === "waiting") return `${detail} · waiting for first token`;
  if (phase === "tool") return `${detail} · tool running, timer paused`;
  return `${detail} · click to reset`;
}
