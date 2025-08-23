import { ErrorPage } from "../common/error-page";
import { AcceptanceRate } from "./charts/acceptance-rate";
import { ChatAcceptanceRate } from "./charts/chat-acceptance-rate";
import { ActiveUsers } from "./charts/active-users";
import { Editor } from "./charts/editor";
import { Language } from "./charts/language";
import { Stats } from "./charts/stats";
import { TotalChatsAndAcceptances } from "./charts/total-chat-suggestions-and-acceptances";
import { TotalCodeLineSuggestionsAndAcceptances } from "./charts/total-code-line-suggestions-and-acceptances";
import { TotalSuggestionsAndAcceptances } from "./charts/total-suggestions-and-acceptances";
import { DataProvider } from "./dashboard-state";
import { TimeFrameToggle } from "./filter/time-frame-toggle";
import { Header } from "./header";
import { getCopilotMetrics, IFilter as MetricsFilter } from "@/services/copilot-metrics-service";
import { getCopilotSeatsManagement, getAllCopilotSeatsTeams, IFilter as SeatServiceFilter } from "@/services/copilot-seat-service";
import { cosmosConfiguration } from "@/services/cosmos/cosmos-db-service";

export interface IProps {
  searchParams: MetricsFilter;
}

export default async function Dashboard(props: IProps) {
  const metricsFilter = props.searchParams;

  const metricsPromise = getCopilotMetrics(metricsFilter);
  const seatsPromise = getCopilotSeatsManagement({
    date: props.searchParams.endDate,
  } as SeatServiceFilter);
  const teamsPromise = getAllCopilotSeatsTeams({
    date: props.searchParams.endDate,
  } as SeatServiceFilter);
  const [metrics, seats, teams] = await Promise.all([
    metricsPromise,
    seatsPromise,
    teamsPromise,
  ]);
  const isCosmosDb = cosmosConfiguration();

  if (metrics.status !== "OK") {
    return <ErrorPage error={metrics.errors[0].message} />;
  }

  if (seats.status !== "OK") {
    return <ErrorPage error={seats.errors[0].message} />;
  }

  if (teams.status !== "OK") {
    return <ErrorPage error={teams.errors[0].message} />;
  }
  return (
    <DataProvider
      copilotUsages={metrics.response}
      seatsData={seats.response}
      teamsData={teams.response}
      filter={{
        startDate: props.searchParams.startDate,
        endDate: props.searchParams.endDate,
        enterprise: props.searchParams.enterprise,
        organization: props.searchParams.organization,
      }}
    >
      <main className="flex flex-1 flex-col gap-4 md:gap-8 pb-8">
        <Header isCosmosDb={isCosmosDb} />
        <div className="mx-auto w-full max-w-6xl container">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Stats />
            <div className="flex justify-end col-span-4">
              <TimeFrameToggle />
            </div>
            <ActiveUsers />
            <AcceptanceRate />
            <ChatAcceptanceRate />
            <TotalCodeLineSuggestionsAndAcceptances />
            <TotalSuggestionsAndAcceptances />
            <TotalChatsAndAcceptances />
            <Language />
            <Editor />
          </div>
        </div>
      </main>
    </DataProvider>
  );
}
