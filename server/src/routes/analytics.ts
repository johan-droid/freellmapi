import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPostgresPool } from '../db/postgres.js';
import { analyticsAggregator } from '../services/analytics-aggregator.js';
import { getActiveRegistry } from '../services/router-registry.js';

export const analyticsRouter = Router();

function getCutoffDate(range: string): Date {
  const now = Date.now();
  switch (range) {
    case '24h':
      return new Date(now - 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now - 30 * 24 * 60 * 60 * 1000);
    case '90d':
      return new Date(now - 90 * 24 * 60 * 60 * 1000);
    case '7d':
    default:
      return new Date(now - 7 * 24 * 60 * 60 * 1000);
  }
}

// 1. Overview / Summary statistics
analyticsRouter.get('/summary', async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as string) ?? '7d';
    const cutoff = getCutoffDate(range);
    const pool = getPostgresPool();

    // Query aggregated stats from Neon
    const dbRes = await pool.query(
      `SELECT
         COALESCE(SUM(request_count), 0) as total_requests,
         COALESCE(SUM(success_count), 0) as success_count,
         COALESCE(SUM(failure_count), 0) as failure_count,
         COALESCE(SUM(input_tokens), 0) as total_input_tokens,
         COALESCE(SUM(output_tokens), 0) as total_output_tokens,
         COALESCE(SUM(total_tokens), 0) as total_tokens,
         COALESCE(SUM(latency_sum_ms), 0) as total_latency_ms,
         COALESCE(SUM(latency_count), 0) as total_latency_count,
         COALESCE(SUM(rate_limit_count), 0) as rate_limit_count,
         COALESCE(SUM(fallback_count), 0) as fallback_count,
         MIN(bucket_start) as first_request_at
       FROM analytics_hourly
       WHERE bucket_start >= $1`,
      [cutoff.toISOString()]
    );

    const stats = dbRes.rows[0] || {};
    let totalRequests = Number(stats.total_requests || 0);
    let successCount = Number(stats.success_count || 0);
    let failureCount = Number(stats.failure_count || 0);
    let totalInputTokens = Number(stats.total_input_tokens || 0);
    let totalOutputTokens = Number(stats.total_output_tokens || 0);
    let totalTokens = Number(stats.total_tokens || 0);
    let totalLatencyMs = Number(stats.total_latency_ms || 0);
    let totalLatencyCount = Number(stats.total_latency_count || 0);
    let rateLimitCount = Number(stats.rate_limit_count || 0);
    let fallbackCount = Number(stats.fallback_count || 0);
    let firstRequestAt = stats.first_request_at ? new Date(stats.first_request_at).toISOString() : null;

    // Merge with unflushed active in-memory buffer for real-time accuracy
    const unflushed = analyticsAggregator.getUnflushedBuffer();
    for (const b of unflushed) {
      if (new Date(b.bucketStart) >= cutoff) {
        totalRequests += b.requestCount;
        successCount += b.successCount;
        failureCount += b.failureCount;
        totalInputTokens += b.inputTokens;
        totalOutputTokens += b.outputTokens;
        totalTokens += b.totalTokens;
        totalLatencyMs += b.latencySumMs;
        totalLatencyCount += b.latencyCount;
        rateLimitCount += b.rateLimitCount;
        fallbackCount += b.fallbackCount;
        if (!firstRequestAt || new Date(b.bucketStart) < new Date(firstRequestAt)) {
          firstRequestAt = b.bucketStart;
        }
      }
    }

    const decidedRequests = successCount + failureCount;
    const successRate = decidedRequests > 0 ? (successCount / decidedRequests) * 100 : 100;
    const avgLatencyMs = totalLatencyCount > 0 ? Math.round(totalLatencyMs / totalLatencyCount) : 0;

    // Estimate cost savings based on standard industry rates ($3/M input, $15/M output)
    const estimatedCostSavings = ((totalInputTokens * 3.0) + (totalOutputTokens * 15.0)) / 1000000.0;

    res.json({
      totalRequests,
      successCount,
      failureCount,
      successRate: Math.round(successRate * 10) / 10,
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      avgLatencyMs,
      rateLimitCount,
      fallbackCount,
      estimatedCostSavings: Math.round(estimatedCostSavings * 100) / 100,
      firstRequestAt,
    });
  } catch (err: any) {
    console.error('[analytics] Error fetching summary:', err);
    res.status(500).json({ error: 'Failed to fetch analytics summary' });
  }
});

// Alias for /overview
analyticsRouter.get('/overview', (req, res) => {
  // Redirect internally to summary
  res.redirect(307, req.originalUrl.replace('/overview', '/summary'));
});

