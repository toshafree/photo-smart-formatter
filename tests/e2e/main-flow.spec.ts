import { expect, test } from "@playwright/test";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("uploads a photo and prepares a result without a real API call", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("OpenAI API key").fill("sk-test-only");
  await page.getByRole("button", { name: "+ Свой формат" }).click();
  await page.getByLabel("Название *").fill("Smoke квадрат");
  await page.getByLabel("Ширина, px *").fill("64");
  await page.getByLabel("Высота, px *").fill("64");
  await page.getByRole("button", { name: "Сохранить формат" }).click();

  await page.locator('input[type="file"][accept*="image/jpeg"]').setInputFiles({
    name: "smoke.png",
    mimeType: "image/png",
    buffer: onePixelPng,
  });
  await expect(page.getByText("smoke.png", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Подготовить изображения/ }).click();

  await expect(page.getByRole("heading", { name: "Smoke квадрат" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Скачать файл" })).toBeVisible();
  await expect(page.getByText("Лимит соблюдён")).toBeVisible();
});
