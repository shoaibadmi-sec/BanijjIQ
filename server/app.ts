import { Hono } from 'hono';
import type { SherDatabase } from './db/types.js';
import { handleApiRequest } from './core/handler.js';

type SherBindings = {
  DB: SherDatabase;
};

type SherHonoEnv = {
  Bindings: SherBindings;
};

/**
 * Creates the shared SherERP Hono application.
 *
 * Node passes a fixed local SQLite database instance.
 * Cloudflare passes no database here; Hono resolves the native D1 binding
 * from c.env.DB for every request.
 */
export function createApp(nodeDatabase?: SherDatabase): Hono<SherHonoEnv> {
  const app = new Hono<SherHonoEnv>();

  app.get('/', (c) => c.json({
    ok: true,
    name: 'SherERP API',
    health: '/api/health'
  }));

  app.all('/api/*', async (c) => {
    const db = nodeDatabase ?? c.env?.DB;
    if (!db) {
      return c.json({ ok: false, error: 'Database binding is not configured' }, 500);
    }

    const response = await handleApiRequest(c.req.raw, db);
    const body = await response.text();
    response.headers.forEach((value, key) => c.header(key, value));
    return c.body(body, response.status as any);
  });

  app.notFound((c) => c.json({ ok: false, error: 'Route not found' }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ ok: false, error: 'Unexpected server error' }, 500);
  });

  return app;
}
