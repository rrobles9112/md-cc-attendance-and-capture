import { createClient } from "@/lib/supabase/client";

export async function getSetting(key: string): Promise<string | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .single();

  if (error || !data) return null;
  return data.value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  try {
    const { error } = await supabase.from("app_settings").upsert(
      {
        key,
        value,
        updated_by: session.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );

    if (error) {
      if ((error as { code?: string }).code === "42501") {
        throw Object.assign(
          new Error(
            "permission-denied: super_admin required (re-login if role was just granted)",
          ),
          { code: "permission-denied", cause: error },
        );
      }
      throw error;
    }
  } catch (e) {
    if (
      e instanceof Error &&
      (e as { code?: string }).code === "permission-denied"
    )
      throw e;
    if (e instanceof Error && e.message === "Not authenticated") throw e;
    const withCode = e as { code?: string; name?: string; message?: string };
    if (
      withCode &&
      typeof withCode.code === "string" &&
      withCode.code.length > 0
    )
      throw e;
    const name = withCode?.name ?? "";
    const message = withCode?.message ?? "";
    if (
      e instanceof TypeError ||
      name === "TypeError" ||
      name === "NetworkError" ||
      /fetch|network|Failed to fetch|Load failed/i.test(`${name} ${message}`)
    ) {
      throw Object.assign(new Error("network"), { code: "network", cause: e });
    }
    throw e;
  }
}

export async function getDpoContactEmail(): Promise<string> {
  const email = await getSetting("dpo_contact_email");
  return email ?? "";
}

export const RETREAT_TOTAL_COST_KEY = "retreat.youth.total_cost";

export async function getRetreatTotalCost(): Promise<string | null> {
  return getSetting(RETREAT_TOTAL_COST_KEY);
}

export async function setRetreatTotalCost(value: string): Promise<void> {
  await setSetting(RETREAT_TOTAL_COST_KEY, value);
}
