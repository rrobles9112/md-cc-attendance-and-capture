"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import type { ChronicRow } from "@/lib/pastoreo/queries";
import { NotifyButton } from "./NotifyButton";

interface Props {
  rows: ChronicRow[];
}

export function ChronicTable({ rows }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  }

  function handleExport() {
    const exportRows = rows.map((r) => ({
      Nombre: r.name,
      Edad: r.ageYears ?? "",
      Sexo: r.sex,
      "Ultima asistencia": r.lastAttendedDate ?? "",
      "Racha perdidas": r.missedStreak,
      WhatsApp: r.waNumberMasked,
    }));
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pastoreo");
    const data = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([data], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const today = new Date().toISOString().slice(0, 10);
    a.download = `pastoreo-${today}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exportado ${rows.length} filas`);
  }

  if (rows.length === 0) {
    return (
      <div data-testid="chronic-empty" className="rounded-md border p-8 text-center text-muted-foreground">
        No hay ausentes cronicos con los filtros actuales.
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="chronic-table">
      <div className="flex gap-2">
        <Button data-testid="export-button" variant="outline" onClick={handleExport}>
          Exportar
        </Button>
        {selected.size > 0 && (
          <NotifyButton
            memberIds={Array.from(selected)}
            onDone={() => setSelected(new Set())}
          />
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  data-testid="select-all"
                  checked={selected.size === rows.length && rows.length > 0}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Edad</TableHead>
              <TableHead>Sexo</TableHead>
              <TableHead>Ultima asistencia</TableHead>
              <TableHead>Racha</TableHead>
              <TableHead>WhatsApp</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} data-testid="chronic-row">
                <TableCell>
                  <Checkbox
                    data-testid={`select-${r.id}`}
                    checked={selected.has(r.id)}
                    onCheckedChange={() => toggle(r.id)}
                  />
                </TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.ageYears ?? "-"}</TableCell>
                <TableCell>{r.sex}</TableCell>
                <TableCell>{r.lastAttendedDate ?? "-"}</TableCell>
                <TableCell>{r.missedStreak}</TableCell>
                <TableCell data-testid="phone-masked">{r.waNumberMasked}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
