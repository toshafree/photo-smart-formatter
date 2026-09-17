import { describe, expect, it } from "vitest";
import {
  mapCropToPixels,
  normalizedCropAspect,
  protectBoxesInCrop,
  relativeAspectError,
  repairCropAspect,
} from "../src/lib/crop";

describe("crop helpers", () => {
  it("measures aspect ratio in pixels, not normalized space", () => {
    const aspect = normalizedCropAspect({ x: 0, y: 0, width: 0.5, height: 1 }, 4000, 2000);
    expect(aspect).toBe(1);
  });

  it("repairs aspect ratio while keeping crop in bounds", () => {
    const repaired = repairCropAspect(
      { x: 0.1, y: 0.1, width: 0.82, height: 0.8 },
      16 / 9,
      4000,
      3000,
    );
    expect(relativeAspectError(normalizedCropAspect(repaired, 4000, 3000), 16 / 9)).toBeLessThan(
      1e-10,
    );
    expect(repaired.x).toBeGreaterThanOrEqual(0);
    expect(repaired.x + repaired.width).toBeLessThanOrEqual(1);
  });

  it("expands a badly proportioned model crop around its semantic center", () => {
    const original = { x: 0.82, y: 0.3, width: 0.12, height: 0.4 };
    const repaired = repairCropAspect(original, 16 / 9, 4000, 3000);
    expect(relativeAspectError(normalizedCropAspect(repaired, 4000, 3000), 16 / 9)).toBeLessThan(
      1e-10,
    );
    expect(repaired.width).toBeGreaterThan(original.width);
    expect(repaired.height).toBe(original.height);
    expect(repaired.x).toBeGreaterThanOrEqual(0);
    expect(repaired.x + repaired.width).toBeLessThanOrEqual(1);
  });

  it("shifts an exact crop to keep a protected face and safety margin", () => {
    const protectedCrop = protectBoxesInCrop(
      { x: 0.1, y: 0.25, width: 0.8, height: 0.45 },
      [{ x: 0.44, y: 0.04, width: 0.12, height: 0.14 }],
      16 / 9,
      1000,
      1000,
    );
    expect(protectedCrop.y).toBeLessThanOrEqual(0.001);
    expect(protectedCrop.y + protectedCrop.height).toBeGreaterThanOrEqual(0.22);
    expect(
      relativeAspectError(normalizedCropAspect(protectedCrop, 1000, 1000), 16 / 9),
    ).toBeLessThan(1e-10);
  });

  it("maps normalized coordinates to bounded pixels", () => {
    expect(mapCropToPixels({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 }, 1000, 500)).toEqual({
      x: 100,
      y: 100,
      width: 500,
      height: 200,
    });
  });
});
