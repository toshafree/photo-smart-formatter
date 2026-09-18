import { describe, expect, it } from "vitest";
import {
  findJpegQuality,
  findLargestFittingDetailScale,
  validateEncodedMetadata,
} from "../src/lib/image";
import { rotatedDimensions } from "../src/lib/orientation";
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

  it("uses qualities below the old 45% floor when required by the byte limit", async () => {
    const encode = async (quality: number) =>
      new Blob([new Uint8Array(Math.round(quality * 1000))], { type: "image/jpeg" });
    const result = await findJpegQuality(encode, 200, { iterations: 12 });
    expect(result.limitMet).toBe(true);
    expect(result.blob.size).toBeLessThanOrEqual(200);
    expect(result.quality).toBeGreaterThan(0.19);
    expect(result.quality).toBeLessThanOrEqual(0.201);
  });

  it("reports an impossible limit without changing dimensions", async () => {
    const encode = async () => new Blob([new Uint8Array(1000)], { type: "image/jpeg" });
    expect((await findJpegQuality(encode, 500)).limitMet).toBe(false);
  });
});

describe("JPEG detail fallback", () => {
  it("finds the largest detail scale whose minimum-quality JPEG fits", async () => {
    const encode = async (detailScale: number) =>
      new Blob([new Uint8Array(Math.round(100 + detailScale * 1000))], {
        type: "image/jpeg",
      });
    const result = await findLargestFittingDetailScale(encode, 600, { iterations: 12 });
    expect(result.limitMet).toBe(true);
    expect(result.blob.size).toBeLessThanOrEqual(600);
    expect(result.detailScale).toBeGreaterThan(0.49);
    expect(result.detailScale).toBeLessThanOrEqual(0.501);
  });

  it("reports a limit below the smallest fallback representation", async () => {
    const encode = async () => new Blob([new Uint8Array(300)], { type: "image/jpeg" });
    const result = await findLargestFittingDetailScale(encode, 200);
    expect(result.limitMet).toBe(false);
    expect(result.blob.size).toBe(300);
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

describe("semantic source rotation", () => {
  it("swaps dimensions only for quarter turns", () => {
    expect(rotatedDimensions(4000, 3000, 0)).toEqual({ width: 4000, height: 3000 });
    expect(rotatedDimensions(4000, 3000, 90)).toEqual({ width: 3000, height: 4000 });
    expect(rotatedDimensions(4000, 3000, 180)).toEqual({ width: 4000, height: 3000 });
    expect(rotatedDimensions(4000, 3000, 270)).toEqual({ width: 3000, height: 4000 });
  });
});
