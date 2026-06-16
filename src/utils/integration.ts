// Optional host integrations.
//
// A couple of ksui components can do MORE when the surrounding app feeds them
// runtime context — a permission check (MarkdownNotes gates its client-mention
// hover card on "clients.view") and the active workspace id (useAccountsIndex
// re-keys its fetch per workspace). The library used to pull these from
// "@kserp/host-ui"; it now owns a tiny opt-in registry instead, so it stays a
// standalone dependency-free package.
//
// Default behavior with nothing configured (any plain SolidJS consumer):
//   - canAccess(code) === false   → MarkdownNotes renders a plain, non-hovering
//                                    mention chip.
//   - getActiveWorkspaceId() === null → useAccountsIndex stays empty (its fetch
//                                    short-circuits), so accounts resolve to the
//                                    type-default glyph.
//
// A host app wires the real behavior once at startup:
//   import { configurePermissions, configureActiveWorkspace } from "@kahitsan/ksui";
//   configurePermissions((code) => usePermissions().has(code));
//   configureActiveWorkspace(() => useActiveWorkspace().activeWorkspace()?.ws_id ?? null);
//
// The resolvers may read reactive sources; ksui calls them inside tracking
// scopes, so a signal-backed permission/workspace value stays reactive.

type PermissionResolver = (code: string) => boolean;
type WorkspaceResolver = () => number | string | null;

let permissionResolver: PermissionResolver | null = null;
let workspaceResolver: WorkspaceResolver | null = null;

/** Register the host's permission check. Pass a function so it can read a reactive source. */
export function configurePermissions(resolver: PermissionResolver): void {
  permissionResolver = resolver;
}

/** True when the host granted `code`. False when no resolver is configured. */
export function canAccess(code: string): boolean {
  return permissionResolver ? !!permissionResolver(code) : false;
}

/** Register the host's active-workspace id getter. Pass a function so it can read a reactive source. */
export function configureActiveWorkspace(resolver: WorkspaceResolver): void {
  workspaceResolver = resolver;
}

/** The host's active workspace id, or null when no resolver is configured. */
export function getActiveWorkspaceId(): number | string | null {
  return workspaceResolver ? workspaceResolver() : null;
}
