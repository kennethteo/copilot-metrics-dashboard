import Dashboard from "@/features/seats/seats-page";
import { Suspense } from "react";
import Loading from "./loading";
import { Metadata } from 'next';
import type { IFilter as SeatServiceFilter } from "@/services/copilot-seat-service";
 
export const metadata: Metadata = {
  title: "GitHub Copilot Seats Dashboard",
  description: "GitHub Copilot Seats Dashboard",
};
export const dynamic = "force-dynamic";
export default async function Home(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await props.searchParams) ?? {};
  const filter: SeatServiceFilter = {
    date: sp.date ? new Date(sp.date as string) : undefined,
    enterprise: (sp.enterprise as string) || "",
    organization: (sp.organization as string) || "",
    team: Array.isArray(sp.team)
      ? (sp.team as string[])
      : sp.team
      ? [sp.team as string]
      : [],
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
