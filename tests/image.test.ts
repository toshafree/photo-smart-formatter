import { describe, expect, it } from "vitest";
import { findJpegQuality, validateEncodedMetadata } from "../src/lib/image";
import type { OutputFormat } from "../src/types";

const format: OutputFormat = {
  id: "test",
  group: "Тест",
  name: "Тест",
  width: 100,
  height: 80,
  mimeType: "image/jpeg",
  extension: "jpg",
  maxBytes: 600,
  filenameTemplate: "{sourceBase}.{ext}",
  builtIn: false,
};

describe("JPEG quality search", () => {
  it("finds the highest tested quality under the actual byte limit", async () => {
    const encode = async (quality: number) =>
      new Blob([new Uint8Array(Math.round(quality * 1000))], { type: "image/jpeg" });
    const result = await findJpegQuality(encode, 600, { iterations: 9 });
    expect(result.limitMet).toBe(true);
    expect(result.blob.size).toBeLessThanOrEqual(600);
    expect(result.quality).toBeGreaterThan(0.58);
  });

  it("reports an impossible limit without changing dimensions", async () => {
    const encode = async () => new Blob([new Uint8Array(1000)], { type: "image/jpeg" });
    expect((await findJpegQuality(encode, 500)).limitMet).toBe(false);
  });
});

describe("encoded output validation", () => {
  it("accepts matching metadata", () => {
    expect(
      validateEncodedMetadata(
        { width: 100, height: 80, mimeType: "image/jpeg", size: 400 },
        format,
      ),
    ).toEqual([]);
  });

  it("reports dimensions, mime and empty files", () => {
    expect(
      validateEncodedMetadata({ width: 99, height: 80, mimeType: "image/png", size: 0 }, format),
    ).toHaveLength(3);
  });
});
