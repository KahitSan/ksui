// Source: KahitSan/kserp src/components/MarkdownNotes.tsx (vendored into the plugin remote).
//
// Renders transaction `notes` with a restricted markdown subset and inline
// client-mention chips (@[Name](client:N)). Adapted for the remote: routing is
// host-owned so mention chips link via a plain <a href> instead of @solidjs/
// router's <A>; usePermissions + highlightMatch come from the host UI kit. The
// hover card fetches the SIBLING clients plugin at /api/clients/:id and
// degrades to a non-hovering chip when that 404s.

import { For, Show, createMemo, createSignal, createUniqueId, onCleanup, type JSX } from "solid-js";
import { usePermissions, highlightMatch } from "@kserp/host-ui";

const MENTION_RE = /@\[([^\]]+)\](?:\(client:(\d+)\))?/g;

type InlineToken =
  | { kind: "text"; value: string }
  | { kind: "bold"; children: InlineToken[] }
  | { kind: "italic"; children: InlineToken[] }
  | { kind: "code"; value: string }
  | { kind: "link"; href: string; children: InlineToken[] }
  | { kind: "mention"; name: string; clientId: number | null };

type BlockToken =
  | { kind: "p"; children: InlineToken[] }
  | { kind: "ul"; items: InlineToken[][] }
  | { kind: "ol"; items: InlineToken[][] };

function tokenizeMentions(input: string): InlineToken[] {
  const out: InlineToken[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(input)) !== null) {
    if (m.index > lastIndex) {
      out.push({ kind: "text", value: input.slice(lastIndex, m.index) });
    }
    const name = m[1];
    const id = m[2] ? Number.parseInt(m[2], 10) : null;
    out.push({ kind: "mention", name, clientId: Number.isFinite(id) ? id : null });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < input.length) {
    out.push({ kind: "text", value: input.slice(lastIndex) });
  }
  return out;
}

