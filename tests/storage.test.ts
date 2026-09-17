import { describe, expect, it } from "vitest";
import {
  FORMAT_STORAGE_KEY,
  loadCustomFormats,
  resetCustomFormats,
  saveCustomFormats,
} from "../src/lib/storage";
import type { OutputFormat } from "../src/types";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

const custom: OutputFormat = {
  id: "custom",
  group: "Мои",
  name: "Квадрат",
  width: 500,
  height: 500,
  mimeType: "image/png",
  extension: "png",
  maxBytes: 900_000,
  filenameTemplate: "{sourceBase}.{ext}",
  builtIn: false,
};

describe("format persistence", () => {
  it("round-trips custom formats", () => {
    const storage = memoryStorage();
    saveCustomFormats(storage, [custom]);
    expect(loadCustomFormats(storage)).toEqual([custom]);
  });

  it("ignores corrupt data and resets", () => {
    const storage = memoryStorage();
    storage.setItem(FORMAT_STORAGE_KEY, "not json");
    expect(loadCustomFormats(storage)).toEqual([]);
    resetCustomFormats(storage);
    expect(storage.getItem(FORMAT_STORAGE_KEY)).toBeNull();
  });
});
