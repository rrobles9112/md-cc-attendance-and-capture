"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Props {
  memberIds: string[];
  dryRun?: boolean;
  onDone?: () => void;
}

export function NotifyButton({ memberIds, dryRun = false, onDone }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, number> | null>(null);

  async function handleNotify() {
    if (memberIds.length === 0) return;
    setLoading(true);
    setResult(null);
    try {
      const supabase = createClient();

      // Chunk 50 per spec batch limit
      const chunks: string[][] = [];
      for (let i = 0; i < memberIds.length; i += 50) {
        chunks.push(memberIds.slice(i, i + 50));
      }

      let aggregated: Record<string, number> = { sent: 0, skipped_no_consent: 0, skipped_invalid_phone: 0, skipped_duplicate: 0, skipped_cap: 0, failed: 0 };
      for (const chunk of chunks) {
        const { data, error } = await supabase.functions.invoke("send-whatsapp", {
          body: {
            kind: "shepherding_checkin",
            member_ids: chunk,
            template_name: "shepherding_checkin",
            dry_run: dryRun,
          },
        });
        if (error) throw error;
        const body = (data as Record<string, number>) ?? {};
        for (const k of Object.keys(aggregated)) {
          aggregated[k] += Number(body[k] ?? 0);
        }
      }

      setResult(aggregated);
      toast.success(
        dryRun
          ? `Dry run: ${aggregated.sent ?? 0} would be sent`
          : `Enviados: ${aggregated.sent ?? 0}, omitidos: ${(aggregated.skipped_no_consent ?? 0) + (aggregated.skipped_invalid_phone ?? 0)}`
      );
      onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al notificar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2" data-testid="notify-button-wrap">
      <Button
        data-testid="notify-button"
        onClick={handleNotify}
        disabled={loading || memberIds.length === 0}
      >
        {loading ? "Enviando..." : dryRun ? "Probar (dry_run)" : `Notificar (${memberIds.length})`}
      </Button>
      {dryRun && (
        <span className="text-xs text-muted-foreground">dry_run activo — no se envia</span>
      )}
      {result && (
        <span data-testid="notify-result" className="text-xs text-muted-foreground">
          sent={result.sent} skipped_no_consent={result.skipped_no_consent} failed={result.failed}
        </span>
      )}
    </div>
  );
}
