import * as AvatarPrimitive from "@radix-ui/react-avatar";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/cn";

export const Avatar = AvatarPrimitive.Root;

export function AvatarImage({ className, ...props }: ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>) {
  return <AvatarPrimitive.Image className={cn("h-full w-full rounded-full object-cover", className)} {...props} />;
}

export function AvatarFallback({ className, ...props }: ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        "grid h-full w-full place-items-center rounded-full border border-border bg-panelElev/70 text-xs font-medium text-text",
        className
      )}
      {...props}
    />
  );
}
