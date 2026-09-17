import type { ModelId } from "../types";

export const MODEL_PROFILES: Array<{
  id: ModelId;
  label: string;
  description: string;
}> = [
  {
    id: "gpt-5.6-terra",
    label: "Сбалансированный",
    description: "Оптимальный баланс качества и стоимости",
  },
  {
    id: "gpt-6-astra",
    label: "Максимальное качество",
    description: "Для сложных сцен и точной композиции",
  },
  {
    id: "gpt-5.6-luna",
    label: "Экономичный",
    description: "Для больших партий и простых кадров",
  },
];

export const DEFAULT_MODEL: ModelId = "gpt-5.6-terra";
