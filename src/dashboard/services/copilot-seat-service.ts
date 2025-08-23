import { formatResponseError, unknownResponseError } from "@/features/common/response-error";
import { ServerActionResponse } from "@/features/common/server-action-response";
import { ensureGitHubEnvConfig } from "./env-service";
import { CopilotSeatsData, SeatAssignment, GitHubTeam } from "@/features/common/models";
// import { cosmosClient, cosmosConfiguration } from "./cosmos-db-service";
import { format } from "date-fns";
// import { SqlQuerySpec } from "@azure/cosmos";
import { stringIsNullOrEmpty } from "../utils/helpers";
import { pgPool, pgConfiguration } from "./pg/pg-db-service";

export interface IFilter {
  date?: Date;
  enterprise: string;
  organization: string;
  team: string[];
  page: number;
}

export const getCopilotSeats = async (
  filter: IFilter
): Promise<ServerActionResponse<CopilotSeatsData>> => {
  const env = ensureGitHubEnvConfig();
  const isPgConfig = pgConfiguration();

  if (env.status !== "OK") {
    return env;
  }

  const { enterprise, organization } = env.response;

  try {
    switch (process.env.GITHUB_API_SCOPE) {
      case "enterprise":
        if (stringIsNullOrEmpty(filter.enterprise)) {
          filter.enterprise = enterprise;
        }
        break;
      default:
        if (stringIsNullOrEmpty(filter.organization)) {
          filter.organization = organization;
        }
        break;
    }
  if (isPgConfig) {
      return getCopilotSeatsFromDatabase(filter);
    }
    return getCopilotSeatsFromApi(filter);
  } catch (e) {
    return unknownResponseError(e);
  }
};

const getDataFromDatabase = async (
  filter: IFilter
): Promise<ServerActionResponse<CopilotSeatsData[]>> => {
  try {
    const pool = pgPool();

    let date = "";
    const maxDays = 365 * 2; // maximum 2 years of data (reserved)

    // Resolve target date: use provided date, otherwise pick latest available date
    // First try matching the provided scope; if none, fall back to any scope and drop scope filters
    let resolvedEnterprise: string | null = filter.enterprise || null;
    let resolvedOrganization: string | null = filter.organization || null;
    if (filter.date) {
      date = format(filter.date, "yyyy-MM-dd");
    } else {
      // Try scope-aware max(date)
      const scopeValues: any[] = [];
      let scopeWhere = "";
      let sIdx = 0;
      if (resolvedEnterprise) { sIdx += 1; scopeValues.push(resolvedEnterprise); scopeWhere += `${scopeWhere ? " AND " : ""} enterprise = $${sIdx}`; }
      if (resolvedOrganization) { sIdx += 1; scopeValues.push(resolvedOrganization); scopeWhere += `${scopeWhere ? " AND " : ""} organization = $${sIdx}`; }

      const scopeSql = `SELECT MAX(date) AS max_date FROM seats_history ${scopeWhere ? `WHERE ${scopeWhere}` : ""}`;
      const scopeRes = await pool.query(scopeSql, scopeValues);
      let maxDate = scopeRes.rows?.[0]?.max_date as string | Date | null | undefined;

      if (!maxDate) {
        // Fall back to any scope
        const anyRes = await pool.query(`SELECT MAX(date) AS max_date FROM seats_history`);
        maxDate = anyRes.rows?.[0]?.max_date as string | Date | null | undefined;
        // If we found data without scope, don't apply scope filters below
        if (maxDate) { resolvedEnterprise = null; resolvedOrganization = null; }
      }

      if (maxDate instanceof Date) {
        date = format(maxDate, "yyyy-MM-dd");
      } else if (typeof maxDate === "string") {
        date = maxDate;
      } else {
        // As a last resort, use today (may return no rows)
        date = format(Date.now(), "yyyy-MM-dd");
      }
    }

    // Assumptions:
    // - Table: seats_history
    // - Columns: date (DATE), enterprise TEXT NULL, organization TEXT NULL, page INT NULL, seats JSONB, total_seats INT, total_active_seats INT
    // - We'll filter by seats JSON content when team filter provided
    const values: any[] = [date];
    let where = `date = $1`;
    let idx = values.length;

    if (resolvedEnterprise) {
      idx += 1; values.push(resolvedEnterprise);
      where += ` AND enterprise = $${idx}`;
    }
    if (resolvedOrganization) {
      idx += 1; values.push(resolvedOrganization);
      where += ` AND organization = $${idx}`;
    }
    if (filter.page) {
      idx += 1; values.push(filter.page);
      where += ` AND page = $${idx}`;
    }

    // Team filter: seats is JSONB array; we want rows where any seat.assigning_team.name in provided list
    if (filter.team && filter.team.length > 0) {
      if (filter.team.length === 1) {
        idx += 1; values.push(filter.team[0]);
        where += ` AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(seats) AS seat
          WHERE seat->'assigning_team'->>'name' = $${idx}
        )`;
      } else {
        const ph: string[] = [];
        for (const t of filter.team) { idx += 1; values.push(t); ph.push(`$${idx}`); }
        where += ` AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(seats) AS seat
          WHERE seat->'assigning_team'->>'name' IN (${ph.join(", ")})
        )`;
      }
    }

    const sql = `SELECT id, date, total_seats, total_active_seats, seats, enterprise, organization, page, has_next_page, last_update
                 FROM seats_history
                 WHERE ${where}
                 ORDER BY page NULLS FIRST`;

    const { rows } = await pool.query(sql, values);
    const resources = rows.map((r: any) => ({
      id: String(r.id),
      date: r.date instanceof Date ? format(r.date, "yyyy-MM-dd") : r.date,
      total_seats: r.total_seats,
      total_active_seats: r.total_active_seats ?? 0,
      seats: r.seats,
      enterprise: r.enterprise,
      organization: r.organization,
      page: r.page ?? 1,
      has_next_page: r.has_next_page ?? false,
      last_update: r.last_update,
    }) as CopilotSeatsData);

    return { status: "OK", response: resources };
  } catch (e) {
    return unknownResponseError(e);
  }
};

