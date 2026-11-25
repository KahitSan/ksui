import test from "node:test";
import assert from "node:assert/strict";
import { validateIconManifest, iconCellBounds } from "./icon-source-manifest.mjs";

const group = () => ({
  id: "approved-seed", columns: 2, rows: 2,
  names: ["bir-office", null, null, "tax-document"], sha256: "a".repeat(64),
});

test("unused source cells remain positional but never become icons", () => {
  const result = validateIconManifest({ groups: [group()], expectedCount: 2 });
  assert.deepEqual(result.names, ["bir-office", "tax-document"]);
  assert.equal(result.complete, true);
});

test("partial source coverage is explicitly opt-in", () => {
  const manifest = { groups: [group()], expectedCount: 167 };
  assert.throws(() => validateIconManifest(manifest), /Incomplete source coverage: 2\/167/);
  assert.equal(validateIconManifest(manifest, { allowPartial: true }).complete, false);
});

test("duplicate canonical names are rejected across source groups", () => {
  assert.throws(() => validateIconManifest({ groups: [group(), { ...group(), id: "another" }] }), /duplicate icon name/);
});

test("grid mistakes cannot shift semantic cell assignments", () => {
  assert.throws(() => validateIconManifest({ groups: [{ ...group(), columns: 3 }] }), /cell count/);
});

test("invalid source identity and hash are rejected", () => {
  assert.throws(() => validateIconManifest({ groups: [{ ...group(), id: "../outside" }] }), /source group/);
  assert.throws(() => validateIconManifest({ groups: [{ ...group(), sha256: "" }] }), /Source hash/);
});

test("the audited required set rejects stale counts and extra source art", () => {
  const expectedNames = ["bir-office", "tax-document", "search"];
  const manifest = { groups: [group()], expectedCount: 3, expectedNames };
  assert.equal(validateIconManifest(manifest, { expectedNames, allowPartial: true }).complete, false);
  assert.throws(() => validateIconManifest({ ...manifest, expectedCount: 167 }, { expectedNames, allowPartial: true }), /count differs/);
  assert.throws(() => validateIconManifest(manifest, { expectedNames: ["bir-office", "search"], allowPartial: true }), /names differ/);
  assert.throws(() => validateIconManifest({ groups: [group()] }, { expectedNames: ["bir-office"], allowPartial: true }), /outside the required/);
});

test("recorded uneven grids preserve whole cells and reject invalid boundaries", () => {
  const g = { ...group(), rowBoundaries: [0, 350, 640] };
  validateIconManifest({ groups: [g] });
  assert.deepEqual(iconCellBounds(g, { width: 640, height: 640 }, 2), { left: 0, right: 320, top: 350, bottom: 640 });
  assert.deepEqual(iconCellBounds(g, { width: 640, height: 640 }, g.names.indexOf("tax-document")), { left: 320, right: 640, top: 350, bottom: 640 });
  assert.throws(() => iconCellBounds(g, { width: 640, height: 641 }, 2), /match image dimensions/);
  for (const rowBoundaries of [[1, 350, 640], [0, 350, 350], [0, 350], [0, 350.5, 640]]) {
    assert.throws(() => validateIconManifest({ groups: [{ ...g, rowBoundaries }] }), /Invalid source cell boundaries/);
  }
  assert.throws(() => iconCellBounds({ ...g, columnBoundaries: [0, 320, 641] }, { width: 640, height: 640 }, 0), /match image dimensions/);
});
