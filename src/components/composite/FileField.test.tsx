// U6 — FileField tests: state transitions, injected uploader/resolver called,
// graceful degrade on a rejected presign + a rejected upload.
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, waitFor } from "@solidjs/testing-library";
import FileField, { type AssetHandle } from "./FileField";

const imageHandle: AssetHandle = { id: "a1", name: "receipt.png", mime: "image/png", size: 2048 };

function pngFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "receipt.png", { type: "image/png" });
}

describe("FileField", () => {
  it("starts empty with a drop zone", () => {
    const { getByTestId } = render(() => (
      <FileField testId="ff" onUpload={vi.fn(async () => imageHandle)} />
    ));
    expect(getByTestId("ff-drop")).toBeTruthy();
  });

  it("calls the injected uploader on pick and transitions to done", async () => {
    const onUpload = vi.fn(async () => imageHandle);
    const onChange = vi.fn();
    const presignUrl = vi.fn(async () => "https://signed/url.png");
    const { getByTestId, queryByTestId } = render(() => (
      <FileField testId="ff" onUpload={onUpload} onChange={onChange} presignUrl={presignUrl} />
    ));
    const input = getByTestId("ff-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [pngFile()], configurable: true });
    fireEvent.change(input);

    await waitFor(() => expect(onUpload).toHaveBeenCalled());
    await waitFor(() => expect(getByTestId("ff-done")).toBeTruthy());
    expect(onChange).toHaveBeenCalledWith(imageHandle);
    // image handle → presign called for preview
    await waitFor(() => expect(presignUrl).toHaveBeenCalledWith(imageHandle));
    await waitFor(() => expect(getByTestId("ff-preview")).toBeTruthy());
    expect(queryByTestId("ff-drop")).toBeNull();
  });

  it("degrades gracefully (broken thumb, no throw) when presign rejects", async () => {
    const onUpload = vi.fn(async () => imageHandle);
    const presignUrl = vi.fn(async () => {
      throw new Error("expired");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getByTestId } = render(() => (
      <FileField testId="ff" onUpload={onUpload} presignUrl={presignUrl} />
    ));
    const input = getByTestId("ff-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [pngFile()], configurable: true });
    fireEvent.change(input);

    await waitFor(() => expect(getByTestId("ff-broken")).toBeTruthy());
  });

  it("shows a failed state when the uploader rejects (never throws)", async () => {
    const onUpload = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getByTestId } = render(() => <FileField testId="ff" onUpload={onUpload} />);
    const input = getByTestId("ff-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [pngFile()], configurable: true });
    fireEvent.change(input);

    await waitFor(() => expect(getByTestId("ff-failed").textContent).toContain("offline"));
    expect(getByTestId("ff-retry")).toBeTruthy();
  });

  it("clears the handle when removed", async () => {
    const onChange = vi.fn();
    const { getByTestId } = render(() => (
      <FileField
        testId="ff"
        value={{ id: "x", name: "doc.pdf", mime: "application/pdf", size: 100 }}
        onUpload={vi.fn(async () => imageHandle)}
        onChange={onChange}
      />
    ));
    expect(getByTestId("ff-done")).toBeTruthy();
    fireEvent.click(getByTestId("ff-remove"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
    expect(getByTestId("ff-drop")).toBeTruthy();
  });

  it("loads a pre-seeded image value via the presigned (https) URL into the preview", async () => {
    const presignUrl = vi.fn(async () => "https://signed.example/preview.png?sig=abc");
    const { getByTestId } = render(() => (
      <FileField testId="ff" value={imageHandle} onUpload={vi.fn(async () => imageHandle)} presignUrl={presignUrl} />
    ));
    // A value handle present at mount presigns eagerly and shows the done card.
    expect(getByTestId("ff-done")).toBeTruthy();
    await waitFor(() => expect(presignUrl).toHaveBeenCalledWith(imageHandle));
    const img = (await waitFor(() => getByTestId("ff-preview"))) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://signed.example/preview.png?sig=abc");
  });

  it("renders a non-image handle with a file icon (no presign)", () => {
    const presignUrl = vi.fn(async () => "x");
    const { getByTestId } = render(() => (
      <FileField
        testId="ff"
        value={{ id: "x", name: "doc.pdf", mime: "application/pdf", size: 100 }}
        onUpload={vi.fn(async () => imageHandle)}
        presignUrl={presignUrl}
      />
    ));
    expect(getByTestId("ff-done")).toBeTruthy();
    expect(presignUrl).not.toHaveBeenCalled(); // only images presign
  });
});