const getCopilotSeatsFromDatabase = async (
  filter: IFilter
): Promise<ServerActionResponse<CopilotSeatsData>> => {
  try {
    const data = await getDataFromDatabase(filter);

    if (data.status !== "OK" || !data.response) {
      return {
        status: "ERROR",
        errors: [{ message: "No data found" }],
      };
    }

    const seatsData = aggregateSeatsData(data.response, filter.team);

    return {
      status: "OK",
      response: seatsData as CopilotSeatsData,
    };
  } catch (e) {
    return unknownResponseError(e);
  }
};

const getDataFromApi = async (
  filter: IFilter
): Promise<ServerActionResponse<CopilotSeatsData[]>> => {
  const env = ensureGitHubEnvConfig();

  if (env.status !== "OK") {
    return env;
  }

  let { token, version } = env.response;

  try {
    if (filter.enterprise) {
      let enterpriseSeats: CopilotSeatsData[] = [];
      let pageCount = 1;
      let url = `https://api.github.com/enterprises/${filter.enterprise}/copilot/billing/seats?per_page=100`;

      do {
        const enterpriseResponse = await fetch(url, {
          cache: "no-store",
          headers: {
            Accept: `application/vnd.github+json`,
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": version,
          },
        });

        if (!enterpriseResponse.ok) {
          return formatResponseError(filter.enterprise, enterpriseResponse);
        }

        const enterpriseData = await enterpriseResponse.json();
        const enterpriseSeat: CopilotSeatsData = {
          enterprise: filter.enterprise,
          seats: enterpriseData.seats,
          total_seats: enterpriseData.total_seats,
          total_active_seats: 0,
          page: pageCount,
          has_next_page: false,
          last_update: null,
          date: "",
          id: "",
          organization: null,
        };

        const linkHeader = enterpriseResponse.headers.get("Link");
        url = getNextUrlFromLinkHeader(linkHeader) || "";
        enterpriseSeat.has_next_page = !stringIsNullOrEmpty(url);
        enterpriseSeats.push(enterpriseSeat);
        pageCount++;
      } while (!stringIsNullOrEmpty(url));

      // Calculate total active seats for each page as the count of all active seats across all pages
      const allActiveSeatsCount = enterpriseSeats
        .flatMap((s) => s.seats)
        .filter((seat) => {
          if (!seat.last_activity_at) return false;
          const lastActivityDate = new Date(seat.last_activity_at);
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          return lastActivityDate >= thirtyDaysAgo;
        }).length;

      enterpriseSeats.forEach((seatPage) => {
        seatPage.total_active_seats = allActiveSeatsCount;
      });

      return {
        status: "OK",
        response: enterpriseSeats,
      };
    }

    let organizationSeats: CopilotSeatsData[] = [];
    let pageCount = 1;
    let url = `https://api.github.com/orgs/${filter.organization}/copilot/billing/seats?per_page=100`;
    do {
      const organizationResponse = await fetch(url, {
        cache: "no-store",
        headers: {
          Accept: `application/vnd.github+json`,
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": version,
        },
      });

      if (!organizationResponse.ok) {
        return formatResponseError(filter.organization, organizationResponse);
      }

      const organizationData = await organizationResponse.json();
      const organizationSeat: CopilotSeatsData = {
        organization: filter.organization,
        seats: organizationData.seats,
        total_seats: organizationData.total_seats,
        total_active_seats: 0,
        page: pageCount,
        has_next_page: false,
        last_update: null,
        date: "",
        id: "",
        enterprise: null,
      };

      const linkHeader = organizationResponse.headers.get("Link");
      url = getNextUrlFromLinkHeader(linkHeader) || "";
      organizationSeat.has_next_page = !stringIsNullOrEmpty(url);
      organizationSeats.push(organizationSeat);
      pageCount++;
    } while (!stringIsNullOrEmpty(url));

    // Calculate total active seats for each page as the count of all active seats across all pages
    const allActiveSeatsCount = organizationSeats
      .flatMap((s) => s.seats)
      .filter((seat) => {
        if (!seat.last_activity_at) return false;
        const lastActivityDate = new Date(seat.last_activity_at);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        return lastActivityDate >= thirtyDaysAgo;
      }).length;

    organizationSeats.forEach((seatPage) => {
      seatPage.total_active_seats = allActiveSeatsCount;
    });

    return {
      status: "OK",
      response: organizationSeats,
    };
  } catch (e) {
    return unknownResponseError(e);
  }
};

