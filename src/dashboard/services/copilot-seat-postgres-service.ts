import { formatResponseError, unknownResponseError } from "@/features/common/response-error";
import { CopilotSeatsData } from "@/features/common/models";
import { ServerActionResponse } from "@/features/common/server-action-response";
import { format } from "date-fns";
import { executeQuery } from "./postgres-db-service";
import { IFilter } from "./copilot-seat-service";

export const getCopilotSeatsFromPostgres = async (
  filter: IFilter
): Promise<ServerActionResponse<CopilotSeatsData[]>> => {
  try {
    let dateFilter = "";
    const params: any[] = [];
    let paramIndex = 1;

    // Handle date filtering
    if (filter.date) {
      dateFilter = format(filter.date, "yyyy-MM-dd");
    } else {
      dateFilter = format(new Date(), "yyyy-MM-dd");
    }

    // Build the SQL query
    let query = `
      SELECT data 
      FROM copilot_metrics.seats_history 
      WHERE date = $${paramIndex}
    `;
    params.push(dateFilter);
    paramIndex++;

    // Add enterprise filter
    if (filter.enterprise) {
      query += ` AND enterprise = $${paramIndex}`;
      params.push(filter.enterprise);
      paramIndex++;
    }

    // Add organization filter  
    if (filter.organization) {
      query += ` AND organization = $${paramIndex}`;
      params.push(filter.organization);
      paramIndex++;
    }

    // Add team filter - for seats, team filtering would be applied to the seats data
    // We'll handle this after fetching the data since teams are within the seats array

    // Add ordering for consistent results
    query += ` ORDER BY page ASC`;

    // Execute the query
    const results = await executeQuery<{ data: CopilotSeatsData }>(query, params);
    
    // Extract the data field from each result
    let seatsData: CopilotSeatsData[] = results.map(row => row.data);

    // Apply team filtering if specified
    if (filter.team && filter.team.length > 0) {
      seatsData = seatsData.map(seatPage => ({
        ...seatPage,
        seats: seatPage.seats.filter(seat => {
          // Check if the seat's user is in any of the specified teams
          // Note: This is a simplified approach - in reality, you'd need to query
          // team membership from GitHub API or store team membership data
          return filter.team!.some(team => 
            seat.assigning_team?.slug === team
          );
        })
      })).filter(seatPage => seatPage.seats.length > 0); // Only return pages with seats
    }

    return {
      status: "OK",
      response: seatsData,
    };

  } catch (error) {
    console.error("Error fetching seats from PostgreSQL:", error);
    return unknownResponseError(error);
  }
};

// Helper function to save seats data to PostgreSQL
export const saveCopilotSeatsToPostgres = async (
  seatsData: CopilotSeatsData[],
  enterprise?: string,
  organization?: string
): Promise<ServerActionResponse<void>> => {
  try {
    const queries = seatsData.map(seatPage => {
      const query = `
        INSERT INTO copilot_metrics.seats_history (
          date, enterprise, organization, total_seats, total_active_seats,
          page, has_next_page, last_update, seats, data
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        )
        ON CONFLICT (date, COALESCE(enterprise, ''), COALESCE(organization, ''), page)
        DO UPDATE SET
          total_seats = EXCLUDED.total_seats,
          total_active_seats = EXCLUDED.total_active_seats,
          has_next_page = EXCLUDED.has_next_page,
          last_update = EXCLUDED.last_update,
          seats = EXCLUDED.seats,
          data = EXCLUDED.data,
          updated_at = NOW()
      `;

      const params = [
        seatPage.date,
        enterprise || null,
        organization || null, 
        seatPage.total_seats,
        seatPage.total_active_seats,
        seatPage.page,
        seatPage.has_next_page,
        seatPage.last_update ? new Date(seatPage.last_update) : null,
        JSON.stringify(seatPage.seats),
        JSON.stringify(seatPage)
      ];

      return { query, params };
    });

    // Execute all queries in a transaction
    const pool = require('./postgres-db-service').postgresClient();
    await pool.query('BEGIN');
    try {
      for (const { query, params } of queries) {
        await executeQuery(query, params);
      }
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

    return {
      status: "OK",
      response: undefined,
    };

  } catch (error) {
    console.error("Error saving seats to PostgreSQL:", error);
    return unknownResponseError(error);
  }
};

// Helper function to aggregate seats data by teams if needed
export const aggregateSeatsDataByTeam = (
  seatsData: CopilotSeatsData[],
  teams: string[]
): CopilotSeatsData => {
  if (seatsData.length === 0) {
    return {
      id: "",
      date: "",
      total_seats: 0,
      total_active_seats: 0,
      seats: [],
      enterprise: null,
      organization: null,
      page: 1,
      has_next_page: false,
      last_update: null,
    };
  }

  // Combine all seats from all pages
  const allSeats = seatsData.flatMap(page => page.seats);

  // Filter by teams if specified
  const filteredSeats = teams.length > 0 
    ? allSeats.filter(seat => 
        teams.some(team => seat.assigning_team?.slug === team)
      )
    : allSeats;

  // Calculate active seats (seats with activity in the last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const activeSeatCount = filteredSeats.filter(seat => {
    if (!seat.last_activity_at) return false;
    const lastActivityDate = new Date(seat.last_activity_at);
    return lastActivityDate >= thirtyDaysAgo;
  }).length;

  // Use the first page's metadata
  const firstPage = seatsData[0];

  return {
    ...firstPage,
    total_seats: filteredSeats.length,
    total_active_seats: activeSeatCount,
    seats: filteredSeats,
    page: 1,
    has_next_page: false,
  };
};