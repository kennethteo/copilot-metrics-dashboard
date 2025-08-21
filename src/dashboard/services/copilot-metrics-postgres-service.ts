import { formatResponseError, unknownResponseError } from "@/features/common/response-error";
import { CopilotMetrics, CopilotUsageOutput } from "@/features/common/models";
import { ServerActionResponse } from "@/features/common/server-action-response";
import { format } from "date-fns";
import { postgresClient, postgresConfiguration, executeQuery } from "./postgres-db-service";
import { ensureGitHubEnvConfig } from "./env-service";
import { stringIsNullOrEmpty, applyTimeFrameLabel } from "../utils/helpers";
import { IFilter } from "./copilot-metrics-service";

export const getCopilotMetricsFromPostgres = async (
  filter: IFilter
): Promise<ServerActionResponse<CopilotUsageOutput[]>> => {
  try {
    let start = "";
    let end = "";
    const maximumDays = 31;

    if (filter.startDate && filter.endDate) {
      start = format(filter.startDate, "yyyy-MM-dd");
      end = format(filter.endDate, "yyyy-MM-dd");
    } else {
      // Set the start date to 31 days ago and end date to today
      const todayDate = new Date();
      const startDate = new Date(todayDate);
      startDate.setDate(todayDate.getDate() - maximumDays);

      start = format(startDate, "yyyy-MM-dd");
      end = format(todayDate, "yyyy-MM-dd");
    }

    // Build the SQL query with parameterized inputs for security
    let query = `
      SELECT data 
      FROM copilot_metrics.metrics_history 
      WHERE date >= $1 AND date <= $2
    `;
    const params: any[] = [start, end];
    let paramIndex = 3;

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

    // Add team filter
    if (filter.team && filter.team.length > 0) {
      if (filter.team.length === 1) {
        query += ` AND team = $${paramIndex}`;
        params.push(filter.team[0]);
        paramIndex++;
      } else {
        const teamPlaceholders = filter.team
          .map((_, index) => `$${paramIndex + index}`)
          .join(", ");
        query += ` AND team = ANY(ARRAY[${teamPlaceholders}])`;
        params.push(...filter.team);
        paramIndex += filter.team.length;
      }
    } else {
      query += ` AND team IS NULL`;
    }

    // Add ordering for consistent results
    query += ` ORDER BY date ASC`;

    // Execute the query
    const results = await executeQuery<{ data: CopilotMetrics }>(query, params);
    
    // Extract the data field from each result
    const metrics: CopilotMetrics[] = results.map(row => row.data);

    // Apply time frame labels using the existing helper
    const dataWithTimeFrame = applyTimeFrameLabel(metrics);
    
    return {
      status: "OK",
      response: dataWithTimeFrame,
    };

  } catch (error) {
    console.error("Error fetching metrics from PostgreSQL:", error);
    return unknownResponseError(error);
  }
};

// Helper function to save metrics to PostgreSQL
export const saveCopilotMetricsToPostgres = async (
  metrics: CopilotMetrics[],
  enterprise?: string,
  organization?: string,
  team?: string
): Promise<ServerActionResponse<void>> => {
  try {
    const queries = metrics.map(metric => {
      // Apply time frame transformation to get the additional fields
      const transformed = applyTimeFrameLabel([metric])[0];
      
      const query = `
        INSERT INTO copilot_metrics.metrics_history (
          date, enterprise, organization, team, day,
          total_active_users, total_engaged_users, total_ide_engaged_users,
          total_code_suggestions, total_code_acceptances,
          total_code_lines_suggested, total_code_lines_accepted,
          total_chat_engaged_users, total_chats,
          total_chat_insertion_events, total_chat_copy_events,
          time_frame_week, time_frame_month, time_frame_display,
          breakdown, data
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
        )
        ON CONFLICT (date, COALESCE(enterprise, ''), COALESCE(organization, ''), COALESCE(team, ''))
        DO UPDATE SET
          total_active_users = EXCLUDED.total_active_users,
          total_engaged_users = EXCLUDED.total_engaged_users,
          total_ide_engaged_users = EXCLUDED.total_ide_engaged_users,
          total_code_suggestions = EXCLUDED.total_code_suggestions,
          total_code_acceptances = EXCLUDED.total_code_acceptances,
          total_code_lines_suggested = EXCLUDED.total_code_lines_suggested,
          total_code_lines_accepted = EXCLUDED.total_code_lines_accepted,
          total_chat_engaged_users = EXCLUDED.total_chat_engaged_users,
          total_chats = EXCLUDED.total_chats,
          total_chat_insertion_events = EXCLUDED.total_chat_insertion_events,
          total_chat_copy_events = EXCLUDED.total_chat_copy_events,
          time_frame_week = EXCLUDED.time_frame_week,
          time_frame_month = EXCLUDED.time_frame_month,
          time_frame_display = EXCLUDED.time_frame_display,
          breakdown = EXCLUDED.breakdown,
          data = EXCLUDED.data,
          updated_at = NOW()
      `;

      const params = [
        metric.date,
        enterprise || null,
        organization || null, 
        team || null,
        transformed.day,
        transformed.total_active_users,
        transformed.total_engaged_users,
        transformed.total_ide_engaged_users,
        transformed.total_code_suggestions,
        transformed.total_code_acceptances,
        transformed.total_code_lines_suggested,
        transformed.total_code_lines_accepted,
        transformed.total_chat_engaged_users,
        transformed.total_chats,
        transformed.total_chat_insertion_events,
        transformed.total_chat_copy_events,
        transformed.time_frame_week,
        transformed.time_frame_month,
        transformed.time_frame_display,
        JSON.stringify(transformed.breakdown),
        JSON.stringify(metric)
      ];

      return { query, params };
    });

    // Execute all queries in a transaction
    await postgresClient().query('BEGIN');
    try {
      for (const { query, params } of queries) {
        await executeQuery(query, params);
      }
      await postgresClient().query('COMMIT');
    } catch (error) {
      await postgresClient().query('ROLLBACK');
      throw error;
    }

    return {
      status: "OK",
      response: undefined,
    };

  } catch (error) {
    console.error("Error saving metrics to PostgreSQL:", error);
    return unknownResponseError(error);
  }
};