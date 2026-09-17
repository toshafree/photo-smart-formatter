import type { Box, OutputFormat } from "../types";

export const ASPECT_EPSILON = 0.005;
export const REPAIRABLE_ASPECT_ERROR = 0.03;

export function normalizedCropAspect(crop: Box, sourceWidth: number, sourceHeight: number) {
  return (crop.width * sourceWidth) / (crop.height * sourceHeight);
}

export function relativeAspectError(actual: number, expected: number) {
  return Math.abs(actual - expected) / expected;
}

export function repairCropAspect(
  crop: Box,
  targetAspect: number,
  sourceWidth: number,
  sourceHeight: number,
): Box {
  const normalizedTarget = targetAspect * (sourceHeight / sourceWidth);
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  let width = crop.height * normalizedTarget;
  let height = crop.height;

  if (width > 1) {
    width = crop.width;
    height = crop.width / normalizedTarget;
  }

  const maxWidthAtCenter = 2 * Math.min(centerX, 1 - centerX);
  const maxHeightAtCenter = 2 * Math.min(centerY, 1 - centerY);
  const scale = Math.min(1, maxWidthAtCenter / width, maxHeightAtCenter / height);
  width *= scale;
  height *= scale;

  const x = Math.min(1 - width, Math.max(0, centerX - width / 2));
  const y = Math.min(1 - height, Math.max(0, centerY - height / 2));
  return { x, y, width, height };
}

export function mapCropToPixels(crop: Box, sourceWidth: number, sourceHeight: number) {
  const x = Math.max(0, Math.round(crop.x * sourceWidth));
  const y = Math.max(0, Math.round(crop.y * sourceHeight));
  const right = Math.min(sourceWidth, Math.round((crop.x + crop.width) * sourceWidth));
  const bottom = Math.min(sourceHeight, Math.round((crop.y + crop.height) * sourceHeight));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export function cropNeedsUpscale(
  crop: Box,
  sourceWidth: number,
  sourceHeight: number,
  format: Pick<OutputFormat, "width" | "height">,
) {
  const pixels = mapCropToPixels(crop, sourceWidth, sourceHeight);
  return pixels.width < format.width || pixels.height < format.height;
}
