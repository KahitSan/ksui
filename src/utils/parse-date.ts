// Natural-language date parser + date string formatters.
//
// Ported verbatim from the host DatePicker's `parse-date.ts` so ksui's
// DatePicker carries no host dependency. Pure functions, no UI, no framework —
// depends on nothing. Lives in utils/ (not components/) because it renders
// nothing; the DatePicker component calls it.
//
// Handles: "dec 3", "december 3", "decem 3", "now", "today", "yesterday",
// "last week", "last month", "next friday", typo correction, and optional time.
// Returns { date: string (YYYY-MM-DD), time?: string (HH:MM) } or null.

export interface ParsedDate {
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM (24h)
  label?: string; // human-readable label for what was parsed
}

// ── Month names + fuzzy matching ──────────────────────────────────────────────

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

const MONTH_ABBREVS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

// Day-of-week names for "next friday" etc.
const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const WEEKDAY_ABBREVS: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

// ── Levenshtein distance (for typo correction) ───────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

/**
 * Match input against month names with typo tolerance.
 * Tries: exact prefix match first, then fuzzy match (Levenshtein ≤ 2).
 */
function matchMonth(input: string): number | null {
  const lower = input.toLowerCase();

  // Exact abbreviation
  if (MONTH_ABBREVS[lower] !== undefined) return MONTH_ABBREVS[lower];

  // Prefix match (e.g. "decem" → december, "janu" → january)
  for (let i = 0; i < MONTHS.length; i++) {
    if (MONTHS[i].startsWith(lower) && lower.length >= 3) return i;
  }

  // Fuzzy match — only if input is 4+ chars to avoid false positives
  if (lower.length >= 4) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < MONTHS.length; i++) {
      // Compare against full name and against same-length prefix
      const full = MONTHS[i];
      const prefix = full.slice(0, lower.length);
      const distFull = levenshtein(lower, full);
      const distPrefix = levenshtein(lower, prefix);
      const dist = Math.min(distFull, distPrefix);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    // Allow up to 2 edits
    if (bestDist <= 2) return bestIdx;
  }

  return null;
}

/**
 * Match input against weekday names with typo tolerance.
 */
function matchWeekday(input: string): number | null {
  const lower = input.toLowerCase();

  if (WEEKDAY_ABBREVS[lower] !== undefined) return WEEKDAY_ABBREVS[lower];

  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (WEEKDAYS[i].startsWith(lower) && lower.length >= 3) return i;
  }

  if (lower.length >= 4) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < WEEKDAYS.length; i++) {
      const full = WEEKDAYS[i];
      const prefix = full.slice(0, lower.length);
      const dist = Math.min(levenshtein(lower, full), levenshtein(lower, prefix));
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (bestDist <= 2) return bestIdx;
  }

  return null;
}

// ── Time parsing ──────────────────────────────────────────────────────────────

