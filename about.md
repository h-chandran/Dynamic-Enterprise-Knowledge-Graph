# About This Project

**Dynamic Enterprise Knowledge Graph** is a production-oriented platform that builds and maintains a knowledge graph from unstructured enterprise data—primarily meeting transcripts and employee check-ins. It extracts people, teams, projects, tasks, blockers, and skills from natural language, stores them in a graph database, and exposes them through analytics, insights, and interactive visualization.

## What It Does

1. **Ingests meetings** — Accepts raw meeting transcripts (e.g., employee check-ins) via the API. Transcripts are chunked by semantic category (active work, progress updates, blockers, dependencies, skill gaps, uncertainty) and stored in Postgres.

2. **Extracts structured knowledge** — A worker service processes transcript chunks through a multi-pass LLM pipeline:
   - **Entities**: People, Teams, Projects, Tasks, Blockers, Skills, Meetings
   - **Relationships**: MEMBER_OF, WORKS_ON, OWNS, PART_OF, BLOCKED_BY, HAS_SKILL
   - **Update events**: DAILY_SUMMARY_RECORDED, TASK_PROGRESS_REPORTED, TASK_COMPLETED, BLOCKER_REPORTED, BLOCKER_RESOLVED, MEETING_NOTED

   Extraction results are validated, retried on failure, and stored in Postgres for review and audit.

3. **Builds the graph** — Extracted data is written to Neo4j through:
   - **Entity resolution**: Maps extracted entities to canonical graph nodes (create or merge)
   - **Event layer writer**: Creates UpdateEvent nodes and links them to TranscriptChunks (SUPPORTS) and asserted entities/relationships (ASSERTED)
   - **Current state materializer**: Derives operational facts (e.g., Person WORKS_ON Task) from events using confidence thresholds and observation counts
   - **Fact conflict handler**: Resolves conflicting or superseded facts over time

4. **Serves analytics** — The API computes metrics over the graph, such as:
   - Blocker centrality (impact of blockers on tasks, projects, people)
   - Skill coverage (which skills are used across teams and projects)
   - Task ownership distribution
   - Project health indicators

5. **Generates insights** — Identifies patterns and risks:
   - Repeated blockers (same or similar blockers affecting multiple people/teams)
   - Skill gaps (skills needed but underprovided)
   - Overload (people with too many projects, tasks, or sole ownership)

6. **Visualizes the graph** — The web app lets users explore subgraphs by team, project, or person. It supports temporal exploration (viewing the graph as of a point in time) and displays insight cards alongside the visualization.

## Architecture

- **apps/web**: Next.js + TypeScript frontend for graph visualization and dashboards
- **apps/api**: Fastify backend with meeting ingestion, extraction admin, analytics, insights, and visualization endpoints
- **apps/worker**: TypeScript worker for transcript extraction jobs (LLM-based extraction with retry and validation)
- **packages/shared-types**: Shared TypeScript types and schemas for the ontology, extraction output, analytics, and visualization

**Data stores:**
- **Neo4j**: Graph storage (nodes and relationships)
- **Postgres**: Meetings, transcript chunks, extraction jobs, extraction reviews

## Domain Model

The graph ontology defines node types (Person, Team, Project, Task, Blocker, Skill, Meeting, TranscriptChunk, UpdateEvent) and relationship types with allowed endpoint patterns. Update events carry provenance (source system, asserted-by, evidence) and confidence scores. The system tracks both event-sourced assertions and materialized current-state facts.

## Current State

The repository is a production-ready scaffold with full infrastructure: env validation, Neo4j migrations, health checks, and feature-oriented module structure. The transcript extraction pipeline is implemented but uses a **placeholder** provider by default (`TRANSCRIPT_PROVIDER=placeholder`); integrating a real LLM provider (e.g., OpenAI) is required for live extraction. The worker service bootstraps but does not yet run extraction jobs automatically—job orchestration (e.g., via a queue) would need to be wired in.
