import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  return dotenv.parse(fs.readFileSync(filePath));
}

export function loadProjectEnv(
  projectRoot = PROJECT_ROOT,
  targetEnv: NodeJS.ProcessEnv = process.env,
): void {
  const merged = {
    ...parseEnvFile(path.resolve(projectRoot, '.env')),
    ...parseEnvFile(path.resolve(projectRoot, '.env.local')),
  };

  for (const [key, value] of Object.entries(merged)) {
    if (targetEnv[key] === undefined) {
      targetEnv[key] = value;
    }
  }
}

export function resolveDbPathEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dbPath = env.DB_PATH?.trim();
  if (dbPath) return dbPath;

  const legacyPath = env.DATABASE_PATH?.trim();
  if (legacyPath) return legacyPath;

  return undefined;
}

loadProjectEnv();
