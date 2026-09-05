import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let isInMemoryMock = false;

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number | null;
}

export interface PostgresDb {
  query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
  getClient(): Promise<pg.PoolClient>;
  transaction<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  isMock(): boolean;
}

/**
 * Parses DATABASE_URL or environment variables to configure the PostgreSQL pool.
 * Neon PostgreSQL requires SSL.
 */
export function createPostgresPool(connectionString?: string): pg.Pool {
  const url = connectionString || process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_DATABASE_URL;
  
  if (!url) {
    throw new Error(
      'DATABASE_URL environment variable is required for PostgreSQL connection.\n' +
      'Example: postgresql://user:password@ep-sample.us-east-2.aws.neon.tech/neondb?sslmode=require'
    );
  }

  const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
  const needsSsl = !isLocal || url.includes('sslmode=require') || url.includes('neon.tech');

  const poolConfig: pg.PoolConfig = {
    connectionString: url,
    max: Number(process.env.PG_MAX_CONNECTIONS || 10), // Small pool for Render/Neon Free Tier
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };

  if (needsSsl) {
    poolConfig.ssl = {
      rejectUnauthorized: false,
    };
  }

  const createdPool = new Pool(poolConfig);
  const poolAny = createdPool as any;
  poolAny.prepare = (_sql: string) => ({
    get: () => undefined,
    all: () => [],
    run: () => ({ changes: 0, lastInsertRowid: 1 }),
  });
  poolAny.exec = () => {};
  poolAny.transaction = (fn: any) => fn;
  poolAny.pragma = () => [];
  return createdPool;
}

/**
 * Initializes the singleton Postgres pool.
 */
export function initPostgresPool(connectionString?: string): pg.Pool {
  if (pool) {
    return pool;
  }

  const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
  const useRealPg = Boolean(process.env.USE_REAL_POSTGRES);

  if (isTest && !useRealPg) {
    isInMemoryMock = true;
    pool = createInMemoryMockPool() as any;
    return pool!;
  }

  pool = createPostgresPool(connectionString);
  return pool;
}

export function getPostgresPool(): pg.Pool {
  if (!pool) {
    return initPostgresPool();
  }
  return pool;
}

export async function closePostgresPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * In-memory mock pool for running unit tests without an active live Postgres daemon.
 */
