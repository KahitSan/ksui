// example-start
import { NotFound } from "@kahitsan/ksui";

export default function NotFoundBasic() {
  // NotFound is a domain-free centered empty-state. Every string defaults to a
  // generic 404 but is overridable; the action defaults to a self-styled
  // button driven by onButtonClick (or href for an anchor). Here min-h-screen
  // is neutralized with a wrapper so the variants render inline in the docs.
  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "2rem",
      }}
    >
      <div style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
        <span style={{ "font-size": "0.85rem", opacity: 0.8 }}>Default 404</span>
        <NotFound
          class="!min-h-0 py-8"
          onButtonClick={() => alert("go back clicked")}
        />
      </div>

      <div style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
        <span style={{ "font-size": "0.85rem", opacity: 0.8 }}>Custom copy + logo slot</span>
        <NotFound
          class="!min-h-0 py-8"
          logo={
            <div
              style={{
                width: "3rem",
                height: "3rem",
                "border-radius": "0.75rem",
                background: "rgba(201, 169, 97, 0.2)",
              }}
            />
          }
          title=""
          heading="No results found"
          message="Try adjusting your filters or search terms."
          buttonText="Clear filters"
          onButtonClick={() => alert("clear filters clicked")}
        />
      </div>

      <div style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
        <span style={{ "font-size": "0.85rem", opacity: 0.8 }}>Anchor action via href</span>
        <NotFound class="!min-h-0 py-8" href="#/" buttonText="Back to docs home" />
      </div>

      <div style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
        <span style={{ "font-size": "0.85rem", opacity: 0.8 }}>No button</span>
        <NotFound class="!min-h-0 py-8" heading="Coming soon" message="This page is not ready yet." hideButton />
      </div>
    </div>
  );
}
