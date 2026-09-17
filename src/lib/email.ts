export type EmailStage = "preparing" | "uploading" | "sending";

type EmailZipInput = {
  apiUrl: string;
  email: string;
  captchaToken: string;
  zip: Blob;
  filename?: string;
  signal?: AbortSignal;
  onStage?: (stage: EmailStage) => void;
};

type PrepareResponse = {
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  session: string;
};

type SendResponse = {
  ok: true;
  expiresAt: string;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function postJson<T>(
  apiUrl: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(
      typeof data.message === "string"
        ? data.message
        : "Сервис отправки временно недоступен. Повторите попытку.",
    );
  }
  return data as T;
}

export async function emailResultsZip({
  apiUrl,
  email,
  captchaToken,
  zip,
  filename = "prepared-photos.zip",
  signal,
  onStage,
}: EmailZipInput): Promise<SendResponse> {
  onStage?.("preparing");
  const prepared = await postJson<PrepareResponse>(
    apiUrl,
    {
      action: "prepare",
      email,
      filename,
      size: zip.size,
      captchaToken,
    },
    signal,
  );

  onStage?.("uploading");
  const upload = await fetch(prepared.uploadUrl, {
    method: "PUT",
    headers: prepared.uploadHeaders,
    body: zip,
    signal,
  });
  if (!upload.ok) {
    throw new Error("Не удалось загрузить ZIP. Проверьте сеть и повторите попытку.");
  }

  onStage?.("sending");
  return postJson<SendResponse>(
    apiUrl,
    {
      action: "send",
      session: prepared.session,
    },
    signal,
  );
}
