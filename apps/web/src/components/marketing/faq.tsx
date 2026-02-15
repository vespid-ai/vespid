type FaqItem = {
  question: string;
  answer: string;
};

type FaqProps = {
  eyebrow: string;
  title: string;
  items: FaqItem[];
};

export function Faq({ eyebrow, title, items }: FaqProps) {
  return (
    <section id="faq" className="py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-sm uppercase tracking-[0.28em] text-muted">{eyebrow}</div>
        <h2 className="mt-4 text-3xl font-semibold text-text sm:text-4xl font-[var(--font-marketing)]">
          {title}
        </h2>
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          {items.map((item) => (
            <div key={item.question} className="rounded-2xl border border-borderSubtle/70 bg-panel/60 p-6 shadow-elev1">
              <div className="text-base font-semibold text-text">{item.question}</div>
              <p className="mt-3 text-sm text-muted">{item.answer}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
