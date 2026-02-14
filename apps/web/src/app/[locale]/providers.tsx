"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { ThemeProvider, useTheme } from "next-themes";
import { DensityProvider } from "../../lib/hooks/use-density";

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster richColors closeButton theme={resolvedTheme === "dark" ? "dark" : "light"} />;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() =>
    new QueryClient({
      defaultOptions: {
        queries: {
          retry: 1,
          refetchOnWindowFocus: false,
        },
      },
    })
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem enableColorScheme>
      <DensityProvider>
        <QueryClientProvider client={client}>
          {children}
          <ThemedToaster />
        </QueryClientProvider>
      </DensityProvider>
    </ThemeProvider>
  );
}
