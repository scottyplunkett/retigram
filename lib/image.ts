const MAX_EDGE = 1568;
const MAX_BYTES = 4.5 * 1024 * 1024;

/**
 * Downscale an image so its long edge is at most 1568px and re-encode it.
 * Returns a Blob ready to upload. Browser-only.
 */
export async function prepareImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= MAX_BYTES && file.type !== "image/heic") {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // PNG keeps thin lines and small text crisp; fall back to JPEG if it is still too big.
  const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (png && png.size <= MAX_BYTES) return png;
  const jpeg = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  if (!jpeg) throw new Error("Could not encode image");
  return jpeg;
}
