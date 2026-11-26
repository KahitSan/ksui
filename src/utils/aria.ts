// Solid 2 removes a boolean-false attribute, which would drop aria-expanded="false";
// ARIA state attributes must be serialized as strings.
export function ariaBool(value: boolean | undefined | null): "true" | "false" | undefined {
  if (value === undefined || value === null) return undefined;
  return value ? "true" : "false";
}

/** For aria-pressed / aria-checked, which also allow "mixed". */
export function ariaTri(
  value: boolean | "mixed" | undefined | null,
): "true" | "false" | "mixed" | undefined {
  return value === "mixed" ? "mixed" : ariaBool(value);
}
