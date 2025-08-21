#!/usr/bin/env node

/**
 * Database Migration Script
 * 
 * This script helps migrate from Azure Cosmos DB to AWS RDS PostgreSQL
 * It can be run to set up the initial PostgreSQL schema or to migrate data
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    console.log('Connecting to PostgreSQL database...');
    await pool.query('SELECT NOW()');
    console.log('✅ Successfully connected to PostgreSQL');

    // Read and execute the schema SQL file
    const schemaPath = path.join(__dirname, 'sql', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      console.log('Running database schema migrations...');
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(schemaSql);
      console.log('✅ Schema migrations completed successfully');
    } else {
      console.warn('⚠️  Schema file not found at:', schemaPath);
    }

    // Verify the tables were created
    const tablesQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'copilot_metrics'
      ORDER BY table_name;
    `;
    
    const result = await pool.query(tablesQuery);
    console.log('✅ Created tables:');
    result.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });

    console.log('\n🎉 Database migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Update your .env file to include DATABASE_URL');
    console.log('2. Restart your application');
    console.log('3. The application will now use PostgreSQL instead of Cosmos DB');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations };