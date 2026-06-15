// example-start
import { LiveTimer } from "@kahitsan/ksui";

export default function LiveTimerBasic() {
  const now = Date.now();
  const minutesAgo = (m: number) => new Date(now - m * 60_000);
  const minutesFromNow = (m: number) => new Date(now + m * 60_000);

  // Sample windows that land each LiveTimer in a different scenario.
  const startedFiveMinAgo = minutesAgo(5);
  const endsInTwoHours = minutesFromNow(120);
  const startsInTenMin = minutesFromNow(10);
  const endedTenMinAgo = minutesAgo(10);

  return (
    <div
      style={{
        padding: "1.5rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1rem",
        "max-width": "26rem",
      }}
    >
      {/* Open timer — started a few minutes ago, no end set, counts up. */}
      <LiveTimer startAt={startedFiveMinAgo} />

      {/* Countdown — started 5 min ago, ends in 2 hours. Color shifts
          green to amber to red as the window fills. */}
      <LiveTimer startAt={startedFiveMinAgo} endAt={endsInTwoHours} />

      {/* Countdown to start — a future booking. */}
      <LiveTimer startAt={startsInTenMin} endAt={minutesFromNow(130)} />

      {/* Overdue — the window closed 10 min ago and keeps counting past it. */}
      <LiveTimer startAt={minutesAgo(70)} endAt={endedTenMinAgo} overdue />

      {/* Completed — the window closed and we are NOT tracking overdue. */}
      <LiveTimer startAt={minutesAgo(70)} endAt={endedTenMinAgo} />

      {/* Counter-card layout — total label on the left, live countdown
          on the right. */}
      <LiveTimer startAt={startedFiveMinAgo} endAt={endsInTwoHours} totalLabel="2h total" />
    </div>
  );
}
