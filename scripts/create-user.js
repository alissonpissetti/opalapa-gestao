import 'dotenv/config';
import { createPool } from '../server/db.js';
import { migrateUsers, createUser } from '../server/users.js';
import { hashPassword } from '../server/auth.js';

function usage() {
  console.log(`Uso: npm run user:create -- --name "Nome" --password "senha" [--email x@y.com] [--phone 11999999999]

Pelo menos um de --email ou --phone é obrigatório.`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      console.error(`Valor ausente para --${name}`);
      process.exit(1);
    }
    args[name] = value;
    i++;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.name || !args.password) {
  usage();
  process.exit(1);
}

const email = args.email?.trim().toLowerCase() || null;
const phone = args.phone?.replace(/\D/g, '') || null;

if (!email && !phone) {
  console.error('Informe --email e/ou --phone.');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não definida no .env');
  process.exit(1);
}

const pool = createPool(process.env.DATABASE_URL);

try {
  await migrateUsers(pool);
  const passwordHash = await hashPassword(args.password);
  const id = await createUser(pool, {
    name: args.name.trim(),
    email,
    phone,
    passwordHash,
  });
  console.log(`Usuário criado (id ${id}): ${args.name}`);
  if (email) console.log(`  E-mail: ${email}`);
  if (phone) console.log(`  Celular: ${phone}`);
} catch (err) {
  if (err.code === 'ER_DUP_ENTRY') {
    console.error('E-mail ou celular já cadastrado.');
  } else {
    console.error(err.message);
  }
  process.exit(1);
} finally {
  await pool.end();
}
