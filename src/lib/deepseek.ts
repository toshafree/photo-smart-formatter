import { ANALYSIS_JSON_SCHEMA, validateAnalysis } from "./analysis";
import { HttpError, withRetry } from "./retry";
import { SYSTEM_PROMPT } from "../config/system-prompt";
import { DEEPSEEK_RESPONSES_URL } from "../config/api";
import type { AnalysisResult, ModelId, OutputFormat } from "../types";

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
  incomplete_details?: { reason?: string } | null;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
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
    `Исходник после нормализации EXIF, но до визуальной проверки ориентации: ${input.sourceWidth} × ${input.sourceHeight} px.`,
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
    "Ответ должен быть одним JSON-объектом, точно соответствующим переданной JSON Schema, без Markdown, пояснений до или после JSON.",
  ].join("\n");
}

function safeApiError(status: number, code?: string): HttpError {
  if (status === 401)
    return new HttpError("API key отклонён DeepSeek. Проверьте ключ.", status, code);
  if (status === 402)
    return new HttpError("На балансе DeepSeek недостаточно средств.", status, code);
  if (status === 403) return new HttpError("DeepSeek отклонил доступ к API.", status, code);
  if (status === 404 || code === "model_not_found")
    return new HttpError("Модель deepseek-flash недоступна аккаунту.", status, code);
  if (status === 422) return new HttpError("DeepSeek отклонил параметры запроса.", status, code);
  if (status === 429)
    return new HttpError("Достигнут лимит запросов DeepSeek. Повторите позже.", status, code);
  if (status >= 500)
    return new HttpError("Временная ошибка DeepSeek. Повторите позже.", status, code);
  return new HttpError(
    "DeepSeek не смог обработать запрос. Проверьте настройки и изображение.",
    status,
    code,
  );
}

function extractOutputText(payload: ResponsePayload): string {
  if (payload.error) {
    throw new NonRepairableAnalysisError("DeepSeek вернул ошибку при формировании ответа.");
  }
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  if (payload.status === "incomplete") {
    const reason = payload.incomplete_details?.reason;
    throw new Error(
      reason === "max_output_tokens"
        ? "DeepSeek исчерпал лимит вывода до формирования JSON."
        : "DeepSeek вернул незавершённый ответ без JSON.",
    );
  }
  throw new Error("DeepSeek вернул пустой ответ без JSON. Повтори полный JSON-объект.");
}

async function callDeepSeek(input: AnalyzeInput, repairErrors?: string[]) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await withRetry(
    () =>
      fetchImpl(DEEPSEEK_RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: input.signal,
        body: JSON.stringify({
          model: input.model,
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
          reasoning: { effort: "none" },
          text: {
            format: {
              type: "json_schema",
              name: "photo_processing_plan",
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
    candidate = await callDeepSeek(input);
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

  candidate = await callDeepSeek(input, errors);
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
  return { sourceSummary: "Тестовое изображение", sourceRotation: 0, subjects: [], outputs };
}
