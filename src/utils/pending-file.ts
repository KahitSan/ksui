// Pre-upload pending file state — a file the user has picked or pasted but not
// yet uploaded. The two plugins that support attachment upload (transactions,
// timesheets/payroll) both defined this locally; extracted here so they share
// one canonical type + helpers and avoid drift.

/** A file the user picked or pasted but hasn't been uploaded yet. */
export interface PendingFile {
  id: string;
  file: File;
  previewUrl: string | null;
}

let _counter = 0;

/** Wrap a picked/pasted File into a PendingFile with a stable id and optional
 *  image preview URL. Must be called from the client (browser) — relies on
 *  URL.createObjectURL. */
export function createPendingFile(file: File): PendingFile {
  const isImage = file.type.startsWith("image/");
  return {
    id: `pf-${++_counter}-${Date.now()}`,
    file,
    previewUrl: isImage ? URL.createObjectURL(file) : null,
  };
}

/** Release the object URL held by a pending file. Call when the file is removed
 *  from the list or after upload completes. */
export function revokePendingFile(pf: PendingFile): void {
  if (pf.previewUrl) URL.revokeObjectURL(pf.previewUrl);
}
