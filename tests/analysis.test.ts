import { describe, expect, it } from "vitest";
import { validateAnalysis } from "../src/lib/analysis";
import { createMockAnalysis } from "../src/lib/openai";
import type { OutputFormat } from "../src/types";

const format: OutputFormat = {
  id: "wide",
  group: "Тест",
  name: "Wide",
  width: 1600,
  height: 900,
  mimeType: "image/jpeg",
  extension: "jpg",
  maxBytes: 500_000,
  filenameTemplate: "{sourceBase}.{ext}",
  builtIn: false,
};

describe("analysis validation", () => {
  it("accepts every requested format exactly once", () => {
    const result = validateAnalysis(createMockAnalysis([format], 4000, 3000), [format], 4000, 3000);
    expect(result.success).toBe(true);
  });

  it("rejects missing and unknown format IDs", () => {
    const value = createMockAnalysis([format], 4000, 3000);
    value.outputs[0].formatId = "unknown";
    const result = validateAnalysis(value, [format], 4000, 3000);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.join(" ")).toContain("unknown");
  });

  it("repairs a small aspect-ratio deviation", () => {
    const value = createMockAnalysis([format], 4000, 3000);
    value.outputs[0].crop.height *= 1.01;
    const result = validateAnalysis(value, [format], 4000, 3000);
    expect(result.success).toBe(true);
    if (result.success) expect(result.repairs.length).toBe(1);
  });
});
