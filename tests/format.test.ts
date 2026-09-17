import { describe, expect, it } from "vitest";
import { validateFormat } from "../src/lib/format";
import type { OutputFormat } from "../src/types";

const valid: OutputFormat = {
  id: "test",
  group: "Тест",
  name: "Карточка",
  width: 1200,
  height: 800,
  mimeType: "image/jpeg",
  extension: "jpg",
  maxBytes: 500 * 1024,
  filenameTemplate: "{sourceBase}.{ext}",
  builtIn: false,
};

describe("validateFormat", () => {
  it("accepts a complete format", () => {
    expect(validateFormat(valid).success).toBe(true);
  });

  it("rejects invalid dimensions and mismatched extension", () => {
    expect(validateFormat({ ...valid, width: 0 }).success).toBe(false);
    expect(validateFormat({ ...valid, extension: "png" }).success).toBe(false);
  });

  it("requires an extension placeholder", () => {
    expect(validateFormat({ ...valid, filenameTemplate: "{sourceBase}" }).success).toBe(false);
  });
});
