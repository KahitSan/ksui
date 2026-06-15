import { type JSX } from "solid-js";
import LiveTimerBasic from "../examples/live-timer-basic";
import liveTimerBasicSrc from "../examples/live-timer-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function LiveTimerPage(): JSX.Element {
  return (
    <article>
      <h1>LiveTimer</h1>
      <p class="lead">
        A realtime progress pill that ticks on its own. Give it a <code>startAt</code> and an optional{" "}
        <code>endAt</code> and it picks the right look: counting down to a future start, an open timer counting up, a
        countdown with green-to-red urgency, an overdue alert, or a finished window. All LiveTimers on a page share one
        ticker, so a board full of them still runs a single interval.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { LiveTimer } from "@kahitsan/ksui";`} />
      </div>

      <h2>Scenarios</h2>
      <Example
        title="Scenarios"
        description="One component, six live states: open timer, running countdown, countdown to start, overdue, completed, and the counter-card total-label layout. These tick in real time."
        render={() => <LiveTimerBasic />}
        code={liveTimerBasicSrc}
      />

      <h2>Props</h2>
      <table class="props-table">
        <thead>
          <tr>
            <th>Prop</th>
            <th>Type</th>
            <th>Default</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>startAt</code>
            </td>
            <td>
              <code>Date | string | number</code>
            </td>
            <td>required</td>
          </tr>
          <tr>
            <td>
              <code>endAt</code>
            </td>
            <td>
              <code>Date | string | number | null</code>
            </td>
            <td>
              <code>null</code> (open timer)
            </td>
          </tr>
          <tr>
            <td>
              <code>overdue</code>
            </td>
            <td>
              <code>boolean</code>
            </td>
            <td>
              <code>false</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>icon</code>
            </td>
            <td>
              <code>Component&lt;{`{ size: number; class?: string }`}&gt;</code>
            </td>
            <td>picked from scenario</td>
          </tr>
          <tr>
            <td>
              <code>label</code>
            </td>
            <td>
              <code>string | null</code>
            </td>
            <td>scenario default (<code>null</code> hides it)</td>
          </tr>
          <tr>
            <td>
              <code>hidePercentage</code>
            </td>
            <td>
              <code>boolean</code>
            </td>
            <td>scenario default</td>
          </tr>
          <tr>
            <td>
              <code>totalLabel</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>n/a (switches to left-total / right-countdown layout)</td>
          </tr>
          <tr>
            <td>
              <code>class</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>merged onto the inner ProgressBar</td>
          </tr>
        </tbody>
      </table>

      <h2>How the time ticks</h2>
      <p>
        The countdown text uses a compact format: <code>Xd Yh</code> at a day or more, <code>Xh MM:SS</code> at an hour
        or more, and <code>MM:SS</code> under an hour. Under 24 hours the ticker updates every second; further out it
        slows to once every five minutes so a far-off booking does not burn cycles.
      </p>

      <PageFooter path="/components/live-timer" />
    </article>
  );
}
