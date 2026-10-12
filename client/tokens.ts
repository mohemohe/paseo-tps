import { estimateTokenCount } from "tokenx";

/**
 * Estimates output tokens for streamed text with tokenx's heuristic rules
 * (roughly four Latin characters or one CJK character per token, tuned for
 * OpenAI's `o200k_base`). Paseo does not deliver live token counts to plugins,
 * so the meter estimates while a turn streams and corrects the final value with
 * the provider's reported usage when the turn completes.
 */
export function estimateTokens(text: string): number {
  return estimateTokenCount(text);
}
