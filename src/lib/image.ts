import picaFactory from "pica";
import { orientation as readOrientation } from "exifr";
import { mapCropToPixels } from "./crop";
import { rotatedDimensions } from "./orientation";
import type { Adjustments, Box, OutputFormat, RotationDegrees } from "../types";

const pica = picaFactory();
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
export const MAX_SOURCE_PIXELS = 50_000_000;

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
  if (!context) throw new Error("Браузер не смог создать Canvas 2D.");
  return context;
}

function orientedDimensions(width: number, height: number, orientation: number) {
  return orientation >= 5 && orientation <= 8
    ? { width: height, height: width }
    : { width, height };
}

function applyOrientationTransform(
  context: CanvasRenderingContext2D,
  orientation: number,
  width: number,
  height: number,
) {
  const transforms: Record<number, [number, number, number, number, number, number]> = {
    1: [1, 0, 0, 1, 0, 0],
    2: [-1, 0, 0, 1, width, 0],
    3: [-1, 0, 0, -1, width, height],
    4: [1, 0, 0, -1, 0, height],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, height, 0],
    7: [0, -1, -1, 0, height, width],
    8: [0, -1, 1, 0, 0, width],
  };
  context.setTransform(...(transforms[orientation] ?? transforms[1]));
}

export async function decodeNormalizedImage(file: Blob): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap;
  let orientation = 1;
  let needsManualOrientation = true;
  try {
    orientation = Number((await readOrientation(file)) || 1);
  } catch {
    orientation = 1;
  }

  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: "none",
      premultiplyAlpha: "default",
      colorSpaceConversion: "default",
    } as ImageBitmapOptions);
  } catch {
    bitmap = await createImageBitmap(file);
    needsManualOrientation = false;
    orientation = 1;
  }

  try {
    const dimensions = orientedDimensions(bitmap.width, bitmap.height, orientation);
    if (dimensions.width * dimensions.height > MAX_SOURCE_PIXELS) {
      throw new Error("Изображение слишком большое: поддерживается не более 50 мегапикселей.");
    }
    const canvas = createCanvas(dimensions.width, dimensions.height);
    const context = getContext(canvas);
    if (needsManualOrientation) {
      applyOrientationTransform(context, orientation, bitmap.width, bitmap.height);
    }
    context.drawImage(bitmap, 0, 0);
    context.setTransform(1, 0, 0, 1, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
}

export async function readImageDimensions(file: Blob) {
  const canvas = await decodeNormalizedImage(file);
  const dimensions = { width: canvas.width, height: canvas.height };
  releaseCanvas(canvas);
  return dimensions;
}

export async function createVisionPreview(source: HTMLCanvasElement): Promise<string> {
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const target = createCanvas(
    Math.max(1, Math.round(source.width * scale)),
    Math.max(1, Math.round(source.height * scale)),
  );
  if (scale < 1) {
    await pica.resize(source, target, { quality: 3, alpha: false });
  } else {
    getContext(target).drawImage(source, 0, 0);
  }
  const blob = await canvasToBlob(target, "image/jpeg", 0.84);
  releaseCanvas(target);
  return blobToDataUrl(blob);
}

export function rotateCanvas(source: HTMLCanvasElement, rotation: RotationDegrees) {
  if (rotation === 0) return source;
  const dimensions = rotatedDimensions(source.width, source.height, rotation);
  const target = createCanvas(dimensions.width, dimensions.height);
  const context = getContext(target);
  context.translate(target.width / 2, target.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  context.setTransform(1, 0, 0, 1, 0, 0);
  return target;
}

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function applyAdjustments(canvas: HTMLCanvasElement, adjustments: Adjustments) {
  const context = getContext(canvas);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  const exposureFactor = 2 ** (adjustments.exposure * 0.65);
  const contrastFactor = 1 + adjustments.contrast * 0.4;
  const saturationFactor = 1 + adjustments.saturation * 0.45;
  const temperatureShift = adjustments.temperature * 18;

  for (let index = 0; index < pixels.length; index += 4) {
    let red = pixels[index] * exposureFactor;
    let green = pixels[index + 1] * exposureFactor;
    let blue = pixels[index + 2] * exposureFactor;
    const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const shadowWeight = (1 - Math.min(1, luma / 255)) ** 2;
    const highlightWeight = Math.min(1, luma / 255) ** 2;
    const toneShift =
      adjustments.shadows * 28 * shadowWeight + adjustments.highlights * 28 * highlightWeight;

    red = (red - 128) * contrastFactor + 128 + toneShift + temperatureShift;
    green = (green - 128) * contrastFactor + 128 + toneShift;
    blue = (blue - 128) * contrastFactor + 128 + toneShift - temperatureShift;
    const adjustedLuma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    pixels[index] = clampChannel(adjustedLuma + (red - adjustedLuma) * saturationFactor);
    pixels[index + 1] = clampChannel(adjustedLuma + (green - adjustedLuma) * saturationFactor);
    pixels[index + 2] = clampChannel(adjustedLuma + (blue - adjustedLuma) * saturationFactor);
  }
  context.putImageData(image, 0, 0);
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Браузер не смог закодировать изображение.")),
      mimeType,
      quality,
    );
  });
}

