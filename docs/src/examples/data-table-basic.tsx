// example-start
import { DataTable, type DataTableColumn } from "@kahitsan/ksui";

interface Person {
  id: number;
  name: string;
  role: string;
  joined: string;
}

// Client-side mode: pass `data` and the table handles search, sort, and
// pagination in the browser — no fetchFn, no backend. (Provide `fetchFn`
// instead for server-side mode with { data, total } chunks.)
const PEOPLE: Person[] = [
  { id: 1, name: "Ada Lovelace", role: "Engineer", joined: "2021-03-12" },
  { id: 2, name: "Alan Turing", role: "Cryptographer", joined: "2020-07-01" },
  { id: 3, name: "Grace Hopper", role: "Admiral", joined: "2019-11-23" },
  { id: 4, name: "Katherine Johnson", role: "Mathematician", joined: "2022-01-09" },
  { id: 5, name: "Margaret Hamilton", role: "Engineer", joined: "2021-09-30" },
];

const columns: DataTableColumn<Person>[] = [
  { data: "name", title: "Name" },
  { data: "role", title: "Role" },
  { data: "joined", title: "Joined" },
];

export default function DataTableBasic() {
  return (
    <DataTable<Person>
      data={PEOPLE}
      columns={columns}
      pageLength={3}
      searchPlaceholder="Search people…"
      emptyMessage="No people yet."
      noResultsMessage="No people match that search."
    />
  );
}
