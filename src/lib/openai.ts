import { ANALYSIS_JSON_SCHEMA, validateAnalysis } from "./analysis";
import { HttpError, withRetry } from "./retry";
import { SYSTEM_PROMPT } from "../config/system-prompt";
import type { AnalysisResult, ModelId, OutputFormat } from "../types";

const RESPONSES_URL = "https://api.openai.com/v1/responses";

type AnalyzeInput = {
  apiKey: string;
  model: ModelId;
  imageDataUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  formats: OutputFormat[];
  globalPrompt: string;
  photoPrompt: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
};

type ResponsePayload = {
  id?: string;
  status?: string;
  error?: { code?: string; message?: string } | null;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
};

class NonRepairableAnalysisError extends Error {}

function requestText(input: AnalyzeInput, repairErrors?: string[]) {
  const formatList = input.formats.map((format) => ({
    formatId: format.id,
    width: format.width,
    height: format.height,
    prompt: format.prompt || "",
  }));

  return [
    `Ориентированный исходник: ${input.sourceWidth} × ${input.sourceHeight} px.`,
    `Целевые форматы: ${JSON.stringify(formatList)}.`,
    input.globalPrompt
      ? `Общее уточнение пользователя: ${input.globalPrompt}`
      : "Общего уточнения нет.",
    input.photoPrompt
      ? `Уточнение для этой фотографии: ${input.photoPrompt}`
      : "Уточнения для фото нет.",
    repairErrors?.length
      ? `Предыдущий ответ не прошёл проверку. Исправь все ошибки и верни полный объект для тех же formatId: ${repairErrors.join(" | ")}`
      : "Верни полный план обработки для каждого переданного formatId.",
  ].join("\n");
}

function safeApiError(status: number, code?: string): HttpError {
  if (status === 401)
    return new HttpError("API key отклонён OpenAI. Проверьте ключ.", status, code);
  if (status === 403)
    return new HttpError(
      "У проекта нет доступа к выбранной модели или Responses API.",
      status,
      code,
    );
  if (status === 404 || code === "model_not_found")
    return new HttpError("Выбранная модель недоступна. Выберите другой профиль.", status, code);
  if (status === 429)
    return new HttpError("Достигнут лимит запросов OpenAI. Повторите позже.", status, code);
  if (status >= 500)
    return new HttpError("Временная ошибка OpenAI. Повторите позже.", status, code);
  return new HttpError(
    "OpenAI не смог обработать запрос. Проверьте настройки и изображение.",
    status,
    code,
  );
}

function extractOutputText(payload: ResponsePayload): string {
  if (payload.error) {
    throw new NonRepairableAnalysisError("OpenAI вернул ошибку при формировании ответа.");
  }
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "refusal") {
        throw new NonRepairableAnalysisError("Модель отказалась анализировать это изображение.");
      }
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new Error("OpenAI вернул ответ без структурированных данных.");
}

async function callOpenAI(input: AnalyzeInput, repairErrors?: string[]) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await withRetry(
    () =>
      fetchImpl(RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: input.signal,
        body: JSON.stringify({
          model: input.model,
          store: false,
          instructions: SYSTEM_PROMPT,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: requestText(input, repairErrors) },
                { type: "input_image", image_url: input.imageDataUrl, detail: "high" },
              ],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "photo_processing_plan",
              strict: true,
              schema: ANALYSIS_JSON_SCHEMA,
            },
          },
          max_output_tokens: 12_000,
        }),
      }).then(async (result) => {
        if (!result.ok) {
          let code: string | undefined;
          try {
            const body = (await result.json()) as { error?: { code?: string } };
            code = body.error?.code;
          } catch {
            // Keep errors free from response bodies that may include sensitive input.
          }
          throw safeApiError(result.status, code);
        }
        return result;
      }),
    { signal: input.signal },
  );

  const payload = (await response.json()) as ResponsePayload;
  const text = extractOutputText(payload);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Модель вернула невалидный JSON.");
  }
}

export async function analyzePhoto(input: AnalyzeInput): Promise<AnalysisResult> {
  let candidate: unknown;
  let errors: string[];

  try {
    candidate = await callOpenAI(input);
    const first = validateAnalysis(candidate, input.formats, input.sourceWidth, input.sourceHeight);
    if (first.success) return first.data;
    errors = first.errors;
  } catch (error) {
    if (
      error instanceof HttpError ||
      error instanceof TypeError ||
      error instanceof NonRepairableAnalysisError ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw error;
    }
    errors = [error instanceof Error ? error.message : "Неизвестная ошибка ответа."];
  }

  candidate = await callOpenAI(input, errors);
  const repaired = validateAnalysis(
    candidate,
    input.formats,
    input.sourceWidth,
    input.sourceHeight,
  );
  if (repaired.success) return repaired.data;
  throw new Error(
    `Инструкция модели не прошла проверку после повтора: ${repaired.errors.join(" ")}`,
  );
}

export function createMockAnalysis(
  formats: OutputFormat[],
  sourceWidth: number,
  sourceHeight: number,
): AnalysisResult {
  const outputs = formats.map((format) => {
    const targetNormalized = (format.width / format.height) * (sourceHeight / sourceWidth);
    const width = Math.min(1, targetNormalized);
    const height = targetNormalized <= 1 ? 1 : 1 / targetNormalized;
    return {
      formatId: format.id,
      crop: { x: (1 - width) / 2, y: (1 - height) / 2, width, height },
      adjustments: {
        exposure: 0,
        contrast: 0.04,
        saturation: 0.03,
        temperature: 0,
        highlights: -0.03,
        shadows: 0.03,
        sharpen: 0.15,
      },
      warnings: [] as string[],
      rationale: "Центральное кадрирование для тестового режима.",
    };
  });
  return { sourceSummary: "Тестовое изображение", subjects: [], outputs };
}
