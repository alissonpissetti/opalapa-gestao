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
  const leadTipo =
    tipoLead === 'artistico'
      ? 'artístico'
      : tipoLead === 'alimentacao'
        ? 'alimentação'
        : 'comercial / patrocínio';
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
