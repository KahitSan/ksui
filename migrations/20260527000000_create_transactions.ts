// Owns the `accounts` schema transaction tables.
//
// The `accounts` schema is CONSENTED-shared with the financial-accounts
// plugin: each plugin owns a disjoint set of tables inside it and never
// touches the other's. This migration creates ONLY the transaction tables
// (transactions, transaction_line_items, transaction_subcategories,
// transaction_attachments, transaction_visibility, transaction_payments,
// transaction_edits, transaction_customer_groups, transaction_customers) plus
// the supporting role-visibility / client-pool tables the routes read. It does
// NOT create accounts.financial_accounts — that belongs to financial-accounts.
//
// Isolation discipline (process-isolation model):
//   - financial_account_id / source_account_id / destination_account_id are
//     plain integer SOFT references with NO cross-plugin FK to
//     accounts.financial_accounts (that table is another plugin's, and may not
//     even exist when transactions runs standalone).
//   - created_by / updated_by / uploaded_by / edited_by / user_id are plain
//     TEXT columns with NO FK to the kernel-owned "user" table — the plugin
//     never reaches into kernel tenant/identity tables.
//   - workspace_id is a plain integer (no FK to kernel `organizations`);
//     RLS still scopes every row to its org via auth.workspace_id().
//   - client_id / package_id / package_variant_id / voucher_id are plain
//     integers (soft refs to clients/packages/vouchers plugins, resolved over
//     the kernel RPC at read/write time, never via SQL FK).
//
// Fully idempotent (CREATE SCHEMA/TABLE/INDEX IF NOT EXISTS, DROP-then-CREATE
// for constraints/policies, NOT VALID + VALIDATE for CHECKs). On a database
// that already carries these tables (the pre-plugin monolith) every statement
// no-ops; on a fresh database it builds them from scratch.

