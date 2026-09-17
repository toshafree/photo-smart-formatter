import { validateAnalysis } from "./analysis";
import { applyFilenameTemplate, dedupeFilename } from "./filename";
import {
  createVisionPreview,
  decodeNormalizedImage,
  releaseCanvas,
  renderOutput,
  rotateCanvas,
} from "./image";
import type { AnalysisResult, JobStatus, ModelId, OutputFormat, PreparedOutput } from "../types";

export type JobUpdate = { status: JobStatus; progress: number; text: string };

export type PipelineInput = {
  file: File;
  formats: OutputFormat[];
  apiKey: string;
  model: ModelId;
  globalPrompt: string;
  photoPrompt: string;
  signal: AbortSignal;
  onUpdate: (update: JobUpdate) => void;
};

export type PipelineDependencies = {
  analyze: (input: {
    apiKey: string;
    model: ModelId;
    imageDataUrl: string;
    sourceWidth: number;
    sourceHeight: number;
    formats: OutputFormat[];
    globalPrompt: string;
    photoPrompt: string;
    signal: AbortSignal;
  }) => Promise<AnalysisResult>;
  decode?: typeof decodeNormalizedImage;
  preview?: typeof createVisionPreview;
  rotate?: typeof rotateCanvas;
  render?: typeof renderOutput;
  createObjectUrl?: (blob: Blob) => string;
};

export async function runPhotoPipeline(
  input: PipelineInput,
  dependencies: PipelineDependencies,
): Promise<PreparedOutput[]> {
  const decode = dependencies.decode ?? decodeNormalizedImage;
  const preview = dependencies.preview ?? createVisionPreview;
  const rotate = dependencies.rotate ?? rotateCanvas;
  const render = dependencies.render ?? renderOutput;
  const createObjectUrl = dependencies.createObjectUrl ?? URL.createObjectURL;
  const update = input.onUpdate;
  const assertActive = () => {
    if (input.signal.aborted) throw new DOMException("Операция отменена", "AbortError");
  };

  update({ status: "decoding", progress: 8, text: "Чтение ориентации и подготовка" });
  const analysisSource = await decode(input.file);
  const sourceWidth = analysisSource.width;
  const sourceHeight = analysisSource.height;
  let imageDataUrl: string;
  try {
    imageDataUrl = await preview(analysisSource);
  } finally {
    releaseCanvas(analysisSource);
  }
  assertActive();

  update({ status: "analyzing", progress: 24, text: "DeepSeek анализирует композицию" });
  const rawAnalysis = await dependencies.analyze({
    apiKey: input.apiKey,
    model: input.model,
    imageDataUrl,
    sourceWidth,
    sourceHeight,
    formats: input.formats,
    globalPrompt: input.globalPrompt,
    photoPrompt: input.photoPrompt,
    signal: input.signal,
  });
  assertActive();

  update({ status: "validating", progress: 48, text: "Проверка инструкций" });
  const validation = validateAnalysis(rawAnalysis, input.formats, sourceWidth, sourceHeight);
  if (!validation.success) throw new Error(validation.errors.join(" "));

  const source = await decode(input.file);
  const renderSource = rotate(source, validation.data.sourceRotation);
  const outputs: PreparedOutput[] = [];
  const usedNames = new Set<string>();
  try {
    for (let index = 0; index < input.formats.length; index += 1) {
      assertActive();
      const format = input.formats[index];
      const instruction = validation.data.outputs.find((output) => output.formatId === format.id)!;
      const baseProgress = 52 + (index / input.formats.length) * 42;
      update({
        status: "rendering",
        progress: baseProgress,
        text: `Рендеринг: ${format.name}`,
      });
      const encoded = await render(renderSource, format, instruction.crop, instruction.adjustments);
      update({
        status: "compressing",
        progress: baseProgress + 4,
        text: `Проверка объёма: ${format.name}`,
      });
      const warnings = [...instruction.warnings];
      if (validation.data.sourceRotation !== 0) {
        warnings.push(
          `Исходник автоматически повёрнут на ${validation.data.sourceRotation}° по часовой стрелке.`,
        );
      }
      if (!encoded.limitMet) {
        warnings.push(
          format.mimeType === "image/png"
            ? "Lossless PNG не укладывается в лимит. Параметр quality для PNG намеренно не используется."
            : "Даже JPEG с минимальным качеством 45% не укладывается в лимит.",
        );
      }
      const filename = dedupeFilename(
        applyFilenameTemplate(format.filenameTemplate, input.file.name, format),
        usedNames,
      );
      outputs.push({
        format,
        filename,
        blob: encoded.blob,
        objectUrl: createObjectUrl(encoded.blob),
        crop: instruction.crop,
        adjustments: instruction.adjustments,
        warnings,
        limitMet: encoded.limitMet,
        actualWidth: format.width,
        actualHeight: format.height,
      });
    }
  } catch (error) {
    outputs.forEach((output) => URL.revokeObjectURL(output.objectUrl));
    throw error;
  } finally {
    if (renderSource !== source) releaseCanvas(renderSource);
    releaseCanvas(source);
  }
  update({ status: "done", progress: 100, text: "Готово" });
  return outputs;
}

export async function mapConcurrent<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const current = items[nextIndex];
      nextIndex += 1;
      await worker(current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
}
