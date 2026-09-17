import { describe, expect, it } from "vitest";
import { applyFilenameTemplate, dedupeFilename, sanitizeFilename } from "../src/lib/filename";
import type { OutputFormat } from "../src/types";

const format: OutputFormat = {
  id: "poster",
  group: "Сайт",
  name: "Большой постер",
  width: 500,
  height: 700,
  mimeType: "image/jpeg",
  extension: "jpg",
  maxBytes: 500_000,
  filenameTemplate: "{sourceBase}__{formatSlug}_{width}x{height}.{ext}",
  builtIn: false,
};

describe("filenames", () => {
  it("substitutes supported placeholders", () => {
    expect(applyFilenameTemplate(format.filenameTemplate, "Фото 01.png", format)).toBe(
      "Фото 01__большои-постер_500x700.jpg",
    );
  });

  it("removes filesystem-forbidden characters", () => {
    expect(sanitizeFilename('bad<name>:"/\\|?*.jpg')).toBe("bad-name--------.jpg");
    expect(sanitizeFilename("CON")).toBe("_CON");
  });

  it("adds deterministic collision suffixes", () => {
    const used = new Set<string>();
    expect(dedupeFilename("image.jpg", used)).toBe("image.jpg");
    expect(dedupeFilename("image.jpg", used)).toBe("image-2.jpg");
    expect(dedupeFilename("image.jpg", used)).toBe("image-3.jpg");
  });
});
