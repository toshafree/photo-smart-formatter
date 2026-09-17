import type { Box, OutputFormat } from "../types";

export const ASPECT_EPSILON = 0.005;

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
  const currentNormalizedAspect = crop.width / crop.height;
  let width = crop.width;
  let height = crop.height;

  if (currentNormalizedAspect < normalizedTarget) {
    width = height * normalizedTarget;
    if (width > 1) {
      width = 1;
      height = 1 / normalizedTarget;
    }
  } else {
    height = width / normalizedTarget;
    if (height > 1) {
      height = 1;
      width = normalizedTarget;
    }
  }

  const x = Math.min(1 - width, Math.max(0, centerX - width / 2));
  const y = Math.min(1 - height, Math.max(0, centerY - height / 2));
  return { x, y, width, height };
}

function positionToCover(
  current: number,
  size: number,
  requiredStart: number,
  requiredEnd: number,
) {
  const minimum = Math.max(0, requiredEnd - size);
  const maximum = Math.min(requiredStart, 1 - size);
  if (minimum <= maximum) return Math.min(maximum, Math.max(minimum, current));
  return Math.min(1 - size, Math.max(0, (requiredStart + requiredEnd - size) / 2));
}

export function protectBoxesInCrop(
  crop: Box,
  boxes: Box[],
  targetAspect: number,
  sourceWidth: number,
  sourceHeight: number,
  margin = 0.04,
): Box {
  if (!boxes.length) return crop;

  const normalizedTarget = targetAspect * (sourceHeight / sourceWidth);
  const requiredLeft = Math.max(0, Math.min(...boxes.map((box) => box.x)) - margin);
  const requiredTop = Math.max(0, Math.min(...boxes.map((box) => box.y)) - margin);
  const requiredRight = Math.min(1, Math.max(...boxes.map((box) => box.x + box.width)) + margin);
  const requiredBottom = Math.min(1, Math.max(...boxes.map((box) => box.y + box.height)) + margin);
  const maximumWidth = Math.min(1, normalizedTarget);
  const maximumHeight = maximumWidth / normalizedTarget;
  let width = Math.max(
    crop.width,
    requiredRight - requiredLeft,
    (requiredBottom - requiredTop) * normalizedTarget,
  );
  width = Math.min(maximumWidth, width);
  const height = Math.min(maximumHeight, width / normalizedTarget);
  const x = positionToCover(crop.x, width, requiredLeft, requiredRight);
  const y = positionToCover(crop.y, height, requiredTop, requiredBottom);
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
