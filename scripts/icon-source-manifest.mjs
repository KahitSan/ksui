function validateGrid(group) {
  if (!Number.isInteger(group.columns) || group.columns < 1) throw new Error(`Invalid source columns: ${group.id}`);
  if (!Number.isInteger(group.rows) || group.rows < 1) throw new Error(`Invalid source rows: ${group.id}`);
  if (!Array.isArray(group.names) || group.names.length !== group.columns * group.rows) throw new Error(`Source cell count does not match its grid: ${group.id}`);
}

function validateBoundaries(values, count, label) {
  if (values === undefined) return;
  if (!Array.isArray(values) || values.length !== count + 1 || values[0] !== 0) throw new Error(`Invalid source cell boundaries: ${label}`);
  for (let i = 0; i < values.length; i++) {
    if (!Number.isInteger(values[i])) throw new Error(`Invalid source cell boundaries: ${label}`);
    if (i > 0 && values[i] <= values[i - 1]) throw new Error(`Invalid source cell boundaries: ${label}`);
  }
}

function addName(name, names) {
  if (name === null) return;
  if (typeof name !== "string" || !/^[a-z][a-z0-9-]*$/.test(name) || names.has(name)) throw new Error(`Invalid or duplicate icon name: ${String(name)}`);
  names.add(name);
}

function requiredNames(manifest, expectedNames) {
  const required = expectedNames ?? manifest.expectedNames;
  if (required === undefined) return;
  validateRequiredNames(required);
  if (expectedNames && manifest.expectedNames) assertSameNames(expectedNames, manifest.expectedNames);
  return required;
}

function validateRequiredNames(required) {
  if (!Array.isArray(required) || new Set(required).size !== required.length) throw new Error("Invalid required source names");
  for (const name of required) {
    if (typeof name !== "string" || !/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("Invalid required source names");
  }
}

function assertSameNames(expected, actual) {
  if (actual.length !== expected.length || actual.some((name) => !expected.includes(name))) throw new Error("Manifest source names differ from the artwork contract");
}

function expectedSourceCount(manifest, required, actualCount) {
  const expectedCount = required?.length ?? manifest.expectedCount ?? actualCount;
  if (required && manifest.expectedCount != null && manifest.expectedCount !== expectedCount) throw new Error("Manifest count differs from the artwork contract");
  validateExpectedCount(expectedCount, actualCount);
  return expectedCount;
}

function validateExpectedCount(expectedCount, actualCount) {
  if (!Number.isInteger(expectedCount) || expectedCount < actualCount || expectedCount < 1) throw new Error("Invalid expected icon count");
}

function coverage(manifest, names, required, allowPartial) {
  if (required && [...names].some((name) => !required.includes(name))) throw new Error("Source artwork is outside the required design set");
  const expectedCount = expectedSourceCount(manifest, required, names.size);
  const complete = names.size === expectedCount;
  if (!complete && !allowPartial) throw new Error(`Incomplete source coverage: ${names.size}/${expectedCount}`);
  return { names: [...names], expectedCount, complete };
}

function validateGroup(group, groups, names) {
  if (!/^[a-z][a-z0-9-]*$/.test(group.id) || groups.has(group.id)) throw new Error(`Invalid or duplicate source group: ${group.id}`);
  groups.add(group.id);
  validateGrid(group);
  if (!/^[a-f0-9]{64}$/.test(group.sha256)) throw new Error(`Source hash is missing or invalid: ${group.id}`);
  validateBoundaries(group.rowBoundaries, group.rows, `${group.id} rowBoundaries`);
  validateBoundaries(group.columnBoundaries, group.columns, `${group.id} columnBoundaries`);
  for (const name of group.names) addName(name, names);
}

/** Validate cell assignments before any exporter writes generated assets. */
export function validateIconManifest(manifest, { allowPartial = false, expectedNames } = {}) {
  if (!Array.isArray(manifest.groups) || !manifest.groups.length) throw new Error("Icon manifest needs at least one source group");
  const groups = new Set();
  const names = new Set();
  for (const group of manifest.groups) validateGroup(group, groups, names);
  return coverage(manifest, names, requiredNames(manifest, expectedNames), allowPartial);
}

/** A recorded uneven grid preserves generator spacing without trimming artwork. */
export function iconCellBounds(group, { width, height }, index) {
  validateExtent(group.rowBoundaries, height, group.id);
  validateExtent(group.columnBoundaries, width, group.id);
  const column = index % group.columns;
  const row = Math.floor(index / group.columns);
  const [left, right] = axisBounds(group.columnBoundaries, group.columns, width, column);
  const [top, bottom] = axisBounds(group.rowBoundaries, group.rows, height, row);
  return { left, right, top, bottom };
}

function validateExtent(boundaries, size, id) {
  if (boundaries && boundaries.at(-1) !== size) throw new Error(`Source boundaries do not match image dimensions: ${id}`);
}

function axisBounds(boundaries, count, size, index) {
  if (boundaries) return [boundaries[index], boundaries[index + 1]];
  return [Math.round(index * size / count), Math.round((index + 1) * size / count)];
}
