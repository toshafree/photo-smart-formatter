import { slugify } from "./format";
import type { OutputFormat } from "../types";

// Control characters are intentionally included because filenames must be portable.
// eslint-disable-next-line no-control-regex
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function sanitizeFilename(value: string): string {
  let clean = value
    .replace(INVALID_FILENAME_CHARS, "-")
    .replace(/\s+/g, " ")
    .replace(/\.{2,}/g, ".")
    .replace(/[ .]+$/g, "")
    .trim();

  if (!clean) clean = "file";
  if (WINDOWS_RESERVED.test(clean)) clean = `_${clean}`;
  return clean.slice(0, 180);
}

export function sourceBase(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return sanitizeFilename(lastDot > 0 ? filename.slice(0, lastDot) : filename);
}

export function applyFilenameTemplate(template: string, sourceName: string, format: OutputFormat) {
  const values: Record<string, string> = {
    sourceBase: sourceBase(sourceName),
    formatName: format.name,
    formatSlug: slugify(format.name) || format.id,
    width: String(format.width),
    height: String(format.height),
    ext: format.extension,
  };

  const rendered = template.replace(
    /\{(sourceBase|formatName|formatSlug|width|height|ext)\}/g,
    (_, key: string) => values[key] ?? "",
  );
  const safe = sanitizeFilename(rendered);
  const expectedExtension = `.${format.extension}`;
  return safe.toLocaleLowerCase().endsWith(expectedExtension)
    ? safe
    : `${safe}${expectedExtension}`;
}

export function dedupeFilename(filename: string, usedNames: Set<string>): string {
  if (!usedNames.has(filename.toLocaleLowerCase())) {
    usedNames.add(filename.toLocaleLowerCase());
    return filename;
  }

  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : "";
  let index = 2;
  let candidate = `${base}-${index}${extension}`;
  while (usedNames.has(candidate.toLocaleLowerCase())) {
    index += 1;
    candidate = `${base}-${index}${extension}`;
  }
  usedNames.add(candidate.toLocaleLowerCase());
  return candidate;
}
