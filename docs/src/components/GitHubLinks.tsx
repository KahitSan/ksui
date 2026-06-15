import { type JSX } from "solid-js";
import Star from "lucide-solid/icons/star";

const REPO_URL = "https://github.com/KahitSan/ksui";

// The official GitHub octocat mark as an inline SVG. We inline it because the
// GitHub brand icon was removed from lucide, so we cannot rely on lucide for it.
function GitHubMark(props: { size?: number }): JSX.Element {
  const s = props.size ?? 20;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

// The GitHub logo link plus a static "Star" pill. We keep it lightweight: no
// external scripts and no iframes, just two plain links to the repo.
export function GitHubLinks(): JSX.Element {
  return (
    <div class="github-links">
      <a
        class="topbar-link github-mark-link"
        href={REPO_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="GitHub"
      >
        <GitHubMark size={20} />
      </a>
      <a
        class="star-pill"
        href={REPO_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="Star ksui on GitHub"
      >
        <Star size={14} />
        <span>Star</span>
      </a>
    </div>
  );
}