const getCopilotSeatsFromApi = async (
  filter: IFilter
): Promise<ServerActionResponse<CopilotSeatsData>> => {
  try {
    const data = await getDataFromApi(filter);

    if (data.status !== "OK" || !data.response) {
      return {
        status: "ERROR",
        errors: [{ message: "No data found" }],
      };
    }

    const seatsData = aggregateSeatsData(data.response, filter.team);

    return {
      status: "OK",
      response: seatsData as CopilotSeatsData,
    };
  } catch (e) {
    return unknownResponseError(e);
  }
};

export const getCopilotSeatsManagement = async (
  filter: IFilter
): Promise<ServerActionResponse<CopilotSeatsData>> => {
  const env = ensureGitHubEnvConfig();
  const isPgConfig = pgConfiguration();

  if (env.status !== "OK") {
    return env;
  }

  const { enterprise, organization } = env.response;

  try {
    switch (process.env.GITHUB_API_SCOPE) {
      case "enterprise":
        if (stringIsNullOrEmpty(filter.enterprise)) {
          filter.enterprise = enterprise;
        }
        break;
      default:
        if (stringIsNullOrEmpty(filter.organization)) {
          filter.organization = organization;
        }
        break;
    }

  if (isPgConfig) {
      const data = await getCopilotSeatsFromDatabase(filter);

      if (data.status !== "OK" || !data.response) {
        return {
          status: "OK",
          response: {} as CopilotSeatsData,
        };
      }

      const seatsData = data.response;
      return {
        status: "OK",
        response: seatsData as CopilotSeatsData,
      };
    }

    const data = await getCopilotSeatsFromApi(filter);

    if (data.status !== "OK" || !data.response) {
      return {
        status: "OK",
        response: {} as CopilotSeatsData,
      };
    }

    const seatsData = data.response;

    return {
      status: "OK",
      response: seatsData as CopilotSeatsData,
    };
  } catch (e) {
    return unknownResponseError(e);
  }
};

const getNextUrlFromLinkHeader = (linkHeader: string | null): string | null => {
  if (!linkHeader) return null;

  const links = linkHeader.split(",");
  for (const link of links) {
    const match = link.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match && match[2] === "next") {
      return match[1];
    }
  }
  return null;
};

