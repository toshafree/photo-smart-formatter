import { z } from "zod";
import type { OutputFormat } from "../types";

export const MAX_DIMENSION = 10_000;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export const outputFormatSchema = z
  .object({
    id: z.string().min(1).max(100),
    group: z.string().trim().min(1, "Укажите площадку").max(100),
    name: z.string().trim().min(1, "Укажите название").max(120),
    width: z.number().int().positive().max(MAX_DIMENSION),
    height: z.number().int().positive().max(MAX_DIMENSION),
    mimeType: z.enum(["image/jpeg", "image/png"]),
    extension: z.enum(["jpg", "png"]),
    maxBytes: z.number().int().positive().max(MAX_FILE_BYTES),
    prompt: z.string().max(1000).optional(),
    filenameTemplate: z.string().trim().min(1).max(250),
    builtIn: z.boolean(),
  })
  .strict()
  .superRefine((format, context) => {
    const expected = format.mimeType === "image/jpeg" ? "jpg" : "png";
    if (format.extension !== expected) {
      context.addIssue({
        code: "custom",
        path: ["extension"],
        message: `Расширение должно быть .${expected}`,
      });
    }
    if (!format.filenameTemplate.includes("{ext}")) {
      context.addIssue({
        code: "custom",
        path: ["filenameTemplate"],
        message: "Шаблон должен содержать {ext}",
      });
    }
  });

export function validateFormat(format: OutputFormat) {
  return outputFormatSchema.safeParse(format);
}

export function createFormatId(name: string): string {
  const slug = slugify(name) || "format";
  return `custom-${slug}-${crypto.randomUUID().slice(0, 8)}`;
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("ru")
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
