module.exports = async (req, res) => {
if (req.method !== 'POST') {
res.status(405).json({ erro: 'Método não permitido.' });
return;
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
res.status(500).json({ erro: 'Chave da API não configurada no servidor (ANTHROPIC_API_KEY ausente na Vercel).' });
return;
}

let body = req.body;
if (!body || typeof body === 'string') {
try { body = JSON.parse(body || '{}'); } catch { body = {}; }
}
const { pergunta, contexto } = body || {};

if (!pergunta || typeof pergunta !== 'string' || !pergunta.trim()) {
res.status(400).json({ erro: 'Pergunta vazia.' });
return;
}

const perguntaLimitada = pergunta.slice(0, 2000);
const contextoTexto = JSON.stringify(contexto || {}).slice(0, 24000);

const systemPrompt = 'Você é um assistente financeiro dentro de um app de orçamento familiar pessoal. ' +
'Responda SOMENTE com base nos dados fornecidos no contexto abaixo — nunca invente números. ' +
'Seja direto e objetivo, em português do Brasil, e cite valores em reais (R$). ' +
'Você não é um consultor financeiro licenciado: se a pergunta envolver decisão de investimento, ' +
'lembre disso brevemente, sem repetir esse aviso em toda resposta. ' +
'Se a pergunta não puder ser respondida com os dados fornecidos, diga isso claramente em vez de supor. ' +
'\n\nContexto (dados financeiros do usuário, em JSON):\n' + contextoTexto;

try {
const respAnthropic = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
  'content-type': 'application/json',
  'x-api-key': apiKey,
  'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 700,
  system: systemPrompt,
  messages: [{ role: 'user', content: perguntaLimitada }],
  }),
  });

if (!respAnthropic.ok) {
const errText = await respAnthropic.text().catch(() => '');
res.status(502).json({ erro: 'Falha ao consultar a IA.', detalhe: errText.slice(0, 300) });
return;
}

const data = await respAnthropic.json();
  const texto = (data.content || []).map((b) => b.text || '').join('\n').trim() || 'Sem resposta.';
res.status(200).json({ resposta: texto });
} catch (e) {
res.status(500).json({ erro: 'Erro interno ao consultar a IA.', detalhe: String(e).slice(0, 300) });
}
};
