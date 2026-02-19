"use client";

import { useTranslations } from "next-intl";
import { ModelChipPicker } from "../llm/model-chip-picker";

export function ModelPickerField({
  value,
  onChange,
  placeholder,
  allowClear = true,
  emptyLabel,
  testId,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  emptyLabel?: string;
  testId?: string;
}) {
  const t = useTranslations();

  return (
    <ModelChipPicker
      value={value}
      onChange={onChange}
      placeholder={emptyLabel ?? placeholder ?? t("models.inputPlaceholder")}
      ariaLabel={t("sessions.create.modelChipAria")}
      allowClear={allowClear}
      clearLabel={t("llm.compact.clearModel")}
      className="max-w-[420px] gap-1.5 rounded-full"
      {...(testId ? { testId } : {})}
    />
  );
}