const aggregateSeatsData = (
  data: CopilotSeatsData[],
  teamFilter?: string[]
): CopilotSeatsData => {
  let seats: SeatAssignment[] = [];

  if (data.length === 0) {
    return {
      total_seats: 0,
      total_active_seats: 0,
      seats: seats,
    } as CopilotSeatsData;
  }

  // Garantee backwards compatibility with document without the total_active_seats property
  if (
    data[0].total_active_seats === null ||
    data[0].total_active_seats === undefined
  ) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    data[0].total_active_seats = data[0].seats.filter((seat) => {
      if (!seat.last_activity_at) return false;
      const lastActivityDate = new Date(seat.last_activity_at);
      return lastActivityDate >= thirtyDaysAgo;
    }).length;
  }

  if (data.length === 1) {
    // Apply team filtering if specified
    let filteredSeats = data[0].seats;
    if (teamFilter && teamFilter.length > 0) {
      filteredSeats = data[0].seats.filter(
        (seat) =>
          seat.assigning_team?.name &&
          teamFilter.includes(seat.assigning_team.name)
      );
    }

    // Recalculate totals based on filtered seats
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const activeSeatsCount = filteredSeats.filter((seat) => {
      if (!seat.last_activity_at) return false;
      const lastActivityDate = new Date(seat.last_activity_at);
      return lastActivityDate >= thirtyDaysAgo;
    }).length;

    return {
      ...data[0],
      total_seats: filteredSeats.length,
      total_active_seats: activeSeatsCount,
      seats: filteredSeats,
    };
  }

  // For multiple documents, flatten and deduplicate seats
  const allSeats = data.flatMap((seatData) => seatData.seats);

  // Apply team filtering if specified
  let filteredSeats = allSeats;
  if (teamFilter && teamFilter.length > 0) {
    filteredSeats = allSeats.filter(
      (seat) =>
        seat.assigning_team?.name &&
        teamFilter.includes(seat.assigning_team.name)
    );
  }

  const uniqueSeatsMap = new Map<string, SeatAssignment>();
  filteredSeats.forEach((seat) => {
    if (!uniqueSeatsMap.has(seat.assignee.login)) {
      uniqueSeatsMap.set(seat.assignee.login, seat);
    }
  });

  seats = Array.from(uniqueSeatsMap.values());

  // Recalculate totals based on filtered and deduplicated seats
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const activeSeatsCount = seats.filter((seat) => {
    if (!seat.last_activity_at) return false;
    const lastActivityDate = new Date(seat.last_activity_at);
    return lastActivityDate >= thirtyDaysAgo;
  }).length;

  const aggregatedData: CopilotSeatsData = {
    enterprise: data[0].enterprise,
    organization: data[0].organization,
    total_seats: seats.length,
    total_active_seats: activeSeatsCount,
    page: data[0].page,
    has_next_page: false,
    last_update: data[0].last_update,
    date: data[0].date,
    id: data[0].id,
    seats: seats,
  };

  return aggregatedData;
};

export const getAllCopilotSeatsTeams = async (
  filter: IFilter
): Promise<ServerActionResponse<GitHubTeam[]>> => {
  const env = ensureGitHubEnvConfig();
  const isPgConfig = pgConfiguration();

  if (env.status !== "OK") {
    return env;
  }

  const { enterprise, organization } = env.response;

  try {
    switch (process.env.GITHUB_API_SCOPE) {
      case "enterprise":
        if (stringIsNullOrEmpty(filter.enterprise)) {
          filter.enterprise = enterprise;
        }
        break;
      default:
        if (stringIsNullOrEmpty(filter.organization)) {
          filter.organization = organization;
        }
        break;
    }
  if (isPgConfig) {
      const dbResult = await getAllCopilotSeatsTeamsFromDatabase(filter);
      if (dbResult.status !== "OK" || !dbResult.response) {
        return {
          status: "ERROR",
          errors: [{ message: "No data found" }],
        };
      }
      return {
        status: "OK",
        response: dbResult.response,
      };
    }
    const apiResult = await getAllCopilotSeatsTeamsFromApi(filter);
    if (apiResult.status !== "OK" || !apiResult.response) {
      return {
        status: "ERROR",
        errors: [{ message: "No data found" }],
      };
    }
    return {
      status: "OK",
      response: apiResult.response,
    };
  } catch (e) {
    return unknownResponseError(e);
  }
};

