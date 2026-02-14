"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import { Button } from "./button";

export function DataTable<T>({
  data,
  columns,
  getRowId,
  className,
}: {
  data: T[];
  columns: Array<ColumnDef<T, any>>;
  getRowId?: (original: T, index: number, parent?: any) => string;
  className?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(getRowId ? { getRowId } : {}),
  });

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--radius-md)] border border-borderSubtle shadow-elev1 shadow-inset",
        "bg-gradient-to-b from-panel/55 to-panel/35",
        className
      )}
    >
      <table className="w-full border-collapse">
        <thead className="bg-surface2/50">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-borderStrong">
              {hg.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                const sortIcon =
                  sorted === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : sorted === "desc" ? <ArrowDown className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />;

                return (
                  <th
                    key={header.id}
                    className={cn(
                      "px-3 py-2 text-left text-xs font-medium text-muted",
                      "group-data-[density=compact]:py-1.5"
                    )}
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <span className="text-muted">{sortIcon}</span>
                      </Button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-borderSubtle last:border-b-0 transition-colors hover:bg-surface2/40"
            >
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={cn(
                    "px-3 py-2 text-sm text-text",
                    "group-data-[density=compact]:py-1.5 group-data-[density=compact]:text-[13px]"
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
