export type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  shouldRetry?: (error: unknown) => boolean;
  signal?: AbortSignal;
};

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function isTransientError(error: unknown): boolean {
  if (error instanceof HttpError) return error.status === 429 || error.status >= 500;
  return error instanceof TypeError;
}

export function abortableSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Операция отменена", "AbortError"));
      return;
    }
    const timer = window.setTimeout(resolve, delayMs);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Операция отменена", "AbortError"));
      },
      { once: true },
    );
  });
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}) {
  const {
    retries = 3,
    baseDelayMs = 500,
    maxDelayMs = 8_000,
    random = Math.random,
    sleep = abortableSleep,
    shouldRetry = isTransientError,
    signal,
  } = options;

  let attempt = 0;
  while (true) {
    if (signal?.aborted) throw new DOMException("Операция отменена", "AbortError");
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error;
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const jittered = Math.round(exponential * (0.75 + random() * 0.5));
      attempt += 1;
      await sleep(jittered, signal);
    }
  }
}
