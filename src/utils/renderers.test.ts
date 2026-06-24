// U8 — registry + consumes-validation unit tests (pure, no DOM).
import { afterEach, describe, expect, it } from "vitest";
import {
  clearRenderers,
  getRenderer,
  hasRenderer,
  registerRenderer,
  unregisterRenderer,
  validateConsumes,
  type RendererDefinition,
} from "./renderers";

const noopDef = (id: string): RendererDefinition => ({
  id,
  consumes: { name: "string" },
  emits: ["edit"],
  render: () => null as never,
});

afterEach(() => clearRenderers());

describe("renderer registry", () => {
  it("registers and looks up by id", () => {
    registerRenderer(noopDef("card"));
    expect(hasRenderer("card")).toBe(true);
    expect(getRenderer("card")?.id).toBe("card");
  });

  it("re-registering the same id replaces (last write wins)", () => {
    registerRenderer(noopDef("card"));
    registerRenderer({ ...noopDef("card"), emits: ["pay"] });
    expect(getRenderer("card")?.emits).toEqual(["pay"]);
  });

  it("unknown id is undefined, not a throw", () => {
    expect(getRenderer("missing")).toBeUndefined();
    expect(hasRenderer("missing")).toBe(false);
  });

  it("unregister removes a renderer", () => {
    registerRenderer(noopDef("card"));
    unregisterRenderer("card");
    expect(hasRenderer("card")).toBe(false);
  });
});

describe("validateConsumes", () => {
  it("accepts a matching item", () => {
    const r = validateConsumes(
      { customer: "string", progress: "number", packages: "array", balance: "currency?" },
      { customer: "Acme", progress: 3, packages: [], balance: 1200 },
    );
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("allows an optional field to be absent", () => {
    const r = validateConsumes({ name: "string", balance: "currency?" }, { name: "x" });
    expect(r.ok).toBe(true);
  });

  it("rejects a missing required field", () => {
    const r = validateConsumes({ name: "string" }, {});
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("name");
  });

  it("rejects a type mismatch", () => {
    const r = validateConsumes({ progress: "number" }, { progress: "nope" });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("expected number");
  });

  it("rejects a non-object item", () => {
    expect(validateConsumes({ a: "string" }, null).ok).toBe(false);
    expect(validateConsumes({ a: "string" }, [] as unknown).ok).toBe(false);
  });

  it("ignores extra keys not in the schema", () => {
    const r = validateConsumes({ name: "string" }, { name: "x", extra: 99 });
    expect(r.ok).toBe(true);
  });

  it("any matches anything", () => {
    expect(validateConsumes({ blob: "any" }, { blob: { x: 1 } }).ok).toBe(true);
  });
});
