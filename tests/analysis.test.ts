import { describe, expect, it } from "vitest";
import { validateAnalysis } from "../src/lib/analysis";
import { createMockAnalysis } from "../src/lib/deepseek";
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

  it("locally repairs a large model aspect-ratio error", () => {
    const value = createMockAnalysis([format], 4000, 3000);
    value.outputs[0].crop = { x: 0.45, y: 0.05, width: 0.1, height: 0.9 };
    const result = validateAnalysis(value, [format], 4000, 3000);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.repairs).toHaveLength(1);
      expect(result.data.outputs[0].warnings.join(" ")).toContain(
        "автоматически вписана в точный формат",
      );
    }
  });

  it("moves a valid crop to protect an important face", () => {
    const value = createMockAnalysis([format], 4000, 3000);
    value.outputs[0].crop = { x: 0, y: 0.25, width: 1, height: 0.75 };
    value.subjects = [
      {
        kind: "face",
        description: "Главный герой",
        importance: 0.95,
        box: { x: 0.45, y: 0.03, width: 0.1, height: 0.12 },
      },
    ];
    const result = validateAnalysis(value, [format], 4000, 3000);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outputs[0].crop.y).toBe(0);
      expect(result.data.outputs[0].warnings.join(" ")).toContain("не обрезать важные лица");
    }
  });

  it("validates crop geometry against dimensions after a quarter turn", () => {
    const value = createMockAnalysis([format], 4000, 3000);
    value.sourceRotation = 90;
    const result = validateAnalysis(value, [format], 3000, 4000);
    expect(result.success).toBe(true);
  });

  it("rejects unsupported source rotations", () => {
    const value = createMockAnalysis([format], 4000, 3000);
    (value as unknown as { sourceRotation: number }).sourceRotation = 45;
    const result = validateAnalysis(value, [format], 4000, 3000);
    expect(result.success).toBe(false);
  });
});
