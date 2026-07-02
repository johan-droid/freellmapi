import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, 'data', 'freeapi.db');

try {
  const db = new Database(dbPath, { readonly: true });
  
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Tables:', tables.map(t => t.name));
  
  const modelCount = db.prepare("SELECT COUNT(*) as count FROM models").get();
  console.log(`Total models in 'models' table: ${modelCount.count}`);
  
  const byPlatform = db.prepare("SELECT platform, COUNT(*) as count FROM models GROUP BY platform").all();
  console.log('Models by platform in models table:', byPlatform);
  
  const hasCatalog = tables.some(t => t.name === 'provider_catalog_models');
  if (hasCatalog) {
    const catalogCount = db.prepare("SELECT COUNT(*) as count FROM provider_catalog_models").get();
    console.log(`Total models in provider_catalog_models: ${catalogCount.count}`);
    
    // Let's run a query to see models grouped by normalised display name (or normalized ID)
    // and count distinct platforms.
    const catalogRows = db.prepare("SELECT provider_slug, provider_model_id, display_name FROM provider_catalog_models WHERE status='active'").all();
    
    const groups = {};
    for (const row of catalogRows) {
      // Normalisation: strip (free), etc.
      let s = row.display_name.trim();
      let prev;
      do {
        prev = s;
        s = s.replace(/\s*\([^()]*\)\s*$/, '').trim();
        s = s.replace(/\s+free$/i, '').trim();
      } while (s !== prev);
      
      const key = s.toLowerCase().replace(/[\s\-_]+/g, ' ').trim();
      if (!groups[key]) {
        groups[key] = {
          displayName: s,
          platforms: new Set(),
          models: []
        };
      }
      groups[key].platforms.add(row.provider_slug);
      groups[key].models.push(`${row.provider_slug}:${row.provider_model_id}`);
    }
    
    console.log('--- DB GROUPS BY PLATFORM COUNT ---');
    const sorted = Object.entries(groups).map(([key, data]) => ({
      key,
      displayName: data.displayName,
      platforms: Array.from(data.platforms),
      count: data.platforms.size,
      models: data.models
    })).sort((a, b) => b.count - a.count);
    
    for (const g of sorted.slice(0, 10)) {
      console.log(`${g.displayName}: ${g.count} platforms [${g.platforms.join(', ')}]`);
    }
  }
} catch (err) {
  console.error(err);
}
