// The payees page authored via the ksui RouteSpec builders, compiled down to a
// ResourceUiSpec by ksui's routeToResourceSpec (the lowering-parity tests live
// in ksui alongside the builders).
import { Cell, action, col, defineRoute, setting, table, defineForm, field } from "@kahitsan/ksui";

const KIND_LABELS = { vendor: "Vendor", customer: "Customer", both: "Both" } as const;

export const payeesRoute = defineRoute({
  basePath: "/api/payees",
  title: "Payees",
  subtitle: "Vendors, customers, and billers used on transactions",
  softDeleteField: "is_active",
  testIdPrefix: "payees",
  permissions: {
    view: "payees.view",
    edit: ["payees.create", "payees.edit"],
    delete: "payees.delete",
  },

  header: {
    actions: [action("new", { label: "Add Payee", flow: "create" })],
  },

  toolbar: {
    search: { placeholder: "Search by name...", fields: ["name"] },
    filters: [
      {
        type: "segmented",
        param: "status",
        options: ["active", "archived", "all"],
        default: "active",
        testIdPrefix: "payees-status",
      },
      {
        type: "select",
        param: "kind",
        default: "",
        options: [
          { value: "", label: "All kinds" },
          { value: "vendor", label: "Vendors" },
          { value: "customer", label: "Customers" },
          { value: "both", label: "Both" },
        ],
      },
    ],
  },

  view: table({
    columns: [
      col("name", { title: "Name", orderable: true, render: Cell.Title }),
      col("kind", { title: "Kind", orderable: true, render: Cell.Enum(KIND_LABELS) }),
      col("default_subcategory", { title: "Default category", render: Cell.Text({ muted: true }) }),
      col("is_active", {
        title: "Status",
        orderable: true,
        render: Cell.Status({
          active: { label: "Active", tone: "success" },
          inactive: { label: "Archived", tone: "warning" },
        }),
      }),
    ],
  }),

  form: defineForm({
    fields: {
      name: field.text({
        label: "Name *",
        required: true,
        transform: "trim",
        placeholder: 'e.g. "MERALCO" or "Jollibee Magsaysay"',
      }),
      kind: field.select({
        label: "Kind",
        default: "vendor",
        options: [
          { value: "vendor", label: "Vendor (Paid to / Payable to)" },
          { value: "customer", label: "Customer (Received from)" },
          { value: "both", label: "Both" },
        ],
      }),
      default_subcategory: field.text({
        label: "Default category",
        transform: "trimOrNull",
        placeholder: 'e.g. "Internet" -- prefilled when this payee is picked',
      }),
      notes: field.textarea({
        label: "Notes",
        transform: "trimOrNull",
        rows: 3,
        placeholder: "Internal notes about this payee...",
      }),
    },
    submit: { create: "payees.create", update: "payees.update" },
  }),

  detail: [
    { label: "Name", value: { type: "field", key: "name" } },
    { label: "Kind", value: { type: "enum", key: "kind", labels: KIND_LABELS } },
    { label: "Default category", value: { type: "field", key: "default_subcategory" } },
    { label: "Notes", value: { type: "field", key: "notes" } },
    { label: "Status", value: { type: "status", key: "is_active", active: "Active", inactive: "Archived" } },
    { label: "Created", value: { type: "datetime", key: "created_at" } },
    { label: "Updated", value: { type: "datetime", key: "updated_at" } },
  ],

  settings: { pageSize: setting.number({ default: 25 }) },

  labels: {
    add: "Add Payee",
    createTitle: "New Payee",
    createSubmit: "Create Payee",
    editTitle: "Edit Payee",
    editSubmit: "Save Changes",
    titleField: "name",
    searchPlaceholder: "Search by name...",
    empty: "No payees yet. Click 'Add Payee' to create one.",
    noResults: "No payees match your search.",
    createErrorFallback: "Failed to create payee",
    updateErrorFallback: "Failed to update payee",
    networkError: "Network error",
    archiveTitle: "Archive this payee?",
    archiveMessage: "It will be hidden from the active list but kept on past transactions.",
    archiveConfirm: "Archive",
  },
});
