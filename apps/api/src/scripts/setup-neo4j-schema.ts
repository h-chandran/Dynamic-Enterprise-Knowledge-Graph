import { initializeNeo4jSchema } from "../infrastructure/database/neo4j-schema.js";
import { closeNeo4jConnection } from "../infrastructure/database/neo4j.js";

const bootstrap = async () => {
  try {
    const result = await initializeNeo4jSchema();
    const migrationCount = result.migrations.length;
    const statementCount = result.migrations.reduce((acc, item) => acc + item.statementCount, 0);

    console.log(`Neo4j schema initialized. Applied ${migrationCount} migration file(s), ${statementCount} statement(s).`);
    result.migrations.forEach((migration) => {
      console.log(` - ${migration.migrationFile}: ${migration.statementCount} statement(s)`);
    });
  } finally {
    await closeNeo4jConnection();
  }
};

void bootstrap();
