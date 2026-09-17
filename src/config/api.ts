export const DIRECT_OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const configuredProxyUrl = import.meta.env.VITE_OPENAI_PROXY_URL?.trim() ?? "";

export const OPENAI_PROXY_CONFIGURED = configuredProxyUrl.length > 0;

export function resolveOpenAIResponsesUrl(proxyUrl = configuredProxyUrl) {
  if (!proxyUrl.trim()) return DIRECT_OPENAI_RESPONSES_URL;

  let url: URL;
  try {
    url = new URL(proxyUrl.trim());
  } catch {
    throw new Error("URL OpenAI proxy настроен неверно.");
  }

  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
    throw new Error("OpenAI proxy должен использовать HTTPS.");
  }

  url.hash = "";
  return url.toString();
}
