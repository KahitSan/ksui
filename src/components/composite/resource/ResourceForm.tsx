// The create/edit form: one control per declared field (text / textarea /
// select) on the FormField + Button shell. Form state is owned by ResourcePage
// and passed in, so one instance backs both the create and edit modals.
import { For, Show } from "solid-js";
import FormField from "../../base/FormField";
import Button from "../../base/Button";
import { INPUT_CLASS } from "../../../utils/INPUT_CLASS";
import type { ResourceUiSpec, UiField } from "./spec";


export interface ResourceFormProps {
  spec: ResourceUiSpec;
  values: Record<string, string>;
  setValue: (key: string, value: string) => void;
  error: string;
  saving: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
}

function Field(props: { spec: ResourceUiSpec; field: UiField; value: string; setValue: (v: string) => void }) {
  const f = props.field;
  const testId =
    f.type === "text" && (f as { required?: boolean }).required
      ? `${props.spec.testIdPrefix}-form-${f.key}`
      : undefined;
  return (
    <FormField label={f.label}>
      <Show when={f.type === "select"}>
        <select
          data-testid={`${props.spec.testIdPrefix}-form-${f.key}`}
          value={props.value}
          onChange={(e) => props.setValue(e.currentTarget.value)}
          class={`${INPUT_CLASS} cursor-pointer`}
          required={f.type === "select" ? f.required : undefined}
        >
          <For each={f.type === "select" ? f.options : []}>
            {(o) => <option value={o.value}>{o.label}</option>}
          </For>
        </select>
      </Show>
      <Show when={f.type === "textarea"}>
        <textarea
          value={props.value}
          onInput={(e) => props.setValue(e.currentTarget.value)}
          class={`${INPUT_CLASS} resize-none`}
          rows={f.type === "textarea" ? (f.rows ?? 3) : 3}
          placeholder={f.type === "textarea" ? f.placeholder : undefined}
        />
      </Show>
      <Show when={f.type === "text"}>
        <input
          type="text"
          data-testid={testId}
          value={props.value}
          onInput={(e) => props.setValue(e.currentTarget.value)}
          class={INPUT_CLASS}
          placeholder={f.type === "text" ? f.placeholder : undefined}
          required={f.type === "text" ? f.required : undefined}
        />
      </Show>
    </FormField>
  );
}

export function ResourceForm(props: ResourceFormProps) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit();
      }}
      class="space-y-4"
    >
      <Show when={props.error}>
        <div
          data-testid={`${props.spec.testIdPrefix}-form-error`}
          class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
        >
          {props.error}
        </div>
      </Show>

      <For each={props.spec.fields}>
        {(field) => (
          <Field
            spec={props.spec}
            field={field}
            value={props.values[field.key] ?? ""}
            setValue={(v) => props.setValue(field.key, v)}
          />
        )}
      </For>

      <div class="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
        <Button type="button" onClick={props.onCancel} intent="secondary" class="w-full sm:w-auto">
          Cancel
        </Button>
        <Button
          type="button"
          onClick={props.onSubmit}
          disabled={props.saving}
          intent="primary"
          class="gap-2 w-full sm:w-auto"
          data-testid={`${props.spec.testIdPrefix}-form-submit`}
        >
          {props.submitLabel}
        </Button>
      </div>
    </form>
  );
}
