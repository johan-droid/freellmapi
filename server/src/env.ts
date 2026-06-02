import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const envPath = path.join(rootDir, '.env');
const envLocalPath = path.join(rootDir, '.env.local');

dotenv.config({ path: envPath });

if (fs.existsSync(envLocalPath)) {
  const localEnv = dotenv.parse(fs.readFileSync(envLocalPath));
  for (const k in localEnv) {
    process.env[k] = localEnv[k];
  }
}

