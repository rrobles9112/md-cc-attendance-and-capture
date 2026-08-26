import { ageBucket } from "./buckets";
import { maskPhone } from "@/lib/phone/normalize";

export type AgeBucket = ReturnType<typeof ageBucket>;

export interface ChronicRow {
  id: string;
  name: string;
  ageYears: number | null;
  ageBucket: string | null;
  sex: string;
  lastAttendedDate: string | null;
  missedStreak: number;
  waNumberMasked: string;
  waNumberRaw?: string | null;
}

export interface BirthdayRow {
  id: string;
  name: string;
  birthday: string;
  ageToday: number;
}

export interface PastoreoFilters {
  ageBucket?: string;
  sex?: string;
  from?: string;
  to?: string;
}

/**
 * Build the chronic absentees SQL with window function ROW_NUMBER().
 * Threshold and lookback are parametrized via app_settings keys
 * pastoreo_chronic_threshold (default 3) and pastoreo_chronic_lookback_days (default 90).
 * Uses indexes: idx_attendance_member_session, idx_sessions_session_date, idx_members_sex.
 *
 * When age_years is GENERATED STORED, buckets.ts helpers map age_years to buckets;
 * otherwise fallback is EXTRACT(YEAR FROM age(birthday)).
 */
export function buildChronicQuery(): string {
  return `
-- Chronic absentees: >=1 attendance in last lookback_days, then >=threshold consecutive misses
-- Parametrized via app_settings.pastoreo_chronic_threshold / pastoreo_chronic_lookback_days
WITH params AS (
  SELECT
    COALESCE(NULLIF((SELECT value FROM public.app_settings WHERE key='pastoreo_chronic_threshold'), ''), '3')::int AS threshold,
    COALESCE(NULLIF((SELECT value FROM public.app_settings WHERE key='pastoreo_chronic_lookback_days'), ''), '90')::int AS lookback_days
),
ordered_sessions AS (
  SELECT id, session_date, ROW_NUMBER() OVER (ORDER BY session_date) AS rn
  FROM public.sessions, params
  WHERE deleted_at IS NULL
    AND session_date >= (CURRENT_DATE AT TIME ZONE 'America/Bogota') - (SELECT lookback_days FROM params) * INTERVAL '1 day'
),
member_last_attendance AS (
  SELECT a.member_id, MAX(s.session_date) AS last_attended_date, MAX(s.rn) AS last_attended_rn
  FROM public.attendance a
  JOIN ordered_sessions s ON s.id = a.session_id
  WHERE a.deleted_at IS NULL
  GROUP BY a.member_id
),
missed_streak AS (
  SELECT mla.member_id, COUNT(os.id) AS missed_count
  FROM member_last_attendance mla
  JOIN ordered_sessions os ON os.rn > mla.last_attended_rn
  LEFT JOIN public.attendance a ON a.member_id = mla.member_id AND a.session_id = os.id AND a.deleted_at IS NULL
  WHERE a.id IS NULL
  GROUP BY mla.member_id
)
SELECT m.id, m.name, m.birthday, m.sex, m.age_years,
       mla.last_attended_date, ms.missed_count,
       COALESCE(wn.number, m.phone) AS wa_number
FROM missed_streak ms
JOIN member_last_attendance mla ON mla.member_id = ms.member_id
JOIN public.members m ON m.id = ms.member_id
LEFT JOIN public.whatsapp_numbers wn ON wn.member_id = m.id AND wn.is_primary_phone AND wn.deleted_at IS NULL
CROSS JOIN params
WHERE m.deleted_at IS NULL
  AND ms.missed_count >= (SELECT threshold FROM params)
ORDER BY ms.missed_count DESC, mla.last_attended_date ASC
`.trim();
}

export function buildBirthdayScanQuery(): string {
  return `
SELECT m.id, m.name, m.birthday, EXTRACT(YEAR FROM age(m.birthday))::int AS age_today
FROM public.members m
WHERE m.deleted_at IS NULL
  AND m.birthday IS NOT NULL
  AND (
    (EXTRACT(MONTH FROM m.birthday) = EXTRACT(MONTH FROM CURRENT_DATE AT TIME ZONE 'America/Bogota')
     AND EXTRACT(DAY FROM m.birthday) = EXTRACT(DAY FROM CURRENT_DATE AT TIME ZONE 'America/Bogota'))
    OR (
      EXTRACT(MONTH FROM m.birthday) = 2 AND EXTRACT(DAY FROM m.birthday) = 29
      AND NOT ((EXTRACT(YEAR FROM CURRENT_DATE AT TIME ZONE 'America/Bogota')::int % 4 = 0 AND EXTRACT(YEAR FROM CURRENT_DATE AT TIME ZONE 'America/Bogota')::int % 100 <> 0) OR (EXTRACT(YEAR FROM CURRENT_DATE AT TIME ZONE 'America/Bogota')::int % 400 = 0))
      AND EXTRACT(MONTH FROM CURRENT_DATE AT TIME ZONE 'America/Bogota') = 2
      AND EXTRACT(DAY FROM CURRENT_DATE AT TIME ZONE 'America/Bogota') = 28
    )
  )
`.trim();
}

/** Mask phone for display — last 4 only */
export function toMaskedPhone(raw: string | null | undefined): string {
  return maskPhone(raw);
}

/** Format wa export row */
export function formatChronicExportRow(row: ChronicRow) {
  return {
    Nombre: row.name,
    Edad: row.ageYears ?? "",
    Bucket: row.ageBucket ?? "No especificado",
    Sexo: row.sex,
    "Ultima asistencia": row.lastAttendedDate ?? "",
    "Racha perdidas": row.missedStreak,
    "WhatsApp": row.waNumberMasked,
  };
}
