import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, 'data', 'freeapi.db');

try {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare("SELECT platform, enabled, label FROM api_keys").all();
  console.log(`Found ${rows.length} API keys in the database:`);
  for (const row of rows) {
    console.log(`- platform: ${row.platform}, enabled: ${row.enabled}, label: ${row.label}`);
  }
} catch (err) {
  console.error(err);
}
