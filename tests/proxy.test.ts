import { describe, expect, it, vi } from "vitest";
import { createProxyHandler } from "../worker/index";

const origin = "https://toshafree.github.io";
const env = { ALLOWED_ORIGINS: origin };

function proxyRequest(init: RequestInit = {}) {
  return new Request("https://proxy.example/v1/responses", {
    method: "POST",
    headers: {
      Origin: origin,
      Authorization: "Bearer sk-project-test-only",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "test", input: "hello" }),
    ...init,
  });
}

describe("Cloudflare OpenAI proxy", () => {
  it("answers an allowed CORS preflight without contacting OpenAI", async () => {
    const fetchMock = vi.fn();
    const handle = createProxyHandler(fetchMock);
    const response = await handle(
      new Request("https://proxy.example/v1/responses", {
        method: "OPTIONS",
        headers: { Origin: origin },
      }),
      env,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects browser requests from an unapproved origin", async () => {
    const fetchMock = vi.fn();
    const handle = createProxyHandler(fetchMock);
    const response = await handle(
      proxyRequest({ headers: { Origin: "https://evil.example" } }),
      env,
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards only the required request data and returns safe CORS headers", async () => {
    let forwardedInput: string | URL | Request | undefined;
    let forwardedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      forwardedInput = input;
      forwardedInit = init;
      return Response.json(
        { id: "response-1", output: [] },
        {
          headers: {
            "X-Request-ID": "req-test",
            "Set-Cookie": "private=1",
          },
        },
      );
    });
    const handle = createProxyHandler(fetchMock);
    const request = proxyRequest();
    const response = await handle(request, env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Request-ID")).toBe("req-test");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();

    expect(forwardedInput).toBe("https://api.openai.com/v1/responses");
    expect(forwardedInit?.method).toBe("POST");
    expect(new Headers(forwardedInit?.headers).get("Authorization")).toBe(
      "Bearer sk-project-test-only",
    );
    expect(JSON.parse(new TextDecoder().decode(forwardedInit?.body as ArrayBuffer))).toEqual({
      model: "test",
      input: "hello",
    });
  });
});
