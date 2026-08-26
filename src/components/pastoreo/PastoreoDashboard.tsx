import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MonitoringStrip } from "./MonitoringStrip";
import { PastoreoFilters } from "./PastoreoFilters";
import { ChronicTable } from "./ChronicTable";
import { ChronicThresholdControl } from "./ChronicThresholdControl";
import { BirthdayDigest } from "./BirthdayDigest";
import type { ChronicRow, BirthdayRow } from "@/lib/pastoreo/queries";

interface Props {
  kpis: { totalMembers: number; attendanceRate: number | null; avgPerSession: number | null };
  ageBuckets: Array<{ bucket: string; count: number }>;
  sexBuckets: Array<{ sex: string; count: number }>;
  chronicRows: ChronicRow[];
  birthdayUpcoming: BirthdayRow[];
  birthdayMissingCount: number;
  monitoring: {
    sentThisMonth: number;
    cap: number;
    alertAt: number;
    whatsappEnabled: boolean;
    hasCreds: boolean;
    lastCronRun: string | null;
    todayCounts?: Record<string, number>;
  };
  threshold: number;
  lookbackDays: number;
  canManageSettings: boolean;
  initialTab?: string;
}

export function PastoreoDashboard({
  kpis,
  ageBuckets,
  sexBuckets,
  chronicRows,
  birthdayUpcoming,
  birthdayMissingCount,
  monitoring,
  threshold,
  lookbackDays,
  canManageSettings,
  initialTab = "resumen",
}: Props) {
  return (
    <div className="space-y-6" data-testid="pastoreo-dashboard">
      <MonitoringStrip {...monitoring} />

      <PastoreoFilters />

      <Tabs defaultValue={initialTab} data-testid="pastoreo-tabs">
        <TabsList>
          <TabsTrigger value="resumen" data-testid="tab-resumen">Resumen</TabsTrigger>
          <TabsTrigger value="cronicos" data-testid="tab-cronicos">Ausentes cronicos</TabsTrigger>
          <TabsTrigger value="cumpleanos" data-testid="tab-cumpleanos">Cumpleanos</TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" data-testid="tab-content-resumen" className="space-y-4 pt-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Miembros activos</CardTitle>
                <CardDescription>Total sin soft-delete</CardDescription>
              </CardHeader>
              <CardContent>
                <p data-testid="kpi-total" className="text-3xl font-bold">{kpis.totalMembers}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Tasa asistencia</CardTitle>
              </CardHeader>
              <CardContent>
                <p data-testid="kpi-rate" className="text-3xl font-bold">
                  {kpis.attendanceRate != null ? `${(kpis.attendanceRate * 100).toFixed(1)}%` : "-"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Promedio por sesion</CardTitle>
              </CardHeader>
              <CardContent>
                <p data-testid="kpi-avg" className="text-3xl font-bold">
                  {kpis.avgPerSession != null ? kpis.avgPerSession.toFixed(1) : "-"}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Por bucket edad</CardTitle>
              </CardHeader>
              <CardContent>
                <ul data-testid="age-bucket-list" className="space-y-1 text-sm">
                  {ageBuckets.map((b) => (
                    <li key={b.bucket} className="flex justify-between">
                      <span>{b.bucket}</span>
                      <span data-testid={`age-${b.bucket}`}>{b.count}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Por sexo</CardTitle>
              </CardHeader>
              <CardContent>
                <ul data-testid="sex-bucket-list" className="space-y-1 text-sm">
                  {sexBuckets.map((b) => (
                    <li key={b.sex} className="flex justify-between">
                      <span>{b.sex}</span>
                      <span data-testid={`sex-${b.sex}`}>{b.count}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="cronicos" data-testid="tab-content-cronicos" className="space-y-4 pt-4">
          <ChronicThresholdControl threshold={threshold} lookbackDays={lookbackDays} canManage={canManageSettings} />
          <ChronicTable rows={chronicRows} />
        </TabsContent>

        <TabsContent value="cumpleanos" data-testid="tab-content-cumpleanos" className="space-y-4 pt-4">
          <BirthdayDigest upcoming={birthdayUpcoming} missingCount={birthdayMissingCount} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
