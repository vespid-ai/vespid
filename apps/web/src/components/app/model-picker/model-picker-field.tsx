"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { ModelPickerDialog } from "./model-picker-dialog";

export function ModelPickerField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? t("models.inputPlaceholder")}
        />
        <Button type="button" variant="outline" onClick={() => setOpen(true)} className="shrink-0">
          <Search className="mr-2 h-4 w-4" />
          {t("common.search")}
        </Button>
      </div>

      <ModelPickerDialog
        open={open}
        onOpenChange={setOpen}
        value={value}
        onChange={(next) => onChange(next)}
      />
    </>
  );
}

