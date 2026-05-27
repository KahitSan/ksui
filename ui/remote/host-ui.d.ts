// The shared UI kit the HOST exposes to plugin remote bundles (window.__KSERP_UI__,
// externalized as "@kserp/host-ui"). Declared here so the remote type-checks
// without importing host source. The host owns the runtime: its catch-all route
// (src/routes/[...slug].tsx) populates this global from the host's kit barrel
// (src/lib/host-ui.tsx) before loading any remote. Mirror that surface here.
declare module "@kserp/host-ui" {
  import type { JSX } from "solid-js";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const Button: (props: any) => JSX.Element;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const PageShell: (props: any) => JSX.Element;
  export function confirm(opts: {
    title?: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }): Promise<boolean>;
}
