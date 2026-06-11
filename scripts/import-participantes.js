import 'dotenv/config';
import { createPool } from '../server/db.js';
import { migrateParticipantes, upsertParticipanteByNome } from '../server/participantes.js';
import { PARTICIPANTES_IMPORT } from '../server/data/participantes-import.js';

const pool = createPool(process.env.DATABASE_URL);

await migrateParticipantes(pool);

let created = 0;
let updated = 0;
const errors = [];

for (const item of PARTICIPANTES_IMPORT) {
  try {
    const result = await upsertParticipanteByNome(pool, item);
    if (result.created) created++;
    else updated++;
    console.log(`${result.created ? '+' : '~'} ${item.nome}`);
  } catch (err) {
    errors.push({ nome: item.nome, message: err.message });
    console.error(`! ${item.nome}: ${err.message}`);
  }
}

console.log(`\nConcluído: ${created} criado(s), ${updated} atualizado(s), ${errors.length} erro(s).`);

if (errors.length) {
  process.exitCode = 1;
}

await pool.end();
