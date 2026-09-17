import type { RotationDegrees } from "../types";

export function rotatedDimensions(width: number, height: number, rotation: RotationDegrees) {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}
