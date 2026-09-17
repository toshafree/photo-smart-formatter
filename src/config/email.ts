export const EMAIL_API_URL = (import.meta.env.VITE_EMAIL_API_URL ?? "").trim();
export const SMARTCAPTCHA_SITE_KEY = (import.meta.env.VITE_SMARTCAPTCHA_SITE_KEY ?? "").trim();

export const EMAIL_DELIVERY_ENABLED = Boolean(EMAIL_API_URL && SMARTCAPTCHA_SITE_KEY);
