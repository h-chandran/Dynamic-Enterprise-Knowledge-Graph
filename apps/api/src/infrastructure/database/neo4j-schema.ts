import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Session } from "neo4j-driver";
import { getNeo4jSession } from "./neo4j.js";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const CURRENT_DIR = dirname(CURRENT_FILE);
const DEFAULT_MIGRATIONS_DIR = join(CURRENT_DIR, "migrations", "neo4j");

export interface Neo4jSchemaMigrationResult {
  migrationFile: string;
  statementCount: number;
}

export interface Neo4jSchemaSetupResult {
  migrations: Neo4jSchemaMigrationResult[];
}

export const initializeNeo4jSchema = async (migrationsDir = DEFAULT_MIGRATIONS_DIR): Promise<Neo4jSchemaSetupResult> => {
  const migrationFiles = await getMigrationFiles(migrationsDir);
  const session = getNeo4jSession("WRITE");
  const migrations: Neo4jSchemaMigrationResult[] = [];

  try {
    for (const migrationFile of migrationFiles) {
      const filePath = join(migrationsDir, migrationFile);
      const script = await readFile(filePath, "utf8");
      const statements = splitCypherStatements(script);

      await runStatements(session, statements);

      migrations.push({
        migrationFile,
        statementCount: statements.length
      });
    }
  } finally {
    await session.close();
  }

  return { migrations };
};

export const getNeo4jMigrationsDir = () => DEFAULT_MIGRATIONS_DIR;

async function getMigrationFiles(migrationsDir: string): Promise<string[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".cypher")
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function runStatements(session: Session, statements: string[]): Promise<void> {
  for (const statement of statements) {
    await session.run(statement);
  }
}

function splitCypherStatements(script: string): string[] {
  return script
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !statement.startsWith("--"));
}
