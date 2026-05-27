import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import dotenv from 'dotenv';
import morgan from 'morgan';
import { createStream } from 'rotating-file-stream';
import { createPool } from './src/backend/db-mysql.js';
import { createApp as createMySQLApp } from './src/backend/app-mysql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const PORT = process.env.PORT;
const isProduction = process.env.NODE_ENV === 'production';
const BASE_PATH = process.env.BASE_PATH || '/project/nemesis';

async function startServer() {
  const dbConfig = {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'nemesis_dashboard',
  };

  createPool(dbConfig);
  console.log('[Worker] MySQL pool created');

  const { app: apiApp } = await createMySQLApp();

  const app = express();

  const logDirectory = path.join(__dirname, 'logs');
  if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory, { recursive: true });
  }

  const createLogFilename = (prefix) => (time, index) => {
    const t = time || new Date();
    const d = String(t.getDate()).padStart(2, '0');
    const m = String(t.getMonth() + 1).padStart(2, '0');
    const y = t.getFullYear();
    const idx = index > 1 ? `-${index}` : '';
    return `${prefix}-${d}-${m}-${y}${idx}.log`;
  };

  const accessLogStream = createStream(createLogFilename('access'), {
    interval: '1d',
    size: '100M',
    path: logDirectory,
    compress: 'gzip',
    maxFiles: 14,
  });

  const errorLogStream = createStream(createLogFilename('error'), {
    interval: '1d',
    size: '20M',
    path: logDirectory,
    compress: 'gzip',
    maxFiles: 30,
  });

  app.use(morgan('short', { stream: accessLogStream }));
  app.use(morgan('short', {
    stream: errorLogStream,
    skip: (req, res) => res.statusCode < 400,
  }));
  app.use(morgan('dev'));

  app.use(BASE_PATH, apiApp);

  if (!isProduction) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
      base: BASE_PATH + '/',
    });
    app.use(vite.middlewares);
    console.log('[Worker] Vite development server attached.');
  } else {
    const distPath = path.join(__dirname, 'dist');
    if (!fs.existsSync(distPath)) {
      console.warn('[Worker] WARNING: dist directory not found! Run `npm run build` for production.');
    } else {
      app.use(express.static(distPath));
      app.get(`${BASE_PATH}/*`, (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
      console.log('[Worker] Static production files served from /dist');
    }
  }

  const server = app.listen(PORT, () => {
    console.log(`[Worker] Orchestrator listening on http://127.0.0.1:${PORT}`);
    console.log(`[Worker] Environment: ${isProduction ? 'Production' : 'Development'}`);
    console.log(`[Worker] Base Path: ${BASE_PATH}`);
    console.log(`[Worker] MySQL: ${dbConfig.host}/${dbConfig.database}`);
  });

  function shutdown(signal) {
    console.log(`\n[Worker] ${signal} received, shutting down...`);
    server.close(() => {
      console.log('[Worker] Server closed. Exiting.');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[Worker] Force closing...');
      process.exit(1);
    }, 5000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

startServer().catch(err => {
  console.error('[Worker] Fatal error starting server:', err);
  process.exit(1);
});