"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  threshold: number;
  lookbackDays: number;
  canManage: boolean;
  onSave?: (threshold: number, lookbackDays: number) => Promise<void>;
}

export function ChronicThresholdControl({ threshold, lookbackDays, canManage, onSave }: Props) {
  const [t, setT] = useState(String(threshold));
  const [lb, setLb] = useState(String(lookbackDays));
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave(Number(t), Number(lb));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-end gap-3 rounded-md border p-3" data-testid="chronic-threshold-control">
      <div className="flex flex-col gap-1">
        <Label htmlFor="chronic-threshold">Umbral (faltas consecutivas)</Label>
        <Input
          id="chronic-threshold"
          data-testid="chronic-threshold"
          type="number"
          min={1}
          max={10}
          value={t}
          onChange={(e) => setT(e.target.value)}
          disabled={!canManage}
          className="w-24"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="chronic-lookback">Ventana (dias)</Label>
        <Input
          id="chronic-lookback"
          data-testid="chronic-lookback"
          type="number"
          min={7}
          max={365}
          value={lb}
          onChange={(e) => setLb(e.target.value)}
          disabled={!canManage}
          className="w-24"
        />
      </div>
      {canManage && onSave && (
        <Button data-testid="chronic-save" onClick={handleSave} disabled={saving}>
          {saving ? "Guardando..." : "Guardar"}
        </Button>
      )}
      {!canManage && (
        <span className="text-xs text-muted-foreground">Solo super_admin puede modificar</span>
      )}
    </div>
  );
}
