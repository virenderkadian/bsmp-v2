# BSMPOPS V2

Route operations and billing app for dairy delivery workflows, built with Next.js, Prisma, and Supabase Postgres.

## Stack

- Next.js App Router
- Prisma ORM
- Supabase Postgres
- TypeScript

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the environment template and fill in your values:

```bash
cp .env.example .env
```

3. Use the Supabase free-plan shared session pooler URL for both `DATABASE_URL` and `DIRECT_URL` if your local network cannot reach Supabase's IPv6 direct host.

Example:

```env
DATABASE_URL="postgresql://postgres.YOUR_PROJECT_REF:YOUR_PASSWORD@aws-REGION.pooler.supabase.com:5432/postgres?connection_limit=1&pool_timeout=20"
DIRECT_URL="postgresql://postgres.YOUR_PROJECT_REF:YOUR_PASSWORD@aws-REGION.pooler.supabase.com:5432/postgres?connection_limit=1&pool_timeout=20"

NEXT_PUBLIC_SUPABASE_URL="https://your-project-ref.supabase.co"
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="your-publishable-key"
```

4. Generate the Prisma client, run migrations, and seed the database:

```bash
npm run prisma:generate
npm run prisma:migrate:dev -- --name init
npm run db:seed
```

5. Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Supabase Connection Notes

- `DATABASE_URL` is the main app connection string.
- `DIRECT_URL` is used by Prisma for schema and migration operations.
- The app defaults to `connection_limit=10&pool_timeout=20` (see `src/lib/prisma.ts`), which assumes the **Transaction pooler** and a Supabase plan that allows more than one connection.
- If you're still on the Supabase **free plan / Session pooler**, drop `connection_limit` back to `1` in your `DATABASE_URL` (see `.env.example`) — `connection_limit=10` on the free Session pooler will produce `EMAXCONNSESSION` errors.
- `Direct connection` may fail on IPv4-only or IPv6-limited networks.

If your network supports IPv6, you can optionally use the direct host for `DIRECT_URL`:

```env
DIRECT_URL="postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT_REF.supabase.co:5432/postgres"
```

## Scripts

- `npm run dev` starts the Next.js dev server
- `npm run build` creates a production build
- `npm run start` runs the production server
- `npm run lint` runs ESLint
- `npm run prisma:generate` generates the Prisma client
- `npm run prisma:migrate:dev -- --name init` creates and applies a development migration
- `npm run db:seed` seeds the database with starter data

## Project Status

Current foundation includes:

- Prisma schema for routes, customers, products, vehicles, entries, payments, and monthly billing
- Seed data for initial local setup
- App shell and starter module pages for masters, assignments, route entry, and billing

## Security Note

Do not commit real database passwords or publishable keys. If a secret is pasted into chat, terminal history, or screenshots, rotate it in Supabase before continuing.
