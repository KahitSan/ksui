---
"@kahitsan/ksui": minor
---

Make ksui a fully standalone component library — it no longer depends on `@kserp/host-ui`.

Every component now depends only on `solid-js` + `lucide-solid` and injects its own CSS. The components that used to import host-kit pieces are self-contained: `CameraCapture`, `ImageCropper`, and `FormActions` use ksui's own `Button`; `ImageCropper` uses the new self-contained `Modal`; `ExistingAttachmentTile` uses the new `confirm`; `ComboBox`/`MarkdownNotes` use the new built-in `highlightMatch`. New exports: `Modal`, `confirm`, `highlightMatch`/`HighlightedText`/`matchesQuery`/`matchesAny`, `useFocusTrap`/`autoFocusOnMount`/`lockPullToRefresh`/`unlockPullToRefresh`, and the optional host-integration helpers `configurePermissions`/`configureActiveWorkspace`/`canAccess`/`getActiveWorkspaceId` (components degrade gracefully when these are not configured).

BREAKING: the `@kahitsan/ksui/host-ui` ambient type-contract subpath (`host-ui.d.ts`) is removed — the `@kserp/host-ui` ambient now lives in the kernel. Consumers that referenced `@kahitsan/ksui/host-ui` must repoint to the kernel-owned contract.
