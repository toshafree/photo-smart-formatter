import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import nodemailer from "nodemailer";

const REGION = "ru-central1";
const STORAGE_ENDPOINT = "https://storage.yandexcloud.net";
const UPLOAD_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 30 * 60;
const DEFAULT_DOWNLOAD_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_MAX_ARCHIVE_BYTES = 150 * 1024 * 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class PublicError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function integerEnv(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${name}`);
  return value;
}

function credentials() {
  return {
    accessKeyId: env("AWS_ACCESS_KEY_ID"),
    secretAccessKey: env("AWS_SECRET_ACCESS_KEY"),
  };
}

function s3Client() {
  return new S3Client({
    region: REGION,
    endpoint: STORAGE_ENDPOINT,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: credentials(),
  });
}

function smtpTransport() {
  const port = integerEnv("SMTP_PORT", 465);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST?.trim() || "smtp.yandex.ru",
    port,
    secure: port === 465,
    auth: {
      user: env("SMTP_USER"),
      pass: env("SMTP_PASSWORD"),
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

function getHeader(event, wanted) {
  const headers = event?.headers ?? {};
  const key = Object.keys(headers).find((name) => name.toLowerCase() === wanted.toLowerCase());
  return key ? String(headers[key]) : "";
}

function allowedOrigin(event) {
  const origin = getHeader(event, "origin");
  const allowed = new Set(
    env("ALLOWED_ORIGINS")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  return allowed.has(origin) ? origin : "";
}

function response(statusCode, body, origin = "") {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "3600";
  }
  return { statusCode, headers, isBase64Encoded: false, body: JSON.stringify(body) };
}

function parseBody(event) {
  if (event?.body && typeof event.body === "object") return event.body;
  if (typeof event?.body !== "string") throw new PublicError(400, "Пустой запрос.");
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    return JSON.parse(raw);
  } catch {
    throw new PublicError(400, "Некорректный JSON.");
  }
}

function clientIp(event) {
  return getHeader(event, "x-forwarded-for").split(",")[0]?.trim() ?? "";
}

async function verifyCaptcha(token, ip) {
  if (typeof token !== "string" || !token) {
    throw new PublicError(400, "Подтвердите, что вы не робот.");
  }
  const form = new URLSearchParams({
    secret: env("SMARTCAPTCHA_SERVER_KEY"),
    token,
  });
  if (ip) form.set("ip", ip);
  const result = await fetch("https://smartcaptcha.cloud.yandex.ru/validate", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!result.ok) throw new PublicError(503, "Не удалось проверить SmartCaptcha.");
  const data = await result.json();
  if (data.status !== "ok") throw new PublicError(403, "Проверка SmartCaptcha не пройдена.");
}

function validateEmail(value) {
  if (typeof value !== "string") throw new PublicError(400, "Укажите email получателя.");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new PublicError(400, "Проверьте адрес электронной почты.");
  }
  return email;
}

function validateSize(value) {
  const size = Number(value);
  const max = integerEnv("MAX_ARCHIVE_BYTES", DEFAULT_MAX_ARCHIVE_BYTES);
  if (!Number.isSafeInteger(size) || size <= 0 || size > max) {
    throw new PublicError(
      400,
      `Размер ZIP должен быть не больше ${Math.floor(max / 1024 / 1024)} МБ.`,
    );
  }
  return size;
}

function createSession(data) {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const signature = createHmac("sha256", env("SESSION_SECRET")).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readSession(session) {
  if (typeof session !== "string") throw new PublicError(400, "Некорректная сессия отправки.");
  const [payload, signature, extra] = session.split(".");
  if (!payload || !signature || extra) throw new PublicError(400, "Некорректная сессия отправки.");
  const expected = createHmac("sha256", env("SESSION_SECRET")).update(payload).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new PublicError(403, "Сессия отправки недействительна.");
  }
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new PublicError(400, "Некорректная сессия отправки.");
  }
  if (
    data?.v !== 1 ||
    typeof data.id !== "string" ||
    typeof data.email !== "string" ||
    typeof data.key !== "string" ||
    !Number.isSafeInteger(data.size) ||
    !Number.isSafeInteger(data.exp)
  ) {
    throw new PublicError(400, "Некорректная сессия отправки.");
  }
  if (Date.now() > data.exp) throw new PublicError(410, "Время отправки истекло. Начните заново.");
  return data;
}

function htmlEscape(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

async function prepareUpload(body, event) {
  const email = validateEmail(body.email);
  const size = validateSize(body.size);
  await verifyCaptcha(body.captchaToken, clientIp(event));

  const id = randomUUID();
  const date = new Date().toISOString().slice(0, 10);
  const key = `archives/${date}/${id}.zip`;
  const bucket = env("BUCKET_NAME");
  const client = s3Client();
  const uploadHeaders = {
    "Content-Type": "application/zip",
    "If-None-Match": "*",
  };
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: uploadHeaders["Content-Type"],
      IfNoneMatch: uploadHeaders["If-None-Match"],
    }),
    { expiresIn: UPLOAD_TTL_SECONDS },
  );
  const session = createSession({
    v: 1,
    id,
    email,
    key,
    size,
    exp: Date.now() + SESSION_TTL_SECONDS * 1000,
  });
  return { uploadUrl, uploadHeaders, session };
}

function isAlreadyLocked(error) {
  const status = error?.$metadata?.httpStatusCode;
  return status === 409 || status === 412;
}

async function sendLink(body) {
  const session = readSession(body.session);
  const bucket = env("BUCKET_NAME");
  const client = s3Client();
  let metadata;
  try {
    metadata = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: session.key }));
  } catch {
    throw new PublicError(409, "ZIP ещё не загружен. Повторите попытку.");
  }
  if (metadata.ContentLength !== session.size) {
    throw new PublicError(400, "Размер загруженного ZIP не совпал с ожидаемым.");
  }

  const lockKey = `locks/${session.id}`;
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: lockKey,
        Body: "sent",
        ContentType: "text/plain",
        IfNoneMatch: "*",
      }),
    );
  } catch (error) {
    if (isAlreadyLocked(error)) {
      throw new PublicError(409, "Письмо для этого архива уже было отправлено.");
    }
    throw error;
  }

  const downloadTtl = Math.min(
    integerEnv("DOWNLOAD_TTL_SECONDS", DEFAULT_DOWNLOAD_TTL_SECONDS),
    30 * 24 * 60 * 60,
  );
  const downloadUrl = await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: session.key,
      ResponseContentDisposition: 'attachment; filename="prepared-photos.zip"',
    }),
    { expiresIn: downloadTtl },
  );

  try {
    await smtpTransport().sendMail({
      from: {
        name: process.env.EMAIL_SENDER_NAME?.trim() || "Фотоформат",
        address: env("SMTP_USER"),
      },
      to: session.email,
      subject: "Готовые изображения — ZIP-архив",
      text: `Ваш ZIP-архив готов: ${downloadUrl}\n\nСсылка действует 24 часа.`,
      html: `<p>Ваш ZIP-архив с готовыми изображениями сформирован.</p><p><a href="${htmlEscape(downloadUrl)}">Скачать ZIP-архив</a></p><p>Ссылка действует 24 часа.</p>`,
    });
  } catch (error) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: lockKey }));
    } catch {
      // The original SMTP error is more useful; lifecycle cleanup removes the stale lock.
    }
    throw error;
  }

  return { ok: true, expiresAt: new Date(Date.now() + downloadTtl * 1000).toISOString() };
}

export async function handler(event) {
  let origin = "";
  try {
    origin = allowedOrigin(event);
    const method = String(event?.httpMethod ?? "").toUpperCase();
    if (method === "OPTIONS") {
      return origin
        ? response(204, {}, origin)
        : response(403, { message: "Этот источник не разрешён." });
    }
    if (!origin) return response(403, { message: "Этот источник не разрешён." });
    if (method !== "POST") return response(405, { message: "Метод не поддерживается." }, origin);

    const body = parseBody(event);
    if (body.action === "prepare") {
      return response(200, await prepareUpload(body, event), origin);
    }
    if (body.action === "send") {
      return response(200, await sendLink(body), origin);
    }
    throw new PublicError(400, "Неизвестное действие.");
  } catch (error) {
    const statusCode = error instanceof PublicError ? error.statusCode : 500;
    const message =
      error instanceof PublicError
        ? error.message
        : "Сервис отправки временно недоступен. Повторите попытку.";
    console.error("Email function request failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      statusCode,
    });
    return response(statusCode, { message }, origin);
  }
}
