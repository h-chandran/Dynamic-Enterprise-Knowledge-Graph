import neo4j, { type Driver, type SessionMode } from "neo4j-driver";
import { env } from "../../config/env.js";

let neo4jDriver: Driver | null = null;

export const getNeo4jDriver = () => {
  if (!neo4jDriver) {
    neo4jDriver = neo4j.driver(
      env.NEO4J_URI,
      neo4j.auth.basic(env.NEO4J_USERNAME, env.NEO4J_PASSWORD)
    );
  }

  return neo4jDriver;
};

export const checkNeo4jConnection = async () => {
  const session = getNeo4jSession("READ");

  try {
    await getNeo4jDriver().verifyConnectivity();
    await session.run("RETURN 1");
    return { status: "up" as const };
  } catch (error) {
    return {
      status: "down" as const,
      error: error instanceof Error ? error.message : "Neo4j connectivity check failed."
    };
  } finally {
    await session.close();
  }
};

export const getNeo4jSession = (defaultAccessMode: SessionMode = "WRITE") =>
  getNeo4jDriver().session({
    defaultAccessMode,
    database: env.NEO4J_DATABASE
  });

export const closeNeo4jConnection = async () => {
  if (!neo4jDriver) {
    return;
  }

  await neo4jDriver.close();
  neo4jDriver = null;
};
