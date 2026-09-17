import { describe, expect, it } from "vitest";
import { DEEPSEEK_RESPONSES_URL } from "../src/config/api";

describe("DeepSeek endpoint configuration", () => {
  it("uses the official HTTPS Responses API", () => {
    expect(DEEPSEEK_RESPONSES_URL).toBe("https://api.deepseek.com/responses");
  });
});
