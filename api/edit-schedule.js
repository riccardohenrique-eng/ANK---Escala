// Vercel serverless function — /api/edit-schedule
// Recebe um comando em português sobre a semana que está na tela ("troca a Duda com a
// Alana na sexta", "põe a Joeli de folga sábado") e devolve uma PROPOSTA de mudanças
// estruturada — nunca aplica nada sozinho. O client sempre mostra a diferença antes de
// aplicar (mesmo padrão de confiança já usado no resto do app: aviso, não bloqueio, mas
// aqui é "proposta visível", não bloqueio nem aplicação silenciosa).
// Mesma família do api/interpret-constraints.js (Google Gemini, free tier).

const GEMINI_MODEL = 'gemini-3.6-flash';
const VALID_TYPES = ['abertura', 'intermediario', 'fechamento', 'folga', 'supervisao', 'ferias', 'atestado', 'falta'];

const TOOL_SCHEMA = {
  name: 'propose_edits',
  description: 'Devolve a lista de mudanças propostas na grade da semana atual, a partir do comando do usuário.',
  parameters: {
    type: 'OBJECT',
    properties: {
      edits: {
        type: 'ARRAY',
        description: 'Uma entrada por célula que precisa mudar. Não inclua células que já estão como o usuário quer.',
        items: {
          type: 'OBJECT',
          properties: {
            empId: { type: 'STRING', description: 'id exato de uma das funcionárias fixas fornecidas' },
            dow: { type: 'INTEGER', description: '0=segunda,1=terça,2=quarta,3=quinta,4=sexta,5=sábado,6=domingo' },
            type: { type: 'STRING', enum: VALID_TYPES, description: 'novo tipo de turno pra essa célula' }
          },
          required: ['empId', 'dow', 'type']
        }
      },
      summary: { type: 'STRING', description: 'Frase curta em português explicando o que vai mudar, pra mostrar antes do usuário confirmar.' },
      unclear: { type: 'BOOLEAN', description: 'true se o comando não deu pra entender com confiança (nome ambíguo, dia não identificado, etc) — nesse caso edits deve vir vazio e summary explica o que faltou.' }
    },
    required: ['edits', 'summary']
  }
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY não configurada no projeto Vercel' });
    return;
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    res.status(400).json({ error: 'JSON inválido' });
    return;
  }
  const { command, team, grid, weekStart } = body || {};
  if (!command || typeof command !== 'string' || !command.trim()) {
    res.status(400).json({ error: 'comando vazio' });
    return;
  }
  if (!Array.isArray(team) || !team.length) {
    res.status(400).json({ error: 'equipe não informada' });
    return;
  }
  if (!grid || typeof grid !== 'object') {
    res.status(400).json({ error: 'grade da semana não informada' });
    return;
  }

  const DOW_NAMES = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
  const teamList = team.map((e) => `${e.id} = ${e.name}`).join('\n');
  const gridLines = team.map((e) => {
    const row = DOW_NAMES.map((_, dow) => `${DOW_NAMES[dow]}: ${(grid[e.id] && grid[e.id][dow]) || 'folga'}`).join(', ');
    return `${e.name} (${e.id}) — ${row}`;
  }).join('\n');

  const systemPrompt = `Você ajuda a editar a escala de trabalho já gerada de uma loja de açaí (Açaí No Kilo, Cruz das Almas/BA), a partir de um comando em português coloquial do gestor. Use SEMPRE a ferramenta propose_edits.

Semana de referência: ${weekStart || '(não informada)'}
Convenção de dia da semana (dow): 0=segunda, 1=terça, 2=quarta, 3=quinta, 4=sexta, 5=sábado, 6=domingo.
Tipos de turno válidos: ${VALID_TYPES.join(', ')}.

Funcionárias fixas (use o id exato em empId):
${teamList}

Estado atual da grade desta semana (o que cada uma está fazendo em cada dia, ANTES da mudança que o usuário está pedindo):
${gridLines}

Regras:
- "Trocar" duas pessoas num dia = duas edições: cada uma recebe o tipo que a outra tinha antes nesse dia.
- Se o usuário só disser um dia da semana sem mais contexto, aplique só nesse dia (não na semana toda), a menos que ele diga "toda semana" ou algo assim.
- Só inclua em "edits" as células que realmente precisam mudar de valor — se already está como pedido, não repita.
- Se o comando for uma pergunta (não um pedido de mudança) ou for ambíguo demais pra ter certeza (nome que não bate com ninguém da lista, dia não identificável), devolva edits vazio e unclear:true, explicando em summary o que faltou entender — nunca invente id ou dia.`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: command }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          tools: [{ functionDeclarations: [TOOL_SCHEMA] }],
          toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['propose_edits'] } }
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => '');
      res.status(502).json({ error: 'falha ao chamar a API do Gemini', detail: errText.slice(0, 500) });
      return;
    }

    const data = await geminiRes.json();
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const call = parts.find((p) => p.functionCall && p.functionCall.name === 'propose_edits');
    if (!call) {
      res.status(502).json({ error: 'resposta da IA sem proposta estruturada' });
      return;
    }

    const args = call.functionCall.args || {};
    const validIds = new Set(team.map((e) => e.id));
    const edits = (Array.isArray(args.edits) ? args.edits : []).filter((e) =>
      e && validIds.has(e.empId) && Number.isInteger(e.dow) && e.dow >= 0 && e.dow <= 6 && VALID_TYPES.includes(e.type)
    );

    res.status(200).json({ edits, summary: args.summary || '', unclear: !!args.unclear });
  } catch (err) {
    res.status(500).json({ error: 'erro interno', detail: String(err && err.message || err) });
  }
};