function parseInlineMarkdown(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let i = 0;
  let buf = "";
  const flush = () => {
    if (buf) {
      tokens.push({ kind: "text", value: buf });
      buf = "";
    }
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch === "`") {
      const close = text.indexOf("`", i + 1);
      if (close > i) {
        flush();
        tokens.push({ kind: "code", value: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }

    if (ch === "*" && text[i + 1] === "*") {
      const close = text.indexOf("**", i + 2);
      if (close > i + 1) {
        flush();
        tokens.push({ kind: "bold", children: parseInlineMarkdown(text.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }

    if (ch === "_" || ch === "*") {
      const prev = i > 0 ? text[i - 1] : "";
      const opensWord = prev === "" || /[\s(.,;:!?[]/.test(prev);
      if (opensWord) {
        const close = text.indexOf(ch, i + 1);
        if (close > i + 1) {
          const inner = text.slice(i + 1, close);
          if (!inner.includes("\n") && inner.trim()) {
            flush();
            tokens.push({ kind: "italic", children: parseInlineMarkdown(inner) });
            i = close + 1;
            continue;
          }
        }
      }
    }

    if (ch === "[") {
      const labelEnd = text.indexOf("]", i + 1);
      if (labelEnd > i && text[labelEnd + 1] === "(") {
        const urlEnd = text.indexOf(")", labelEnd + 2);
        if (urlEnd > labelEnd) {
          const label = text.slice(i + 1, labelEnd);
          const url = text.slice(labelEnd + 2, urlEnd).trim();
          if (/^https?:\/\//i.test(url)) {
            flush();
            tokens.push({ kind: "link", href: url, children: parseInlineMarkdown(label) });
            i = urlEnd + 1;
            continue;
          }
        }
      }
    }

    buf += ch;
    i += 1;
  }
  flush();
  return tokens;
}

function parseBlocks(input: string): BlockToken[] {
  const blocks: BlockToken[] = [];
  const lines = input.split(/\r?\n/);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: InlineToken[][] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*[-*]\s+/, "");
        items.push(parseInlineWithMentions(itemText));
        i += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: InlineToken[][] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*\d+\.\s+/, "");
        items.push(parseInlineWithMentions(itemText));
        i += 1;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: "p", children: parseInlineWithMentions(paraLines.join("\n")) });
  }

  return blocks;
}

function parseInlineWithMentions(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  for (const token of tokenizeMentions(text)) {
    if (token.kind === "text") {
      out.push(...parseInlineMarkdown(token.value));
    } else {
      out.push(token);
    }
  }
  return out;
}

interface MentionClientLite {
  id: number;
  name_raw: string;
  email: string | null;
  phone: string | null;
}
interface MentionClientCacheEntry {
  value: MentionClientLite | null;
  ts: number;
}
const MENTION_CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
const mentionClientCache = new Map<number, MentionClientCacheEntry>();

function readMentionClientCache(id: number): MentionClientCacheEntry | undefined {
  const entry = mentionClientCache.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > MENTION_CLIENT_CACHE_TTL_MS) {
    mentionClientCache.delete(id);
    return undefined;
  }
  return entry;
}

function writeMentionClientCache(id: number, value: MentionClientLite | null): void {
  mentionClientCache.set(id, { value, ts: Date.now() });
}

function MentionHoverCard(props: { clientId: number; name: string }): JSX.Element {
  const hoverCardId = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const [data, setData] = createSignal<MentionClientLite | null | undefined>(
    readMentionClientCache(props.clientId)?.value,
  );
  const [loading, setLoading] = createSignal(false);
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function clearTimers() {
    if (openTimer) clearTimeout(openTimer);
    if (closeTimer) clearTimeout(closeTimer);
    openTimer = undefined;
    closeTimer = undefined;
  }

  async function ensureFetched() {
    const cached = readMentionClientCache(props.clientId);
    if (cached) {
      setData(cached.value);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/clients/${props.clientId}`, { credentials: "include" });
      if (res.status === 200) {
        const c = (await res.json()) as MentionClientLite;
        const lite: MentionClientLite = {
          id: c.id,
          name_raw: c.name_raw,
          email: c.email ?? null,
          phone: c.phone ?? null,
        };
        writeMentionClientCache(props.clientId, lite);
        setData(lite);
      } else {
        writeMentionClientCache(props.clientId, null);
        setData(null);
      }
    } catch {
      writeMentionClientCache(props.clientId, null);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  function handleEnter() {
    clearTimers();
    openTimer = setTimeout(() => {
      setOpen(true);
      void ensureFetched();
    }, 120);
  }
  function handleLeave() {
    clearTimers();
    closeTimer = setTimeout(() => setOpen(false), 100);
  }
  function handleFocus() {
    clearTimers();
    setOpen(true);
    void ensureFetched();
  }
  function handleBlur() {
    clearTimers();
    closeTimer = setTimeout(() => setOpen(false), 100);
  }

  onCleanup(clearTimers);

  return (
    <span class="relative inline-block" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <a
        href={`/clients/${props.clientId}`}
        class="inline-flex items-center rounded bg-zinc-800/50 px-1.5 py-0.5 text-[0.85em] text-emerald-400 hover:text-emerald-300 hover:bg-zinc-800/70 transition-colors"
        data-testid="mention-chip"
        aria-describedby={open() && data() !== null ? hoverCardId : undefined}
        onFocus={handleFocus}
        onBlur={handleBlur}
      >
        @{props.name}
      </a>
      <Show when={open() && data() !== null}>
        <span
          id={hoverCardId}
          role="tooltip"
          data-testid="mention-hover-card"
          class="absolute left-0 top-full z-50 mt-1 inline-block min-w-[14rem] max-w-xs rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 shadow-lg"
          onMouseEnter={() => clearTimers()}
          onMouseLeave={handleLeave}
        >
          <Show when={!loading() && data()} fallback={<span class="text-zinc-400">Loading…</span>}>
            {(c) => (
              <span class="block">
                <span class="block font-medium text-zinc-100">{c().name_raw}</span>
                <Show when={c().email}>
                  <span class="mt-1 block text-zinc-400" data-testid="mention-hover-email">
                    {c().email}
                  </span>
                </Show>
                <Show when={c().phone}>
                  <span class="block text-zinc-400" data-testid="mention-hover-phone">
                    {c().phone}
                  </span>
                </Show>
                <Show when={!c().email && !c().phone}>
                  <span class="mt-1 block text-zinc-500">No contact details on file.</span>
                </Show>
              </span>
            )}
          </Show>
        </span>
      </Show>
    </span>
  );
}

function MentionChip(props: { name: string; clientId: number | null }): JSX.Element {
  let canViewClients = () => false;
  try {
    const perms = usePermissions();
    canViewClients = () => perms.has("clients.view");
  } catch {
    /* no provider in context, leave canViewClients() returning false */
  }

  return (
    <Show
      when={props.clientId !== null}
      fallback={
        <span
          class="inline-flex items-center rounded bg-zinc-800/40 px-1.5 py-0.5 text-[0.85em] text-zinc-500"
          data-testid="mention-chip-unresolved"
        >
          @{props.name}
        </span>
      }
    >
      <Show
        when={canViewClients()}
        fallback={
          <a
            href={`/clients/${props.clientId}`}
            class="inline-flex items-center rounded bg-zinc-800/50 px-1.5 py-0.5 text-[0.85em] text-emerald-400 hover:text-emerald-300 hover:bg-zinc-800/70 transition-colors"
            data-testid="mention-chip"
          >
            @{props.name}
          </a>
        }
      >
        <MentionHoverCard clientId={props.clientId as number} name={props.name} />
      </Show>
    </Show>
  );
}

function RenderInline(props: { tokens: InlineToken[]; searchQuery?: string }): JSX.Element {
  return (
    <For each={props.tokens}>
      {(t) => {
        if (t.kind === "text")
          return <>{props.searchQuery ? highlightMatch(t.value, props.searchQuery) : t.value}</>;
        if (t.kind === "bold")
          return (
            <strong>
              <RenderInline tokens={t.children} searchQuery={props.searchQuery} />
            </strong>
          );
        if (t.kind === "italic")
          return (
            <em>
              <RenderInline tokens={t.children} searchQuery={props.searchQuery} />
            </em>
          );
        if (t.kind === "code")
          return (
            <code class="px-1 py-0.5 rounded bg-zinc-800/60 text-[0.9em] text-zinc-200">
              {props.searchQuery ? highlightMatch(t.value, props.searchQuery) : t.value}
            </code>
          );
        if (t.kind === "link")
          return (
            <a
              href={t.href}
              target="_blank"
              rel="noopener noreferrer"
              class="text-emerald-400 hover:text-emerald-300 underline"
            >
              <RenderInline tokens={t.children} searchQuery={props.searchQuery} />
            </a>
          );
        if (t.kind === "mention") return <MentionChip name={t.name} clientId={t.clientId} />;
        return null;
      }}
    </For>
  );
}

export interface MarkdownNotesProps {
  value: string | null | undefined;
  class?: string;
  searchQuery?: string;
}

export default function MarkdownNotes(props: MarkdownNotesProps): JSX.Element {
  const blocks = createMemo<BlockToken[]>(() => {
    const v = props.value;
    if (!v) return [];
    return parseBlocks(v);
  });

  return (
    <Show when={blocks().length > 0}>
      <div class={props.class} data-testid="markdown-notes">
        <For each={blocks()}>
          {(b, idx) => {
            if (b.kind === "p")
              return (
                <p class={idx() === 0 ? "" : "mt-2"}>
                  <RenderInline tokens={b.children} searchQuery={props.searchQuery} />
                </p>
              );
            if (b.kind === "ul")
              return (
                <ul class={`list-disc pl-5 ${idx() === 0 ? "" : "mt-2"}`}>
                  <For each={b.items}>
                    {(item) => (
                      <li>
                        <RenderInline tokens={item} searchQuery={props.searchQuery} />
                      </li>
                    )}
                  </For>
                </ul>
              );
            if (b.kind === "ol")
              return (
                <ol class={`list-decimal pl-5 ${idx() === 0 ? "" : "mt-2"}`}>
                  <For each={b.items}>
                    {(item) => (
                      <li>
                        <RenderInline tokens={item} searchQuery={props.searchQuery} />
                      </li>
                    )}
                  </For>
                </ol>
              );
            return null;
          }}
        </For>
      </div>
    </Show>
  );
}
