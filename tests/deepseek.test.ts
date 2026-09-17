import { describe, expect, it, vi } from "vitest";
import { DEEPSEEK_RESPONSES_URL } from "../src/config/api";
import { analyzePhoto, createMockAnalysis } from "../src/lib/deepseek";
import type { OutputFormat } from "../src/types";

const format: OutputFormat = {
  id: "wide",
  group: "Тест",
  name: "Wide",
  width: 1600,
  height: 900,
  mimeType: "image/jpeg",
  extension: "jpg",
  maxBytes: 500_000,
  filenameTemplate: "{sourceBase}.{ext}",
  builtIn: false,
};

function input(fetchImpl: typeof fetch) {
  return {
    apiKey: "sk-deepseek-test-only",
    model: "deepseek-flash" as const,
    imageDataUrl: "data:image/jpeg;base64,abc",
    sourceWidth: 4000,
    sourceHeight: 3000,
    formats: [format],
    globalPrompt: "",
    photoPrompt: "",
    signal: new AbortController().signal,
    fetchImpl,
  };
}

describe("DeepSeek vision client", () => {
  it("uses Flash vision and the documented Responses API structured output", async () => {
    const analysis = createMockAnalysis([format], 4000, 3000);
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void url;
      void init;
      return Response.json({
        id: "response-test",
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(analysis) }],
          },
        ],
      });
    });

    await expect(analyzePhoto(input(fetchMock as typeof fetch))).resolves.toEqual(analysis);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DEEPSEEK_RESPONSES_URL);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sk-deepseek-test-only");

    const body = JSON.parse(String(init?.body)) as {
      model: string;
      reasoning: { effort: string };
      input: Array<{ content: Array<Record<string, unknown>> }>;
      text: { format: Record<string, unknown> };
      store?: unknown;
    };
    expect(body.model).toBe("deepseek-flash");
    expect(body.reasoning).toEqual({ effort: "none" });
    expect(body.input[0].content[1]).toMatchObject({
      type: "input_image",
      image_url: "data:image/jpeg;base64,abc",
      detail: "high",
    });
    expect(body.text.format.type).toBe("json_schema");
    expect(body.text.format.schema).toBeDefined();
    expect(body.text.format.strict).toBeUndefined();
    expect(body.store).toBeUndefined();
  });

  it("shows an explicit insufficient-balance error", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void url;
      void init;
      return Response.json({ error: { code: "insufficient_balance" } }, { status: 402 });
    });

    await expect(analyzePhoto(input(fetchMock as typeof fetch))).rejects.toThrow(
      "На балансе DeepSeek недостаточно средств",
    );
  });

  it("retries an empty structured response once with explicit JSON guidance", async () => {
    const analysis = createMockAnalysis([format], 4000, 3000);
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        void url;
        void init;
        if (fetchMock.mock.calls.length === 1) {
          return Response.json({ id: "empty", status: "completed", output: [] });
        }
        return Response.json({
          id: "repaired",
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: JSON.stringify(analysis) }],
            },
          ],
        });
      },
    );

    await expect(analyzePhoto(input(fetchMock as typeof fetch))).resolves.toEqual(analysis);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
      input: Array<{ content: Array<{ type: string; text?: string }> }>;
    };
    expect(secondBody.input[0].content[0].text).toContain("пустой ответ без JSON");
  });
});
