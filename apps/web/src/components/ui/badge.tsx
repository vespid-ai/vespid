import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const badgeVariants = cva("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      neutral: "border-border bg-panel/70 text-text",
      ok: "border-ok/30 bg-ok/10 text-ok",
      warn: "border-warn/30 bg-warn/10 text-warn",
      danger: "border-danger/30 bg-danger/10 text-danger",
      accent: "border-accent/30 bg-accent/10 text-accent",
    },
  },
  defaultVariants: {
    variant: "neutral",
  },
});

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
