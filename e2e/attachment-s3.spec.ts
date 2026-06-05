import { test, expect, type APIRequestContext } from "@playwright/test";

// S3-only attachment storage (no disk writes).
//
// Uploading an attachment must (1) put the bytes in S3-compatible object
// storage (MinIO in dev/CI, DO Spaces in prod), (2) record the public link in
// s3_link, and (3) remove the object again when the attachment is deleted.
// The fetch in step (2) goes straight at the returned s3_link with a fresh
// unauthenticated context — exactly what a browser <img src> does — so this
// fails if the server "succeeds" without the bytes actually reaching storage.
//
// Requires the dev stack to run with S3_* configured (worktree-create.sh and
// ci.yml both wire MinIO). Without it the upload route 503s by design — there
// is no silent disk fallback to hide a misconfigured environment.

const EMAIL = process.env.E2E_EMAIL || "admin@kahitsan.com";
const PASSWORD = process.env.E2E_PASSWORD || "password";

// In the standalone CI host destination_account_id is a soft ref (no FK, see
// charge-customer-groups.spec.ts), so an arbitrary positive integer charges
// fine. Against a prod-shaped database the FK to financial_accounts IS
// enforced, so prefer a real account when the financial-accounts plugin is
// mounted and fall back to the soft ref when it isn't.
const FAKE_ACCOUNT_ID = 99_002;

async function pickAccountId(
  api: APIRequestContext,
  headers: Record<string, string>,
): Promise<number> {
  const res = await api.get("/api/financial-accounts?limit=1", { headers });
  if (res.ok()) {
    const body = await res.json();
    const id = body?.data?.[0]?.id;
    if (typeof id === "number") return id;
    // Plugin mounted but the org has no accounts yet (FK is enforced here, so
    // the soft ref would bounce) — create one.
    const created = await api.post("/api/financial-accounts", {
      headers,
      data: { name: `attachment-s3 spec ${Date.now()}`, type: "cash" },
    });
    if (created.ok()) return (await created.json()).id as number;
  }
  return FAKE_ACCOUNT_ID;
}

// Smallest valid 1x1 transparent PNG.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function signIn(api: APIRequestContext): Promise<number> {
  const res = await api.post("/api/auth/sign-in/email", {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(res.status(), await res.text()).toBe(200);
  const orgsRes = await api.get("/api/organizations");
  const orgsBody = await orgsRes.json();
  const orgs = orgsBody.data ?? orgsBody;
  return orgs[0].id as number;
}

test("attachment upload stores bytes in object storage, records s3_link, and deletes with the row", async ({
  request,
  playwright,
}) => {
  const orgId = await signIn(request);
  const headers = { "X-Organization-Id": String(orgId) };

  // A transaction to attach to.
  const charge = await request.post("/api/transactions/charge", {
    headers,
    data: {
      destination_account_id: await pickAccountId(request, headers),
      items: [{ description: "attachment-s3 spec", quantity: 1, unit_price: 10 }],
    },
  });
  expect(charge.status(), await charge.text()).toBe(201);
  const txId = (await charge.json()).transaction.id as number;

  // Upload.
  const upload = await request.post(`/api/transactions/${txId}/attachments`, {
    headers,
    multipart: {
      file: { name: "receipt.png", mimeType: "image/png", buffer: PNG_BYTES },
    },
  });
  expect(upload.status(), await upload.text()).toBe(201);
  const attachment = await upload.json();

  // The row records the public link only — file_path is decommissioned.
  expect(attachment.file_path).toBeUndefined();
  expect(attachment.s3_link).toMatch(
    new RegExp(`^https?://.+/uploads/transactions/${orgId}/[0-9a-f-]+\\.png$`),
  );

  // The bytes are publicly fetchable at s3_link — fresh context, no session,
  // like a browser resolving <img src>.
  const anon = await playwright.request.newContext();
  try {
    const fetched = await anon.get(attachment.s3_link);
    expect(fetched.status(), `GET ${attachment.s3_link}`).toBe(200);
    expect((await fetched.body()).length).toBe(PNG_BYTES.length);

    // Deleting the attachment removes the object from storage too.
    const del = await request.delete(`/api/transactions/${txId}/attachments/${attachment.id}`, {
      headers,
    });
    expect(del.status()).toBe(204);
    const afterDelete = await anon.get(attachment.s3_link);
    expect(afterDelete.status(), "object should be gone after attachment delete").not.toBe(200);
  } finally {
    await anon.dispose();
  }
});

test("metadata-only POST without a file is rejected", async ({ request }) => {
  const orgId = await signIn(request);
  const headers = { "X-Organization-Id": String(orgId) };

  const charge = await request.post("/api/transactions/charge", {
    headers,
    data: {
      destination_account_id: await pickAccountId(request, headers),
      items: [{ description: "attachment-s3 spec json-path", quantity: 1, unit_price: 10 }],
    },
  });
  expect(charge.status(), await charge.text()).toBe(201);
  const txId = (await charge.json()).transaction.id as number;

  // A JSON body could previously insert a row pointing at a file that was
  // never uploaded; with S3-only storage that row would be a permanent dead
  // link, so the route now requires real multipart bytes.
  const jsonPost = await request.post(`/api/transactions/${txId}/attachments`, {
    headers,
    data: { file_name: "ghost.png", file_url: `transactions/${orgId}/ghost.png` },
  });
  expect(jsonPost.status()).toBe(400);
});
