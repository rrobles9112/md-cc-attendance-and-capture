interface MonitoringStripProps {
  sentThisMonth: number;
  cap: number;
  alertAt: number;
  whatsappEnabled: boolean;
  hasCreds: boolean;
  lastCronRun: string | null;
  todayCounts?: Record<string, number>;
}

export function MonitoringStrip({
  sentThisMonth,
  cap,
  alertAt,
  whatsappEnabled,
  hasCreds,
  lastCronRun,
  todayCounts,
}: MonitoringStripProps) {
  const capApproaching = sentThisMonth >= alertAt && sentThisMonth < cap;
  const capReached = sentThisMonth >= cap;

  return (
    <div className="space-y-2" data-testid="monitoring-strip">
      {!whatsappEnabled && (
        <div
          data-testid="banner-kill-switch"
          className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800"
        >
          WhatsApp deshabilitado — kill switch activo (whatsapp_enabled=false).
        </div>
      )}
      {!hasCreds && (
        <div
          data-testid="banner-d2"
          className="rounded-md border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-800"
        >
          WhatsApp no configurado — dry_run activo. Configurá WHATSAPP_TOKEN /
          WHATSAPP_PHONE_NUMBER_ID en Vault para habilitar envíos reales.
        </div>
      )}
      {capApproaching && (
        <div
          data-testid="banner-cap-warning"
          className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800"
        >
          WhatsApp uso {sentThisMonth}/{cap} — cap próximo. Los envíos se pausarán
          al llegar a {cap}.
        </div>
      )}
      {capReached && (
        <div
          data-testid="banner-cap-reached"
          className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          WhatsApp cap alcanzado {sentThisMonth}/{cap} — envíos pausados.
        </div>
      )}
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span data-testid="metric-sent">Enviados este mes: {sentThisMonth}/{cap}</span>
        {lastCronRun && (
          <span data-testid="metric-cron">Ultimo cron: {lastCronRun}</span>
        )}
        {!lastCronRun && (
          <span data-testid="metric-cron-empty">Cron aun no ejecutado</span>
        )}
        {todayCounts && Object.keys(todayCounts).length > 0 && (
          <span data-testid="metric-today">
            Hoy:{" "}
            {Object.entries(todayCounts)
              .map(([k, v]) => `${k}=${v}`)
              .join(" ")}
          </span>
        )}
      </div>
    </div>
  );
}
