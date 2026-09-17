import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "../src/config/system-prompt";

describe("vision system prompt", () => {
  it("asks the model to remove visually empty edge bands by cropping", () => {
    expect(SYSTEM_PROMPT).toContain("крупную однородную полосу вдоль края");
    expect(SYSTEM_PROMPT).toContain(
      "Совпадение aspect ratio исходника и целевого формата само по себе не является причиной использовать весь исходник",
    );
  });

  it("protects meaningful negative space and important subjects", () => {
    expect(SYSTEM_PROMPT).toContain("осмысленного негативного пространства");
    expect(SYSTEM_PROMPT).toContain("без обрезания лиц, голов, кистей");
  });
});
