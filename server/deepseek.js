export function getDeepseekConfig() {
  const baseUrl = (process.env.DEEPSEEK_API_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  const apiKey = process.env.DEEPSEEK_API_KEY || '';
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  const timeoutMs = Number(process.env.DEEPSEEK_TIMEOUT_MS) || 60000;
  return {
    baseUrl,
    apiKey,
    model,
    timeoutMs,
    enabled: Boolean(apiKey),
  };
}

function chatCompletionsUrl(baseUrl) {
  return baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
}

export async function deepseekChat(messages, { temperature = 0.7, maxTokens = 900 } = {}) {
  const { baseUrl, apiKey, model, timeoutMs } = getDeepseekConfig();
  if (!apiKey) {
    throw Object.assign(new Error('DeepSeek não configurada no servidor'), { status: 503 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(chatCompletionsUrl(baseUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!res.ok) {
      const msg =
        (body && (body.error?.message || body.error || body.message)) ||
        (typeof body === 'string' ? body : '') ||
        `DeepSeek HTTP ${res.status}`;
      throw Object.assign(new Error(String(msg)), { status: res.status, body });
    }

    const content = body?.choices?.[0]?.message?.content;
    if (!content || !String(content).trim()) {
      throw Object.assign(new Error('A IA não retornou texto'), { status: 502 });
    }

    return String(content).trim();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw Object.assign(new Error('A IA demorou demais para responder'), { status: 504 });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function formatCamposResumo(campos) {
  if (!Array.isArray(campos) || !campos.length) return 'Sem perguntas customizadas cadastradas.';
  return campos
    .map((campo, index) => {
      const label = String(campo.label || `Campo ${index + 1}`).trim();
      const type = String(campo.type || 'text');
      const required = campo.required ? 'obrigatório' : 'opcional';
      const options =
        campo.type === 'select' && Array.isArray(campo.options) && campo.options.length
          ? ` | opções: ${campo.options.slice(0, 8).join(', ')}${campo.options.length > 8 ? '…' : ''}`
          : '';
      return `- ${label} (${type}, ${required})${options}`;
    })
    .join('\n');
}

export async function generateFormularioIntroText({
  eventoNome,
  nome,
  descricaoLead,
  tipoLead,
  brief,
  introducaoAtual,
  campos,
}) {
  const formName = String(nome || '').trim();
  if (!formName) {
    throw Object.assign(new Error('Informe o nome do formulário antes de gerar o texto'), { status: 400 });
  }

  const userBrief = String(brief || '').trim();
  const currentIntro = String(introducaoAtual || '').trim();
  const evento = String(eventoNome || 'Opalapa').trim();
  const leadTipo = leadTipoLabel(tipoLead);
  const leadDesc = String(descricaoLead || formName).trim();

  const systemPrompt = `Você escreve textos de introdução para formulários públicos de candidatura do evento Opalapa.
Regras:
- Escreva em português do Brasil, tom acolhedor e profissional.
- 2 a 4 parágrafos curtos, prontos para publicar.
- Explique o que é a candidatura, o que acontece após o envio e incentive o preenchimento.
- Não invente prazos, valores, benefícios ou regras que não foram informados.
- Não use markdown, bullets, títulos ou emojis.
- Retorne apenas o texto final da introdução.`;

  const userPrompt = [
    `Evento: ${evento}`,
    `Formulário: ${formName}`,
    `Tipo de lead: ${leadTipo}`,
    `Descrição interna do lead: ${leadDesc}`,
    '',
    'Perguntas do formulário:',
    formatCamposResumo(campos),
    userBrief ? `\nInstruções adicionais: ${userBrief}` : '',
    currentIntro ? `\nTexto atual (pode melhorar ou reescrever):\n${currentIntro}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return deepseekChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { temperature: 0.65, maxTokens: 700 },
  );
}

function leadTipoLabel(tipoLead) {
  if (tipoLead === 'artistico') return 'artístico';
  if (tipoLead === 'alimentacao') return 'alimentação';
  return 'comercial / patrocínio';
}

function formatSecoesResumo(secoes, ignoreIndex = -1) {
  if (!Array.isArray(secoes) || !secoes.length) return 'Nenhum outro bloco informativo cadastrado.';
  const lines = secoes
    .map((secao, index) => {
      if (index === ignoreIndex) return null;
      const titulo = String(secao.titulo || '').trim();
      const texto = String(secao.texto || '').trim();
      if (!titulo && !texto) return null;
      const preview = texto ? `${texto.slice(0, 140)}${texto.length > 140 ? '…' : ''}` : '';
      return `- ${titulo || `Bloco ${index + 1}`}${preview ? `: ${preview}` : ''}`;
    })
    .filter(Boolean);
  return lines.length ? lines.join('\n') : 'Nenhum outro bloco informativo cadastrado.';
}

function parseSecaoAiResponse(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    throw Object.assign(new Error('A IA não retornou texto'), { status: 502 });
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const titulo = String(parsed.titulo || parsed.title || '').trim();
      const corpo = String(parsed.texto || parsed.text || parsed.conteudo || '').trim();
      if (titulo || corpo) return { titulo, texto: corpo };
    } catch {
      /* fallback abaixo */
    }
  }

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2) {
    return { titulo: lines[0].replace(/^#+\s*/, ''), texto: lines.slice(1).join('\n\n') };
  }

  return { titulo: '', texto: text };
}

export async function generateFormularioSecaoText({
  eventoNome,
  nome,
  descricaoLead,
  tipoLead,
  brief,
  tituloAtual,
  textoAtual,
  campos,
  secoes,
  secaoIndex,
  introducao,
}) {
  const formName = String(nome || '').trim();
  if (!formName) {
    throw Object.assign(new Error('Informe o nome do formulário antes de gerar o texto'), { status: 400 });
  }

  const userBrief = String(brief || '').trim();
  const titulo = String(tituloAtual || '').trim();
  const corpo = String(textoAtual || '').trim();
  const evento = String(eventoNome || 'Opalapa').trim();
  const leadTipo = leadTipoLabel(tipoLead);
  const leadDesc = String(descricaoLead || formName).trim();
  const index = Number(secaoIndex) || 0;
  const intro = String(introducao || '').trim();

  const systemPrompt = `Você escreve blocos informativos para formulários públicos de candidatura do evento Opalapa.
Cada bloco tem um título curto e um texto explicativo exibido antes das perguntas.
Regras:
- Escreva em português do Brasil, tom acolhedor e profissional.
- O título deve ter no máximo 80 caracteres, sem markdown.
- O texto deve ter 1 a 3 parágrafos curtos, prontos para publicar.
- Não invente prazos, valores, benefícios ou regras que não foram informados.
- Não repita conteúdo já presente na introdução ou em outros blocos.
- Não use markdown, bullets, emojis nem formatação especial no texto.
- Responda APENAS com JSON válido no formato: {"titulo":"...","texto":"..."}`;

  const userPrompt = [
    `Evento: ${evento}`,
    `Formulário: ${formName}`,
    `Tipo de lead: ${leadTipo}`,
    `Descrição interna do lead: ${leadDesc}`,
    `Posição do bloco: ${index + 1}`,
    '',
    intro ? `Introdução já publicada no topo:\n${intro}` : '',
    '',
    'Outros blocos informativos já cadastrados:',
    formatSecoesResumo(secoes, index),
    '',
    'Perguntas do formulário:',
    formatCamposResumo(campos),
    userBrief ? `\nO que este bloco deve explicar: ${userBrief}` : '',
    titulo || corpo
      ? `\nConteúdo atual deste bloco (pode melhorar ou reescrever):\nTítulo: ${titulo || '(vazio)'}\nTexto: ${corpo || '(vazio)'}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const raw = await deepseekChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { temperature: 0.68, maxTokens: 750 },
  );

  return parseSecaoAiResponse(raw);
}
