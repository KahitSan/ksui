// example-start
import { FormField } from "@kahitsan/ksui";

export default function FormFieldBasic() {
  // FormField just wraps a control: a label on top, your control in the
  // middle, and an optional hint line below. The control here is a plain
  // styled input so you can see how the wrapper frames it.
  const inputStyle = {
    width: "100%",
    padding: "0.5rem 0.625rem",
    "border-radius": "0.5rem",
    border: "1px solid rgba(128, 128, 128, 0.35)",
    background: "transparent",
    color: "inherit",
    "font-size": "0.875rem",
  };

  return (
    <div
      style={{
        padding: "1.5rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1.25rem",
        "max-width": "22rem",
      }}
    >
      <FormField label="Full name">
        <input style={inputStyle} type="text" value="Maria Santos" readOnly />
      </FormField>

      <FormField label="Email" hint="We only use this for receipts.">
        <input style={inputStyle} type="email" value="maria@example.com" readOnly />
      </FormField>

      <FormField label="Monthly budget" hint="Amounts are in pesos.">
        <input style={inputStyle} type="text" value="15,000" readOnly />
      </FormField>
    </div>
  );
}
