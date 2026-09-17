import { describe, expect, it, vi } from "vitest";
import { createMockAnalysis } from "../src/lib/deepseek";
import { runPhotoPipeline } from "../src/lib/pipeline";
import type { OutputFormat } from "../src/types";

const formats: OutputFormat[] = [
  {
    id: "square",
    group: "Тест",
    name: "Квадрат",
    width: 100,
    height: 100,
    mimeType: "image/jpeg",
    extension: "jpg",
    maxBytes: 1000,
    filenameTemplate: "{sourceBase}__{formatSlug}.{ext}",
    builtIn: false,
  },
  {
    id: "wide",
    group: "Тест",
    name: "Широкий",
    width: 160,
    height: 90,
    mimeType: "image/jpeg",
    extension: "jpg",
    maxBytes: 1000,
    filenameTemplate: "{sourceBase}__{formatSlug}.{ext}",
    builtIn: false,
  },
];

describe("photo pipeline", () => {
  it("analyzes once for all formats and renders every output", async () => {
    const analyze = vi.fn(
      async (input: { formats: OutputFormat[]; sourceWidth: number; sourceHeight: number }) =>
        createMockAnalysis(input.formats, input.sourceWidth, input.sourceHeight),
    );
    const render = vi.fn(async (_source, format: OutputFormat) => ({
      blob: new Blob([new Uint8Array(500)], { type: format.mimeType }),
      quality: 0.9,
      limitMet: true,
    }));
    const updates: string[] = [];
    const outputs = await runPhotoPipeline(
      {
        file: { name: "source.jpg" } as File,
        formats,
        apiKey: "memory-only",
        model: "deepseek-flash",
        globalPrompt: "",
        photoPrompt: "",
        signal: new AbortController().signal,
        onUpdate: (update) => updates.push(update.status),
      },
      {
        analyze: analyze as never,
        decode: async () => ({ width: 400, height: 300 }) as HTMLCanvasElement,
        preview: async () => "data:image/jpeg;base64,abc",
        render: render as never,
        createObjectUrl: (blob) => `blob:test-${blob.size}`,
      },
    );

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0][0].formats).toHaveLength(2);
    expect(render).toHaveBeenCalledTimes(2);
    expect(outputs).toHaveLength(2);
    expect(updates).toContain("validating");
    expect(updates.at(-1)).toBe("done");
  });

  it("rotates the source before rendering crops when the model requests it", async () => {
    const renderedSizes: Array<[number, number]> = [];
    const analyze = vi.fn(
      async (input: { formats: OutputFormat[]; sourceWidth: number; sourceHeight: number }) => {
        const analysis = createMockAnalysis(input.formats, input.sourceHeight, input.sourceWidth);
        analysis.sourceRotation = 90;
        return analysis;
      },
    );
    const rotate = vi.fn((_source: HTMLCanvasElement, rotation: number) => {
      expect(rotation).toBe(90);
      return { width: 300, height: 400 } as HTMLCanvasElement;
    });
    const render = vi.fn(async (source: HTMLCanvasElement, format: OutputFormat) => {
      renderedSizes.push([source.width, source.height]);
      return {
        blob: new Blob([new Uint8Array(500)], { type: format.mimeType }),
        quality: 0.9,
        limitMet: true,
      };
    });

    const outputs = await runPhotoPipeline(
      {
        file: { name: "sideways.jpg" } as File,
        formats,
        apiKey: "memory-only",
        model: "deepseek-flash",
        globalPrompt: "",
        photoPrompt: "",
        signal: new AbortController().signal,
        onUpdate: () => undefined,
      },
      {
        analyze: analyze as never,
        decode: async () => ({ width: 400, height: 300 }) as HTMLCanvasElement,
        preview: async () => "data:image/jpeg;base64,abc",
        rotate: rotate as never,
        render: render as never,
        createObjectUrl: (blob) => `blob:test-${blob.size}`,
      },
    );

    expect(rotate).toHaveBeenCalledTimes(1);
    expect(renderedSizes).toEqual([
      [300, 400],
      [300, 400],
    ]);
    expect(outputs[0].warnings.join(" ")).toContain("повёрнут на 90°");
  });
});