export async function findJpegQuality(
  encode: (quality: number) => Promise<Blob>,
  maxBytes: number,
  options: { min?: number; max?: number; iterations?: number } = {},
) {
  const minimum = options.min ?? 0;
  const maximum = options.max ?? 1;
  const iterations = options.iterations ?? 10;
  const highBlob = await encode(maximum);
  if (highBlob.size <= maxBytes) return { blob: highBlob, quality: maximum, limitMet: true };

  const lowBlob = await encode(minimum);
  if (lowBlob.size > maxBytes) return { blob: lowBlob, quality: minimum, limitMet: false };

  let low = minimum;
  let high = maximum;
  let bestBlob = lowBlob;
  let bestQuality = minimum;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const quality = (low + high) / 2;
    const blob = await encode(quality);
    if (blob.size <= maxBytes) {
      low = quality;
      bestBlob = blob;
      bestQuality = quality;
    } else {
      high = quality;
    }
  }
  return { blob: bestBlob, quality: bestQuality, limitMet: true };
}

export async function findLargestFittingDetailScale(
  encode: (detailScale: number) => Promise<Blob>,
  maxBytes: number,
  options: { min?: number; max?: number; iterations?: number } = {},
) {
  const minimum = options.min ?? 0.01;
  const maximum = options.max ?? 1;
  const iterations = options.iterations ?? 7;
  const minimumBlob = await encode(minimum);
  if (minimumBlob.size > maxBytes) {
    return { blob: minimumBlob, detailScale: minimum, limitMet: false };
  }

  let low = minimum;
  let high = maximum;
  let bestBlob = minimumBlob;
  let bestScale = minimum;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const detailScale = (low + high) / 2;
    const blob = await encode(detailScale);
    if (blob.size <= maxBytes) {
      low = detailScale;
      bestBlob = blob;
      bestScale = detailScale;
    } else {
      high = detailScale;
    }
  }
  return { blob: bestBlob, detailScale: bestScale, limitMet: true };
}

async function redrawWithReducedDetail(
  source: HTMLCanvasElement,
  target: HTMLCanvasElement,
  detailScale: number,
) {
  const reduced = createCanvas(
    Math.max(1, Math.round(source.width * detailScale)),
    Math.max(1, Math.round(source.height * detailScale)),
  );
  try {
    await pica.resize(source, reduced, { quality: 3, alpha: false });
    const context = getContext(target);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      reduced,
      0,
      0,
      reduced.width,
      reduced.height,
      0,
      0,
      target.width,
      target.height,
    );
  } finally {
    releaseCanvas(reduced);
  }
}

