# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nemesis is a public-facing procurement audit dashboard for Indonesia's government procurement data (LKPP / SIRUP). It ingests JSONL/CSV datasets, surfaces anomalies and waste, and presents findings via an interactive MapLibre map and sortable tables.

## Commands

```bash
# Development (SQLite backend)
npm run dev

# Development (MySQL backend)
npm run dev:mysql

# Production build + start
npm run build && npm run start

# Production (MySQL)
npm run build && npm run start:mysql

# Database
npm run db:reset      # Rebuild SQLite from dataset/ JSONL files + GeoJSON
npm run db:export     # Export SQLite to file
npm run db:import     # Import SQLite dump
npm run db:export-mysql  # Export SQLite data to MySQL

# Lint / Format
npm run lint          # ESLint on src/
npm run format        # Prettier write on src/**/*.{js,jsx,css}
```

## Architecture

### Unified Vite Orchestrator

`worker.js` is the single entry point that combines Express and Vite:
- Express serves the REST API (`/api/*`) and production static files
- In development mode, Vite middleware is mounted for HMR
- In production, `npm run build` produces `dist/` which Express serves statically
- Rotating gzip logs are written to `/logs` daily

### Two Database Backends (Parallel)

Both backends share identical API surface — different entry points:

| Backend | Entry point        | Config file        |
|---------|-------------------|--------------------|
| SQLite  | `worker.js`       | `app.js`           |
| MySQL   | `worker-mysql.js` | `app-mysql.js`     |

The MySQL variants (`app-mysql.js`, `dashboard-mysql.service.js`, `dashboard-mysql.repository.js`) mirror the SQLite ones — they are parallel implementations, not abstractions over a shared interface.

`worker-mysql.js` also mounts the API under `BASE_PATH` (default `/project/nemesis`), whereas `worker.js` mounts at root. This affects how the frontend's API calls resolve in containerized deployments.

### Backend Layers (SQLite)

```
app.js              # Express app: middleware (helmet, cors, rate-limit, hpp), routes
  dashboard.service.js  # Business logic: data shaping, pagination, legend building
    dashboard.repository.js  # Raw SQL queries via better-sqlite3
      db.js         # Database connection, path resolution
        config.js   # Environment variables
      seed.js       # Schema creation, data seeding, metric materialization
```

### API Endpoints

```
GET  /api/health              # Health check
GET  /api/bootstrap           # Full initial payload (summary, regions, provinces, GeoJSON)
GET  /api/regions/:key/packages         # Paginated packages for a district
GET  /api/provinces/:key/packages      # Paginated packages for a province
GET  /api/owners/packages?ownerType=&ownerName=   # Paginated packages for an owner
```

Package list queries support: `page`, `pageSize`, `search`, `ownerType`, `severity`, `priorityOnly`.

### Database Schema (SQLite)

Core tables: `packages`, `regions`, `provinces`
Join tables: `package_regions`, `package_provinces`
Denormalized metrics: `region_metrics`, `province_metrics`, `owner_metrics`
Asset store: `assets` (key-value JSON blob for GeoJSON and audit metadata)

Metric tables (`region_metrics`, `owner_metrics`) are **automatically rebuilt on startup** by `worker.js` if the schema is outdated or missing, via `ensureRegionMetricsCompatibility` / `ensureOwnerMetricsCompatibility` from `seed.js`.

### Frontend Structure

```
src/frontend/
  main.jsx          # Preact mount — renders into <div id="app">
  App.jsx           # Thin Preact wrapper; defers to vanilla JS
  assets/js/
    map.js          # MapLibre map initialization
    app.js          # Vanilla JS dashboard: KPI, tabs, table, legend
  assets/css/styles.css
  index.html
```

App.jsx loads `map.js` first, then `app.js`. All three (`map.js`, `app.js`, `styles.css`) are vanilla JS/CSS — Preact is only used for the initial mount wrapper.

### Environment Variables

Configured in `.env`, loaded via `dotenv` in `config.js`. Key vars:

| Variable              | Default                        | Purpose                          |
|-----------------------|--------------------------------|----------------------------------|
| `NODE_ENV`            | `production`                   | Dev vs prod mode                 |
| `PORT`                | `3000`                         | Server bind port                 |
| `SQLITE_PATH`         | `data/dashboard.sqlite`        | SQLite file path                 |
| `AUDIT_DATASET_DIR`   | `dataset`                      | Source JSONL/CSV files           |
| `AUDIT_DATASET_YEAR`  | `2026`                         | File prefix filter (year-NNNN)   |
| `GEO_ROOT_PATH`       | `seed/geo`                     | GeoJSON source directory          |
| `GEOJSON_PATH`        | `seed/geo/03-districts`        | District GeoJSON directory       |
| `PROVINCE_GEOJSON_PATH` | `seed/geo/02-provinces/province-only` | Province GeoJSON dir |
| `CORS_ORIGIN`         | `*`                            | CORS policy                      |
| `BASE_PATH`           | `/project/nemesis`             | MySQL: URL prefix for API + static (MySQL worker only) |
| `MYSQL_HOST`          | `localhost`                   | MySQL host                       |
| `MYSQL_PORT`          | `3306`                         | MySQL port                       |
| `MYSQL_DATABASE`      | `nemesis_dashboard`            | MySQL database name              |

No test suite exists — there are no test files in the project.

## Key Patterns

- **Path resolution**: `config.js` resolves all file paths relative to project root, supporting both absolute and relative values.
- **DB path fallback**: `db.js` scans `DATA_DIR` for SQLite files and picks the one matching configured name, or the first schema-valid file if none match.
- **Location parsing**: `seed.js` parses `lokasi` field as pipe-separated `province, region (type)` segments, resolved against GeoJSON lookup tables with aliasing for common name variants (e.g. "DKI Jakarta" → "jakartaraya"). Both province and district keys support aliases for messy input normalization.
- **Risk scoring**: `risk_score = (is_mencurigakan ? 1 : 0) + (is_pemborosan ? 1 : 0) + severity{low:0, med:1, high:2, absurd:3}`. Packages with `risk_score >= 2` or `potential_waste > 0` are marked `is_priority`.
- **Severity scores**: `low=1, med=2, high=3, absurd=4` — used consistently across seed.js and dashboard.service.js.
- **Severity scores**: `low=1, med=2, high=3, absurd=4` — used consistently across seed.js and dashboard.service.js.

## Docker

```bash
docker-compose up -d --build   # Start in container (production mode)
docker exec -it nemesis npm run db:reset   # Rebuild DB inside container
```

Docker runs the production orchestrator with `NODE_ENV=production`, binds ports 3000, and mounts `data/`, `dataset/`, and `logs/` as volumes.

## Lint & Format

ESLint uses flat config (`eslint.config.js`) with two targets: `src/backend/**` (Node globals) and `src/frontend/**` (browser globals + JSX). `no-undef` is an error; `no-unused-vars` is a warning.

Prettier formats `src/**/*.{js,jsx,css}`.