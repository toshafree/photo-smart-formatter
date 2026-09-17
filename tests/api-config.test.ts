import { describe, expect, it } from "vitest";
import { DIRECT_OPENAI_RESPONSES_URL, resolveOpenAIResponsesUrl } from "../src/config/api";

describe("OpenAI endpoint configuration", () => {
  it("uses the direct API when no proxy is configured", () => {
    expect(resolveOpenAIResponsesUrl(" ")).toBe(DIRECT_OPENAI_RESPONSES_URL);
  });

  it("accepts an HTTPS proxy endpoint", () => {
    expect(resolveOpenAIResponsesUrl(" https://proxy.example/v1/responses ")).toBe(
      "https://proxy.example/v1/responses",
    );
  });

  it("rejects insecure remote proxy endpoints", () => {
    expect(() => resolveOpenAIResponsesUrl("http://proxy.example/v1/responses")).toThrow(
      "должен использовать HTTPS",
    );
  });
});
