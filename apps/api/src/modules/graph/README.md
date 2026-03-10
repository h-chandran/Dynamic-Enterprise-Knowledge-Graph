# Graph API Module

Shared graph persistence pieces for Neo4j now live here and in `src/infrastructure/database`.

## Neo4j Schema Initialization

Schema migrations are stored in:

- `apps/api/src/infrastructure/database/migrations/neo4j/001_constraints.cypher`
- `apps/api/src/infrastructure/database/migrations/neo4j/002_indexes.cypher`

They cover all canonical node labels used by the ontology:

- `Person`
- `Team`
- `Project`
- `Task`
- `Blocker`
- `Skill`
- `Meeting`
- `TranscriptChunk`
- `UpdateEvent`

Run schema setup from the repo root:

```bash
pnpm --filter @dekgraph/api neo4j:schema
```

This script is idempotent and safe to run repeatedly. It uses:

- `CREATE CONSTRAINT ... IF NOT EXISTS`
- `CREATE INDEX ... IF NOT EXISTS`

## Required Environment Variables

- `NEO4J_URI`
- `NEO4J_USERNAME`
- `NEO4J_PASSWORD`
- `NEO4J_DATABASE` (defaults to `neo4j`)

## Idempotent Node Creation Helpers

Helpers are in:

- `apps/api/src/modules/graph/neo4j-node-helpers.ts`

Available helpers:

- `createOrMergePersonNode`
- `createOrMergeTeamNode`
- `createOrMergeProjectNode`
- `createOrMergeTaskNode`
- `createOrMergeBlockerNode`
- `createOrMergeSkillNode`
- `createOrMergeMeetingNode`
- `createOrMergeTranscriptChunkNode`
- `createOrMergeUpdateEventNode`
- `createOrMergeNode` (generic)

These helpers use `MERGE (n:Label {id: $id})` so writes are idempotent on canonical IDs.
