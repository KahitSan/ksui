// Pre-upload pending file state — a file the user has picked or pasted but not
// yet uploaded. The plugins that support attachment upload (transactions,
// counter, timesheets/payroll) each defined this locally; extracted here so
// they share one canonical type + helpers and avoid drift.

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

/** Extra fetch() init the caller needs layered onto every upload request —
 *  e.g. timesheets/payroll's X-Workspace-Id header for the fresh-login case
 *  where the host's fetch monkey-patch has no localStorage fallback yet. */
export interface UploadPendingFilesOptions {
  headers?: Record<string, string>;
}

/** Upload each pending file to the transactions plugin's standard multipart
 *  POST /:id/attachments S3 route — the one place attachment bytes are ever
 *  written, whichever plugin's UI collected them. Best-effort per file: a
 *  failed upload doesn't stop the rest. Returns the file names that failed,
 *  in the file's own `name` (not a caller-relabeled `file_name`), for the
 *  caller to surface as a soft error. */
export async function uploadPendingFiles(
  transactionId: number,
  files: PendingFile[],
  opts: UploadPendingFilesOptions = {}
): Promise<string[]> {
  const failed: string[] = [];
  for (const pf of files) {
    try {
      const fd = new FormData();
      fd.append("file", pf.file, pf.file.name);
      const res = await fetch(`/api/transactions/${transactionId}/attachments`, {
        method: "POST",
        credentials: "include",
        headers: opts.headers,
        body: fd,
      });
      if (!res.ok) failed.push(pf.file.name);
    } catch {
      failed.push(pf.file.name);
    }
  }
  return failed;
}
