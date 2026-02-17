import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { cn } from "../../lib/cn";

export function QuickCreatePanel(props: {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <Card className={props.className}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle className="flex items-center gap-2">
              {props.icon}
              {props.title}
            </CardTitle>
            {props.description ? <CardDescription>{props.description}</CardDescription> : null}
          </div>
          {props.actions}
        </div>
      </CardHeader>
      <CardContent className={cn("grid gap-4", props.contentClassName)}>{props.children}</CardContent>
    </Card>
  );
}
