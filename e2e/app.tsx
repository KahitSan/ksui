/* @refresh reload */
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import Modal from "../src/components/base/Modal";
import DatePicker from "../src/components/base/DatePicker";
import { DataTable, type DataTableColumn } from "../src/components/base/DataTable";

// Minimal test page that renders ksui components for Playwright e2e.
// Each section is a self-contained component with data-testid markers
// that the Playwright tests target.

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

function App() {
  return (
    <>
      <h1>ksui e2e</h1>
      <ModalSection />
      <DatePickerSection />
      <DataTableSection />
    </>
  );
}

render(() => <App />, document.getElementById("app")!);
