import { estimateTokens } from "./tokens";

export type MeterPhase = "idle" | "waiting" | "streaming" | "tool" | "done";

/**
 * A turn is measured in segments. A segment starts when the user sends a
 * message or a tool call finishes, and ends when a tool call starts or the turn
 * finishes. Tool time never counts toward generation time, and the first token
 * of the turn measures TTFT from the segment that produced it.
 */
export interface MeterState {
  phase: MeterPhase;
  /** When the turn's measurement started (the user's message). */
  turnStartedAt: number | null;
  /** Start of the current segment: the user's message or the last tool end. */
  segmentStartedAt: number | null;
  /** When the current segment produced its first output token. */
  segmentFirstTokenAt: number | null;
  /** Generation time accumulated from closed segments, in milliseconds. */
  generationMs: number;
  /** Time from the turn's first segment start to its first output token. */
  ttftMs: number | null;
  /** Output text streamed so far (assistant messages and reasoning). */
  text: string;
  /** Provider-reported output tokens for the finished turn, when available. */
  actualTokens: number | null;
  /** Tool calls that are running and currently pause generation. */
  runningTools: readonly string[];
}

export type MeterEvent =
  | { kind: "user-message"; at: number }
  | { kind: "output"; at: number; text: string }
  | { kind: "tool-running"; at: number; callId: string }
  | { kind: "tool-ended"; at: number; callId: string }
  | { kind: "turn-end"; at: number; outputTokens?: number }
  | { kind: "reset" };

export interface MeterMetrics {
  phase: MeterPhase;
  tps: number | null;
  ttftMs: number | null;
  tokens: number;
  generationMs: number;
}

export function createMeterState(): MeterState {
  return {
    phase: "idle",
    turnStartedAt: null,
    segmentStartedAt: null,
    segmentFirstTokenAt: null,
    generationMs: 0,
    ttftMs: null,
    text: "",
    actualTokens: null,
    runningTools: [],
  };
}

/** A turn is in flight while it can still accumulate tokens. */
export function isMeterActive(state: MeterState): boolean {
  return state.phase === "waiting" || state.phase === "streaming" || state.phase === "tool";
}

/** Adds the time a segment has been generating and stops tracking it. */
function closeSegment(state: MeterState, at: number): MeterState {
  if (state.segmentFirstTokenAt === null) return state;
  const elapsed = Math.max(0, at - state.segmentFirstTokenAt);
  return { ...state, generationMs: state.generationMs + elapsed, segmentFirstTokenAt: null };
}

function isPositiveCount(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

export function applyMeterEvent(state: MeterState, event: MeterEvent): MeterState {
  switch (event.kind) {
    case "reset":
      return createMeterState();
    case "user-message":
      return {
        ...createMeterState(),
        phase: "waiting",
        turnStartedAt: event.at,
        segmentStartedAt: event.at,
      };
    case "output": {
      // Text outside a turn, or while a tool pauses generation, is not measured.
      if (state.phase === "idle" || state.phase === "tool") return state;
      if (event.text.length === 0) return state;
      const text = state.text + event.text;
      // A finished turn can still receive buffered text. Count its tokens without
      // reopening the closed segment or extending the generation time.
      if (state.phase === "done") return { ...state, text };
      if (state.segmentFirstTokenAt !== null) return { ...state, text };
      const ttftMs = state.ttftMs ?? Math.max(0, event.at - (state.segmentStartedAt ?? event.at));
      return { ...state, text, phase: "streaming", segmentFirstTokenAt: event.at, ttftMs };
    }
    case "tool-running": {
      if (!isMeterActive(state)) return state;
      const runningTools = state.runningTools.includes(event.callId)
        ? state.runningTools
        : [...state.runningTools, event.callId];
      return { ...closeSegment(state, event.at), phase: "tool", runningTools };
    }
    case "tool-ended": {
      if (!isMeterActive(state)) return state;
      const runningTools = state.runningTools.filter((id) => id !== event.callId);
      // Close the segment even when only the terminal tool state was delivered.
      const closed = closeSegment(state, event.at);
      if (runningTools.length > 0) return { ...closed, runningTools };
      return { ...closed, runningTools, phase: "waiting", segmentStartedAt: event.at };
    }
    case "turn-end": {
      if (!isMeterActive(state)) return state;
      const closed = closeSegment(state, event.at);
      return {
        ...closed,
        phase: "done",
        runningTools: [],
        actualTokens: isPositiveCount(event.outputTokens) ? event.outputTokens : closed.actualTokens,
      };
    }
  }
}

export interface MeterMetricsOptions {
  /** Use the provider's reported output tokens for the final rate. */
  correctWithUsage?: boolean;
}

export function meterMetrics(
  state: MeterState,
  now: number,
  { correctWithUsage = true }: MeterMetricsOptions = {},
): MeterMetrics {
  const live =
    state.segmentFirstTokenAt !== null ? Math.max(0, now - state.segmentFirstTokenAt) : 0;
  const generationMs = state.generationMs + live;
  // Prefer the provider's reported output tokens once the turn finishes, unless
  // the setting turns the correction off.
  const tokens =
    correctWithUsage && state.actualTokens !== null ? state.actualTokens : estimateTokens(state.text);
  const tps = generationMs > 0 && tokens > 0 ? tokens / (generationMs / 1000) : null;
  return { phase: state.phase, tps, ttftMs: state.ttftMs, tokens, generationMs };
}
