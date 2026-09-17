import { z } from "zod";
import {
  ASPECT_EPSILON,
  REPAIRABLE_ASPECT_ERROR,
  cropNeedsUpscale,
  normalizedCropAspect,
  relativeAspectError,
  repairCropAspect,
} from "./crop";
import type { AnalysisResult, OutputFormat } from "../types";

const boxSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
  })
  .strict();

const adjustmentsSchema = z
  .object({
    exposure: z.number().finite().min(-1).max(1),
    contrast: z.number().finite().min(-1).max(1),
    saturation: z.number().finite().min(-1).max(1),
    temperature: z.number().finite().min(-1).max(1),
    highlights: z.number().finite().min(-1).max(1),
    shadows: z.number().finite().min(-1).max(1),
    sharpen: z.number().finite().min(0).max(1),
  })
  .strict();

export const analysisResultSchema = z
  .object({
    sourceSummary: z.string().max(2000),
    subjects: z.array(
      z
        .object({
          kind: z.enum(["person", "face", "object", "text", "logo", "other"]),
          description: z.string().max(1000),
          importance: z.number().finite().min(0).max(1),
          box: boxSchema,
        })
        .strict(),
    ),
    outputs: z.array(
      z
        .object({
          formatId: z.string().min(1),
          crop: boxSchema,
          adjustments: adjustmentsSchema,
          warnings: z.array(z.string().max(1000)),
          rationale: z.string().max(2000),
        })
        .strict(),
    ),
  })
  .strict();

const boxJsonSchema = {
  type: "object",
  properties: {
    x: { type: "number", minimum: 0, maximum: 1 },
    y: { type: "number", minimum: 0, maximum: 1 },
    width: { type: "number", exclusiveMinimum: 0, maximum: 1 },
    height: { type: "number", exclusiveMinimum: 0, maximum: 1 },
  },
  required: ["x", "y", "width", "height"],
  additionalProperties: false,
} as const;

export const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  properties: {
    sourceSummary: { type: "string" },
    subjects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["person", "face", "object", "text", "logo", "other"] },
          description: { type: "string" },
          importance: { type: "number", minimum: 0, maximum: 1 },
          box: boxJsonSchema,
        },
        required: ["kind", "description", "importance", "box"],
        additionalProperties: false,
      },
    },
    outputs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          formatId: { type: "string" },
          crop: boxJsonSchema,
          adjustments: {
            type: "object",
            properties: {
              exposure: { type: "number", minimum: -1, maximum: 1 },
              contrast: { type: "number", minimum: -1, maximum: 1 },
              saturation: { type: "number", minimum: -1, maximum: 1 },
              temperature: { type: "number", minimum: -1, maximum: 1 },
              highlights: { type: "number", minimum: -1, maximum: 1 },
              shadows: { type: "number", minimum: -1, maximum: 1 },
              sharpen: { type: "number", minimum: 0, maximum: 1 },
            },
            required: [
              "exposure",
              "contrast",
              "saturation",
              "temperature",
              "highlights",
              "shadows",
              "sharpen",
            ],
            additionalProperties: false,
          },
          warnings: { type: "array", items: { type: "string" } },
          rationale: { type: "string" },
        },
        required: ["formatId", "crop", "adjustments", "warnings", "rationale"],
        additionalProperties: false,
      },
    },
  },
  required: ["sourceSummary", "subjects", "outputs"],
  additionalProperties: false,
} as const;

export type AnalysisValidation =
  { success: true; data: AnalysisResult; repairs: string[] } | { success: false; errors: string[] };

export function validateAnalysis(
  input: unknown,
  formats: OutputFormat[],
  sourceWidth: number,
  sourceHeight: number,
): AnalysisValidation {
  const parsed = analysisResultSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues
        .slice(0, 12)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    };
  }

  const data = structuredClone(parsed.data) as AnalysisResult;
  const errors: string[] = [];
  const repairs: string[] = [];
  const expectedIds = new Set(formats.map((format) => format.id));
  const seenIds = new Set<string>();

  for (const subject of data.subjects) {
    if (subject.box.x + subject.box.width > 1 + Number.EPSILON) {
      errors.push(`Область объекта «${subject.description}» выходит за правую границу.`);
    }
    if (subject.box.y + subject.box.height > 1 + Number.EPSILON) {
      errors.push(`Область объекта «${subject.description}» выходит за нижнюю границу.`);
    }
  }

  for (const output of data.outputs) {
    if (!expectedIds.has(output.formatId)) {
      errors.push(`Получен неизвестный formatId: ${output.formatId}.`);
      continue;
    }
    if (seenIds.has(output.formatId)) {
      errors.push(`Формат ${output.formatId} повторяется в ответе.`);
      continue;
    }
    seenIds.add(output.formatId);
    if (output.crop.x + output.crop.width > 1 + Number.EPSILON) {
      errors.push(`Crop ${output.formatId} выходит за правую границу.`);
      continue;
    }
    if (output.crop.y + output.crop.height > 1 + Number.EPSILON) {
      errors.push(`Crop ${output.formatId} выходит за нижнюю границу.`);
      continue;
    }

    const format = formats.find((candidate) => candidate.id === output.formatId)!;
    const targetAspect = format.width / format.height;
    const actualAspect = normalizedCropAspect(output.crop, sourceWidth, sourceHeight);
    const error = relativeAspectError(actualAspect, targetAspect);
    if (error > REPAIRABLE_ASPECT_ERROR) {
      errors.push(
        `Crop ${output.formatId}: aspect ratio отличается на ${(error * 100).toFixed(1)}%.`,
      );
      continue;
    }
    if (error > ASPECT_EPSILON / 10) {
      output.crop = repairCropAspect(output.crop, targetAspect, sourceWidth, sourceHeight);
      const repairMessage = `Aspect ratio crop для «${format.name}» аккуратно скорректирован локально.`;
      output.warnings = [...output.warnings, repairMessage];
      repairs.push(repairMessage);
    }
    if (cropNeedsUpscale(output.crop, sourceWidth, sourceHeight, format)) {
      output.warnings = [
        ...output.warnings,
        "Потребовалось увеличение разрешения; возможна потеря детализации.",
      ];
    }
  }

  for (const id of expectedIds) {
    if (!seenIds.has(id)) errors.push(`В ответе отсутствует формат ${id}.`);
  }
  if (data.outputs.length !== formats.length) {
    errors.push(`Ожидалось инструкций: ${formats.length}, получено: ${data.outputs.length}.`);
  }

  return errors.length ? { success: false, errors } : { success: true, data, repairs };
}
