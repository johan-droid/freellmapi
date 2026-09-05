import pg from 'pg';
import * as initialSchema from '../migrations/001_initial_schema.js';
import * as seedProvidersModels from '../migrations/002_seed_providers_models.js';

export interface MigrationModule {
  up(client: pg.PoolClient | pg.Pool): Promise<void> | void;
  down(client: pg.PoolClient | pg.Pool): Promise<void> | void;
}

export interface DefaultMigration {
  filename: string;
  module: MigrationModule;
}

export const INITIAL_SCHEMA_FILENAME = '001_initial_schema.ts';
export const SEED_PROVIDERS_MODELS_FILENAME = '002_seed_providers_models.ts';

export const DEFAULT_MIGRATIONS: readonly DefaultMigration[] = [
  { filename: INITIAL_SCHEMA_FILENAME, module: initialSchema },
  { filename: SEED_PROVIDERS_MODELS_FILENAME, module: seedProvidersModels },
];