// 2. Provider breakdown
analyticsRouter.get('/providers', async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as string) ?? '7d';
    const cutoff = getCutoffDate(range);
    const pool = getPostgresPool();

    const dbRes = await pool.query(
      `SELECT
         p.id as provider_id,
         p.provider_key,
         p.display_name,
         p.enabled,
         COALESCE(SUM(a.request_count), 0) as requests,
         COALESCE(SUM(a.success_count), 0) as success_count,
         COALESCE(SUM(a.failure_count), 0) as failure_count,
         COALESCE(SUM(a.input_tokens), 0) as input_tokens,
         COALESCE(SUM(a.output_tokens), 0) as output_tokens,
         COALESCE(SUM(a.total_tokens), 0) as total_tokens,
         COALESCE(SUM(a.latency_sum_ms), 0) as latency_sum_ms,
         COALESCE(SUM(a.latency_count), 0) as latency_count,
         COALESCE(SUM(a.rate_limit_count), 0) as rate_limit_count
       FROM providers p
       LEFT JOIN analytics_hourly a ON a.provider_id = p.id AND a.bucket_start >= $1
       GROUP BY p.id, p.provider_key, p.display_name, p.enabled
       ORDER BY requests DESC, p.priority DESC`,
      [cutoff.toISOString()]
    );

    const providerStatsMap = new Map<number, any>();
    for (const row of dbRes.rows) {
      providerStatsMap.set(row.provider_id, {
        providerId: row.provider_id,
        provider: row.provider_key,
        displayName: row.display_name,
        enabled: row.enabled,
        requests: Number(row.requests || 0),
        successCount: Number(row.success_count || 0),
        failureCount: Number(row.failure_count || 0),
        inputTokens: Number(row.input_tokens || 0),
        outputTokens: Number(row.output_tokens || 0),
        totalTokens: Number(row.total_tokens || 0),
        latencySumMs: Number(row.latency_sum_ms || 0),
        latencyCount: Number(row.latency_count || 0),
        rateLimitCount: Number(row.rate_limit_count || 0),
      });
    }

    // Merge in-memory unflushed buffer
    const unflushed = analyticsAggregator.getUnflushedBuffer();
    for (const b of unflushed) {
      if (b.providerId && new Date(b.bucketStart) >= cutoff) {
        let stats = providerStatsMap.get(b.providerId);
        if (stats) {
          stats.requests += b.requestCount;
          stats.successCount += b.successCount;
          stats.failureCount += b.failureCount;
          stats.inputTokens += b.inputTokens;
          stats.outputTokens += b.outputTokens;
          stats.totalTokens += b.totalTokens;
          stats.latencySumMs += b.latencySumMs;
          stats.latencyCount += b.latencyCount;
          stats.rateLimitCount += b.rateLimitCount;
        }
      }
    }

    const results = Array.from(providerStatsMap.values()).map(p => {
      const decided = p.successCount + p.failureCount;
      const successRate = decided > 0 ? (p.successCount / decided) * 100 : 100;
      const avgLatencyMs = p.latencyCount > 0 ? Math.round(p.latencySumMs / p.latencyCount) : 0;
      return {
        provider: p.provider,
        displayName: p.displayName,
        enabled: p.enabled,
        requests: p.requests,
        successRate: Math.round(successRate * 10) / 10,
        avgLatencyMs,
        totalInputTokens: p.inputTokens,
        totalOutputTokens: p.outputTokens,
        totalTokens: p.totalTokens,
        rateLimitCount: p.rateLimitCount,
      };
    });

    res.json(results);
  } catch (err: any) {
    console.error('[analytics] Error fetching providers:', err);
    res.status(500).json({ error: 'Failed to fetch provider stats' });
  }
});

// 3. Models breakdown
analyticsRouter.get('/models', async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as string) ?? '7d';
    const cutoff = getCutoffDate(range);
    const pool = getPostgresPool();

    const dbRes = await pool.query(
      `SELECT
         m.model_id,
         m.canonical_name,
         m.display_name,
         p.provider_key,
         COALESCE(SUM(a.request_count), 0) as requests,
         COALESCE(SUM(a.success_count), 0) as success_count,
         COALESCE(SUM(a.failure_count), 0) as failure_count,
         COALESCE(SUM(a.input_tokens), 0) as input_tokens,
         COALESCE(SUM(a.output_tokens), 0) as output_tokens,
         COALESCE(SUM(a.total_tokens), 0) as total_tokens,
         COALESCE(SUM(a.latency_sum_ms), 0) as latency_sum_ms,
         COALESCE(SUM(a.latency_count), 0) as latency_count
       FROM models m
       JOIN providers p ON p.id = m.provider_id
       LEFT JOIN analytics_hourly a ON a.model_id = m.model_id AND a.provider_id = m.provider_id AND a.bucket_start >= $1
       GROUP BY m.model_id, m.canonical_name, m.display_name, p.provider_key
       ORDER BY requests DESC`,
      [cutoff.toISOString()]
    );

    const modelStatsMap = new Map<string, any>();
    for (const row of dbRes.rows) {
      const key = `${row.provider_key}:${row.model_id}`;
      modelStatsMap.set(key, {
        modelId: row.model_id,
        canonicalName: row.canonical_name,
        displayName: row.display_name,
        provider: row.provider_key,
        requests: Number(row.requests || 0),
        successCount: Number(row.success_count || 0),
        failureCount: Number(row.failure_count || 0),
        inputTokens: Number(row.input_tokens || 0),
        outputTokens: Number(row.output_tokens || 0),
        totalTokens: Number(row.total_tokens || 0),
        latencySumMs: Number(row.latency_sum_ms || 0),
        latencyCount: Number(row.latency_count || 0),
      });
    }

    const results = Array.from(modelStatsMap.values()).map(m => {
      const decided = m.successCount + m.failureCount;
      const successRate = decided > 0 ? (m.successCount / decided) * 100 : 100;
      const avgLatencyMs = m.latencyCount > 0 ? Math.round(m.latencySumMs / m.latencyCount) : 0;
      return {
        modelId: m.modelId,
        canonicalName: m.canonicalName,
        displayName: m.displayName,
        provider: m.provider,
        requests: m.requests,
        successRate: Math.round(successRate * 10) / 10,
        avgLatencyMs,
        totalInputTokens: m.inputTokens,
        totalOutputTokens: m.outputTokens,
        totalTokens: m.totalTokens,
      };
    });

    res.json(results);
  } catch (err: any) {
    console.error('[analytics] Error fetching models:', err);
    res.status(500).json({ error: 'Failed to fetch model stats' });
  }
});

