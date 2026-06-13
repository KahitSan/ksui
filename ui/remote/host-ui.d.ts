/// <reference types="@kahitsan/plugin-ui/host-ui" />
// The @kserp/host-ui ambient type contract lives in @kahitsan/plugin-ui (a
// normal dependency) — referenced, never copied, so it can't drift. A
// third-party plugin gets the same types from the installed package.

declare module "*.css" {}
