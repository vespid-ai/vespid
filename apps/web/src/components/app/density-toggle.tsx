"use client";

import { AlignJustify, StretchHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDensity } from "../../lib/hooks/use-density";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";

export function DensityToggle() {
  const t = useTranslations();
  const { density, setDensity } = useDensity();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          {density === "compact" ? <AlignJustify className="h-4 w-4" /> : <StretchHorizontal className="h-4 w-4" />}
          {t(density === "compact" ? "settings.density.compact" : "settings.density.comfortable")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setDensity("comfortable")}>{t("settings.density.comfortable")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setDensity("compact")}>{t("settings.density.compact")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
