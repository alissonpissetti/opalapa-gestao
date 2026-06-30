import mysql from 'mysql2/promise';

function parseDatabaseUrl(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
  };
}

export function createPool(databaseUrl) {
  return mysql.createPool({
    ...parseDatabaseUrl(databaseUrl),
    waitForConnections: true,
    connectionLimit: 10,
    connectTimeout: 10000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    timezone: 'Z',
  });
}
