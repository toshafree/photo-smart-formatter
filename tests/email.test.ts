import { afterEach, describe, expect, it, vi } from "vitest";
import { emailResultsZip, type EmailStage } from "../src/lib/email";

describe("emailResultsZip", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prepares an upload, uploads the ZIP and requests the email", async () => {
    const stages: EmailStage[] = [];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            uploadUrl: "https://storage.example/archive.zip?signature=test",
            uploadHeaders: {
              "Content-Type": "application/zip",
              "If-None-Match": "*",
            },
            session: "signed-session",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, expiresAt: "2026-09-18T12:00:00.000Z" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const zip = new Blob(["zip"], { type: "application/zip" });

    const result = await emailResultsZip({
      apiUrl: "https://functions.example/email",
      email: "user@example.ru",
      captchaToken: "captcha-token",
      zip,
      onStage: (stage) => stages.push(stage),
    });

    expect(stages).toEqual(["preparing", "uploading", "sending"]);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://storage.example/archive.zip?signature=test");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "PUT",
      headers: { "Content-Type": "application/zip", "If-None-Match": "*" },
      body: zip,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      action: "send",
      session: "signed-session",
    });
  });

  it("shows a public error returned by the function", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ message: "Проверка SmartCaptcha не пройдена." }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(
      emailResultsZip({
        apiUrl: "https://functions.example/email",
        email: "user@example.ru",
        captchaToken: "expired",
        zip: new Blob(["zip"]),
      }),
    ).rejects.toThrow("Проверка SmartCaptcha не пройдена.");
  });
});
