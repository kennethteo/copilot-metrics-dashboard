import Dashboard from "@/features/seats/seats-page";
import { Suspense } from "react";
import Loading from "./loading";
import { Metadata } from 'next';
import type { IFilter as SeatServiceFilter } from "@/services/copilot-seat-service";
import { parseDate } from "@/utils/helpers";
 
export const metadata: Metadata = {
  title: "GitHub Copilot Seats Dashboard",
  description: "GitHub Copilot Seats Dashboard",
};
export const dynamic = "force-dynamic";
export default async function Home(props: Readonly<{
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const sp = (await props.searchParams) ?? {};

  // Normalize team param to string[]
  const teamParam = sp.team;
  let team: string[] = [];
  if (Array.isArray(teamParam)) {
    team = teamParam;
  } else if (teamParam) {
    team = [String(teamParam)];
  }

  const filter: SeatServiceFilter = {
    date: sp.date ? parseDate(sp.date as string) ?? undefined : undefined,
    enterprise: (sp.enterprise as string) || "",
    organization: (sp.organization as string) || "",
    team,
    page: sp.page ? parseInt(sp.page as string, 10) || 1 : 1,
  };

  let id = "initial-seats-dashboard";
  if (filter.date) {
    id = `${id}-${filter.date.toISOString()}`;
  }

  return (
    <Suspense fallback={<Loading />} key={id}>
      <Dashboard searchParams={filter} />
    </Suspense>
  );
}
