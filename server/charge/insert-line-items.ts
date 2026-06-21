// Charge line-item insert path for the isolated transactions plugin.
//
// Extracted VERBATIM from helpers-charge.ts on the existing function seams:
// intervalSqlFor, assertOrgOwnsRow, the InsertLineItemsOptions type, and
// insertLineItemsForTransaction. The two INSERT blocks and every $N param
// position are byte-for-byte unchanged. No SQL, no logic, no signature
// changes. The original public surface is re-exported from the
// helpers-charge.ts barrel so callers keep importing from there.

import type { PoolClient } from "pg";
import {
  ChargeValidationError,
  type ChargeLineInput,
  type ValidUnit,
} from "./validate.js";

function intervalSqlFor(unit: ValidUnit): string {
  if (unit === "hour") return "make_interval(hours => $8)";
  if (unit === "day") return "make_interval(days => $8)";
  return "make_interval(months => $8)";
}

// Confirms a financial account / client / transaction row exists in this workspace.
// SOFT references (financial_account_id) and clients live in OTHER plugins'
// schemas, so we can't check them here — those are validated by the producer
// plugin at write time only insofar as the FK target exists. We only assert
// rows in THIS plugin's own `accounts` schema.
export async function assertOrgOwnsRow(
  client: PoolClient,
  table: string,
  id: number,
  workspaceId: number,
  label: string,
): Promise<void> {
  const r = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM ${table} WHERE id = $1 AND workspace_id = $2) AS exists`,
    [id, workspaceId],
  );
  if (!r.rows[0]?.exists) {
    throw new ChargeValidationError(404, `${label} not found in this workspace`);
  }
}

export interface InsertLineItemsOptions {
  anchor: "now" | "transaction_date" | "started_at";
  initialStatus: "active" | "completed";
  transactionDate?: string;
  startedAt?: string;
  // Multi-customer breakdown. Parallel array to items[]: entry i carries the
  // customer_group_id to attribute item i to (null = single-customer flow).
  perLineCustomerGroupIds?: (number | null)[];
  // Multi-customer breakdown. Parallel array to items[]: entry i overrides
  // the per-line client_id (used in groups mode so each line gets ITS group's
  // client, not the parent transaction's billed-to). null entry → walk-in.
  // Undefined entry → fall back to line.client_id ?? parentClientId.
  perLineClientIds?: (number | null)[];
  // Per-line started_at override. Parallel array to items[]: a non-null entry
  // forces that line's started_at to the given ISO; a null entry forces NOW()
  // for that line regardless of `anchor`. Undefined entry → use `anchor` for
  // that line. When the whole array is undefined, every line uses `anchor`.
  perLineStartedAt?: (string | null)[];
}

export async function insertLineItemsForTransaction(
  client: PoolClient,
  transactionId: number,
  workspaceId: number,
  parentClientId: number | null,
  items: ChargeLineInput[],
  options: InsertLineItemsOptions,
): Promise<Array<Record<string, unknown>>> {
  if (options.anchor === "transaction_date" && !options.transactionDate) {
    throw new Error("transactionDate is required for anchor='transaction_date'");
  }
  if (options.anchor === "started_at" && !options.startedAt) {
    throw new Error("startedAt is required for anchor='started_at'");
  }
  const lineItems: Array<Record<string, unknown>> = [];
  for (const [lineIdx, line] of items.entries()) {
    const hasDuration = line.duration_unit != null && line.duration_value != null;
    const totalUnits = hasDuration ? (line.duration_value as number) * line.quantity : 0;
    // Per-line client override wins in groups mode; otherwise the line's own
    // client_id, then the parent transaction's billed-to.
    const clientOverride = options.perLineClientIds?.[lineIdx];
    const lineClientId =
      clientOverride !== undefined ? clientOverride : (line.client_id ?? parentClientId ?? null);
    const customerGroupId = options.perLineCustomerGroupIds?.[lineIdx] ?? null;
    // Per-line anchor override (used by multi-customer charges so each cg
    // uses its own started_at). Non-null override → explicit ISO; explicit
    // null → NOW() (a cg with no Started at). Undefined → global `anchor`.
    const perLineOverride = options.perLineStartedAt?.[lineIdx];
    const effectiveAnchor: "now" | "transaction_date" | "started_at" =
      perLineOverride === undefined
        ? options.anchor
        : perLineOverride === null
          ? "now"
          : "started_at";
    const effectiveStartedAt =
      perLineOverride === undefined
        ? options.startedAt
        : perLineOverride === null
          ? undefined
          : perLineOverride;

    const startedAtExpr =
      effectiveAnchor === "now"
        ? "NOW()"
        : effectiveAnchor === "transaction_date"
          ? "($14::date)::timestamptz"
          : "($14::timestamptz)";
    // ends_at: only computed when the line carries a duration; otherwise NULL.
    // The no-duration branch still REFERENCES $8 (total units) so Postgres can
    // determine its type — $8 is always bound in `params`, and a param bound
    // but never referenced raises "could not determine data type of parameter
    // $8". The CASE always yields NULL and is cast to timestamptz so the value
    // assigns cleanly to the ends_at column (a bare NULLIF would infer numeric).
    const endsAtExpr = hasDuration
      ? `${startedAtExpr} + ${intervalSqlFor(line.duration_unit as ValidUnit)}`
      : "(CASE WHEN $8::numeric IS NULL THEN NULL ELSE NULL END)::timestamptz";

    const params: Array<string | number | null> = [
      transactionId, // $1
      workspaceId, // $2
      line.package_id ?? null, // $3
      line.package_variant_id ?? null, // $4
      line.description, // $5
      line.quantity, // $6
      line.unit_price, // $7
      totalUnits, // $8 — used inside make_interval
      line.duration_value ?? null, // $9
      line.duration_unit ?? null, // $10
      lineClientId, // $11
      options.initialStatus, // $12
      customerGroupId, // $13
    ];
    if (effectiveAnchor === "transaction_date") {
      params.push(options.transactionDate as string); // $14
    } else if (effectiveAnchor === "started_at") {
      params.push(effectiveStartedAt as string); // $14
    }

    const liResult = await client.query(
      `INSERT INTO accounts.transaction_line_items
         (transaction_id, workspace_id, package_id, package_variant_id,
          description, quantity, unit_price,
          duration_value, duration_unit, started_at, ends_at, status,
          client_id, customer_group_id)
       VALUES ($1, $2, $3, $4,
               $5, $6, $7,
               $9, $10, ${startedAtExpr},
               ${endsAtExpr},
               $12,
               $11, $13)
       RETURNING *`,
      params,
    );
    lineItems.push(liResult.rows[0]);
  }
  return lineItems;
}
