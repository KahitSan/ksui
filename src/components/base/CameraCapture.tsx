// Vendored into plugin remotes.
// getUserMedia camera capture modal. Button is ksui's own base primitive.

import { createSignal, onCleanup, onMount, Show } from "solid-js";
import Button from "./Button";
import Camera from "lucide-solid/icons/camera";
import X from "lucide-solid/icons/x";

interface Props {
  onCapture: (file: File) => void;
  onClose: () => void;
}

export default function CameraCapture(props: Props) {
  let videoRef: HTMLVideoElement | undefined;
  let canvasRef: HTMLCanvasElement | undefined;
  const [stream, setStream] = createSignal<MediaStream | null>(null);
  const [error, setError] = createSignal("");
  const [captured, setCaptured] = createSignal<string | null>(null);

  onMount(async () => {
    stream()
      ?.getTracks()
      .forEach((t) => t.stop());
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      setStream(s);
      if (videoRef) {
        videoRef.srcObject = s;
        videoRef.play();
      }
    } catch {
      setError("Could not access camera. Check permissions or try the Browse button instead.");
    }
  });

  onCleanup(() => {
    stream()
      ?.getTracks()
      .forEach((t) => t.stop());
  });

  function takePhoto() {
    if (!videoRef || !canvasRef) return;
    canvasRef.width = videoRef.videoWidth;
    canvasRef.height = videoRef.videoHeight;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(videoRef, 0, 0);
    setCaptured(canvasRef.toDataURL("image/jpeg", 0.9));
  }

  function confirmCapture() {
    if (!canvasRef) return;
    const onCapture = props.onCapture;
    canvasRef.toBlob(
      (blob) => {
        if (blob) {
          const file = new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" });
          onCapture(file);
        }
      },
      "image/jpeg",
      0.9,
    );
  }

  function retake() {
    setCaptured(null);
  }

  return (
    <div
      data-testid="camera-capture-modal"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--ks-overlay,rgba(0,0,0,0.7))] backdrop-blur-sm p-4"
    >
      <div class="card-bg rounded-xl border border-[color-mix(in_srgb,var(--ks-accent,#fbbf24)_30%,transparent)] overflow-hidden max-w-lg w-full shadow-2xl">
        <div class="flex items-center justify-between p-3 border-b border-[var(--ks-border,rgba(39,39,42,0.5))]">
          <span
            class="text-sm text-[var(--ks-fg,#ffffff)] font-medium flex items-center gap-2"
            data-testid="camera-capture-title"
          >
            <Camera size={16} /> Camera
          </span>
          <button
            onClick={() => props.onClose()}
            class="text-[var(--ks-fg-subtle,#71717a)] hover:text-[var(--ks-fg-muted,#a1a1aa)] cursor-pointer"
            aria-label="Close camera"
          >
            <X size={18} />
          </button>
        </div>

        <Show when={error()}>
          <div class="p-6 text-center">
            <p class="text-sm text-[var(--ks-danger-fg,#f87171)] mb-3">{error()}</p>
            <Button intent="secondary" variant="ghost" onClick={() => props.onClose()}>
              Close
            </Button>
          </div>
        </Show>

        <Show when={!error()}>
          <div class="relative bg-[var(--ks-surface,#0f0f0f)] aspect-video">
            <Show when={!captured()}>
              <video ref={videoRef} autoplay playsinline muted class="w-full h-full object-cover" />
            </Show>
            <Show when={captured()}>
              <img src={captured()!} alt="Captured" class="w-full h-full object-cover" />
            </Show>
            <canvas ref={canvasRef} class="hidden" />
          </div>

          <div class="flex items-center justify-center gap-3 p-3">
            <Show
              when={!captured()}
              fallback={
                <>
                  <Button intent="secondary" variant="ghost" onClick={retake}>
                    Retake
                  </Button>
                  <Button intent="primary" variant="clip1" onClick={confirmCapture}>
                    Use Photo
                  </Button>
                </>
              }
            >
              <button
                type="button"
                onClick={takePhoto}
                class="w-14 h-14 rounded-full border-4 border-[var(--ks-border-strong,#3f3f46)] bg-[var(--ks-fg,#ffffff)] hover:bg-[var(--ks-fg,#ffffff)] active:scale-95 transition-all cursor-pointer"
                title="Take photo"
                aria-label="Take photo"
              />
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
