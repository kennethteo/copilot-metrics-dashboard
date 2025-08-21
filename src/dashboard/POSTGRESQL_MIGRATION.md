# PostgreSQL Migration Guide

This guide explains how to migrate the GitHub Copilot Metrics Dashboard from Azure Cosmos DB to AWS RDS PostgreSQL.

## Overview

The application has been refactored to support PostgreSQL as the primary database while maintaining backward compatibility with Azure Cosmos DB during the transition period.

## What Changed

### Database Service Layer
- **New Service**: `postgres-db-service.ts` - PostgreSQL connection and query management
- **New Service**: `copilot-metrics-postgres-service.ts` - PostgreSQL-specific metrics operations  
- **New Service**: `copilot-seat-postgres-service.ts` - PostgreSQL-specific seats operations
- **Updated**: Main services now prefer PostgreSQL over Cosmos DB when both are configured

### Database Schema
- **PostgreSQL Tables**: Replace Cosmos DB containers with equivalent tables:
  - `copilot_metrics.history` (replaces `history` container)
  - `copilot_metrics.metrics_history` (replaces `metrics_history` container)
  - `copilot_metrics.seats_history` (replaces `seats_history` container)

### Environment Variables
- **New**: `DATABASE_URL` - PostgreSQL connection string
- **Existing**: `AZURE_COSMOSDB_ENDPOINT` - Still supported for backward compatibility

## Migration Steps

### 1. Set Up AWS RDS PostgreSQL Instance

Create a new RDS PostgreSQL instance in AWS with:
- Engine: PostgreSQL 13+ 
- Instance size: Appropriate for your workload (e.g., db.t3.micro for testing)
- Storage: 20GB minimum, enable auto-scaling if needed
- VPC: Configure security groups to allow connections from your application

### 2. Install Dependencies

The required PostgreSQL dependencies are already included:
```bash
npm install pg @types/pg
```

### 3. Configure Environment Variables

Update your `.env` file:
```env
# PostgreSQL Database (primary)
DATABASE_URL=postgresql://username:password@your-rds-endpoint:5432/copilot_metrics_db

# Azure Cosmos DB (backup/legacy - optional)
AZURE_COSMOSDB_ENDPOINT=your-azure-cosmosdb-endpoint
```

### 4. Run Database Migration

Execute the migration script to set up the PostgreSQL schema:
```bash
cd src/dashboard
DATABASE_URL="your-postgresql-connection-string" node migrate.js
```

### 5. Update Infrastructure (Bicep)

You'll need to update the Bicep templates to provision RDS instead of Cosmos DB:

1. **Remove Cosmos DB resources** from `infra/resources.bicep`
2. **Add RDS resources** - Note: Bicep doesn't natively support AWS resources, so you'll need to:
   - Use AWS CloudFormation templates, or
   - Use Terraform for AWS resources, or
   - Manually provision RDS in AWS Console

3. **Update environment variables** in App Service configuration to use `DATABASE_URL`

### 6. Update Background Functions (.NET)

The background data ingestion functions will need to be updated to write to PostgreSQL instead of Cosmos DB:

1. **Add PostgreSQL NuGet package**: `Npgsql` or `Npgsql.EntityFrameworkCore.PostgreSQL`
2. **Update connection configuration** to use PostgreSQL connection string
3. **Replace Cosmos DB SDK calls** with PostgreSQL queries
4. **Update data models** to work with relational schema

## Database Schema Mapping

| Cosmos DB Container | PostgreSQL Table | Partition Key → Index |
|-------------------|------------------|---------------------|
| `history` | `copilot_metrics.history` | `/Month` → `month` column + index |
| `metrics_history` | `copilot_metrics.metrics_history` | `/date` → `date` column + index |
| `seats_history` | `copilot_metrics.seats_history` | `/date` → `date` column + index |

## Key Features

### 1. Graceful Fallback
The application checks for PostgreSQL configuration first, then falls back to Cosmos DB if PostgreSQL is not configured.

### 2. Data Compatibility
Both JSON documents and relational fields are stored, maintaining compatibility with existing data structures.

### 3. Performance Optimization
- Proper indexing on commonly queried fields
- Connection pooling for PostgreSQL
- Optional table partitioning for large datasets

### 4. Transaction Support
PostgreSQL transactions ensure data consistency during writes.

## Configuration Priority

The application uses this priority order for database connections:
1. **PostgreSQL** (if `DATABASE_URL` is configured)
2. **Cosmos DB** (if `AZURE_COSMOSDB_ENDPOINT` is configured)  
3. **GitHub API** (if no database is configured)

## Testing

After migration, verify the setup:

1. **Build the application**:
   ```bash
   npm run build
   ```

2. **Run tests**:
   ```bash
   npm test
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```

4. **Verify data flow**:
   - Check that metrics data is being read from PostgreSQL
   - Verify that new data ingestion writes to PostgreSQL
   - Test filtering and date range queries

## Troubleshooting

### Connection Issues
- Verify RDS security groups allow inbound connections
- Check that the DATABASE_URL format is correct
- Ensure PostgreSQL version compatibility (13+)

### Performance Issues  
- Monitor query performance and add indexes as needed
- Consider implementing table partitioning for large datasets
- Adjust connection pool settings based on load

### Data Migration
- For existing Cosmos DB data, you'll need a separate migration script
- Consider running both systems in parallel during transition
- Validate data integrity after migration

## Rollback Plan

If you need to rollback to Cosmos DB:
1. Remove or comment out the `DATABASE_URL` environment variable
2. Ensure `AZURE_COSMOSDB_ENDPOINT` is still configured
3. Restart the application - it will automatically fall back to Cosmos DB

## Next Steps

1. **Infrastructure as Code**: Update your deployment templates
2. **Monitoring**: Set up monitoring for the new PostgreSQL database
3. **Backup Strategy**: Implement backup and disaster recovery for RDS
4. **Performance Tuning**: Monitor and optimize query performance
5. **Data Migration**: Migrate existing Cosmos DB data to PostgreSQL if needed