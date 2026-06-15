// Docs-only fetch mock.
//
// The ERP picker components and the accounts index call real backend routes
// (/api/clients, /api/clients/:id, /api/vouchers, /api/financial-accounts).
// The docs site has no backend, so those requests would 404 and the pickers
// would render empty. This intercepts window.fetch for those /api/ paths and
// returns realistic sample data with the exact JSON shape each component
// parses. Anything that is not a mocked /api/ path falls through to the real
// fetch. Imported once before the app mounts in src/index.tsx.

interface ClientOption {
  id: number;
  name_raw: string;
  email?: string | null;
  phone?: string | null;
}

interface VoucherOption {
  id: number;
  code: string;
  type: "percentage" | "fixed_amount" | "free";
  value: string | number | null;
  max_discount_amount: string | number | null;
  applicable_packages: number[] | null;
  minimum_purchase: string | number;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
}

interface PaymentAccountOption {
  id: number;
  name: string;
  type: string;
  icon?: string | null;
  color?: string | null;
  s3_link?: string | null;
}

const SAMPLE_CLIENTS: ClientOption[] = [
  { id: 1, name_raw: "Acme Co", email: "billing@acme.example", phone: "0917 555 0101" },
  { id: 2, name_raw: "Brightline Studio", email: "hello@brightline.example", phone: "0917 555 0102" },
  { id: 3, name_raw: "Carter & Sons", email: null, phone: "0917 555 0103" },
  { id: 4, name_raw: "Della Foods", email: "orders@della.example", phone: null },
  { id: 5, name_raw: "Evergreen Lab", email: null, phone: null },
];

const SAMPLE_VOUCHERS: VoucherOption[] = [
  {
    id: 1,
    code: "WELCOME10",
    type: "percentage",
    value: 10,
    max_discount_amount: 500,
    applicable_packages: null,
    minimum_purchase: 0,
    valid_from: null,
    valid_until: null,
    is_active: true,
  },
  {
    id: 2,
    code: "SAVE200",
    type: "fixed_amount",
    value: 200,
    max_discount_amount: null,
    applicable_packages: null,
    minimum_purchase: 1000,
    valid_from: null,
    valid_until: null,
    is_active: true,
  },
  {
    id: 3,
    code: "FREESHIP",
    type: "free",
    value: null,
    max_discount_amount: null,
    applicable_packages: null,
    minimum_purchase: 0,
    valid_from: null,
    valid_until: null,
    is_active: true,
  },
];

const SAMPLE_ACCOUNTS: PaymentAccountOption[] = [
  { id: 1, name: "Cash on Hand", type: "cash", icon: "Wallet", color: "#16a34a", s3_link: null },
  { id: 2, name: "BPI Checking", type: "bank", icon: "Landmark", color: "#2563eb", s3_link: null },
  { id: 3, name: "GCash", type: "ewallet", icon: "Smartphone", color: "#0ea5e9", s3_link: null },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function pathOf(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw, window.location.origin).pathname;
  } catch {
    return raw;
  }
}

function searchOf(input: RequestInfo | URL): URLSearchParams {
  const raw =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw, window.location.origin).searchParams;
  } catch {
    return new URLSearchParams();
  }
}

export function installDocsFetchMock(): void {
  const realFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = pathOf(input);

    // GET /api/clients/:id  -> a single client object
    const clientByIdMatch = path.match(/^\/api\/clients\/(\d+)$/);
    if (clientByIdMatch) {
      const id = Number.parseInt(clientByIdMatch[1], 10);
      const client = SAMPLE_CLIENTS.find((c) => c.id === id);
      return Promise.resolve(client ? json(client) : json({ error: "Not found" }, 404));
    }

    // GET /api/clients?search=&status=active  -> { data: ClientOption[] }
    if (path === "/api/clients") {
      const search = (searchOf(input).get("search") || "").trim().toLowerCase();
      const data = search
        ? SAMPLE_CLIENTS.filter((c) => c.name_raw.toLowerCase().includes(search))
        : SAMPLE_CLIENTS;
      return Promise.resolve(json({ data }));
    }

    // GET /api/vouchers  -> { data: VoucherOption[] }
    if (path === "/api/vouchers") {
      return Promise.resolve(json({ data: SAMPLE_VOUCHERS }));
    }

    // GET /api/financial-accounts  -> { data: PaymentAccountOption[] }
    if (path === "/api/financial-accounts") {
      const status = searchOf(input).get("status");
      // Sample data is all active, so an archived query returns an empty list.
      const data = status === "archived" ? [] : SAMPLE_ACCOUNTS;
      return Promise.resolve(json({ data }));
    }

    return realFetch(input as RequestInfo, init);
  };
}
