import { useEffect, useRef } from "react";

type WidgetId = number | string;

type SmartCaptchaApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      hl: "ru";
      callback: (token: string) => void;
      shieldPosition: "bottom-left";
    },
  ) => WidgetId;
  destroy: (widgetId: WidgetId) => void;
  subscribe?: (
    widgetId: WidgetId,
    event: "network-error" | "javascript-error" | "token-expired",
    callback: () => void,
  ) => () => void;
};

declare global {
  interface Window {
    smartCaptcha?: SmartCaptchaApi;
  }
}

let scriptPromise: Promise<void> | undefined;

function loadSmartCaptcha() {
  if (window.smartCaptcha) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-smartcaptcha]");
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.src = "https://smartcaptcha.cloud.yandex.ru/captcha.js?render=onload";
      script.async = true;
      script.defer = true;
      script.dataset.smartcaptcha = "true";
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("SmartCaptcha не загрузилась.")), {
      once: true,
    });
  }).catch((error: unknown) => {
    scriptPromise = undefined;
    throw error;
  });
  return scriptPromise;
}

type SmartCaptchaProps = {
  siteKey: string;
  onToken: (token: string) => void;
  onError: (message: string) => void;
};

export function SmartCaptcha({ siteKey, onToken, onError }: SmartCaptchaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  const onErrorRef = useRef(onError);

  onTokenRef.current = onToken;
  onErrorRef.current = onError;

  useEffect(() => {
    let disposed = false;
    let widgetId: WidgetId | undefined;
    const unsubscribers: Array<() => void> = [];

    void loadSmartCaptcha()
      .then(() => {
        if (disposed || !containerRef.current || !window.smartCaptcha) return;
        widgetId = window.smartCaptcha.render(containerRef.current, {
          sitekey: siteKey,
          hl: "ru",
          callback: (token) => onTokenRef.current(token),
          shieldPosition: "bottom-left",
        });
        const subscribe = window.smartCaptcha.subscribe;
        if (subscribe) {
          unsubscribers.push(
            subscribe(widgetId, "network-error", () =>
              onErrorRef.current("SmartCaptcha не смогла подключиться к сети."),
            ),
            subscribe(widgetId, "javascript-error", () =>
              onErrorRef.current("SmartCaptcha не смогла запуститься."),
            ),
            subscribe(widgetId, "token-expired", () => onTokenRef.current("")),
          );
        }
      })
      .catch((error: unknown) =>
        onErrorRef.current(error instanceof Error ? error.message : "SmartCaptcha не загрузилась."),
      );

    return () => {
      disposed = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      if (widgetId !== undefined) window.smartCaptcha?.destroy(widgetId);
    };
  }, [siteKey]);

  return <div className="smart-captcha-host" ref={containerRef} />;
}
