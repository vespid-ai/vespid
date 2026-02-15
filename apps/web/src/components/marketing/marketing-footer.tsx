type MarketingFooterProps = {
  copyright: string;
  links: { label: string; href: string }[];
};

export function MarketingFooter({ copyright, links }: MarketingFooterProps) {
  return (
    <footer className="border-t border-borderSubtle/70 py-10">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 text-sm text-muted">
        <div>{copyright}</div>
        <div className="flex flex-wrap items-center gap-6">
          {links.map((link) => (
            <a key={link.label} href={link.href} className="hover:text-text">
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
