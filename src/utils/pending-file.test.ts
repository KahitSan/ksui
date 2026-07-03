// uploadPendingFiles: per-file best-effort POST to the transactions plugin's
// standard attachment route, returning the names that failed.
import { describe, expect, it, vi, afterEach } from "vitest";
import { uploadPendingFiles, type PendingFile } from "./pending-file";

function pf(name: string): PendingFile {
  return { id: name, file: new File(["x"], name), previewUrl: null };
}

describe("uploadPendingFiles", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs each file to the transaction's attachments route with credentials included", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const failed = await uploadPendingFiles(42, [pf("receipt.jpg")]);

    expect(failed).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/transactions/42/attachments",
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
  });

  it("layers caller-supplied headers onto the request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await uploadPendingFiles(42, [pf("receipt.jpg")], {
      headers: { "X-Workspace-Id": "7" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/transactions/42/attachments",
      expect.objectContaining({ headers: { "X-Workspace-Id": "7" } })
    );
  });

  it("collects failed file names without aborting the remaining uploads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const failed = await uploadPendingFiles(42, [
      pf("a.jpg"),
      pf("b.jpg"),
      pf("c.jpg"),
    ]);

    expect(failed).toEqual(["a.jpg", "b.jpg"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
