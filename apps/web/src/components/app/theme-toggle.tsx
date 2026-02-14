"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { useMounted } from "../../lib/hooks/use-mounted";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";

export function ThemeToggle() {
  const t = useTranslations();
  const mounted = useMounted();
  const { theme, resolvedTheme, setTheme } = useTheme();

  const icon = resolvedTheme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          {icon}
          {mounted ? (theme ?? "light") : "theme"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setTheme("light")}>{t("settings.theme.light")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("dark")}>{t("settings.theme.dark")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("system")}>{t("settings.theme.system")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
