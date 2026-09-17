import { dedupeFilename, sanitizeFilename, sourceBase } from "./filename";
import type { PhotoItem } from "../types";

export async function createResultsZip(photos: PhotoItem[]): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const manifest: Array<Record<string, unknown>> = [];
  const usedFolders = new Set<string>();

  for (const photo of photos) {
    const folderName = dedupeFilename(sanitizeFilename(sourceBase(photo.file.name)), usedFolders);
    const folder = zip.folder(folderName)!;
    for (const output of photo.outputs.filter((item) => item.limitMet)) {
      folder.file(output.filename, output.blob);
      manifest.push({
        sourceName: photo.file.name,
        archivePath: `${folderName}/${output.filename}`,
        formatId: output.format.id,
        target: {
          width: output.format.width,
          height: output.format.height,
          mimeType: output.format.mimeType,
          maxBytes: output.format.maxBytes,
        },
        actual: {
          width: output.actualWidth,
          height: output.actualHeight,
          mimeType: output.blob.type,
          bytes: output.blob.size,
        },
        crop: output.crop,
        adjustments: output.adjustments,
        warnings: output.warnings,
      });
    }
  }
  zip.file(
    "manifest.json",
    JSON.stringify({ generatedAt: new Date().toISOString(), files: manifest }, null, 2),
  );
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