async function encodeJpegWithinLimit(outputCanvas: HTMLCanvasElement, format: OutputFormat) {
  const regular = await findJpegQuality(
    (quality) => canvasToBlob(outputCanvas, format.mimeType, quality),
    format.maxBytes,
  );
  if (regular.limitMet) return { ...regular, detailScale: 1 };

  const fallbackCanvas = createCanvas(outputCanvas.width, outputCanvas.height);
  const minimumDetailScale = Math.min(
    1,
    Math.max(32 / outputCanvas.width, 32 / outputCanvas.height),
  );
  try {
    const scaleSearch = await findLargestFittingDetailScale(
      async (detailScale) => {
        await redrawWithReducedDetail(outputCanvas, fallbackCanvas, detailScale);
        return canvasToBlob(fallbackCanvas, format.mimeType, 0);
      },
      format.maxBytes,
      { min: minimumDetailScale },
    );
    if (!scaleSearch.limitMet) {
      return {
        blob: scaleSearch.blob,
        quality: 0,
        limitMet: false,
        detailScale: scaleSearch.detailScale,
      };
    }

    await redrawWithReducedDetail(outputCanvas, fallbackCanvas, scaleSearch.detailScale);
    const compressed = await findJpegQuality(
      (quality) => canvasToBlob(fallbackCanvas, format.mimeType, quality),
      format.maxBytes,
    );
    return { ...compressed, detailScale: scaleSearch.detailScale };
  } finally {
    releaseCanvas(fallbackCanvas);
  }
}

export type EncodedMetadata = {
  width: number;
  height: number;
  mimeType: string;
  size: number;
};

export function validateEncodedMetadata(metadata: EncodedMetadata, format: OutputFormat): string[] {
  const errors: string[] = [];
  if (metadata.width !== format.width || metadata.height !== format.height) {
    errors.push(`Размер ${metadata.width} × ${metadata.height} не совпадает с целевым.`);
  }
  if (metadata.mimeType !== format.mimeType) errors.push("MIME type результата не совпадает.");
  if (metadata.size <= 0) errors.push("Получен пустой файл.");
  return errors;
}

export async function inspectEncodedBlob(blob: Blob, format: OutputFormat) {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error("Готовый файл не удалось декодировать обратно.");
  }
  try {
    const metadata = {
      width: bitmap.width,
      height: bitmap.height,
      mimeType: blob.type,
      size: blob.size,
    };
    const errors = validateEncodedMetadata(metadata, format);
    if (errors.length) throw new Error(errors.join(" "));
    return metadata;
  } finally {
    bitmap.close();
  }
}

export async function renderOutput(
  source: HTMLCanvasElement,
  format: OutputFormat,
  crop: Box,
  adjustments: Adjustments,
) {
  const pixelCrop = mapCropToPixels(crop, source.width, source.height);
  const cropCanvas = createCanvas(pixelCrop.width, pixelCrop.height);
  getContext(cropCanvas).drawImage(
    source,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height,
  );
  const outputCanvas = createCanvas(format.width, format.height);
  try {
    await pica.resize(cropCanvas, outputCanvas, {
      quality: 3,
      alpha: false,
      unsharpAmount: Math.round(adjustments.sharpen * 100),
      unsharpRadius: 0.6,
      unsharpThreshold: 2,
    });
    applyAdjustments(outputCanvas, adjustments);

    if (format.mimeType === "image/jpeg") {
      const encoded = await encodeJpegWithinLimit(outputCanvas, format);
      await inspectEncodedBlob(encoded.blob, format);
      return encoded;
    }

    const blob = await canvasToBlob(outputCanvas, "image/png");
    await inspectEncodedBlob(blob, format);
    return { blob, quality: null, limitMet: blob.size <= format.maxBytes, detailScale: 1 };
  } finally {
    releaseCanvas(cropCanvas);
    releaseCanvas(outputCanvas);
  }
}

export function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 1;
  canvas.height = 1;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Не удалось подготовить превью для анализа."));
    reader.readAsDataURL(blob);
  });
}
