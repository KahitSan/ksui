// example-start
import { MarkdownNotes } from "@kahitsan/ksui";

export default function MarkdownNotesBasic() {
  const notes = [
    "**Bold** and *italic* with `inline code`.",
    "",
    "A mention chip: @[Acme Co](client:1) renders inline.",
    "",
    "- first bullet",
    "- second bullet",
  ].join("\n");
  return <MarkdownNotes value={notes} />;
}
