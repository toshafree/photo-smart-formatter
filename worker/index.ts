const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_REQUEST_BYTES = 12 * 1024 * 1024;

export type WorkerEnv = {
  ALLOWED_ORIGINS?: string;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function allowedOrigins(env: WorkerEnv) {
  return new Set(
    (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Expose-Headers": "X-Request-ID",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function jsonResponse(status: number, message: string, origin?: string) {
  return Response.json(
    { error: { message } },
    {
      status,
      headers: {
        ...(origin ? corsHeaders(origin) : { "Cache-Control": "no-store" }),
        "Content-Type": "application/json",
      },
    },
  );
}

export function createProxyHandler(fetchImpl: FetchLike = fetch) {
  return async function handleRequest(request: Request, env: WorkerEnv): Promise<Response> {
    const origin = request.headers.get("Origin") ?? "";
    const origins = allowedOrigins(env);

    if (!origins.size) {
      return jsonResponse(500, "Proxy origin allowlist is not configured.");
    }
    if (!origin || !origins.has(origin)) {
      return jsonResponse(403, "Origin is not allowed.");
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/responses") {
      return jsonResponse(404, "Not found.", origin);
    }

    const authorization = request.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ") || authorization.length < 16) {
      return jsonResponse(401, "OpenAI API key is missing.", origin);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return jsonResponse(415, "Content-Type must be application/json.", origin);
    }

    const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      return jsonResponse(413, "Request is too large.", origin);
    }

    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_REQUEST_BYTES) {
      return jsonResponse(413, "Request is too large.", origin);
    }

    let upstream: Response;
    try {
      upstream = await fetchImpl(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body,
      });
    } catch {
      return jsonResponse(502, "OpenAI API is temporarily unreachable.", origin);
    }

    const headers = new Headers(corsHeaders(origin));
    headers.set("Content-Type", upstream.headers.get("Content-Type") ?? "application/json");
    const requestId = upstream.headers.get("X-Request-ID");
    if (requestId) headers.set("X-Request-ID", requestId);

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  };
}

const handleRequest = createProxyHandler();

export default {
  fetch(request: Request, env: WorkerEnv) {
    return handleRequest(request, env);
  },
};
