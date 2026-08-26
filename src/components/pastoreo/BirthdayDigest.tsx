import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BirthdayRow } from "@/lib/pastoreo/queries";

interface Props {
  upcoming: BirthdayRow[];
  missingCount: number;
}

export function BirthdayDigest({ upcoming, missingCount }: Props) {
  return (
    <div className="space-y-4" data-testid="birthday-digest">
      {missingCount > 0 && (
        <div
          data-testid="birthday-warning"
          className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800"
        >
          {missingCount} miembros sin fecha de nacimiento —{" "}
          <a href="/members" className="underline">
            completar datos
          </a>
        </div>
      )}

      {upcoming.length === 0 ? (
        <div data-testid="birthday-empty" className="rounded-md border p-6 text-center text-muted-foreground">
          No hay cumpleanos proximos en los siguientes 30 dias.
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Proximos cumpleanos (30 dias)</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2" data-testid="birthday-list">
              {upcoming.map((b) => (
                <li
                  key={b.id}
                  data-testid="birthday-row"
                  className="flex justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <span>{b.name}</span>
                  <span className="text-muted-foreground">
                    {b.birthday} — {b.ageToday} anos
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
