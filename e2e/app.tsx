/* @refresh reload */
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import Modal from "../src/components/base/Modal";
import DatePicker from "../src/components/base/DatePicker";
import { DataTable, type DataTableColumn } from "../src/components/base/DataTable";
import ComboBox from "../src/components/composite/ComboBox";
import SearchableSelect, {
  type SearchableOption,
} from "../src/components/composite/SearchableSelect";
import BadgeSelect from "../src/components/base/BadgeSelect";
import PaymentAccountPicker from "../src/components/composite/PaymentAccountPicker";
import VoucherPicker from "../src/components/composite/VoucherPicker";
import MentionTextarea from "../src/components/composite/MentionTextarea";
import AddAttachmentTile from "../src/components/base/AddAttachmentTile";
import Store from "lucide-solid/icons/store";

// Minimal test page that renders ksui components for Playwright e2e.
// Each section is a self-contained component with data-testid markers
// that the Playwright tests target.

// PaymentAccountPicker fetches its own list on mount; this harness has no
// backend, so stub the one endpoint it needs to exercise the popup (a
// real empty-state trigger stays disabled and never opens).
const realFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/financial-accounts")) {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: [
            { id: 1, name: "Main Cash", type: "cash" },
            { id: 2, name: "BPI Checking", type: "bank" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  }
  return realFetch(input, init);
};

type Row = { id: number; name: string; amount: number };

const COLUMNS: DataTableColumn<Row>[] = [
  { data: "name" },
  { data: "amount", orderable: true },
];

const DATA: Row[] = [
  { id: 1, name: "Alpha", amount: 100 },
  { id: 2, name: "Beta", amount: 200 },
  { id: 3, name: "Gamma", amount: 300 },
];

function ModalSection() {
  const [open, setOpen] = createSignal(false);
  return (
    <section data-testid="modal-section">
      <h2>Modal</h2>
      <button data-testid="modal-open" onClick={() => setOpen(true)}>Open Modal</button>
      {open() && (
        <Modal onClose={() => setOpen(false)}>
          <div data-testid="modal-content">
            <p>Modal body</p>
            <button data-testid="modal-close" onClick={() => setOpen(false)}>Close</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function DatePickerSection() {
  const [date, setDate] = createSignal<string | null>(null);
  return (
    <section data-testid="datepicker-section">
      <h2>DatePicker</h2>
      <DatePicker value={date()} onChange={setDate} />
      <p data-testid="datepicker-value">{date() ?? "none"}</p>
    </section>
  );
}

function DataTableSection() {
  return (
    <section data-testid="datatable-section">
      <h2>DataTable</h2>
      <DataTable columns={COLUMNS} data={DATA} />
    </section>
  );
}

function ComboBoxSection() {
  const [selected, setSelected] = createSignal<{ id: number; name: string } | null>(null);
  return (
    <section data-testid="combobox-section">
      <h2>ComboBox</h2>
      <ComboBox
        selected={selected()}
        onChange={setSelected}
        search={async () => [
          { id: 1, name: "Client A" },
          { id: 2, name: "Client B" },
        ]}
        idOf={(c) => c.id}
        labelOf={(c) => c.name}
        icon={Store}
        noun="client"
        testIdPrefix="combo-box"
      />
    </section>
  );
}

const SEARCHABLE_OPTIONS: SearchableOption[] = [
  { value: "a", label: "Option A" },
  { value: "b", label: "Option B" },
];

function SearchableSelectSection() {
  const [value, setValue] = createSignal<string | number | null>(null);
  return (
    <section data-testid="searchableselect-section">
      <h2>SearchableSelect</h2>
      <SearchableSelect
        value={value()}
        options={SEARCHABLE_OPTIONS}
        onChange={(next) => setValue(next?.value ?? null)}
        triggerTestId="searchable-select-trigger"
      />
    </section>
  );
}

function BadgeSelectSection() {
  const [value, setValue] = createSignal("open");
  return (
    <section data-testid="badgeselect-section">
      <h2>BadgeSelect</h2>
      <BadgeSelect
        value={value()}
        options={[
          { value: "open", label: "Open" },
          { value: "closed", label: "Closed" },
        ]}
        onChange={setValue}
        testId="badge-select-trigger"
      />
    </section>
  );
}

function PaymentAccountPickerSection() {
  const [selected, setSelected] = createSignal<Parameters<
    typeof PaymentAccountPicker
  >[0]["selected"]>(null);
  return (
    <section data-testid="paymentaccountpicker-section">
      <h2>PaymentAccountPicker</h2>
      <PaymentAccountPicker selected={selected()} onChange={setSelected} />
    </section>
  );
}

function VoucherPickerSection() {
  const [selected, setSelected] = createSignal<Parameters<typeof VoucherPicker>[0]["selected"]>(
    null,
  );
  return (
    <section data-testid="voucherpicker-section">
      <h2>VoucherPicker</h2>
      <VoucherPicker selected={selected()} onChange={setSelected} subtotal={100} packageIds={[]} />
    </section>
  );
}

function MentionTextareaSection() {
  const [value, setValue] = createSignal("");
  return (
    <section data-testid="mentiontextarea-section">
      <h2>MentionTextarea</h2>
      <MentionTextarea value={value()} setValue={setValue} placeholder="Type @ to mention" />
    </section>
  );
}

function AddAttachmentTileSection() {
  return (
    <section data-testid="addattachmenttile-section">
      <h2>AddAttachmentTile</h2>
      <AddAttachmentTile uploading={false} onPickFile={() => {}} onPickCamera={() => {}} />
    </section>
  );
}

// Reproduces the real bug scenario: a picker opened WHILE inside Modal's
// default variant (a native <dialog>), which promotes its own content to the
// top layer — an ordinary z-index popup can never out-paint that.
function InModalDatePickerSection() {
  const [open, setOpen] = createSignal(false);
  const [date, setDate] = createSignal<string | null>(null);
  return (
    <section data-testid="in-modal-datepicker-section">
      <h2>DatePicker inside Modal (dialog top-layer case)</h2>
      <button data-testid="in-modal-open" onClick={() => setOpen(true)}>
        Open Modal with DatePicker
      </button>
      {open() && (
        <Modal onClose={() => setOpen(false)}>
          <div data-testid="in-modal-content">
            <DatePicker value={date()} onChange={setDate} />
          </div>
        </Modal>
      )}
    </section>
  );
}

function App() {
  return (
    <>
      <h1>ksui e2e</h1>
      <ModalSection />
      <DatePickerSection />
      <DataTableSection />
      <ComboBoxSection />
      <SearchableSelectSection />
      <BadgeSelectSection />
      <PaymentAccountPickerSection />
      <VoucherPickerSection />
      <MentionTextareaSection />
      <AddAttachmentTileSection />
      <InModalDatePickerSection />
    </>
  );
}

render(() => <App />, document.getElementById("app")!);
