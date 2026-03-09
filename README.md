# Dynamic Enterprise Knowledge Graph Monorepo

Production-oriented monorepo scaffold for an enterprise knowledge graph product.

## Stack

- `apps/web`: Next.js + TypeScript frontend
- `apps/api`: TypeScript backend API service (Fastify)
- `apps/worker`: TypeScript worker service for transcript extraction jobs
- `packages/shared-types`: Shared TypeScript domain types/contracts

## Architecture

The scaffold is organized by product capabilities:

- `graph`
- `extraction`
- `analytics`
- `visualization`

Each app/service keeps feature-oriented folders so business logic can be added incrementally without restructuring.

## Prerequisites

- Node.js `>=20`
- pnpm `>=9`

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Create env files from examples:

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/web/.env.example apps/web/.env.local
```

3. Start all services in development:

```bash
pnpm dev
```

## Useful Commands

- `pnpm dev` - Run all apps/services in parallel
- `pnpm build` - Build all workspaces
- `pnpm typecheck` - Type-check all workspaces
- `pnpm lint` - Lint all workspaces
- `pnpm clean` - Remove build artifacts

## Notes

- This repository intentionally contains no business logic yet.
- `apps/api` and `apps/worker` use runtime env validation via `zod`.
- `apps/web` uses Next.js env conventions (`NEXT_PUBLIC_*` for public values).
