// FormField is a small presentational wrapper for a labeled form control. It
// renders a label above the control, the control itself (passed as children),
// and an optional hint line below. Copied faithfully from the packages plugin
// remote UI atoms; behavior is unchanged.

import { Show } from "solid-js";
import type { JSX } from "solid-js";

export default function FormField(props: { label: string; children: JSX.Element; hint?: string }) {
  return (
    <div>
      <label class="block text-xs text-zinc-500 mb-1">{props.label}</label>
      {props.children}
      <Show when={props.hint}>
        <p class="text-[10px] text-zinc-600 mt-1">{props.hint}</p>
      </Show>
    </div>
  );
}
