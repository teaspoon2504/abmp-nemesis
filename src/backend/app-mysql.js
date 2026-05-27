import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import { CORS_ORIGIN } from './config.js';
import {
  getBootstrapPayload,
  getOwnerPackages,
  getRegionPackages,
  getProvincePackages,
} from './services/dashboard-mysql.service.js';

function resolveCorsOrigin() {
  if (CORS_ORIGIN === '*') {
    return '*';
  }
  return CORS_ORIGIN.split(',').map((item) => item.trim()).filter(Boolean);
}

export async function createApp() {
  const { openDatabase } = await import('./db-mysql.js');
  openDatabase();
  const app = express();

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://unpkg.com"],
        "script-src-attr": ["'unsafe-inline'"],
        "connect-src": ["'self'", "ws:", "wss:", "http:", "https:"],
        "worker-src": ["'self'", "blob:"],
        "child-src": ["'self'", "blob:"],
        "img-src": ["'self'", "data:", "blob:", "https:"],
        "style-src": ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
      },
    },
  }));

  app.use(cors({ origin: resolveCorsOrigin() }));
  app.use(express.json({ limit: '1mb' }));
  app.use(hpp());

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', limiter);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/bootstrap', async (_req, res) => {
    try {
      const payload = await getBootstrapPayload();
      res.json(payload);
    } catch (error) {
      console.error('Bootstrap error:', error);
      res.status(500).json({ error: 'Failed to load bootstrap data' });
    }
  });

  app.get('/api/regions/:regionKey/packages', async (req, res) => {
    try {
      const payload = await getRegionPackages(req.params.regionKey, req.query);
      if (!payload) {
        return res.status(404).json({ error: 'Region not found' });
      }
      res.json(payload);
    } catch (error) {
      console.error('Region packages error:', error);
      res.status(500).json({ error: 'Failed to load region packages' });
    }
  });

  app.get('/api/provinces/:provinceKey/packages', async (req, res) => {
    try {
      const payload = await getProvincePackages(req.params.provinceKey, req.query);
      if (!payload) {
        return res.status(404).json({ error: 'Province not found' });
      }
      res.json(payload);
    } catch (error) {
      console.error('Province packages error:', error);
      res.status(500).json({ error: 'Failed to load province packages' });
    }
  });

  app.get('/api/owners/packages', async (req, res) => {
    try {
      const ownerType = String(req.query.ownerType || '').trim();
      const ownerName = String(req.query.ownerName || '').trim();
      if (!ownerType || !ownerName) {
        return res.status(400).json({ error: 'ownerType and ownerName are required' });
      }
      const payload = await getOwnerPackages(req.query);
      if (!payload) {
        return res.status(404).json({ error: 'Owner not found' });
      }
      res.json(payload);
    } catch (error) {
      console.error('Owner packages error:', error);
      res.status(500).json({ error: 'Failed to load owner packages' });
    }
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return { app };
}