// 4. Timeline / Timeseries points for charts
analyticsRouter.get('/timeseries', async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as string) ?? '7d';
    const cutoff = getCutoffDate(range);
    const pool = getPostgresPool();

    const dbRes = await pool.query(
      `SELECT
         bucket_start as timestamp,
         SUM(request_count) as requests,
         SUM(success_count) as success_count,
         SUM(failure_count) as failure_count,
         SUM(input_tokens) as input_tokens,
         SUM(output_tokens) as output_tokens,
         SUM(total_tokens) as total_tokens,
         SUM(latency_sum_ms) as latency_sum_ms,
         SUM(latency_count) as latency_count
       FROM analytics_hourly
       WHERE bucket_start >= $1
       GROUP BY bucket_start
       ORDER BY bucket_start ASC`,
      [cutoff.toISOString()]
    );

    const timeMap = new Map<string, any>();
    for (const row of dbRes.rows) {
      const ts = new Date(row.timestamp).toISOString();
      timeMap.set(ts, {
        timestamp: ts,
        requests: Number(row.requests || 0),
        successCount: Number(row.success_count || 0),
        failureCount: Number(row.failure_count || 0),
        inputTokens: Number(row.input_tokens || 0),
        outputTokens: Number(row.output_tokens || 0),
        totalTokens: Number(row.total_tokens || 0),
        latencySumMs: Number(row.latency_sum_ms || 0),
        latencyCount: Number(row.latency_count || 0),
      });
    }

    // Merge unflushed buffer
    const unflushed = analyticsAggregator.getUnflushedBuffer();
    for (const b of unflushed) {
      if (new Date(b.bucketStart) >= cutoff) {
        const ts = b.bucketStart;
        let point = timeMap.get(ts);
        if (!point) {
          point = {
            timestamp: ts,
            requests: 0,
            successCount: 0,
            failureCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            latencySumMs: 0,
            latencyCount: 0,
          };
          timeMap.set(ts, point);
        }
        point.requests += b.requestCount;
        point.successCount += b.successCount;
        point.failureCount += b.failureCount;
        point.inputTokens += b.inputTokens;
        point.outputTokens += b.outputTokens;
        point.totalTokens += b.totalTokens;
        point.latencySumMs += b.latencySumMs;
        point.latencyCount += b.latencyCount;
      }
    }

    const timeline = Array.from(timeMap.values())
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map(p => ({
        timestamp: p.timestamp,
        requests: p.requests,
        successCount: p.successCount,
        failureCount: p.failureCount,
        inputTokens: p.inputTokens,
        outputTokens: p.outputTokens,
        totalTokens: p.totalTokens,
        avgLatencyMs: p.latencyCount > 0 ? Math.round(p.latencySumMs / p.latencyCount) : 0,
      }));

    res.json(timeline);
  } catch (err: any) {
    console.error('[analytics] Error fetching timeseries:', err);
    res.status(500).json({ error: 'Failed to fetch timeseries stats' });
  }
});

// 5. Token metrics breakdown
analyticsRouter.get('/tokens', async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as string) ?? '7d';
    const cutoff = getCutoffDate(range);
    const pool = getPostgresPool();

    const dbRes = await pool.query(
      `SELECT
         p.provider_key as provider,
         COALESCE(SUM(a.input_tokens), 0) as input_tokens,
         COALESCE(SUM(a.output_tokens), 0) as output_tokens,
         COALESCE(SUM(a.total_tokens), 0) as total_tokens
       FROM analytics_hourly a
       JOIN providers p ON p.id = a.provider_id
       WHERE a.bucket_start >= $1
       GROUP BY p.provider_key
       ORDER BY total_tokens DESC`,
      [cutoff.toISOString()]
    );

    res.json(dbRes.rows.map(r => ({
      provider: r.provider,
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      totalTokens: Number(r.total_tokens),
    })));
  } catch (err: any) {
    console.error('[analytics] Error fetching tokens:', err);
    res.status(500).json({ error: 'Failed to fetch token stats' });
  }
});
