// example-start
import { SocialLinksBar } from "@kahitsan/ksui";
import Globe from "lucide-solid/icons/globe";
import AtSign from "lucide-solid/icons/at-sign";
import Rss from "lucide-solid/icons/rss";

export default function SocialLinksBarBasic() {
  // SocialLinksBar renders a row of accessible icon buttons that link out to
  // external profiles. The caller owns the URLs, icons, and labels — nothing
  // domain-specific lives in the component. Each button opens in a new tab
  // with rel="noopener noreferrer" and carries an aria-label.
  const links = [
    { href: "https://example.com/website", icon: Globe, label: "Website" },
    { href: "https://example.com/email", icon: AtSign, label: "Email" },
    { href: "https://example.com/blog", icon: Rss, label: "Blog" },
  ];

  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1.5rem",
      }}
    >
      {/* Default round shape */}
      <SocialLinksBar links={links} />

      {/* Clip-cornered (angular) shape */}
      <SocialLinksBar links={links} shape="clip" />
    </div>
  );
}
