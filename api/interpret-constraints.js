// Vercel serverless function — /api/interpret-constraints
// Recebe texto livre sobre a equipe (férias, folgas, faltas, duplas proibidas,
// disponibilidade de diarista) e devolve restrições estruturadas usando a API do Google Gemini
// (free tier — trocado de Anthropic pra Gemini em 2026-09-21 por causa do custo/uso baixo).
// Requer a env var GEMINI_API_KEY configurada no projeto Vercel (grátis em aistudio.google.com/apikey).

const GEMINI_MODEL = 'gemini-3.6-flash';

const TOOL_SCHEMA = {
  name: 'return_constraints',
  description: 'Devolve a lista de restrições estruturadas extraídas do texto do usuário.',
  parameters: {
    type: 'OBJECT',
    properties: {
      constraints: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            type: {
              type: 'STRING',
              enum: ['absence', 'forced_shift', 'no_pair', 'diarista_limit'],
              description:
                "'absence': funcionária fixa ausente (férias/folga pedida/falta) por um período. " +
                "'forced_shift': funcionária fixa precisa estar num turno específico (abertura/fechamento/intermediario) em cada dia do período. " +
                "'no_pair': duas funcionárias fixas não podem trabalhar juntas (mesma abertura ou mesmo fechamento) no período. " +
                "'diarista_limit': uma diarista só pode ser escalada em certos dias da semana dentro do período."
            },
            empId: { type: 'STRING', description: "usar para 'absence' e 'forced_shift' — id exato de uma das funcionárias fixas fornecidas" },
            empIds: {
              type: 'ARRAY', items: { type: 'STRING' },
              description: "usar para 'no_pair' — exatamente dois ids exatos de funcionárias fixas"
            },
            shiftType: {
              type: 'STRING', enum: ['abertura', 'fechamento', 'intermediario'],
              description: "usar para 'forced_shift'"
            },
            diaristaName: { type: 'STRING', description: "usar para 'diarista_limit' — nome da diarista tal como mencionado" },
            allowedDows: {
              type: 'ARRAY', items: { type: 'INTEGER' },
              description: "usar para 'diarista_limit' — dias em que ELA PODE trabalhar. 0=segunda,1=terça,2=quarta,3=quinta,4=sexta,5=sábado,6=domingo"
            },
            dateStart: { type: 'STRING', description: 'YYYY-MM-DD, primeiro dia em que a restrição vale (inclusive)' },
            dateEnd: { type: 'STRING', description: 'YYYY-MM-DD, último dia em que a restrição vale (inclusive). Se for um único dia, igual a dateStart.' },
            note: { type: 'STRING', description: 'trecho curto do texto original que originou esta restrição, para auditoria' }
          },
          required: ['type', 'dateStart', 'dateEnd', 'note']
        }
      }
    },
    required: ['constraints']
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
  const { text, today, weekStart, team, diaristaPool } = body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'texto vazio' });
    return;
  }
  if (!Array.isArray(team) || !team.length) {
    res.status(400).json({ error: 'equipe não informada' });
    return;
  }

  const teamList = team.map((e) => `${e.id} = ${e.name}`).join('\n');
  const diaristaList = (diaristaPool || []).join(', ') || '(nenhuma cadastrada ainda)';

  const systemPrompt = `Você ajuda a montar a escala de trabalho de uma loja de açaí (Açaí No Kilo, Cruz das Almas/BA).
O usuário (dono/gestor) escreve em português coloquial condições sobre a equipe. Sua tarefa é converter isso em restrições estruturadas, usando SEMPRE a ferramenta return_constraints.

Data de hoje: ${today || '(não informada)'}
Segunda-feira da semana que o usuário está editando agora: ${weekStart || '(não informada)'}
Convenção de dia da semana (dow): 0=segunda, 1=terça, 2=quarta, 3=quinta, 4=sexta, 5=sábado, 6=domingo.

Funcionárias fixas (use o id exato em empId/empIds):
${teamList}

Diaristas já conhecidas (use o nome em diaristaName, mesmo se a pessoa mencionada não estiver nesta lista — pode ser uma diarista nova):
${diaristaList}

Regras para interpretar datas:
- Se o usuário disser um dia da semana sem data (ex: "segunda"), resolva para a data real mais próxima a partir de hoje/semana de referência.
- Se disser um intervalo ("de 20 a 27/08"), dateStart e dateEnd cobrem o intervalo inteiro.
- Se disser só um dia, dateStart = dateEnd.
- Se disser "essa semana" sem mais detalhes, use a semana inteira (segunda a domingo) a partir do weekStart informado.
- Nunca invente ano — use o ano da data de hoje, a menos que o texto diga outro.
- Ausência/falta/férias/folga pedida → sempre type 'absence' (não diferenciamos o motivo na estrutura, mas pode citar o motivo em note).

Se o texto tiver várias condições diferentes, gere um item por condição. Se alguma frase for ambígua demais para virar uma restrição confiável, ignore-a (não invente id ou nome que não bate com a lista acima).`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          tools: [{ functionDeclarations: [TOOL_SCHEMA] }],
          toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['return_constraints'] } }
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
    const call = parts.find((p) => p.functionCall && p.functionCall.name === 'return_constraints');
    if (!call) {
      res.status(502).json({ error: 'resposta da IA sem restrições estruturadas' });
      return;
    }

    const validIds = new Set(team.map((e) => e.id));
    const constraints = ((call.functionCall.args && call.functionCall.args.constraints) || []).filter((c) => {
      if (!c || !c.dateStart || !c.dateEnd) return false;
      if (c.type === 'absence' || c.type === 'forced_shift') return validIds.has(c.empId);
      if (c.type === 'no_pair') return Array.isArray(c.empIds) && c.empIds.length === 2 && c.empIds.every((id) => validIds.has(id));
      if (c.type === 'diarista_limit') return !!c.diaristaName;
      return false;
    });

    res.status(200).json({ constraints });
  } catch (err) {
    res.status(500).json({ error: 'erro interno', detail: String(err && err.message || err) });
  }
};
