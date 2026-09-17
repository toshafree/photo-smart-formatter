import { expect, test } from "@playwright/test";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("uploads a photo and prepares a result without a real API call", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("OpenAI API key").fill("sk-test-only");
  await page.getByRole("button", { name: "+ Свой формат" }).click();
  await page.getByLabel("Название *").fill("Smoke вертикальный");
  await page.getByLabel("Ширина, px *").fill("64");
  await page.getByLabel("Высота, px *").fill("96");
  await page.getByRole("button", { name: "Сохранить формат" }).click();

  await page.locator('input[type="file"][accept*="image/jpeg"]').setInputFiles({
    name: "smoke.png",
    mimeType: "image/png",
    buffer: onePixelPng,
  });
  await expect(page.getByText("smoke.png", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Подготовить изображения/ }).click();

  await expect(page.getByRole("heading", { name: "Smoke вертикальный" })).toBeVisible({
    timeout: 30_000,
  });
  const preview = page.getByAltText("Smoke вертикальный, результат");
  await expect(preview).toBeVisible();
  expect(await preview.evaluate((image) => getComputedStyle(image).objectFit)).toBe("contain");
  const previewFrame = preview.locator("..");
  const frameBox = await previewFrame.boundingBox();
  const imageBox = await preview.boundingBox();
  expect(frameBox).not.toBeNull();
  expect(imageBox).not.toBeNull();
  expect(frameBox!.width / frameBox!.height).toBeCloseTo(64 / 96, 2);
  expect(imageBox!.width).toBeCloseTo(frameBox!.width, 0);
  expect(imageBox!.height).toBeCloseTo(frameBox!.height, 0);
  await expect(page.getByText("До", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Скачать файл" })).toBeVisible();
  await expect(page.getByText("Лимит соблюдён")).toBeVisible();
});
