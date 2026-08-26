"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const AGE_BUCKETS = ["0-12", "13-17", "18-25", "26-35", "36-50", "51+"] as const;
const SEX_OPTIONS = ["M", "F", "other", "prefer_not_to_say", "No especificado"] as const;

export function PastoreoFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value || value === "all") params.delete(key);
      else params.set(key, value);
      router.push(`?${params.toString()}`);
    },
    [router, searchParams]
  );

  const ageBucket = searchParams.get("age_bucket") ?? "all";
  const sex = searchParams.get("sex") ?? "all";

  return (
    <div
      className="flex flex-wrap gap-4 rounded-lg border p-4"
      data-testid="pastoreo-filters"
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="filter-age">Bucket edad</Label>
        <Select value={ageBucket} onValueChange={(v) => updateParam("age_bucket", v)}>
          <SelectTrigger id="filter-age" className="w-[160px]" data-testid="filter-age">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {AGE_BUCKETS.map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filter-sex">Sexo</Label>
        <Select value={sex} onValueChange={(v) => updateParam("sex", v)}>
          <SelectTrigger id="filter-sex" className="w-[200px]" data-testid="filter-sex">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {SEX_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filter-from">Desde</Label>
        <input
          id="filter-from"
          data-testid="filter-from"
          type="date"
          defaultValue={searchParams.get("from") ?? ""}
          onChange={(e) => updateParam("from", e.target.value)}
          className="h-9 rounded-md border px-3 text-sm"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="filter-to">Hasta</Label>
        <input
          id="filter-to"
          data-testid="filter-to"
          type="date"
          defaultValue={searchParams.get("to") ?? ""}
          onChange={(e) => updateParam("to", e.target.value)}
          className="h-9 rounded-md border px-3 text-sm"
        />
      </div>

      <div className="flex items-end">
        <Button
          variant="outline"
          data-testid="filter-clear"
          onClick={() => router.push("?tab=" + (searchParams.get("tab") ?? "resumen"))}
        >
          Limpiar filtros
        </Button>
      </div>
    </div>
  );
}
