import { type JSX } from "solid-js";

// Tiny label-wrapper used throughout the transaction create/edit form: a stacked
// label above its control. Stateless — props only.
export default function FormField(props: { label: string; children: JSX.Element }) {
  return (
    <div>
      <label class="block text-xs text-zinc-500 mb-1">{props.label}</label>
      {props.children}
    </div>
  );
}