function createInMemoryMockPool() {
  const tables = new Map<string, any[]>();
  
  // Initialize standard tables
  tables.set('providers', []);
  tables.set('credentials', []);
  tables.set('models', []);
  tables.set('routing_configuration', []);
  tables.set('analytics_hourly', []);
  tables.set('settings', []);
  tables.set('client_profiles', []);
  tables.set('playground_conversations', []);
  tables.set('migrations', []);
  tables.set('users', []);
  tables.set('sessions', []);

  let idCounter = 1;

  const mockQuery = async (text: string, params: any[] = []): Promise<QueryResult<any>> => {
    const trimmed = text.trim();
    const upper = trimmed.toUpperCase();

    if (upper.startsWith('SELECT 1')) {
      return { rows: [{ '?column?': 1 }], rowCount: 1 };
    }

    if (upper.startsWith('CREATE TABLE') || upper.startsWith('CREATE INDEX') || upper.startsWith('ALTER TABLE')) {
      return { rows: [], rowCount: 0 };
    }

    if (upper.startsWith('SELECT')) {
      if (upper.includes('FROM MIGRATIONS')) {
        const rows = tables.get('migrations') || [];
        return { rows: [...rows], rowCount: rows.length };
      }
      if (upper.includes('FROM USERS')) {
        const rows = tables.get('users') || [];
        if (upper.includes('WHERE EMAIL = $1')) {
          const matched = rows.filter(r => r.email === params[0]);
          return { rows: matched, rowCount: matched.length };
        }
        if (upper.includes('WHERE ID = $1')) {
          const matched = rows.filter(r => r.id === params[0]);
          return { rows: matched, rowCount: matched.length };
        }
        return { rows: [...rows], rowCount: rows.length };
      }
      if (upper.includes('FROM SESSIONS')) {
        const rows = tables.get('sessions') || [];
        if (upper.includes('WHERE TOKEN_HASH = $1')) {
          const matched = rows.filter(r => r.token_hash === params[0]);
          return { rows: matched, rowCount: matched.length };
        }
        return { rows: [...rows], rowCount: rows.length };
      }
      if (upper.includes('FROM SETTINGS')) {
        const rows = tables.get('settings') || [];
        if (upper.includes('WHERE KEY = $1')) {
          const matched = rows.filter(r => r.key === params[0]);
          return { rows: matched, rowCount: matched.length };
        }
        return { rows: [...rows], rowCount: rows.length };
      }
      if (upper.includes('FROM PROVIDERS')) {
        const rows = tables.get('providers') || [];
        return { rows: [...rows], rowCount: rows.length };
      }
      if (upper.includes('FROM CREDENTIALS')) {
        const rows = tables.get('credentials') || [];
        return { rows: [...rows], rowCount: rows.length };
      }
      if (upper.includes('FROM MODELS')) {
        const rows = tables.get('models') || [];
        return { rows: [...rows], rowCount: rows.length };
      }
      if (upper.includes('FROM ROUTING_CONFIGURATION')) {
        const rows = tables.get('routing_configuration') || [];
        return { rows: [...rows], rowCount: rows.length };
      }
      if (upper.includes('FROM ANALYTICS_HOURLY')) {
        const rows = tables.get('analytics_hourly') || [];
        return { rows: [...rows], rowCount: rows.length };
      }
      if (upper.includes('FROM CLIENT_PROFILES')) {
        const rows = tables.get('client_profiles') || [];
        return { rows: [...rows], rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    }

    if (upper.startsWith('INSERT INTO USERS')) {
      const rows = tables.get('users') || [];
      const record = {
        id: idCounter++,
        email: params[0],
        password_hash: params[1],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      rows.push(record);
      tables.set('users', rows);
      return { rows: [record], rowCount: 1 };
    }

    if (upper.startsWith('INSERT INTO SESSIONS')) {
      const rows = tables.get('sessions') || [];
      const record = {
        id: idCounter++,
        token_hash: params[0],
        user_id: params[1],
        expires_at_ms: params[2],
        created_at: new Date().toISOString(),
      };
      rows.push(record);
      tables.set('sessions', rows);
      return { rows: [record], rowCount: 1 };
    }

    if (upper.startsWith('INSERT INTO SETTINGS')) {
      const rows = tables.get('settings') || [];
      const key = params[0];
      const value = params[1];
      const existing = rows.find(r => r.key === key);
      if (existing) {
        existing.value = value;
        existing.updated_at = new Date().toISOString();
      } else {
        rows.push({ key, value, updated_at: new Date().toISOString() });
      }
      tables.set('settings', rows);
      return { rows: [], rowCount: 1 };
    }

    if (upper.startsWith('INSERT INTO MIGRATIONS')) {
      const rows = tables.get('migrations') || [];
      const filename = params[0];
      rows.push({ id: idCounter++, filename, applied_at: new Date().toISOString() });
      tables.set('migrations', rows);
      return { rows: [], rowCount: 1 };
    }

    if (upper.startsWith('INSERT INTO PROVIDERS')) {
      const rows = tables.get('providers') || [];
      const record = {
        id: idCounter++,
        provider_key: params[0],
        display_name: params[1],
        base_url: params[2] || null,
        enabled: params[3] !== false,
        priority: params[4] || 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      rows.push(record);
      tables.set('providers', rows);
      return { rows: [record], rowCount: 1 };
    }

    if (upper.startsWith('INSERT INTO CREDENTIALS')) {
      const rows = tables.get('credentials') || [];
      const record = {
        id: idCounter++,
        provider_id: params[0],
        credential_name: params[1] || '',
        encrypted_value: params[2],
        iv: params[3],
        auth_tag: params[4],
        credential_type: params[5] || 'api_key',
        enabled: params[6] !== false,
        priority: params[7] || 0,
        model_scope: params[8] || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      rows.push(record);
      tables.set('credentials', rows);
      return { rows: [record], rowCount: 1 };
    }

    if (upper.startsWith('INSERT INTO MODELS')) {
      const rows = tables.get('models') || [];
      const record = {
        id: idCounter++,
        provider_id: params[0],
        model_id: params[1],
        canonical_name: params[2],
        display_name: params[3],
        enabled: params[4] !== false,
        context_window: params[5] || null,
        max_output_tokens: params[6] || null,
        supports_streaming: params[7] !== false,
        supports_tools: params[8] === true,
        supports_vision: params[9] === true,
        supports_structured_output: params[10] === true,
        supports_reasoning: params[11] === true,
        input_price: params[12] || 0,
        output_price: params[13] || 0,
        priority: params[14] || 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      rows.push(record);
      tables.set('models', rows);
      return { rows: [record], rowCount: 1 };
    }

    if (upper.startsWith('INSERT INTO ANALYTICS_HOURLY')) {
      const rows = tables.get('analytics_hourly') || [];
      rows.push({
        id: idCounter++,
        bucket_start: params[0],
        provider_id: params[1],
        model_id: params[2],
        request_count: params[3] || 0,
        success_count: params[4] || 0,
        failure_count: params[5] || 0,
        input_tokens: params[6] || 0,
        output_tokens: params[7] || 0,
        total_tokens: params[8] || 0,
        latency_sum_ms: params[9] || 0,
        latency_count: params[10] || 0,
        rate_limit_count: params[11] || 0,
        timeout_count: params[12] || 0,
        fallback_count: params[13] || 0,
      });
      tables.set('analytics_hourly', rows);
      return { rows: [], rowCount: 1 };
    }

    if (upper.startsWith('INSERT INTO CLIENT_PROFILES')) {
      const rows = tables.get('client_profiles') || [];
      const record = {
        id: idCounter++,
        name: params[0],
        token_hash: params[1],
        encrypted_key: params[2],
        iv: params[3],
        auth_tag: params[4],
        system_prompt: params[5] || null,
        enabled: params[6] !== false && params[6] !== 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      rows.push(record);
      tables.set('client_profiles', rows);
      return { rows: [record], rowCount: 1 };
    }

    if (upper.startsWith('UPDATE')) {
      return { rows: [], rowCount: 1 };
    }

    if (upper.startsWith('DELETE')) {
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  };

  return {
    query: mockQuery,
    connect: async () => ({
      query: mockQuery,
      release: () => {},
    }),
    on: () => {},
    end: async () => {},
    prepare: (sql: string) => ({
      get: (...args: any[]) => {
        const u = sql.toUpperCase();
        if (u.includes('FROM CLIENT_PROFILES')) {
          const rows = tables.get('client_profiles') || [];
          if (u.includes('TOKEN_HASH = ?')) {
            return rows.find(r => r.token_hash === args[0]);
          }
          return rows[0];
        }
        if (u.includes('FROM SETTINGS')) {
          const rows = tables.get('settings') || [];
          if (u.includes('KEY = ?')) {
            return rows.find(r => r.key === args[0]);
          }
          return rows[0];
        }
        return undefined;
      },
      all: (...args: any[]) => {
        const u = sql.toUpperCase();
        if (u.includes('FROM CLIENT_PROFILES')) {
          return tables.get('client_profiles') || [];
        }
        if (u.includes('FROM SETTINGS')) {
          return tables.get('settings') || [];
        }
        return [];
      },
      run: (...args: any[]) => {
        const u = sql.toUpperCase();
        if (u.includes('INSERT INTO CLIENT_PROFILES')) {
          const rows = tables.get('client_profiles') || [];
          const record = {
            id: idCounter++,
            name: args[0],
            token_hash: args[1],
            encrypted_key: args[2],
            iv: args[3],
            auth_tag: args[4],
            system_prompt: args[5] || null,
            enabled: args[6] !== false && args[6] !== 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          rows.push(record);
          tables.set('client_profiles', rows);
          return { changes: 1, lastInsertRowid: record.id };
        }
        return { changes: 1, lastInsertRowid: 1 };
      },
    }),
    exec: () => {},
    transaction: (fn: any) => fn,
    pragma: () => [],
    _mockTables: tables,
  };
}
