import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canViewPastoreo, canManageWhatsappSettings } from "@/lib/rbac/guards";
import type { AppRole } from "@/lib/rbac/types";
import { ageBucket, sexBucket } from "@/lib/pastoreo/buckets";
import { maskPhone } from "@/lib/phone/normalize";
import { PastoreoDashboard } from "@/components/pastoreo/PastoreoDashboard";
import type { ChronicRow, BirthdayRow } from "@/lib/pastoreo/queries";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function parseParam(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function PastoreoPage({ searchParams }: PageProps) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Resolve role from app_metadata or profiles
  let role: AppRole | null = (user.app_metadata?.role as AppRole) ?? null;
  if (!role || !["super_admin", "leader", "server"].includes(role)) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    role = (profile?.role as AppRole) ?? null;
  }

  if (!role || !canViewPastoreo(role)) {
    redirect("/dashboard?error=insufficient-permission");
  }

  const params = await searchParams;
  const tab = parseParam(params.tab) ?? "resumen";
  const ageFilter = parseParam(params.age_bucket);
  const sexFilter = parseParam(params.sex);

  // ---- app_settings (threshold, lookback, cap, kill-switch) ----
  const { data: settingsRows } = await supabase.from("app_settings").select("key, value");
  const settings = new Map((settingsRows ?? []).map((r) => [r.key as string, r.value as string]));
  const threshold = Number(settings.get("pastoreo_chronic_threshold") ?? "3");
  const lookbackDays = Number(settings.get("pastoreo_chronic_lookback_days") ?? "90");
  const cap = Number(settings.get("whatsapp_monthly_cap") ?? "900");
  const alertAt = Number(settings.get("whatsapp_monthly_alert_at") ?? "800");
  const whatsappEnabled = (settings.get("whatsapp_enabled") ?? "true") === "true";
  const hasCreds = Boolean(settings.get("whatsapp_phone_number_id"));

  // also check Vault via env fallback for hasCreds (Edge uses Vault)
  const hasCredsEffective = hasCreds || Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID);

  // ---- monitoring: notification_log counts ----
  let sentThisMonth = 0;
  let todayCounts: Record<string, number> = {};
  let lastCronRun: string | null = null;

  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const { count } = await supabase
      .from("notification_log")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent")
      .gte("sent_at", monthStart);
    sentThisMonth = count ?? 0;

    // today by Bogota date: use created_at::date via RPC/fallback to client date
    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
    const { data: todayRows } = await supabase
      .from("notification_log")
      .select("status")
      .gte("created_at", `${todayStr}T00:00:00`)
      .lte("created_at", `${todayStr}T23:59:59`);
    if (todayRows) {
      for (const r of todayRows) {
        todayCounts[r.status] = (todayCounts[r.status] ?? 0) + 1;
      }
    }

    // last cron run — best effort (cron.job_run_details may not be exposed via PostgREST)
    const { data: cronRows } = await supabase
      .from("cron_job_run_details" as unknown as "notification_log")
      .select("*")
      .limit(1)
      .order("start_time" as unknown as string, { ascending: false } as unknown as Record<string, unknown>);
    if (cronRows && cronRows.length > 0) {
      const row = cronRows[0] as unknown as Record<string, unknown>;
      lastCronRun = String(row.start_time ?? row.startTime ?? "");
    }
  } catch {
    // monitoring is best-effort; Pastoreo still renders if it fails
  }

  // ---- members aggregation (Resumen) ----
  let totalMembers = 0;
  let ageBuckets: Array<{ bucket: string; count: number }> = [];
  let sexBuckets: Array<{ sex: string; count: number }> = [];
  let chronicRows: ChronicRow[] = [];
  let birthdayUpcoming: BirthdayRow[] = [];
  let birthdayMissingCount = 0;

  try {
    const { data: members, count: memberCount } = await supabase
      .from("members")
      .select("id, name, birthday, sex, age_years, phone", { count: "exact" })
      .is("deleted_at", null)
      .limit(2000);

    totalMembers = memberCount ?? members?.length ?? 0;

    // Age bucket aggregation (using GENERATED age_years or fallback)
    const ageMap = new Map<string, number>();
    const sexMap = new Map<string, number>();
    let missingBirthday = 0;

    for (const m of members ?? []) {
      // age bucket
      const ageYears =
        (m as unknown as { age_years: number | null }).age_years ??
        (m.birthday ? Math.floor((Date.now() - new Date(m.birthday).getTime()) / 31557600000) : null);
      const bucket = ageBucket(ageYears);
      const bucketKey = bucket ?? "Sin fecha";
      // apply age filter if present
      if (ageFilter && bucket !== ageFilter) {
        // still count sex but skip age bucket for filtered view — simple: filter both
      }
      const sexKey = sexBucket((m as unknown as { sex: string | null }).sex);

      // For filtered counts: skip if filter mismatch
      const ageMatch = !ageFilter || bucket === ageFilter;
      const sexMatch = !sexFilter || sexKey === sexFilter;
      if (!ageMatch || !sexMatch) continue;

      if (bucket) ageMap.set(bucket, (ageMap.get(bucket) ?? 0) + 1);
      sexMap.set(sexKey, (sexMap.get(sexKey) ?? 0) + 1);

      if (!m.birthday) missingBirthday++;
    }

    // If no filters, count missing as total null birthdays (already counted above, but we filtered)
    if (!ageFilter && !sexFilter) {
      birthdayMissingCount = (members ?? []).filter((m) => !m.birthday).length;
    } else {
      birthdayMissingCount = missingBirthday;
    }

    ageBuckets = Array.from(ageMap.entries()).map(([bucket, count]) => ({ bucket, count }));
    sexBuckets = Array.from(sexMap.entries()).map(([sex, count]) => ({ sex, count }));

    // Birthday upcoming 30 days (next 30 days from Bogota today)
    const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
    const upcoming: BirthdayRow[] = [];
    for (const m of members ?? []) {
      if (!m.birthday) continue;
      const bd = new Date(m.birthday);
      const thisYearBd = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
      let diff = Math.ceil((thisYearBd.getTime() - today.getTime()) / 86400000);
      if (diff < 0) {
        const nextYearBd = new Date(today.getFullYear() + 1, bd.getMonth(), bd.getDate());
        diff = Math.ceil((nextYearBd.getTime() - today.getTime()) / 86400000);
        if (diff >= 0 && diff <= 30) {
          const ageToday = today.getFullYear() + 1 - bd.getFullYear();
          upcoming.push({ id: m.id, name: m.name, birthday: m.birthday, ageToday });
        }
      } else if (diff <= 30) {
        const ageToday = today.getFullYear() - bd.getFullYear();
        upcoming.push({ id: m.id, name: m.name, birthday: m.birthday, ageToday });
      }
    }
    upcoming.sort((a, b) => a.birthday.localeCompare(b.birthday));
    birthdayUpcoming = upcoming.slice(0, 50);

    // ---- Chronic absentees: try RPC/view, fallback to empty ----
    // Attempt to query via ordered sessions + attendance; if RPC unavailable, keep empty
    try {
      // Best-effort: derive chronic via attendance if tables accessible
      const { data: sessions } = await supabase
        .from("sessions")
        .select("id, session_date")
        .is("deleted_at", null)
        .order("session_date", { ascending: true })
        .limit(200);

      const { data: attendance } = await supabase
        .from("attendance")
        .select("member_id, session_id")
        .is("deleted_at", null)
        .limit(5000);

      if (sessions && sessions.length > 0 && members) {
        const cutoff = new Date(today);
        cutoff.setDate(cutoff.getDate() - lookbackDays);
        const recentSessions = sessions.filter((s) => new Date(s.session_date) >= cutoff);
        const attendanceSet = new Set((attendance ?? []).map((a) => `${a.member_id}:${a.session_id}`));
        const memberLastIdx = new Map<string, number>();
        // Find last attended index per member
        for (const m of members) {
          let lastIdx = -1;
          for (let i = 0; i < recentSessions.length; i++) {
            if (attendanceSet.has(`${m.id}:${recentSessions[i].id}`)) lastIdx = i;
          }
          if (lastIdx >= 0) {
            const missed = recentSessions.length - lastIdx - 1;
            // Count consecutive misses from last attended forward until break (all after last are consecutive)
            if (missed >= threshold) {
              const waMasked = maskPhone(m.phone);
              const sexVal = sexBucket((m as unknown as { sex: string | null }).sex);
              const ageYears =
                (m as unknown as { age_years: number | null }).age_years ??
                (m.birthday ? Math.floor((Date.now() - new Date(m.birthday).getTime()) / 31557600000) : null);
              // Apply filters
              const bucket = ageBucket(ageYears);
              const ageMatch2 = !ageFilter || bucket === ageFilter;
              const sexMatch2 = !sexFilter || sexVal === sexFilter;
              if (ageMatch2 && sexMatch2) {
                chronicRows.push({
                  id: m.id,
                  name: m.name,
                  ageYears,
                  ageBucket: bucket,
                  sex: sexVal,
                  lastAttendedDate: recentSessions[lastIdx].session_date,
                  missedStreak: missed,
                  waNumberMasked: waMasked,
                  waNumberRaw: m.phone,
                });
              }
            }
            memberLastIdx.set(m.id, lastIdx);
          }
        }
        chronicRows.sort((a, b) => b.missedStreak - a.missedStreak);
      }
    } catch {
      // chronic fallback: empty
    }
  } catch {
    // Pastoreo still renders with zeros if queries fail (RLS/server denial returns empty)
  }

  const kpis = {
    totalMembers,
    attendanceRate: null as number | null,
    avgPerSession: null as number | null,
  };

  const canManageSettings = role ? canManageWhatsappSettings(role) : false;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Pastoreo</h1>
        <p className="text-sm text-muted-foreground">
          Resumen pastoral, ausentes cronicos y cumpleanos — filtros por edad, sexo y fecha.
        </p>
      </div>

      {!hasCredsEffective && (
        <div
          data-testid="banner-d2-global"
          className="rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800"
        >
          WhatsApp no configurado — dry_run activo. El envio real requiere WHATSAPP_TOKEN y
          WHATSAPP_PHONE_NUMBER_ID en Vault.
        </div>
      )}

      <PastoreoDashboard
        kpis={kpis}
        ageBuckets={ageBuckets}
        sexBuckets={sexBuckets}
        chronicRows={chronicRows}
        birthdayUpcoming={birthdayUpcoming}
        birthdayMissingCount={birthdayMissingCount}
        monitoring={{
          sentThisMonth,
          cap,
          alertAt,
          whatsappEnabled,
          hasCreds: hasCredsEffective,
          lastCronRun,
          todayCounts,
        }}
        threshold={threshold}
        lookbackDays={lookbackDays}
        canManageSettings={canManageSettings}
        initialTab={tab}
      />
    </div>
  );
}
