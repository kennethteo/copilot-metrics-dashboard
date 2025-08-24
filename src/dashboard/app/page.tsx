import Dashboard from "@/features/dashboard/dashboard-page";
import { Suspense } from "react";
import Loading from "./loading";
import type { IFilter as MetricsFilter } from "@/services/copilot-metrics-service";

export const dynamic = "force-dynamic";
export default async function Home(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await props.searchParams) ?? {};

  const filter: MetricsFilter = {
    startDate: sp.startDate ? new Date(sp.startDate as string) : undefined,
    endDate: sp.endDate ? new Date(sp.endDate as string) : undefined,
    enterprise: (sp.enterprise as string) || "",
    organization: (sp.organization as string) || "",
    team: Array.isArray(sp.team)
      ? (sp.team as string[])
      : sp.team
      ? [sp.team as string]
      : [],
  };

  let id = "initial-dashboard";
  if (filter.startDate && filter.endDate) {
    id = `${id}-${filter.startDate.toISOString()}-${filter.endDate.toISOString()}`;
  }

  return (
    <Suspense fallback={<Loading />} key={id}>
      {/* Pass the mapped filter as expected by the feature component */}
      <Dashboard searchParams={filter} />
    </Suspense>
  );
}
