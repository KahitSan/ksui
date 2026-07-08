/// <reference types="@kahitsan/ksui" />
declare module "@kserp/host-ui" {
  // Kernel-specific components
  export { default as PageShell } from "@kahitsan/ksui";
  export { default as PageTitle } from "@kahitsan/ksui";
  export { default as PageShareButton } from "@kahitsan/ksui";
  export { default as SearchableSelect } from "@kahitsan/ksui";
  export { default as Avatar } from "@kahitsan/ksui";
  export { default as PluginPageLoader } from "@kahitsan/ksui";

  // Kernel-specific hooks
  export function useActiveWorkspace(): any;
  export function useCan(permission: string): any;
  /** Resolve a route setting (U3): user_pref ?? workspace_default ?? fallback,
   *  where fallback is the plugin_default the route declares. Returns an accessor
   *  so a page can size itself (e.g. pageLength) from the live preference. Used by
   *  the folded-in Payees page. */
  export function useRouteSetting<T>(routePath: string, key: string, fallback: T): () => T;
  export function usePermissions(): {
    has: (code: string) => boolean;
    hasAny: (...codes: string[]) => boolean;
    hasAll: (...codes: string[]) => boolean;
    bypass: () => boolean;
    loading: () => boolean;
    refetch: () => void;
    [key: string]: any;
  };
  export const PermissionGate: (props: {
    when?: boolean;
    redirectTo?: string;
    fallback?: any;
    children: any;
    permission?: string;
  }) => any;

  // Host router (remotes render inside the host's Router tree)
  export type PluginRoute = {
    routeBase: () => string;
    subPath: () => string[];
    query: () => Record<string, string | undefined>;
  };
  export function usePluginRoute(): PluginRoute;
  export function usePluginNavigate(): (to: string, opts?: { replace?: boolean }) => void;
  export const Link: (props: {
    href: string;
    class?: string;
    title?: string;
    "data-testid"?: string;
    "aria-label"?: string;
    "aria-haspopup"?: boolean | "dialog" | "menu" | "listbox" | "tree" | "grid";
    onClick?: (e: MouseEvent) => void;
    children?: any;
  }) => any;

  // Local wrapper types
  export interface SearchableOption {
    value: string | number;
    label: string;
    description?: string;
  }
}

declare module "*.css" {}
