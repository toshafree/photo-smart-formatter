import type { ModelId } from "../types";

export const MODEL_PROFILES: Array<{
  id: ModelId;
  label: string;
  description: string;
}> = [
  {
    id: "deepseek-flash",
    label: "DeepSeek Vision",
    description: "Мультимодальная модель для анализа фотографий и точного JSON",
  },
];

export const DEFAULT_MODEL: ModelId = "deepseek-flash";
