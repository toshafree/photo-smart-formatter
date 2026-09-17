import { describe, expect, it, vi } from "vitest";
import { HttpError, withRetry } from "../src/lib/retry";

describe("retry policy", () => {
  it("retries temporary failures with exponential delays", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new HttpError("rate", 429))
      .mockRejectedValueOnce(new HttpError("server", 503))
      .mockResolvedValue("ok");
    const delays: number[] = [];
    const result = await withRetry(operation, {
      baseDelayMs: 100,
      random: () => 0.5,
      sleep: async (delay) => {
        delays.push(delay);
      },
    });
    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([100, 200]);
  });

  it("does not retry authentication errors", async () => {
    const operation = vi.fn().mockRejectedValue(new HttpError("auth", 401));
    await expect(withRetry(operation, { sleep: async () => undefined })).rejects.toThrow("auth");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
