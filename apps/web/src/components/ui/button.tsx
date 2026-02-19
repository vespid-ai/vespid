import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] text-sm font-medium",
    "transition-[box-shadow,background-color,border-color,color] duration-200",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/35",
    "aria-pressed:ring-2 aria-pressed:ring-accent/30 aria-pressed:ring-offset-1 aria-pressed:ring-offset-surface0",
    "data-[state=active]:ring-2 data-[state=active]:ring-accent/30 data-[state=active]:ring-offset-1 data-[state=active]:ring-offset-surface0",
    "disabled:pointer-events-none disabled:opacity-50",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-text text-surface0 hover:bg-text/92 shadow-elev1",
        accent:
          "bg-brand text-brandContrast shadow-elev1 hover:bg-brand/92 hover:shadow-elev2 focus-visible:ring-accent/35",
        outline:
          "border border-borderSubtle/70 bg-panel/88 hover:bg-panel hover:shadow-elev2 aria-pressed:border-accent/75 aria-pressed:bg-accent/12 data-[state=active]:border-accent/75 data-[state=active]:bg-accent/12",
        ghost:
          "hover:bg-panel/55 aria-pressed:bg-accent/10 aria-pressed:text-text data-[state=active]:bg-accent/10 data-[state=active]:text-text",
        danger: "bg-danger text-white hover:bg-danger/92 focus-visible:ring-danger/35",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-9 px-4",
        lg: "h-10 px-5",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "md",
    },
  }
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
