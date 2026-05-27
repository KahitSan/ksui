import type { QueryResultRow } from "pg";

// Subcategory taxonomy helpers. Ported from the monolith; the only structural
// change is that the table lives in the plugin's own `accounts` schema
// (accounts.transaction_subcategories) rather than the monolith's public
// schema, so the plugin owns it cleanly. Because the plugin's pg search_path
// is `accounts, public`, the unqualified `transaction_subcategories` resolves
// to the accounts copy.

export type AppliesTo = "income" | "expense";

export interface TransactionSubcategory {
  id: number;
  name: string;
  applies_to: AppliesTo;
  sort_order: number;
  is_active: boolean;
}

// Structural subset of pg.PoolClient + kernel PluginDb that the helpers need.
export type SubcategoryQueryHandle = {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
};

/** Maps a transaction.category value to the lookup taxonomy. Internal
 *  transfers ('business') have no subcategory. */
export function appliesToFor(category: string): AppliesTo | null {
  switch (category) {
    case "sale":
      return "income";
    case "expense":
    case "payable":
      return "expense";
    default:
      return null;
  }
}

/** Loads active subcategories for one taxonomy side, sorted by sort_order
 *  then name. */
export async function listSubcategories(
  db: SubcategoryQueryHandle,
  appliesTo: AppliesTo,
): Promise<TransactionSubcategory[]> {
  const { rows } = await db.query<TransactionSubcategory>(
    `SELECT id, name, applies_to, sort_order, is_active
     FROM transaction_subcategories
     WHERE applies_to = $1 AND is_active = TRUE
     ORDER BY sort_order ASC, name ASC`,
    [appliesTo],
  );
  return rows;
}

/** Validates that a subcategory string is allowed for a transaction category.
 *  Returns the canonical name (as stored) if valid, or null for empty input.
 *  Throws on a mismatch. */
export async function validateSubcategory(
  db: SubcategoryQueryHandle,
  category: string,
  subcategory: string | null | undefined,
): Promise<string | null> {
  if (subcategory === null || subcategory === undefined || subcategory === "") {
    return null;
  }
  const trimmed = subcategory.trim();
  const appliesTo = appliesToFor(category);
  if (appliesTo === null) {
    throw new Error(
      `Subcategory "${trimmed}" is not valid for category "${category}". ` +
        `Internal transfers do not take a subcategory.`,
    );
  }
  const { rows } = await db.query<{ name: string }>(
    `SELECT name FROM transaction_subcategories
     WHERE name = $1 AND applies_to = $2`,
    [trimmed, appliesTo],
  );
  if (rows.length === 0) {
    throw new Error(`Subcategory "${trimmed}" is not valid for category "${category}".`);
  }
  return rows[0].name;
}
