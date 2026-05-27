import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

function ensureDataDirectory() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

let pool = null;

function createPool(dbConfig) {
  pool = mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port || 3306,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });
  return pool;
}

function openDatabase() {
  ensureDataDirectory();
  return pool;
}

function closeDatabase() {
  if (pool) {
    pool.end();
    pool = null;
  }
}

async function queryAll(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows[0] || null;
}

async function execute(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

export {
  createPool,
  closeDatabase,
  queryAll,
  queryOne,
  execute,
  openDatabase,
};