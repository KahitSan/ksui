import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeIconModules } from "./write-icon-modules.mjs";

test("oriented aliases share source artwork while legacy exports remain unchanged", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "icon-modules-"));
  try {
    await fs.mkdir(path.join(root, "src/icons"), { recursive: true });
    const legacyModule = "preserved legacy public component\n";
    await fs.writeFile(path.join(root, "src/icons/shopping-bag.tsx"), legacyModule);
    await writeIconModules(root, {
      requiredSourceNames: ["arrow-down", "sales", "check", "check-bold"],
      runtime: [{ name: "arrow-left", source: "arrow-down", rotation: 90 }, { name: "sales", source: "sales", rotation: 0 }],
      variants: { check: { bold: "check-bold" } },
    }, { groups: [{ names: ["shopping-bag", "arrow-left", "check"] }], aliases: {} });
    const arrow = await fs.readFile(path.join(root, "src/icons/arrow-left.tsx"), "utf8");
    assert.match(arrow, /artwork\/arrow-down/);
    assert.match(arrow, /rotation: 90/);
    assert.equal(await fs.readFile(path.join(root, "src/icons/shopping-bag.tsx"), "utf8"), legacyModule);
    const index = await fs.readFile(path.join(root, "src/icons/index.ts"), "utf8");
    assert.match(index, /as ShoppingBag/);
    assert.match(index, /as Sales/);
    assert.match(await fs.readFile(path.join(root, "src/icons/check.tsx"), "utf8"), /artwork as bold.*check-bold/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
