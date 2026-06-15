import { execSync } from 'child_process';
import 'dotenv/config';

const apiPort = Number(process.env.PORT) || 3001;
const vitePort = Number(process.env.VITE_PORT) || 5173;
const ports = [...new Set([apiPort, vitePort])];

function pidsOnPort(port) {
  try {
    const out = execSync(`lsof -ti :${port}`, { encoding: 'utf8' }).trim();
    if (!out) return [];
    return [...new Set(out.split('\n').map((line) => line.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

function killPid(pid) {
  const id = Number(pid);
  if (!Number.isInteger(id) || id <= 0) return false;
  try {
    process.kill(id, 'SIGTERM');
    return true;
  } catch {
    try {
      process.kill(id, 'SIGKILL');
      return true;
    } catch {
      return false;
    }
  }
}

let freed = 0;

for (const port of ports) {
  const pids = pidsOnPort(port);
  if (!pids.length) continue;

  console.log(`[free-port] Liberando porta ${port} (PID ${pids.join(', ')})`);
  for (const pid of pids) {
    if (killPid(pid)) freed += 1;
  }
}

if (freed) {
  await new Promise((resolve) => setTimeout(resolve, 400));
}
