import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;

  constructor() {
    const connectionString =
      process.env.DATABASE_URL ||
      'postgres://barikoi:barikoi_secret@localhost:5432/poi_collection';

    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }

  async onModuleInit() {
    try {
      await this.ensureSchema();
      this.logger.log('PostGIS schema initialized successfully.');
    } catch (error) {
      this.logger.warn(
        `Could not initialize PostGIS schema at startup (will retry on query): ${(error as Error).message}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query(`CREATE EXTENSION IF NOT EXISTS postgis;`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS pois (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        track_id VARCHAR(64) NOT NULL DEFAULT '',
        frame_id VARCHAR(64) NOT NULL DEFAULT '',
        name_bn TEXT NOT NULL,
        name_en TEXT NOT NULL DEFAULT '',
        category VARCHAR(100) NOT NULL DEFAULT 'Commercial Building',
        phone VARCHAR(64),
        address TEXT,
        confidence DOUBLE PRECISION NOT NULL DEFAULT 0.85,
        crop_url TEXT,
        panorama_url TEXT,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        geom GEOMETRY(Point, 4326) NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await this.pool.query(`
      ALTER TABLE pois
      ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_pois_geom ON pois USING GIST (geom);
    `);
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }
}
