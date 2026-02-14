"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, type ButtonProps } from "../ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

export function ConfirmButton({
  title,
  description,
  confirmText,
  variant = "danger",
  onConfirm,
  children,
  ...buttonProps
}: {
  title: string;
  description?: string;
  confirmText: string;
  variant?: ButtonProps["variant"];
  onConfirm: () => Promise<void> | void;
  children: string;
} & Omit<ButtonProps, "children" | "onClick">) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function confirm() {
    setLoading(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button {...buttonProps} onClick={() => setOpen(true)}>
        {children}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>

          <div className="mt-4 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={loading}>
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <Button type="button" variant={variant} onClick={confirm} disabled={loading}>
              {loading ? t("common.working") : confirmText}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
