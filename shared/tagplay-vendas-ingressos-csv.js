/**
 * Parser do CSV de vendas de ingressos exportado pelo TagPlay/TagTickets
 * (separador `;`, campos multilinha entre aspas).
 */

const POS_EMAIL_RE = /@tagplay\.local$/i;
const INTERNAL_EMAIL_RE = /@tagtickets\.com\.br$/i;
const POS_NAME_RE = /comprador\s+pos/i;

function parseMoneyBr(raw) {
  const s = String(raw || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\d,.-]/g, '')
    .trim();
  if (!s) return 0;
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function parseQtd(raw) {
  const n = Number(String(raw || '').replace(/\D/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

/** @returns {string[][]} */
export function parseSemicolonCsvRecords(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };

  const pushRow = () => {
    if (row.length === 1 && row[0] === '' && field === '') return;
    pushField();
    if (row.some((c) => String(c).trim() !== '')) rows.push(row);
    row = [];
  };

  const src = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '"') {
      if (inQuotes && src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ';' && !inQuotes) {
      pushField();
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      pushRow();
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) pushRow();
  return rows;
}

function parseClienteField(raw) {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const nome = lines[0] || '';
  let email = '';
  let telefoneRaw = '';
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!email && /@/.test(line) && !/\s/.test(line)) {
      email = line.toLowerCase();
      continue;
    }
    const digits = line.replace(/\D/g, '');
    if (!telefoneRaw && digits.length >= 10) {
      telefoneRaw = line;
    }
  }
  return { nome, email, telefoneRaw };
}

function isPosVenda({ nome, email }) {
  if (POS_NAME_RE.test(nome)) return true;
  if (email && POS_EMAIL_RE.test(email)) return true;
  if (email && INTERNAL_EMAIL_RE.test(email)) return true;
  return false;
}

function isConfirmado(situacao) {
  return /confirmado/i.test(String(situacao || ''));
}

function ingressoTitulo(raw) {
  const first = String(raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)[0];
  return first || String(raw || '').trim();
}

function contactKey({ email, telefoneDigits }) {
  if (email) return `e:${email}`;
  if (telefoneDigits) return `p:${telefoneDigits}`;
  return '';
}

/**
 * @param {string} csvText
 * @param {{ excluirPos?: boolean, somenteConfirmados?: boolean, agrupar?: boolean }} [options]
 */
export function parseTagplayVendasIngressosCsv(csvText, options = {}) {
  const excluirPos = options.excluirPos !== false;
  const somenteConfirmados = options.somenteConfirmados !== false;
  const agrupar = options.agrupar !== false;

  const records = parseSemicolonCsvRecords(csvText);
  let headerIdx = -1;
  for (let i = 0; i < records.length; i += 1) {
    const r = records[i];
    if (String(r[0] || '').trim() === 'Pedido' && String(r[1] || '').trim() === 'Cliente') {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    throw Object.assign(new Error('CSV não reconhecido: cabeçalho "Pedido;Cliente" não encontrado.'), {
      status: 400,
    });
  }

  const linhas = [];
  let ignoradas = { pos: 0, naoConfirmado: 0, semContato: 0 };

  for (let i = headerIdx + 1; i < records.length; i += 1) {
    const cols = records[i];
    if (!cols || cols.length < 2) continue;
    const clienteRaw = cols[1];
    if (!String(clienteRaw || '').trim()) continue;

    const situacao = cols[2] || '';
    if (somenteConfirmados && !isConfirmado(situacao)) {
      ignoradas.naoConfirmado += 1;
      continue;
    }

    const parsed = parseClienteField(clienteRaw);
    if (excluirPos && isPosVenda(parsed)) {
      ignoradas.pos += 1;
      continue;
    }

    const telefoneDigits = parsed.telefoneRaw.replace(/\D/g, '');
    const key = contactKey({ email: parsed.email, telefoneDigits });
    if (!key) {
      ignoradas.semContato += 1;
      continue;
    }

    linhas.push({
      pedido: String(cols[0] || '').trim(),
      nome: parsed.nome,
      email: parsed.email,
      telefoneRaw: parsed.telefoneRaw,
      telefoneDigits,
      ingresso: ingressoTitulo(cols[3]),
      qtd: parseQtd(cols[5]),
      valor: parseMoneyBr(cols[7]),
      situacao: String(situacao || '').trim(),
      key,
    });
  }

  if (!agrupar) {
    return {
      contatos: linhas.map((l) => ({
        nome: l.nome,
        email: l.email,
        telefone: l.telefoneRaw,
        telefoneDigits: l.telefoneDigits,
        totalIngressos: l.qtd,
        ingressosTipos: l.ingresso ? [l.ingresso] : [],
        valorTotal: l.valor,
        linhasPedido: 1,
        key: l.key,
      })),
      stats: {
        linhasCsv: linhas.length,
        contatos: linhas.length,
        ignoradas,
      },
    };
  }

  /** @type {Map<string, object>} */
  const map = new Map();
  for (const l of linhas) {
    let g = map.get(l.key);
    if (!g) {
      g = {
        nome: l.nome,
        email: l.email,
        telefone: l.telefoneRaw,
        telefoneDigits: l.telefoneDigits,
        totalIngressos: 0,
        ingressosTipos: new Set(),
        valorTotal: 0,
        linhasPedido: 0,
        key: l.key,
      };
      map.set(l.key, g);
    }
    g.totalIngressos += l.qtd;
    g.valorTotal += l.valor;
    g.linhasPedido += 1;
    if (l.ingresso) g.ingressosTipos.add(l.ingresso);
    if (!g.email && l.email) g.email = l.email;
    if (!g.telefone && l.telefoneRaw) {
      g.telefone = l.telefoneRaw;
      g.telefoneDigits = l.telefoneDigits;
    }
  }

  const contatos = [...map.values()].map((g) => ({
    nome: g.nome,
    email: g.email,
    telefone: g.telefone,
    telefoneDigits: g.telefoneDigits,
    totalIngressos: g.totalIngressos,
    ingressosTipos: [...g.ingressosTipos],
    valorTotal: g.valorTotal,
    linhasPedido: g.linhasPedido,
    key: g.key,
  }));

  return {
    contatos,
    stats: {
      linhasCsv: linhas.length,
      contatos: contatos.length,
      ignoradas,
    },
  };
}

export function filterContatosPorCanal(contatos, canal) {
  const mode = String(canal || 'qualquer').toLowerCase();
  return contatos.filter((c) => {
    const hasEmail = Boolean(c.email);
    const hasPhone = Boolean(c.telefoneDigits && c.telefoneDigits.length >= 10);
    if (mode === 'whatsapp') return hasPhone;
    if (mode === 'email') return hasEmail;
    return hasEmail || hasPhone;
  });
}
