import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/cn";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({ className, align = "center", sideOffset = 8, ...props }: ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-80 rounded-lg border border-borderSubtle bg-panel/90 p-3 shadow-elev2 backdrop-blur",
          "animate-fade-in",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
