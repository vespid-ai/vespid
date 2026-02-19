import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/cn";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-md border border-border bg-panel/50 p-1",
        className
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-sm border border-transparent px-3 py-1 text-sm font-medium text-muted",
        "hover:bg-panel/65 hover:text-text",
        "data-[state=active]:border-accent/70 data-[state=active]:bg-accent/12 data-[state=active]:text-text data-[state=active]:shadow-elev1 data-[state=active]:ring-1 data-[state=active]:ring-accent/35",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
        className
      )}
      {...props}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;
