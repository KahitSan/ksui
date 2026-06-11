// Voucher availability probe for the isolated transactions charge flow.
//
// Extracted VERBATIM from helpers-charge.ts on the existing function seam:
// tryProbeVoucher. No logic, no signature changes (only the visibility is
// widened to `export` so run-charge.ts can call it across the module split).

import type { IdentityHeader } from "../lib/peers.js";
import type { ChargePayload } from "./validate.js";

// Disambiguates "vouchers plugin absent" from "code not found" by calling the
// vouchers `validate` RPC, which returns null only when the plugin is absent.
export async function tryProbeVoucher(
  code: string,
  _organizationId: number,
  payload: ChargePayload,
  identityHeader: IdentityHeader,
): Promise<"unavailable" | "invalid"> {
  const { validateVoucher } = await import("../lib/peers.js");
  const subtotal = payload.items.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const result = await validateVoucher(
    {
      code,
      packageId: payload.items.find((l) => l.package_id != null)?.package_id ?? undefined,
      clientId: payload.client_id ?? undefined,
      subtotal,
    },
    identityHeader,
  );
  return result == null ? "unavailable" : "invalid";
}
