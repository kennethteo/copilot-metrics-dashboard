# GitHub Copilot Metrics Dashboard

This is a [Next.js](https://nextjs.org/) project for visualizing GitHub Copilot metrics with support for both Azure Cosmos DB and AWS RDS PostgreSQL.

## Database Support

The application supports two database backends:

1. **PostgreSQL (AWS RDS)** - Primary/preferred option
2. **Azure Cosmos DB** - Legacy support for backward compatibility

See [POSTGRESQL_MIGRATION.md](./POSTGRESQL_MIGRATION.md) for detailed migration instructions.

## Environment Variables

Create a `.env.local` file with the following variables:

### Required GitHub Configuration
```env
GITHUB_ENTERPRISE=your-github-enterprise-name
GITHUB_ORGANIZATION=your-github-organization-name
GITHUB_TOKEN=your-github-token
GITHUB_API_VERSION=2022-11-28
GITHUB_API_SCOPE=organization
```

### Database Configuration (choose one)

**PostgreSQL (recommended):**
```env
DATABASE_URL=postgresql://username:password@localhost:5432/copilot_metrics_db
```

**Azure Cosmos DB (legacy):**
```env
AZURE_COSMOSDB_ENDPOINT=your-azure-cosmosdb-endpoint
```

## Getting Started

First, install packages:
```bash
npm install
# or
yarn install
# or
pnpm install
# or
bun install
```

### PostgreSQL Setup (optional)

If using PostgreSQL, set up your database schema:
```bash
DATABASE_URL="your-postgresql-connection-string" node migrate.js
```

### Run Development Server

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm test` - Run test suite
- `node migrate.js` - Run database migrations (PostgreSQL)

## Features

- Real-time GitHub Copilot metrics visualization
- Support for enterprise and organization scopes
- Team-based filtering and analytics
- Seat management and allocation tracking
- Historical data analysis
- Responsive dashboard design

## Database Priority

The application automatically selects the database in this order:
1. PostgreSQL (if `DATABASE_URL` is configured)
2. Cosmos DB (if `AZURE_COSMOSDB_ENDPOINT` is configured)
3. GitHub API direct access (if no database is configured)

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.
