import 'dotenv/config';
import { createPool, maskDatabaseUrl } from '../server/db.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL não definida. Copie .env.example para .env');
  process.exit(1);
}

const target = maskDatabaseUrl(databaseUrl);
console.log(`Testando conexão com ${target}...`);

const started = Date.now();
const pool = createPool(databaseUrl);

try {
  await pool.query('SELECT 1');
  console.log(`OK — conectado em ${Date.now() - started}ms`);
} catch (err) {
  console.error(`Falha — ${err.code || 'erro'}: ${err.message} (${Date.now() - started}ms)`);
  process.exit(1);
} finally {
  await pool.end();
}
