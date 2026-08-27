import { parsePositiveTotal } from "./payments";

/**
 * Columns for paginated retreat_registrations fetch (AD-004).
 * Must include transferred_* for badge + audit, birthday/is_minor for future export.
 */
export const RETREAT_REGISTRATIONS_SELECT =
  "id,name,email,phone,birthday,is_minor,legal_rep_name,status,created_at,transferred_at,transferred_member_id,member_id";

/**
 * Escape PostgREST ilike wildcards: % _ , \ . // comma escaped for .or URL safety
 * Mirrors design AD-004: replace(/[%_,\\]/g,'\\$&')
 */
export function escapeIlikeSearch(value: string): string {
  return value.replace(/[%_,\\]/g, (m) => `\\${m}`);
}

/**
 * Build PostgREST .or filter for search across name,email,phone.
 * Returns null when empty after trim (no filter). Pure, no supabase client.
 */
export function buildSearchOrFilter(search: string): string | null {
  const t = search.trim();
  if (!t) return null;
  const e = escapeIlikeSearch(t);
  return `name.ilike.%${e}%,email.ilike.%${e}%,phone.ilike.%${e}%`;
}

/**
 * Pagination range inclusive [from,to] for supabase.range(). Page 1-indexed.
 */
export function getPaginationRange(
  page: number,
  pageSize: number,
): { from: number; to: number } {
  const p = Math.max(1, Math.floor(page));
  const s = Math.max(1, Math.floor(pageSize));
  const from = (p - 1) * s;
  return { from, to: from + s - 1 };
}

export type PaymentForAbonos = { amount: number | string; created_at: string };

export type RowAbonos = {
  paid: number;
  remaining: number | null;
  percent: number | null;
  count: number;
  last: string | null;
};

/**
 * Compute abonos aggregates per row (AD-006). Pure, no IO.
 * - paid = SUM(amount)
 * - remaining = total - paid (null when total missing)
 * - percent = paid/total*100 (null when total missing/0)
 * - last = MAX(created_at)
 */
export function computeRowAbonos(
  payments: PaymentForAbonos[],
  totalRaw: string | null,
): RowAbonos {
  let paid = 0;
  let last: string | null = null;
  let max = -1;
  for (const p of payments) {
    const a = typeof p.amount === "number" ? p.amount : Number(p.amount);
    if (Number.isFinite(a)) paid += a;
    if (p.created_at) {
      const t = new Date(p.created_at).getTime();
      if (!Number.isNaN(t) && t > max) {
        max = t;
        last = p.created_at;
      }
    }
  }
  const total = parsePositiveTotal(totalRaw);
  return {
    paid,
    remaining: total === null ? null : total - paid,
    percent: total === null || total === 0 ? null : (paid / total) * 100,
    count: payments.length,
    last,
  };
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("es-CO", { maximumFractionDigits: 0 })}%`;
}

export function formatLastPayment(date: string | null): string {
  if (!date) return "—";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatAmountCOP(value: number): string {
  return value.toLocaleString("es-CO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function groupPaymentsByRegistration(
  payments: Array<{ registration_id: string; amount: number | string; created_at: string }>,
): Map<string, PaymentForAbonos[]> {
  const m = new Map<string, PaymentForAbonos[]>();
  for (const p of payments) {
    const a = m.get(p.registration_id) ?? [];
    a.push({ amount: p.amount, created_at: p.created_at });
    m.set(p.registration_id, a);
  }
  return m;
}
