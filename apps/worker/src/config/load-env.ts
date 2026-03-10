import { config } from "dotenv";
import path from "node:path";

const candidateEnvFiles = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env")
];

export const loadEnvironment = () => {
  for (const envFile of candidateEnvFiles) {
    config({ path: envFile, override: false });
  }
};