type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0001_create",
  async up({ client }: MigrationContext) {
    // CONSENTED-shared schema. IF NOT EXISTS so financial-accounts (or a prior
    // monolith migration) may have created it first; we never DROP it.
    await client.query(`CREATE SCHEMA IF NOT EXISTS accounts`);

    // ── transactions ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts.transactions (
        id SERIAL PRIMARY KEY,
        workspace_id INTEGER NOT NULL,
        category TEXT NOT NULL,
        source_account_id INTEGER,
        destination_account_id INTEGER,
        amount NUMERIC(12,2) NOT NULL,
        currency TEXT NOT NULL DEFAULT 'PHP',
        description TEXT NOT NULL,
        notes TEXT,
        transaction_date DATE NOT NULL,
        is_private BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL DEFAULT 'completed',
        is_backdated BOOLEAN NOT NULL DEFAULT FALSE,
        backdate_reason TEXT,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reference_number TEXT,
        tax_type TEXT NOT NULL DEFAULT 'vat_inclusive',
        tax_rate NUMERIC(5,2) NOT NULL DEFAULT 12.00,
        tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        subtotal NUMERIC(12,2),
        updated_by TEXT,
        client_id INTEGER,
        voucher_id INTEGER,
        discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        payable_kind TEXT,
        due_date DATE,
        cheque_number TEXT,
        pdc_status TEXT,
        subcategory TEXT,
        has_ewt BOOLEAN NOT NULL DEFAULT FALSE,
        ewt_rate NUMERIC(5,2),
        ewt_amount NUMERIC(12,2),
        payee_id INTEGER,
        notion_id TEXT,
        parent_transaction_id INTEGER,
        batch_code INTEGER
      )
    `);

    // CHECK constraints. DROP-then-ADD NOT VALID + VALIDATE so an existing
    // populated table doesn't abort the migration on pre-existing rows.
    const checks: Array<[string, string]> = [
      ["transactions_amount_check", "amount >= 0"],
      [
        "transactions_category_check",
        "category = ANY (ARRAY['expense','sale','business','payable'])",
      ],
      [
        "transactions_status_check",
        "status = ANY (ARRAY['pending','completed','voided'])",
      ],
      [
        "transactions_tax_type_check",
        "tax_type = ANY (ARRAY['vat_inclusive','vat_exclusive','vat_exempt','non_vat'])",
      ],
      [
        "transactions_payable_kind_check",
        "payable_kind IS NULL OR payable_kind = ANY (ARRAY['subscription','utility','rent','loan','tax','other'])",
      ],
      [
        "transactions_pdc_status_check",
        "pdc_status IS NULL OR pdc_status = ANY (ARRAY['issued','presented','cleared','bounced'])",
      ],
    ];
    for (const [name, expr] of checks) {
      await client.query(`ALTER TABLE accounts.transactions DROP CONSTRAINT IF EXISTS ${name}`);
      await client.query(
        `ALTER TABLE accounts.transactions ADD CONSTRAINT ${name} CHECK (${expr}) NOT VALID`,
      );
      await client.query(`ALTER TABLE accounts.transactions VALIDATE CONSTRAINT ${name}`);
    }

    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_transactions_org_date
         ON accounts.transactions (workspace_id, transaction_date DESC, id DESC)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_transactions_org_status
         ON accounts.transactions (workspace_id, status)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_transactions_parent
         ON accounts.transactions (parent_transaction_id)
        WHERE parent_transaction_id IS NOT NULL`,
    );

    // Batch-code sequence used to stamp multi-customer receipts.
    await client.query(`CREATE SEQUENCE IF NOT EXISTS accounts.transaction_batch_code_seq`);

    // ── transaction_line_items ───────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts.transaction_line_items (
        id SERIAL PRIMARY KEY,
        transaction_id INTEGER NOT NULL REFERENCES accounts.transactions(id) ON DELETE CASCADE,
        workspace_id INTEGER NOT NULL,
        package_id INTEGER,
        package_variant_id INTEGER,
        description TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price NUMERIC(12,2) NOT NULL,
        duration_value NUMERIC(10,2),
        duration_unit TEXT,
        started_at TIMESTAMPTZ,
        ends_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'completed',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        client_id INTEGER,
        customer_group_id INTEGER
      )
    `);
    const liChecks: Array<[string, string]> = [
      ["transaction_line_items_quantity_check", "quantity > 0"],
      ["transaction_line_items_unit_price_check", "unit_price >= 0"],
      [
        "transaction_line_items_duration_unit_check",
        "duration_unit IS NULL OR duration_unit = ANY (ARRAY['hour','day','month'])",
      ],
      [
        "transaction_line_items_status_check",
        "status = ANY (ARRAY['completed','active','expired','voided'])",
      ],
    ];
    for (const [name, expr] of liChecks) {
      await client.query(
        `ALTER TABLE accounts.transaction_line_items DROP CONSTRAINT IF EXISTS ${name}`,
      );
      await client.query(
        `ALTER TABLE accounts.transaction_line_items ADD CONSTRAINT ${name} CHECK (${expr}) NOT VALID`,
      );
      await client.query(
        `ALTER TABLE accounts.transaction_line_items VALIDATE CONSTRAINT ${name}`,
      );
    }
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_tli_txn ON accounts.transaction_line_items (transaction_id)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_tli_org_pkg ON accounts.transaction_line_items (workspace_id, package_id)`,
    );

    // ── transaction_subcategories (the income/expense taxonomy) ──────────
    // The monolith keeps this in the PUBLIC schema, but in the isolated plugin
    // it lives in `accounts` (on the plugin's search_path) so the plugin owns
    // it cleanly and never reaches into public. Org-global taxonomy.
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts.transaction_subcategories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        applies_to TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(
      `ALTER TABLE accounts.transaction_subcategories DROP CONSTRAINT IF EXISTS transaction_subcategories_applies_to_check`,
    );
    await client.query(
      `ALTER TABLE accounts.transaction_subcategories ADD CONSTRAINT transaction_subcategories_applies_to_check CHECK (applies_to = ANY (ARRAY['income','expense'])) NOT VALID`,
    );
    await client.query(
      `ALTER TABLE accounts.transaction_subcategories VALIDATE CONSTRAINT transaction_subcategories_applies_to_check`,
    );
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_subcat_name_applies ON accounts.transaction_subcategories (lower(name), applies_to)`,
    );
    // Seed the canonical taxonomy so a fresh install has working pickers + the
    // /charge default subcategory ('Sales - services'). Idempotent via ON
    // CONFLICT against the unique index above.
    await client.query(`
      INSERT INTO accounts.transaction_subcategories (name, applies_to, sort_order) VALUES
        ('Sales - services', 'income', 10),
        ('Sales - goods', 'income', 20),
        ('Other income', 'income', 30),
        ('Rent', 'expense', 10),
        ('Utilities', 'expense', 20),
        ('Internet', 'expense', 30),
        ('Office supplies', 'expense', 40),
        ('Salaries', 'expense', 50),
        ('Other expense', 'expense', 60)
      ON CONFLICT (lower(name), applies_to) DO NOTHING
    `);

    // ── transaction_attachments ──────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts.transaction_attachments (
        id SERIAL PRIMARY KEY,
        transaction_id INTEGER NOT NULL REFERENCES accounts.transactions(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_txn_attachments_txn ON accounts.transaction_attachments (transaction_id)`,
    );

    // ── transaction_visibility (per-user share grants for private txns) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts.transaction_visibility (
        id SERIAL PRIMARY KEY,
        transaction_id INTEGER NOT NULL REFERENCES accounts.transactions(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_visibility_unique ON accounts.transaction_visibility (transaction_id, user_id)`,
    );

    // ── transaction_visibility_role (per-role share grants) ──────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts.transaction_visibility_role (
        id SERIAL PRIMARY KEY,
        transaction_id INTEGER NOT NULL REFERENCES accounts.transactions(id) ON DELETE CASCADE,
        role_code TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_visibility_role_unique ON accounts.transaction_visibility_role (transaction_id, role_code)`,
    );

    // ── transaction_payments (settlement ledger legs) ────────────────────
    // financial_account_id is a plain integer SOFT reference to the
    // financial-accounts plugin's table — NO cross-plugin FK.
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts.transaction_payments (
        id SERIAL PRIMARY KEY,
        transaction_id INTEGER NOT NULL REFERENCES accounts.transactions(id) ON DELETE CASCADE,
        workspace_id INTEGER NOT NULL,
        financial_account_id INTEGER NOT NULL,
        amount NUMERIC(12,2) NOT NULL,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        customer_group_id INTEGER
      )
    `);
    await client.query(
      `ALTER TABLE accounts.transaction_payments DROP CONSTRAINT IF EXISTS transaction_payments_amount_check`,
    );
    await client.query(
      `ALTER TABLE accounts.transaction_payments ADD CONSTRAINT transaction_payments_amount_check CHECK (amount > 0) NOT VALID`,
    );
    await client.query(
      `ALTER TABLE accounts.transaction_payments VALIDATE CONSTRAINT transaction_payments_amount_check`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_txn_payments_txn ON accounts.transaction_payments (transaction_id)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_txn_payments_fa_org ON accounts.transaction_payments (financial_account_id, workspace_id)`,
    );

    // ── transaction_edits (append-only audit trail) ──────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts.transaction_edits (
        id BIGSERIAL PRIMARY KEY,
        transaction_id INTEGER NOT NULL REFERENCES accounts.transactions(id) ON DELETE CASCADE,
        workspace_id INTEGER NOT NULL,
        edited_by TEXT NOT NULL,
        edited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reason TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'edit'
      )
    `);
    await client.query(
      `ALTER TABLE accounts.transaction_edits DROP CONSTRAINT IF EXISTS transaction_edits_kind_check`,
    );
    await client.query(
      `ALTER TABLE accounts.transaction_edits ADD CONSTRAINT transaction_edits_kind_check CHECK (kind = ANY (ARRAY['edit','counter_edit','sales_edit','void','unvoid'])) NOT VALID`,
    );
    await client.query(
      `ALTER TABLE accounts.transaction_edits VALIDATE CONSTRAINT transaction_edits_kind_check`,
    );
    await client.query(
      `ALTER TABLE accounts.transaction_edits DROP CONSTRAINT IF EXISTS transaction_edits_reason_check`,
    );
    await client.query(
      `ALTER TABLE accounts.transaction_edits ADD CONSTRAINT transaction_edits_reason_check CHECK (length(TRIM(BOTH FROM reason)) > 0) NOT VALID`,
    );
    await client.query(
      `ALTER TABLE accounts.transaction_edits VALIDATE CONSTRAINT transaction_edits_reason_check`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_txn_edits_txn ON accounts.transaction_edits (transaction_id, edited_at DESC)`,
    );

    // ── transaction_customer_groups (multi-customer POS breakdown) ───────
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts.transaction_customer_groups (
        id SERIAL PRIMARY KEY,
        transaction_id INTEGER NOT NULL REFERENCES accounts.transactions(id) ON DELETE CASCADE,
        workspace_id INTEGER NOT NULL,
        "position" INTEGER NOT NULL DEFAULT 0,
        client_id INTEGER,
        display_name TEXT NOT NULL,
        note TEXT,
        voucher_id INTEGER,
        subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
        discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        is_payer BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    for (const [name, expr] of [
      ["transaction_customer_groups_subtotal_check", "subtotal >= 0"],
      ["transaction_customer_groups_discount_amount_check", "discount_amount >= 0"],
    ] as Array<[string, string]>) {
      await client.query(
        `ALTER TABLE accounts.transaction_customer_groups DROP CONSTRAINT IF EXISTS ${name}`,
      );
      await client.query(
        `ALTER TABLE accounts.transaction_customer_groups ADD CONSTRAINT ${name} CHECK (${expr}) NOT VALID`,
      );
      await client.query(
        `ALTER TABLE accounts.transaction_customer_groups VALIDATE CONSTRAINT ${name}`,
      );
    }
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_txn_customer_groups_txn ON accounts.transaction_customer_groups (transaction_id)`,
    );

    // ── transaction_customers (explicit client pool per booking) ─────────
    // The monolith calls this table transaction_clients; the task names it
    // transaction_customers. Created here under the task's name; the routes
    // reference accounts.transaction_customers.
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts.transaction_customers (
        transaction_id INTEGER NOT NULL REFERENCES accounts.transactions(id) ON DELETE CASCADE,
        client_id INTEGER NOT NULL,
        workspace_id INTEGER NOT NULL,
        "position" INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (transaction_id, client_id)
      )
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_txn_customers_txn ON accounts.transaction_customers (transaction_id)`,
    );

    // ── RLS safety net on every org-scoped table ─────────────────────────
    // The explicit workspace_id filter in every route is the gate; these
    // policies are defense in depth. Tables without an workspace_id column
    // (visibility, visibility_role, attachments) scope through the parent
    // transaction's policy via the FK + the app-level join, so they are left
    // without RLS here (matching the monolith, which gates them on the parent).
    const orgScopedTables = [
      "transactions",
      "transaction_line_items",
      "transaction_payments",
      "transaction_edits",
      "transaction_customer_groups",
      "transaction_customers",
    ];
    for (const t of orgScopedTables) {
      await client.query(`ALTER TABLE accounts.${t} ENABLE ROW LEVEL SECURITY`);
      await client.query(`DROP POLICY IF EXISTS ${t}_org_isolation ON accounts.${t}`);
      await client.query(`CREATE POLICY ${t}_org_isolation ON accounts.${t}
        USING (auth.is_superuser() OR workspace_id = auth.workspace_id())
        WITH CHECK (auth.is_superuser() OR workspace_id = auth.workspace_id())`);
    }
  },
  async down({ client }: MigrationContext) {
    // CASCADE drops the transaction child tables that FK back to transactions.
    // Leaves the shared `accounts` schema and financial-accounts' tables alone.
    await client.query(`DROP TABLE IF EXISTS accounts.transaction_customers CASCADE`);
    await client.query(`DROP TABLE IF EXISTS accounts.transaction_customer_groups CASCADE`);
    await client.query(`DROP TABLE IF EXISTS accounts.transaction_edits CASCADE`);
    await client.query(`DROP TABLE IF EXISTS accounts.transaction_payments CASCADE`);
    await client.query(`DROP TABLE IF EXISTS accounts.transaction_visibility_role CASCADE`);
    await client.query(`DROP TABLE IF EXISTS accounts.transaction_visibility CASCADE`);
    await client.query(`DROP TABLE IF EXISTS accounts.transaction_attachments CASCADE`);
    await client.query(`DROP TABLE IF EXISTS accounts.transaction_subcategories CASCADE`);
    await client.query(`DROP TABLE IF EXISTS accounts.transaction_line_items CASCADE`);
    await client.query(`DROP TABLE IF EXISTS accounts.transactions CASCADE`);
    await client.query(`DROP SEQUENCE IF EXISTS accounts.transaction_batch_code_seq`);
  },
};

export default migration;
