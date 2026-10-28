import { createApp } from '../app.js';

// On Cloudflare, the shared app reads the native D1 binding from c.env.DB.
// No Node or better-sqlite3 code is imported into this Worker entrypoint.
export default createApp();