function parseTime(input: string): { hours: number; minutes: number } | null {
  const cleaned = input.trim().toLowerCase();
  const patterns: [RegExp, (m: RegExpMatchArray) => { hours: number; minutes: number } | null][] = [
    // 5pm, 5:30pm, 12:45am
    [
      /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/,
      (m) => {
        let h = parseInt(m[1], 10);
        const min = parseInt(m[2] || "0", 10);
        const period = m[3];
        if (period === "pm" && h !== 12) h += 12;
        if (period === "am" && h === 12) h = 0;
        return h < 24 && min < 60 ? { hours: h, minutes: min } : null;
      },
    ],
    // 17:00, 09:30
    [
      /^(\d{1,2}):(\d{2})$/,
      (m) => {
        const h = parseInt(m[1], 10);
        const min = parseInt(m[2], 10);
        return h < 24 && min < 60 ? { hours: h, minutes: min } : null;
      },
    ],
    // 1730
    [
      /^(\d{2})(\d{2})$/,
      (m) => {
        const h = parseInt(m[1], 10);
        const min = parseInt(m[2], 10);
        return h < 24 && min < 60 ? { hours: h, minutes: min } : null;
      },
    ],
  ];

  for (const [re, handler] of patterns) {
    const match = cleaned.match(re);
    if (match) return handler(match);
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toTimeStr(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Fuzzy match relative keywords. Returns a handler or null.
 */
function matchRelative(word: string): (() => Date) | null {
  const candidates: [string[], () => Date][] = [
    [["now", "today", "tdy"], () => new Date()],
    [
      ["yesterday", "yest", "yesterdy", "yestrday"],
      () => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d;
      },
    ],
    [
      ["tomorrow", "tmr", "tmrw", "tomorow", "tommorow", "tmrow"],
      () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return d;
      },
    ],
  ];

  const lower = word.toLowerCase();

  for (const [aliases, fn] of candidates) {
    for (const alias of aliases) {
      if (alias === lower) return fn;
      // Fuzzy: allow 1-2 char edits for words 4+ chars
      if (lower.length >= 4 && levenshtein(lower, alias) <= 2) return fn;
    }
  }

  return null;
}

// ── Main parser ──────────────────────────────────────────────────────────────

function relativeWeekday(now: Date, direction: number, wd: number): Date {
  const d = new Date(now);
  const currentDay = d.getDay();
  let diff: number;
  if (direction === -1) {
    diff = currentDay - wd;
    if (diff <= 0) diff += 7;
    d.setDate(d.getDate() - diff);
  } else {
    diff = wd - currentDay;
    if (diff <= 0) diff += 7;
    d.setDate(d.getDate() + diff);
  }
  return d;
}

/**
 * Handle "last X" / "next X" patterns ("last week", "next friday", "last month").
 * Returns a ParsedDate when tokens[0] is "last"/"next" and a subject resolves,
 * otherwise null (caller falls through to other patterns).
 */
function parseRelativeDirection(tokens: string[], now: Date): ParsedDate | null {
  const direction = tokens[0] === "last" ? -1 : 1;
  const subject = tokens.slice(1).join(" ");

  let datePart: Date | null = null;
  let label = "";

  if (subject === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() + direction * 7);
    datePart = d;
    label = `${tokens[0]} week`;
  } else if (subject === "month") {
    const d = new Date(now);
    d.setMonth(d.getMonth() + direction);
    datePart = d;
    label = `${tokens[0]} month`;
  } else if (subject === "year") {
    const d = new Date(now);
    d.setFullYear(d.getFullYear() + direction);
    datePart = d;
    label = `${tokens[0]} year`;
  } else {
    // "last friday", "next monday"
    const wd = matchWeekday(subject);
    if (wd !== null) {
      datePart = relativeWeekday(now, direction, wd);
      label = `${tokens[0]} ${WEEKDAYS[wd]}`;
    }
  }

  if (!datePart) return null;

  // Check for trailing time token
  let timePart: { hours: number; minutes: number } | null = null;
  if (tokens.length > 2) {
    const timeCandidate = tokens.slice(2).join("");
    timePart = parseTime(timeCandidate);
  }

  const result: ParsedDate = { date: toDateStr(datePart), label };
  if (timePart) result.time = toTimeStr(timePart.hours, timePart.minutes);
  return result;
}

/**
 * Parse the optional trailing year/time tokens shared by the "month day" and
 * "day month" patterns. Starts at startIdx and scans to the end of tokens.
 */
function parseTrailingYearTime(
  tokens: string[],
  startIdx: number,
  defaultYear: number,
): { year: number; timePart: { hours: number; minutes: number } | null } {
  let year = defaultYear;
  let timePart: { hours: number; minutes: number } | null = null;
  let tokenIdx = startIdx;

  while (tokenIdx < tokens.length) {
    const tok = tokens[tokenIdx];
    // 4-digit year
    if (/^\d{4}$/.test(tok)) {
      year = parseInt(tok, 10);
      tokenIdx++;
      continue;
    }
    // Try as time
    const t = parseTime(tok);
    if (t) {
      timePart = t;
      tokenIdx++;
      continue;
    }
    // Try joining remaining as time (e.g. "7" "pm" → "7pm")
    const joined = tokens.slice(tokenIdx).join("");
    const t2 = parseTime(joined);
    if (t2) {
      timePart = t2;
      break;
    }
    tokenIdx++;
  }

  return { year, timePart };
}

