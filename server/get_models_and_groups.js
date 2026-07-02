import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, 'data', 'freeapi.db');

function stripProviderSuffix(displayName) {
  let s = (displayName ?? '').trim();
  let prev;
  do {
    prev = s;
    s = s.replace(/\s*\([^()]*\)\s*$/, '').trim();
    s = s.replace(/\s+free$/i, '').trim();
  } while (s !== prev);
  return s;
}

try {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare("SELECT id, platform, model_id, display_name FROM models").all();
  
  const groups = {};
  for (const row of rows) {
    const canonicalName = stripProviderSuffix(row.display_name);
    if (!groups[canonicalName]) {
      groups[canonicalName] = [];
    }
    groups[canonicalName].push(row);
  }

  const sortedGroups = Object.entries(groups).map(([name, members]) => {
    return {
      name,
      members,
      count: members.length,
      platforms: members.map(m => m.platform)
    };
  }).sort((a, b) => b.count - a.count);

  console.log(`Found ${sortedGroups.length} unique model groups from ${rows.length} total rows:`);
  for (const g of sortedGroups) {
    console.log(`- ${g.name} (${g.count} providers): ${g.platforms.join(', ')}`);
    console.log(`  Members:`);
    for (const m of g.members) {
      console.log(`    * ${m.platform}:${m.model_id}`);
    }
  }
} catch (err) {
  console.error(err);
}
