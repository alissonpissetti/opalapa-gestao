import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { createPool } = await import('../server/db.js');
const { listFunilEtapas } = await import('../server/funil.js');
const { listProducaoEntregas } = await import('../server/producao-entregas.js');

const pool = createPool(process.env.DATABASE_URL);
const [eventos] = await pool.query('SELECT id, nome FROM eventos ORDER BY id LIMIT 5');
console.log('Eventos:', eventos);

for (const ev of eventos) {
  const etapas = await listFunilEtapas(pool, ev.id, { escopo: 'comercial' });
  const vendaStatuses = new Set(['vend']);
  for (const e of etapas) {
    if (e.tipo === 'venda' && e.ativo !== false) vendaStatuses.add(e.status);
  }
  console.log(`\n=== Evento ${ev.id} ${ev.nome} ===`);
  console.log(
    'Etapas venda:',
    [...vendaStatuses],
    etapas.filter((e) => e.tipo === 'venda').map((e) => `${e.titulo}(${e.status})`),
  );

  const [all] = await pool.query(
    `SELECT a.id, a.participante_id, p.nome, a.tipo, a.status, ap.nome AS produto
     FROM arrecadacao a
     JOIN participantes p ON p.id = a.participante_id
     LEFT JOIN arrecadacao_produtos ap ON ap.id = a.produto_id
     WHERE a.evento_id = ? AND a.tipo IN ('espaco', 'patrocinio')
     ORDER BY p.nome`,
    [ev.id],
  );
  const entregas = await listProducaoEntregas(pool, ev.id);
  const entregaPartIds = new Set(entregas.items.map((i) => i.participanteId));

  const byStatus = {};
  for (const r of all) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  console.log('Leads espaco/patrocinio por status:', byStatus);
  console.log('Total leads:', all.length, '| Em entregas:', entregas.items.length);

  const missing = all.filter((r) => !vendaStatuses.has(r.status));
  if (missing.length) {
    console.log('NAO aparecem em entregas (status != etapa venda):');
    for (const r of missing.slice(0, 30)) {
      const etapa = etapas.find((e) => e.status === r.status);
      console.log(` - ${r.nome} | ${r.tipo} | ${r.status} (${etapa?.titulo || '?'}) | ${r.produto || ''}`);
    }
    if (missing.length > 30) console.log(` ... +${missing.length - 30} mais`);
  }

  const inVendaNotEntregas = all.filter(
    (r) => vendaStatuses.has(r.status) && !entregaPartIds.has(r.participante_id),
  );
  if (inVendaNotEntregas.length) {
    console.log('Status venda mas fora da lista entregas:');
    for (const r of inVendaNotEntregas) console.log(` - ${r.nome} ${r.tipo} ${r.status} part=${r.participante_id}`);
  }

  const vendLeads = all.filter((r) => vendaStatuses.has(r.status));
  const vendPartIds = new Set(vendLeads.map((r) => r.participante_id));
  console.log('Participantes unicos em vend:', vendPartIds.size, '| linhas vend:', vendLeads.length);

  const [etapasDb] = await pool.query(
    `SELECT status, titulo, tipo, ativo FROM arrecadacao_funil_etapas
     WHERE evento_id = ? AND escopo = 'comercial' ORDER BY ordem`,
    [ev.id],
  );
  console.log('Funil comercial no banco:', etapasDb);

  const [paidNotVend] = await pool.query(
    `SELECT p.nome, a.tipo, a.status, ap.nome AS produto, a.valor_total, a.valor_pago
     FROM arrecadacao a
     JOIN participantes p ON p.id = a.participante_id
     LEFT JOIN arrecadacao_produtos ap ON ap.id = a.produto_id
     WHERE a.evento_id = ? AND a.tipo IN ('espaco', 'patrocinio')
       AND a.status NOT IN ('vend', 'cancelado', 'perda')
       AND a.valor_pago > 0
     ORDER BY p.nome`,
    [ev.id],
  );
  if (paidNotVend.length) {
    console.log('Com pagamento mas status != vend:', paidNotVend.length);
    for (const r of paidNotVend) {
      const etapa = etapas.find((e) => e.status === r.status);
      console.log(` - ${r.nome} | ${r.status} (${etapa?.titulo || '?'}) | pago ${r.valor_pago}/${r.valor_total}`);
    }
  }

  const [resLeads] = await pool.query(
    `SELECT p.nome, a.tipo, a.status, ap.nome AS produto
     FROM arrecadacao a
     JOIN participantes p ON p.id = a.participante_id
     LEFT JOIN arrecadacao_produtos ap ON ap.id = a.produto_id
     WHERE a.evento_id = ? AND a.status = 'res'
     ORDER BY p.nome`,
    [ev.id],
  );
  console.log('Leads em Aprovado (res):', resLeads.length);

  const [vendDetail] = await pool.query(
    `SELECT p.nome, a.tipo, a.status, a.participante_id, COUNT(*) OVER (PARTITION BY a.participante_id) as linhas_part
     FROM arrecadacao a
     JOIN participantes p ON p.id = a.participante_id
     WHERE a.evento_id = ? AND a.status = 'vend' AND a.tipo IN ('espaco','patrocinio')
     ORDER BY linhas_part DESC, p.nome`,
    [ev.id],
  );
  const multi = vendDetail.filter((r) => r.linhas_part > 1);
  console.log('Participantes vend com multiplas linhas:', multi.length ? [...new Set(multi.map(r=>r.nome))].join(', ') : 'nenhum');
}

await pool.end();