/**
 * Handle "month day [year] [time]" pattern ("dec 3", "december 3 2025", "dec 3 7pm").
 * Returns a ParsedDate when tokens[0] matches a month and the day is valid,
 * otherwise null.
 */
function parseMonthDay(tokens: string[], now: Date): ParsedDate | null {
  const monthIdx = matchMonth(tokens[0]);
  if (monthIdx === null) return null;

  let day = 0;
  let tokenIdx = 1;

  // Parse day
  if (tokenIdx < tokens.length) {
    const dayMatch = tokens[tokenIdx].match(/^(\d{1,2})(st|nd|rd|th)?$/);
    if (dayMatch) {
      day = parseInt(dayMatch[1], 10);
      tokenIdx++;
    }
  }

  // If no day provided, default to 1st
  if (day === 0) day = 1;

  // Parse optional year or time
  const { year, timePart } = parseTrailingYearTime(tokens, tokenIdx, now.getFullYear());

  // Validate day
  const maxDay = new Date(year, monthIdx + 1, 0).getDate();
  if (day < 1 || day > maxDay) return null;

  const datePart = new Date(year, monthIdx, day);
  const yearSuffix = year !== now.getFullYear() ? `, ${year}` : "";
  const label = `${MONTHS[monthIdx].slice(0, 3)} ${day}${yearSuffix}`;

  const result: ParsedDate = { date: toDateStr(datePart), label };
  if (timePart) result.time = toTimeStr(timePart.hours, timePart.minutes);
  return result;
}

/**
 * Handle "day month [year] [time]" pattern ("3 dec", "15 january").
 * Returns a ParsedDate when tokens[0] is a day and tokens[1] a month, else null.
 */
function parseDayMonth(tokens: string[], now: Date): ParsedDate | null {
  const dayMatch = tokens[0].match(/^(\d{1,2})(st|nd|rd|th)?$/);
  if (!dayMatch) return null;

  const mIdx = matchMonth(tokens[1]);
  if (mIdx === null) return null;

  const day = parseInt(dayMatch[1], 10);
  const { year, timePart } = parseTrailingYearTime(tokens, 2, now.getFullYear());

  const maxDay = new Date(year, mIdx + 1, 0).getDate();
  if (day < 1 || day > maxDay) return null;

  const datePart = new Date(year, mIdx, day);
  const yearSuffix = year !== now.getFullYear() ? `, ${year}` : "";
  const label = `${MONTHS[mIdx].slice(0, 3)} ${day}${yearSuffix}`;
  const result: ParsedDate = { date: toDateStr(datePart), label };
  if (timePart) result.time = toTimeStr(timePart.hours, timePart.minutes);
  return result;
}

export function parseDateInput(input: string, ref?: Date): ParsedDate | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const now = ref ?? new Date();

  // Try ISO date first: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed + "T00:00:00");
    if (!isNaN(d.getTime())) return { date: trimmed, label: formatLabel(d) };
  }

  // Split into tokens, separating time-like tokens
  const tokens = trimmed
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (tokens.length === 0) return null;

  // ── Single word: relative or month-only ──

  // Check "last X" / "next X" patterns
  if (tokens.length >= 2 && (tokens[0] === "last" || tokens[0] === "next")) {
    const relResult = parseRelativeDirection(tokens, now);
    if (relResult) return relResult;
  }

  // ── Single token: "now", "today", "yesterday", "tomorrow" ──
  const relSingle = parseRelativeSingle(tokens);
  if (relSingle) return relSingle;

  // ── Month + day [+ year] [+ time] pattern ──
  // "dec 3", "december 3", "decem 3", "dec 3 2025", "dec 3 7pm"
  const monthDayResult = parseMonthDay(tokens, now);
  if (monthDayResult) return monthDayResult;

  // ── "day month" pattern (e.g. "3 dec", "15 january") ──
  if (tokens.length >= 2) {
    const dayMonthResult = parseDayMonth(tokens, now);
    if (dayMonthResult) return dayMonthResult;
  }

  // ── MM/DD or MM/DD/YYYY ──
  const slashResult = parseSlashDate(trimmed, now);
  if (slashResult) return slashResult;

  // ── Weekday-only: "friday", "monday" → next occurrence ──
  return parseWeekdayOnly(tokens, now);
}

