import { Show, type JSX } from "solid-js";
import { A } from "@solidjs/router";
import { FLAT_NAV } from "./Sidebar";

// Previous / Next footer links to walk the doc set sequentially. Pass the
// current route path; it finds the neighbours in the flattened nav order.
export function PageFooter(props: { path: string }): JSX.Element {
  const idx = () => FLAT_NAV.findIndex((i) => i.path === props.path);
  const prev = () => {
    const i = idx();
    return i > 0 ? FLAT_NAV[i - 1] : null;
  };
  const next = () => {
    const i = idx();
    return i >= 0 && i < FLAT_NAV.length - 1 ? FLAT_NAV[i + 1] : null;
  };
  return (
    <footer class="page-footer">
      <div>
        <Show when={prev()}>
          {(p) => (
            <A href={p().path} class="page-footer-link">
              {"<- "}
              {p().label}
            </A>
          )}
        </Show>
      </div>
      <div>
        <Show when={next()}>
          {(n) => (
            <A href={n().path} class="page-footer-link">
              {n().label}
              {" ->"}
            </A>
          )}
        </Show>
      </div>
    </footer>
  );
}
