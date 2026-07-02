import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, 'data', 'freeapi.db');

try {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare("SELECT platform, model_id, display_name, enabled, context_window FROM models").all();
  console.log(`Found ${rows.length} models in the database:`);
  for (const row of rows) {
    console.log(`- platform: ${row.platform}, model_id: ${row.model_id}, display_name: ${row.display_name}, enabled: ${row.enabled}, context_window: ${row.context_window}`);
  }
} catch (err) {
  console.error(err);
}