const getAllCopilotSeatsTeamsFromDatabase = async (
  filter: IFilter
): Promise<ServerActionResponse<GitHubTeam[]>> => {
  try {
    const pool = pgPool();

    let date = "";
    // Resolve latest available date similar to seats data fetch
    let resolvedEnterprise: string | null = filter.enterprise || null;
    let resolvedOrganization: string | null = filter.organization || null;
    if (filter.date) {
      date = format(filter.date, "yyyy-MM-dd");
    } else {
      const scopeValues: any[] = [];
      let scopeWhere = "";
      let sIdx = 0;
      if (resolvedEnterprise) { sIdx += 1; scopeValues.push(resolvedEnterprise); scopeWhere += `${scopeWhere ? " AND " : ""} enterprise = $${sIdx}`; }
      if (resolvedOrganization) { sIdx += 1; scopeValues.push(resolvedOrganization); scopeWhere += `${scopeWhere ? " AND " : ""} organization = $${sIdx}`; }

      const scopeSql = `SELECT MAX(date) AS max_date FROM seats_history ${scopeWhere ? `WHERE ${scopeWhere}` : ""}`;
      const scopeRes = await pool.query(scopeSql, scopeValues);
      let maxDate = scopeRes.rows?.[0]?.max_date as string | Date | null | undefined;

      if (!maxDate) {
        const anyRes = await pool.query(`SELECT MAX(date) AS max_date FROM seats_history`);
        maxDate = anyRes.rows?.[0]?.max_date as string | Date | null | undefined;
        if (maxDate) { resolvedEnterprise = null; resolvedOrganization = null; }
      }

      if (maxDate instanceof Date) {
        date = format(maxDate, "yyyy-MM-dd");
      } else if (typeof maxDate === "string") {
        date = maxDate;
      } else {
        date = format(Date.now(), "yyyy-MM-dd");
      }
    }

  const values: any[] = [date];
    let where = `date = $1`;
    let idx = values.length;
  if (resolvedEnterprise) { idx += 1; values.push(resolvedEnterprise); where += ` AND enterprise = $${idx}`; }
  if (resolvedOrganization) { idx += 1; values.push(resolvedOrganization); where += ` AND organization = $${idx}`; }

    // Extract distinct assigning_team from seats JSONB
    const sql = `
      WITH expanded AS (
        SELECT jsonb_array_elements(seats) AS seat
        FROM seats_history
        WHERE ${where}
      )
      SELECT DISTINCT
        seat->'assigning_team' AS assigning_team
      FROM expanded
      WHERE (seat->'assigning_team') IS NOT NULL
    `;

    const { rows } = await pool.query(sql, values);
    const teams: GitHubTeam[] = (rows as Array<{ assigning_team: GitHubTeam }>)
      .map((r) => r.assigning_team)
      .filter((t: GitHubTeam) => Boolean(t && t.name && t.name.trim().length > 0))
      .sort((a: GitHubTeam, b: GitHubTeam) => (a.name || "").localeCompare(b.name || ""));

    return { status: "OK", response: teams };
  } catch (e) {
    return unknownResponseError(e);
  }
};

const getAllCopilotSeatsTeamsFromApi = async (
  filter: IFilter
): Promise<ServerActionResponse<GitHubTeam[]>> => {
  // There isn't a direct GitHub API to list Copilot assigning teams.
  // Fallback: fetch seats and derive teams client-side.
  const seatsResult = await getCopilotSeatsFromApi(filter);
  if (seatsResult.status !== "OK" || !seatsResult.response) {
    return {
      status: "ERROR",
      errors: [{ message: "Failed to fetch seats for deriving teams" }],
    };
  }
  const seats = seatsResult.response.seats || [];
  const set = new Map<string, GitHubTeam>();
  for (const seat of seats) {
    const team = seat.assigning_team;
    if (team && team.name && !set.has(team.slug)) {
      set.set(team.slug, team);
    }
  }
  const teams = Array.from(set.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return { status: "OK", response: teams };
}