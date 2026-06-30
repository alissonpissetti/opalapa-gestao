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

export function maskDatabaseUrl(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    const db = parsed.pathname.replace(/^\//, '') || 'default';
    return `${parsed.hostname}:${parsed.port || 3306}/${db}`;
  } catch {
    return '(URL inválida)';
  }
}

const NETWORK_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

export function formatDatabaseStartupError(err, databaseUrl) {
  const code = err?.code || err?.errno;
  const target = maskDatabaseUrl(databaseUrl);

  if (NETWORK_ERROR_CODES.has(code)) {
    return [
      'Não foi possível conectar ao banco de dados durante a inicialização (migrações).',
      '',
      `Destino: ${target}`,
      `Erro: ${err.message}`,
      '',
      'Verifique:',
      '  • Conexão com a internet e VPN (se o MariaDB for remoto)',
      '  • DATABASE_URL no arquivo .env (host, porta, usuário e senha)',
      '  • Firewall local ou do provedor bloqueando a porta do banco',
      '  • Se o servidor MariaDB está ligado e aceitando conexões externas',
      '',
      'Teste rápido: npm run db:test',
    ].join('\n');
  }

  if (code === 'ER_ACCESS_DENIED_ERROR') {
    return [
      'Acesso negado ao banco de dados.',
      '',
      `Destino: ${target}`,
      'Verifique usuário e senha em DATABASE_URL no .env.',
    ].join('\n');
  }

  return null;
}

export function createPool(databaseUrl) {
  return mysql.createPool({
    ...parseDatabaseUrl(databaseUrl),
    waitForConnections: true,
    connectionLimit: 10,
    connectTimeout: 15000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    timezone: 'Z',
  });
}
