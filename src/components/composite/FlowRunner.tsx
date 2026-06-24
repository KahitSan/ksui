// U7 — FlowRunner (Vision §9): a client renderer for a SERVER-DRIVEN node graph.
// It renders the current UI-effect node (form / display / choice / message /
// terminal) and POSTs each step to the host-injected `advance(state, input)`
// resolver — which owns ALL authority, data and branching. The client never
// decides the graph: it shows the node, collects input, calls `advance`, and
// renders whatever node comes back, stopping at a terminal node.
//
// Composite because it composes the node model (utils/flow) with loading/terminal/
// error UI. Self-contained CSS (ksui-fr-* unscoped classes + CSS custom props);
// no Tailwind, no host-brand classes (standalone-library rule).

import type { Component, JSX } from "solid-js";
import { For, Match, Show, Switch, createSignal } from "solid-js";
import {
  collectsInput,
  formNodeInput,
  isTerminal,
  missingRequired,
  type FlowAdvance,
  type FlowChoiceNode,
  type FlowDisplayNode,
  type FlowFormNode,
  type FlowInput,
  type FlowMessageNode,
  type FlowNode,
  type FlowState,
} from "../../utils/flow";

const STYLE_ID = "ksui-flow-runner-style";

function ensureStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.ksui-fr{display:flex;flex-direction:column;gap:0.875rem;color:var(--ksui-fr-fg,inherit);}
.ksui-fr-title{font-size:0.95rem;font-weight:600;margin:0;}
.ksui-fr-prompt,.ksui-fr-body{font-size:0.85rem;opacity:0.85;margin:0;}
.ksui-fr-field{display:flex;flex-direction:column;gap:0.25rem;}
.ksui-fr-label{font-size:0.78rem;font-weight:500;}
.ksui-fr-input{padding:0.5rem 0.625rem;border-radius:0.5rem;border:1px solid var(--ksui-fr-border,rgba(255,255,255,0.15));background:var(--ksui-fr-input-bg,rgba(255,255,255,0.04));color:inherit;font-size:0.85rem;}
.ksui-fr-actions{display:flex;gap:0.5rem;flex-wrap:wrap;}
.ksui-fr-btn{padding:0.5rem 0.875rem;border-radius:0.5rem;border:1px solid var(--ksui-fr-border,rgba(255,255,255,0.15));background:var(--ksui-fr-btn-bg,rgba(255,255,255,0.06));color:inherit;font-size:0.82rem;cursor:pointer;}
.ksui-fr-btn:disabled{opacity:0.5;cursor:not-allowed;}
.ksui-fr-btn.primary{background:var(--ksui-fr-primary,#c9a961);color:var(--ksui-fr-primary-fg,#18181b);border-color:transparent;}
.ksui-fr-btn.danger{background:var(--ksui-fr-danger,#ef4444);color:#fff;border-color:transparent;}
.ksui-fr-msg{padding:0.625rem 0.75rem;border-radius:0.5rem;font-size:0.85rem;}
.ksui-fr-msg.info{background:rgba(59,130,246,0.1);}
.ksui-fr-msg.success{background:rgba(34,197,94,0.12);}
.ksui-fr-msg.error{background:rgba(239,68,68,0.12);}
.ksui-fr-error{padding:0.625rem 0.75rem;border-radius:0.5rem;font-size:0.82rem;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);}
.ksui-fr-loading{font-size:0.82rem;opacity:0.7;}
`;
  document.head.appendChild(style);
}

export interface FlowRunnerProps {
  /** The first node the server handed the client (the flow entry). */
  initialNode: FlowNode;
  /**
   * Host-injected resolver — owns authority, data and branching (§9). Given the
   * opaque state and the step input it returns the next node. ksui never decides.
   */
  advance: FlowAdvance;
  /**
   * Opaque flow state threaded into each `advance` call. The client never reads
   * into it; the server correlates the step from it.
   */
  state?: FlowState;
  /** Fired when a terminal node is reached (host closes the flow / refreshes). */
  onComplete?: (node: FlowNode) => void;
  /** Fired when the user cancels a cancelable form (host takes the onCancel edge). */
  onCancel?: () => void;
  /** Optional test id prefix. */
  testId?: string;
}

export const FlowRunner: Component<FlowRunnerProps> = (props) => {
  ensureStyle();
  const [node, setNode] = createSignal<FlowNode>(props.initialNode);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  // Form field values for the current form node (reset whenever the node changes).
  const [values, setValues] = createSignal<Record<string, unknown>>({});

  const tid = (s: string) => (props.testId ? `${props.testId}-${s}` : undefined);

  // Submit `input` to the server resolver and swap in the node it returns. A
  // rejected `advance` surfaces as an error state — the client never invents the
  // next node, so a failure halts on the current step (re-submittable).
  const submit = async (input: FlowInput) => {
    setError(null);
    setBusy(true);
    try {
      const next = await props.advance(props.state, input);
      setNode(next);
      setValues({});
      if (isTerminal(next)) props.onComplete?.(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const setField = (key: string, v: unknown) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  const submitForm = (n: FlowFormNode) => {
    if (missingRequired(n, values()).length > 0) return; // UX gate; server re-validates
    void submit(formNodeInput(n, values()));
  };

  return (
    <div class="ksui-fr" data-testid={tid("root")}>
      <Show when={error()}>
        <div class="ksui-fr-error" role="alert" data-testid={tid("error")}>
          {error()}
        </div>
      </Show>

      <Switch>
        <Match when={node().kind === "form"}>
          {renderForm(node() as FlowFormNode, values(), setField, () => submitForm(node() as FlowFormNode), () => props.onCancel?.(), busy(), tid)}
        </Match>
        <Match when={node().kind === "display"}>
          {renderDisplay(node() as FlowDisplayNode, () => void submit(null), busy(), tid)}
        </Match>
        <Match when={node().kind === "choice"}>
          {renderChoice(node() as FlowChoiceNode, (value) => void submit({ value }), busy(), tid)}
        </Match>
        <Match when={node().kind === "message"}>
          {renderMessage(node() as FlowMessageNode, () => void submit(null), busy(), tid)}
        </Match>
        <Match when={node().kind === "terminal"}>
          {renderTerminal(node(), tid)}
        </Match>
      </Switch>

      <Show when={busy()}>
        <span class="ksui-fr-loading" data-testid={tid("loading")}>Working…</span>
      </Show>
    </div>
  );
};

// ---- node renderers (plain functions returning JSX; no per-node reactivity needed) ----

function renderForm(
  n: FlowFormNode,
  values: Record<string, unknown>,
  setField: (k: string, v: unknown) => void,
  onSubmit: () => void,
  onCancel: () => void,
  busy: boolean,
  tid: (s: string) => string | undefined,
): JSX.Element {
  const blocked = missingRequired(n, values).length > 0;
  return (
    <div class="ksui-fr" data-testid={tid("form")}>
      <Show when={n.title}>
        <h3 class="ksui-fr-title">{n.title}</h3>
      </Show>
      <For each={n.fields}>
        {(f) => (
          <div class="ksui-fr-field">
            <label class="ksui-fr-label" for={`ksui-fr-${f.key}`}>
              {f.label}
              {f.required ? " *" : ""}
            </label>
            <Switch
              fallback={
                <input
                  id={`ksui-fr-${f.key}`}
                  class="ksui-fr-input"
                  type={f.type === "number" ? "number" : "text"}
                  placeholder={f.placeholder}
                  data-testid={tid(`field-${f.key}`)}
                  onInput={(e) => setField(f.key, e.currentTarget.value)}
                />
              }
            >
              <Match when={f.type === "textarea"}>
                <textarea
                  id={`ksui-fr-${f.key}`}
                  class="ksui-fr-input"
                  placeholder={f.placeholder}
                  data-testid={tid(`field-${f.key}`)}
                  onInput={(e) => setField(f.key, e.currentTarget.value)}
                />
              </Match>
              <Match when={f.type === "select"}>
                <select
                  id={`ksui-fr-${f.key}`}
                  class="ksui-fr-input"
                  data-testid={tid(`field-${f.key}`)}
                  onChange={(e) => setField(f.key, e.currentTarget.value)}
                >
                  <option value="" />
                  <For each={f.options ?? []}>
                    {(o) => <option value={o.value}>{o.label}</option>}
                  </For>
                </select>
              </Match>
              <Match when={f.type === "toggle"}>
                <input
                  id={`ksui-fr-${f.key}`}
                  type="checkbox"
                  data-testid={tid(`field-${f.key}`)}
                  onChange={(e) => setField(f.key, e.currentTarget.checked)}
                />
              </Match>
            </Switch>
          </div>
        )}
      </For>
      <div class="ksui-fr-actions">
        <button
          type="button"
          class="ksui-fr-btn primary"
          disabled={busy || blocked}
          data-testid={tid("submit")}
          onClick={onSubmit}
        >
          {n.submitLabel ?? "Submit"}
        </button>
        <Show when={n.cancelable}>
          <button
            type="button"
            class="ksui-fr-btn"
            disabled={busy}
            data-testid={tid("cancel")}
            onClick={onCancel}
          >
            Cancel
          </button>
        </Show>
      </div>
    </div>
  );
}

function renderDisplay(
  n: FlowDisplayNode,
  onContinue: () => void,
  busy: boolean,
  tid: (s: string) => string | undefined,
): JSX.Element {
  return (
    <div class="ksui-fr" data-testid={tid("display")}>
      <Show when={n.title}>
        <h3 class="ksui-fr-title">{n.title}</h3>
      </Show>
      {/* Server-provided, already-sanitized read-only text. Rendered as text, not
          innerHTML, so the client never trusts markup it didn't sanitize. */}
      <p class="ksui-fr-body">{n.body}</p>
      <div class="ksui-fr-actions">
        <button
          type="button"
          class="ksui-fr-btn primary"
          disabled={busy}
          data-testid={tid("continue")}
          onClick={onContinue}
        >
          {n.continueLabel ?? "Continue"}
        </button>
      </div>
    </div>
  );
}

function renderChoice(
  n: FlowChoiceNode,
  onPick: (value: string) => void,
  busy: boolean,
  tid: (s: string) => string | undefined,
): JSX.Element {
  return (
    <div class="ksui-fr" data-testid={tid("choice")}>
      <Show when={n.title}>
        <h3 class="ksui-fr-title">{n.title}</h3>
      </Show>
      <Show when={n.prompt}>
        <p class="ksui-fr-prompt">{n.prompt}</p>
      </Show>
      <div class="ksui-fr-actions">
        <For each={n.options}>
          {(o) => (
            <button
              type="button"
              class={`ksui-fr-btn ${o.intent ?? ""}`}
              disabled={busy}
              data-testid={tid(`choice-${o.value}`)}
              onClick={() => onPick(o.value)}
            >
              {o.label}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

function renderMessage(
  n: FlowMessageNode,
  onAck: () => void,
  busy: boolean,
  tid: (s: string) => string | undefined,
): JSX.Element {
  return (
    <div class="ksui-fr" data-testid={tid("message")}>
      <div class={`ksui-fr-msg ${n.tone ?? "info"}`} role="status">
        {n.text}
      </div>
      <div class="ksui-fr-actions">
        <button
          type="button"
          class="ksui-fr-btn"
          disabled={busy}
          data-testid={tid("ack")}
          onClick={onAck}
        >
          {n.ackLabel ?? "OK"}
        </button>
      </div>
    </div>
  );
}

function renderTerminal(n: FlowNode, tid: (s: string) => string | undefined): JSX.Element {
  if (!isTerminal(n)) return <></>;
  return (
    <div class="ksui-fr" data-testid={tid("terminal")}>
      <Show when={n.title}>
        <h3 class="ksui-fr-title">{n.title}</h3>
      </Show>
      <Show when={n.message}>
        <div class={`ksui-fr-msg ${n.tone ?? "success"}`} role="status">
          {n.message}
        </div>
      </Show>
    </div>
  );
}

export default FlowRunner;