/**
 * Handle a single relative keyword ("now"/"today"/"yesterday"/"tomorrow")
 * optionally followed by a time token. Returns null when tokens[0] is not a
 * relative keyword (or there are too many tokens).
 */
function parseRelativeSingle(tokens: string[]): ParsedDate | null {
  const relFn = matchRelative(tokens[0]);
  if (!relFn || tokens.length > 2) return null;

  const datePart = relFn();
  const label = tokens[0];
  const timePart = tokens[1] ? parseTime(tokens[1]) : null;

  const result: ParsedDate = { date: toDateStr(datePart), label };
  if (timePart) result.time = toTimeStr(timePart.hours, timePart.minutes);
  return result;
}

/**
 * Handle "MM/DD" or "MM/DD/YYYY" (also "." / "-" separators). Returns null when
 * the input doesn't match or the parsed date is out of range.
 */
function parseSlashDate(trimmed: string, now: Date): ParsedDate | null {
  const slashMatch = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?$/);
  if (!slashMatch) return null;

  const m = parseInt(slashMatch[1], 10) - 1;
  const d = parseInt(slashMatch[2], 10);
  let y = slashMatch[3] ? parseInt(slashMatch[3], 10) : now.getFullYear();
  if (y < 100) y += 2000;
  if (m < 0 || m >= 12 || d < 1 || d > new Date(y, m + 1, 0).getDate()) return null;

  const datePart = new Date(y, m, d);
  const yearSuffix = y !== now.getFullYear() ? `, ${y}` : "";
  const label = `${MONTHS[m].slice(0, 3)} ${d}${yearSuffix}`;
  return { date: toDateStr(datePart), label };
}

/**
 * Handle a bare weekday ("friday", "monday") → its next occurrence, optionally
 * followed by a time token. Returns null when tokens[0] is not a weekday.
 */
function parseWeekdayOnly(tokens: string[], now: Date): ParsedDate | null {
  const wd = matchWeekday(tokens[0]);
  if (wd === null || tokens.length > 2) return null;

  const d = new Date(now);
  const currentDay = d.getDay();
  let diff = wd - currentDay;
  if (diff <= 0) diff += 7;
  d.setDate(d.getDate() + diff);
  const label = WEEKDAYS[wd];
  const timePart = tokens[1] ? parseTime(tokens[1]) : null;

  const result: ParsedDate = { date: toDateStr(d), label };
  if (timePart) result.time = toTimeStr(timePart.hours, timePart.minutes);
  return result;
}

// ── Format helpers ───────────────────────────────────────────────────────────

function formatLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Normalize any date-ish string to YYYY-MM-DD.
 * Handles: "2025-07-26", "2025-07-26T00:00:00.000Z", "2025-07-26T16:30:00", etc.
 */
export function normalizeDate(dateStr: string): string {
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // Full ISO or datetime — extract the date part
  const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  // Fallback: parse with Date and extract
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return toDateStr(d);
  return dateStr;
}

export function formatDateDisplay(dateStr: string): string {
  const normalized = normalizeDate(dateStr);
  const d = new Date(normalized + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr; // can't parse, return as-is
  const now = new Date();
  const today = toDateStr(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = toDateStr(yesterday);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = toDateStr(tomorrow);

  if (normalized === today) return "Today";
  if (normalized === yesterdayStr) return "Yesterday";
  if (normalized === tomorrowStr) return "Tomorrow";

  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-US", opts);
}

/** Full date with year for the editable input: "Apr 12, 2026" */
export function formatDateEditable(dateStr: string): string {
  const normalized = normalizeDate(dateStr);
  const d = new Date(normalized + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatTimeDisplay(time: string): string {
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const period = h >= 12 ? "pm" : "am";
  const displayH = h % 12 || 12;
  return m === 0 ? `${displayH}${period}` : `${displayH}:${mStr}${period}`;
}
