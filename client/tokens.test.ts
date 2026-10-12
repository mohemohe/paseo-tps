import { describe, expect, it } from "vitest";
import { estimateTokens } from "./tokens";

describe("token estimation", () => {
  it("returns nothing for empty text", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("treats a short lowercase word as one token", () => {
    expect(estimateTokens("aaaa")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(1);
  });

  it("counts CJK text by script", () => {
    expect(estimateTokens("こんにちは")).toBe(4);
  });

  it("counts latin words and separates them on whitespace", () => {
    expect(estimateTokens("hello world")).toBe(2);
  });

  it("grows with longer text", () => {
    expect(estimateTokens("a".repeat(40))).toBeGreaterThan(estimateTokens("aaaa"));
  });
});
