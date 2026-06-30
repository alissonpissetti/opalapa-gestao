import { execSync } from 'child_process';
import 'dotenv/config';

const apiPort = Number(process.env.PORT) || 3001;
const vitePort = Number(process.env.VITE_PORT) || 5173;
const ports = [...new Set([apiPort, vitePort])];

function pidsOnPortUnix(port) {
  try {
    const out = execSync(`lsof -ti :${port}`, { encoding: 'utf8' }).trim();
    if (!out) return [];
    return [...new Set(out.split('\n').map((line) => line.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

function pidsOnPortWindows(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, {
      encoding: 'utf8',
      shell: true,
    });
    const pids = new Set();
    for (const line of out.split('\n')) {
      if (!line.includes('LISTENING')) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== '0') pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

function pidsOnPort(port) {
  if (process.platform === 'win32') return pidsOnPortWindows(port);
  return pidsOnPortUnix(port);
}

function killPid(pid) {
  const id = Number(pid);
  if (!Number.isInteger(id) || id <= 0) return false;

  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /PID ${id} /F`, { stdio: 'ignore', shell: true });
      return true;
    } catch {
      return false;
    }
  }

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
