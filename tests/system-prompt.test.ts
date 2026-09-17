import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "../src/config/system-prompt";

describe("vision system prompt", () => {
  it("asks the model to remove visually empty edge bands by cropping", () => {
    expect(SYSTEM_PROMPT).toContain("крупную однородную полосу вдоль края");
    expect(SYSTEM_PROMPT).toContain(
      "Совпадение aspect ratio исходника и целевого формата само по себе не является причиной использовать весь исходник",
    );
    expect(SYSTEM_PROMPT).toContain("даже тонкий фрагмент этой полосы");
    expect(SYSTEM_PROMPT).toContain("примерно 0,5–1% размера исходника");
    expect(SYSTEM_PROMPT).toContain("не видно ни одного остатка");
  });

  it("protects meaningful negative space and important subjects", () => {
    expect(SYSTEM_PROMPT).toContain("осмысленного негативного пространства");
    expect(SYSTEM_PROMPT).toContain("без обрезания лиц, голов, кистей");
  });

  it("prioritizes the main story and keeps faces safely composed", () => {
    expect(SYSTEM_PROMPT).toContain("единый главный сюжет исходника");
    expect(SYSTEM_PROMPT).toContain("лица, жесты и взаимодействие людей обычно важнее");
    expect(SYSTEM_PROMPT).toContain("не ближе 5–8% ширины или высоты кадра");
    expect(SYSTEM_PROMPT).toContain("выбери связную подгруппу вокруг главного героя");
    expect(SYSTEM_PROMPT).toContain("либо исключай чисто");
    expect(SYSTEM_PROMPT).toContain(
      "Удаление нежелательных полос не может ухудшать первые четыре пункта",
    );
  });
});
