import { z } from "zod";
import { outputFormatSchema } from "./format";
import type { OutputFormat } from "../types";

export const FORMAT_STORAGE_KEY = "photo-smart-formatter:custom-formats:v1";
const catalogSchema = z.array(outputFormatSchema);

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function loadCustomFormats(storage: StorageLike): OutputFormat[] {
  try {
    const raw = storage.getItem(FORMAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = catalogSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    return parsed.data.filter((format) => !format.builtIn);
  } catch {
    return [];
  }
}

export function saveCustomFormats(storage: StorageLike, formats: OutputFormat[]) {
  const safe = catalogSchema.parse(formats.map((format) => ({ ...format, builtIn: false })));
  storage.setItem(FORMAT_STORAGE_KEY, JSON.stringify(safe));
}

export function resetCustomFormats(storage: StorageLike) {
  storage.removeItem(FORMAT_STORAGE_KEY);
}

export function exportCatalog(formats: OutputFormat[]): string {
  return JSON.stringify(formats, null, 2);
}

export function importCatalog(raw: string): OutputFormat[] {
  const result = catalogSchema.safeParse(JSON.parse(raw));
  if (!result.success) throw new Error("Файл не похож на корректный каталог форматов.");
  const ids = new Set<string>();
  return result.data.map((format) => {
    let id = format.id;
    while (ids.has(id)) id = `${id}-copy`;
    ids.add(id);
    return { ...format, id, builtIn: false };
  });
}
