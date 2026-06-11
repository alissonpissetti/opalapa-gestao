import 'dotenv/config';

const port = process.env.PORT || 3001;
const url = `http://127.0.0.1:${port}/api/health`;
const timeoutMs = 30000;
const intervalMs = 300;
const start = Date.now();

while (Date.now() - start < timeoutMs) {
  try {
    const res = await fetch(url);
    if (res.ok) process.exit(0);
  } catch (_) {}
  await new Promise((r) => setTimeout(r, intervalMs));
}

console.error(`\nAPI não respondeu em http://localhost:${port}/api/health`);
console.error('Use "npm run dev" para subir API + frontend juntos.\n');
process.exit(1);
