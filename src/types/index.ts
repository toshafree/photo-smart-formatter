export type OutputMimeType = "image/jpeg" | "image/png";

export type OutputFormat = {
  id: string;
  group: string;
  name: string;
  width: number;
  height: number;
  mimeType: OutputMimeType;
  extension: "jpg" | "png";
  maxBytes: number;
  prompt?: string;
  filenameTemplate: string;
  builtIn: boolean;
};

export type Box = { x: number; y: number; width: number; height: number };

export type RotationDegrees = 0 | 90 | 180 | 270;

export type Adjustments = {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  highlights: number;
  shadows: number;
  sharpen: number;
};

export type AnalysisResult = {
  sourceSummary: string;
  sourceRotation: RotationDegrees;
  subjects: Array<{
    kind: "person" | "face" | "object" | "text" | "logo" | "other";
    description: string;
    importance: number;
    box: Box;
  }>;
  outputs: Array<{
    formatId: string;
    crop: Box;
    adjustments: Adjustments;
    warnings: string[];
    rationale: string;
  }>;
};

export type JobStatus =
  | "idle"
  | "queued"
  | "decoding"
  | "analyzing"
  | "validating"
  | "rendering"
  | "compressing"
  | "done"
  | "error"
  | "cancelled";

export type PreparedOutput = {
  format: OutputFormat;
  filename: string;
  blob: Blob;
  objectUrl: string;
  crop: Box;
  adjustments: Adjustments;
  warnings: string[];
  limitMet: boolean;
  actualWidth: number;
  actualHeight: number;
};

export type PhotoItem = {
  id: string;
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  specificPrompt: string;
  status: JobStatus;
  progress: number;
  statusText: string;
  error?: string;
  outputs: PreparedOutput[];
};

export type ModelId = "deepseek-flash";
