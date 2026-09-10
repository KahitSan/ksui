// @vitest-environment jsdom
import { cleanup, render, screen } from "@solidjs/testing-library";
import { Suspense } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExistingAttachmentTile from "./ExistingAttachmentTile";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ExistingAttachmentTile", () => {
  it("keeps its parent rendered while private attachment bytes load", async () => {
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:attachment"),
      revokeObjectURL: vi.fn(),
    });

    render(() => (
      <Suspense fallback={<p>Modal fallback</p>}>
        <div data-testid="modal-shell">
          <ExistingAttachmentTile
            attachment={{
              id: 1,
              file_name: "receipt.jpg",
              mime_type: "image/jpeg",
              s3_link: null,
            }}
            rawHref="/api/attachments/1/raw"
            testId="attachment"
          />
        </div>
      </Suspense>
    ));

    expect(screen.getByTestId("modal-shell")).toBeTruthy();
    expect(screen.queryByText("Modal fallback")).toBeNull();
    expect(screen.getByText("Loading")).toBeTruthy();

    resolveFetch(new Response(new Blob(["image"]), { status: 200 }));
    expect(await screen.findByAltText("receipt.jpg")).toBeTruthy();
  });
});
