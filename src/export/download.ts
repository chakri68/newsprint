/** Trigger a browser download for a blob, cleaning up the object URL after. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke late -- revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `newsprint-the-city-never-sleeps-2026-09-03.png` */
export function suggestFilename(text: string, extension: string): string {
  const slug =
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 42) || "clipping";
  const date = new Date().toISOString().slice(0, 10);
  return `newsprint-${slug}-${date}.${extension}`;
}
