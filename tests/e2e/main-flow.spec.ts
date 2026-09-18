import { expect, test } from "@playwright/test";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("uploads a photo and prepares a result without a real API call", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("DeepSeek API key").fill("sk-test-only");
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
  await expect(page.getByRole("button", { name: "Отправить ZIP по почте" })).toBeVisible();
  await expect(page.getByText("Лимит соблюдён")).toBeVisible();
});

test("reduces internal detail when minimum JPEG quality still exceeds the limit", async ({
  page,
}) => {
  await page.goto("/");
  const noisyPng = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d")!;
    const image = context.createImageData(canvas.width, canvas.height);
    let state = 123456789;
    for (let index = 0; index < image.data.length; index += 4) {
      state = (state * 1664525 + 1013904223) >>> 0;
      image.data[index] = state & 255;
      image.data[index + 1] = (state >>> 8) & 255;
      image.data[index + 2] = (state >>> 16) & 255;
      image.data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("PNG encode failed"))),
        "image/png",
      ),
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });

  await page.getByLabel("DeepSeek API key").fill("sk-test-only");
  await page.getByRole("button", { name: "+ Свой формат" }).click();
  await page.getByLabel("Название *").fill("Жёсткий лимит");
  await page.getByLabel("Ширина, px *").fill("512");
  await page.getByLabel("Высота, px *").fill("512");
  await page.getByLabel("Максимум, КБ *").fill("5");
  await page.getByRole("button", { name: "Сохранить формат" }).click();

  await page.locator('input[type="file"][accept*="image/jpeg"]').setInputFiles({
    name: "noise.png",
    mimeType: "image/png",
    buffer: Buffer.from(noisyPng),
  });
  await page.getByRole("button", { name: /Подготовить изображения/ }).click();

  await expect(page.getByRole("heading", { name: "Жёсткий лимит" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Лимит соблюдён")).toBeVisible();
  await page.getByText(/Предупреждения/).click();
  await expect(page.getByText(/внутренняя детализация снижена/)).toBeVisible();
});
