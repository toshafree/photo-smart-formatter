import { describe, expect, it } from "vitest";
import {
  mapCropToPixels,
  normalizedCropAspect,
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

  it("maps normalized coordinates to bounded pixels", () => {
    expect(mapCropToPixels({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 }, 1000, 500)).toEqual({
      x: 100,
      y: 100,
      width: 500,
      height: 200,
    });
  });
});
