/* Motor — IA do escritório: chamadas à Anthropic com a chave única do Railway.

   A chave (ANTHROPIC_API_KEY) nunca sai daqui. O navegador grava comandos ia_* em
   motor_comandos só com os DADOS (conversa em texto, pergunta, lead, pedido); os
   prompts, os esquemas de saída e o contexto do escritório (config.geral.contextoIA)
   moram neste arquivo. Quem confere alçada, visibilidade da conversa e limite por
   pessoa é a fila em index.js; aqui só se monta o pedido, chama e lê a resposta.
   Spec: nuvem/PLANO-IA-ESCRITORIO.md */
'use strict';
const Anthropic = require('@anthropic-ai/sdk');

const MODELOS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (recomendado)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (rápido e mais barato)' }
];
const MODELO_PADRAO = 'claude-opus-5-5';
const MODELO_ALTERNATIVO = 'claude-sonnet-5-5';   // em sobrecarga persistente do Opus
const TIPOS = ['ia_resumo', 'ia_pergunta', 'ia_analise', 'ia_automacao', 'ia_teste'];
const LIMITES = { transcript: 150000, pergunta: 500, pedido: 2000, contexto: 4000 };
/* por tipo: teto de tokens de saída (o raciocínio do modelo conta dentro do teto, por isso
   a folga) e esforço. Resumo/pergunta/automação médio; análise profunda alto; teste mínimo. */
const AJUSTES = {
  ia_resumo:    { max_tokens: 4000, effort: 'medium' },
  ia_pergunta:  { max_tokens: 3000, effort: 'medium' },
  ia_analise:   { max_tokens: 16000, effort: 'high' },
  ia_automacao: { max_tokens: 4000, effort: 'medium' },
  ia_teste:     { max_tokens: 32,   effort: 'low' }
};

/* lida a cada chamada (não em cache no load): trocar a variável no Railway e reiniciar basta,
   e o teste liga/desliga sem recarregar o módulo */
function disponivel() { return !!String(process.env.ANTHROPIC_API_KEY || '').trim(); }
function modeloValido(id) { return MODELOS.some(m => m.id === id) ? id : MODELO_PADRAO; }

function validarPayload(tipo, payload) {
  if (!TIPOS.includes(tipo)) throw new Error('tipo de pedido de IA desconhecido: ' + tipo);
  const p = payload || {};
  const tam = v => String(v == null ? '' : v).length;
  const conversa = tipo === 'ia_analise' ? p.conversaTexto : p.transcript;
  if (tam(conversa) > LIMITES.transcript) throw new Error('conversa longa demais para a IA (limite de 150.000 caracteres)');
  if (tam(p.pergunta) > LIMITES.pergunta) throw new Error('pergunta longa demais (limite de 500 caracteres)');
  if (tam(p.pedido) > LIMITES.pedido) throw new Error('pedido longo demais (limite de 2.000 caracteres)');
  if (tam(p.contexto) > LIMITES.contexto) throw new Error('contexto longo demais (limite de 4.000 caracteres)');
}

/* ---------------- prompts (mesmo texto que vivia em js/ai.js) ---------------- */

/* bloco de contexto do escritório (config.geral.contextoIA) — vazio quando nada foi preenchido */
function contextoEscritorio(c) {
  c = c || {};
  const partes = [];
  if (c.areas && String(c.areas).trim()) partes.push('- Áreas de atuação: ' + String(c.areas).trim());
  if (c.diferenciais && String(c.diferenciais).trim()) partes.push('- Diferenciais: ' + String(c.diferenciais).trim());
  if (c.honorarios && String(c.honorarios).trim()) partes.push('- Honorários (faixa/política): ' + String(c.honorarios).trim());
  if (!partes.length) return '';
  return '\n\nCONTEXTO DO ESCRITÓRIO (use quando relevante; nunca invente além disto):\n' + partes.join('\n');
}

const SYSTEM_COACH = `Você é um coach de vendas de elite, especialista em atendimento comercial via WhatsApp no Brasil.
Sua base teórica: SPIN Selling (Neil Rackham), Never Split the Difference (Chris Voss — empatia tática, rotulação, perguntas calibradas), As Armas da Persuasão (Cialdini), Prospecção Fanática e Objections (Jeb Blount), The Challenger Sale e Receita Previsível (Aaron Ross).
Analise a conversa entre atendente e lead com profundidade e franqueza. Seja específico: cite trechos da conversa, nomeie a técnica correta para cada acerto/erro e escreva as respostas sugeridas prontas para copiar e colar no WhatsApp, com tom humano, caloroso e profissional (pt-BR). Nunca invente fatos que não estão na conversa.`;

const SCHEMA_ANALISE = {
  type: 'object',
  properties: {
    resumo: { type: 'string', description: 'Resumo executivo do atendimento em 2-4 frases' },
    scoreGeral: { type: 'integer', description: 'Nota de 0 a 100 para a qualidade do atendimento' },
    temperatura: { type: 'string', enum: ['Quente', 'Morno', 'Frio'] },
    pontosFortes: { type: 'array', items: { type: 'string' } },
    pontosFracos: { type: 'array', items: { type: 'string' }, description: 'Erros e oportunidades perdidas, com referência à técnica de vendas correspondente' },
    objecoes: { type: 'array', items: { type: 'string' }, description: 'Objeções identificadas e se foram bem tratadas' },
    proximoPasso: { type: 'string', description: 'A ação mais importante a tomar agora' },
    respostasSugeridas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          mensagem: { type: 'string', description: 'Mensagem pronta para enviar ao lead via WhatsApp, em pt-BR' }
        },
        required: ['titulo', 'mensagem'],
        additionalProperties: false
      }
    }
  },
  required: ['resumo', 'scoreGeral', 'temperatura', 'pontosFortes', 'pontosFracos', 'objecoes', 'proximoPasso', 'respostasSugeridas'],
  additionalProperties: false
};

const SYSTEM_RESUMO = `Você é assistente de um escritório de advocacia brasileiro. Resuma conversas de WhatsApp entre a equipe e clientes/leads de forma clara e útil para o atendimento, em pt-BR. Estruture assim:
📋 RESUMO — 2 a 4 frases com a essência da conversa
👤 SITUAÇÃO DO CLIENTE — o que ele quer/precisa, dados importantes mencionados (números de processo, prazos, valores, documentos)
✅ COMBINADOS — o que ficou acordado ou prometido
⏭ PRÓXIMO PASSO — a ação mais importante agora
Seja fiel à conversa; nunca invente fatos.`;

const SYSTEM_PERGUNTA = `Você é assistente de um escritório de advocacia brasileiro. Responda perguntas sobre a conversa de WhatsApp fornecida, em pt-BR, de forma direta e citando o trecho relevante (com data/hora quando ajudar). Se a informação não estiver na conversa, diga claramente que não foi mencionada.`;

const SCHEMA_AUTOMACAO = {
  type: 'object',
  properties: {
    nome: { type: 'string', description: 'Nome curto e claro da automação' },
    gatilho: { type: 'string', enum: ['mensagem_recebida', 'conversa_criada'] },
    cooldownHoras: { type: 'number', description: 'Horas sem repetir para a mesma conversa (padrão 12; use 0.1 para quase sempre)' },
    condicoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['contem_texto', 'nao_contem', 'primeira_mensagem', 'fora_horario', 'dentro_horario', 'sem_departamento', 'departamento', 'individual', 'grupo'] },
          valor: { type: 'string', description: 'contem/nao_contem: palavras separadas por vírgula · horario: "seg-sex 08:00-18:00" · departamento: nome exato · demais: vazio' }
        },
        required: ['tipo', 'valor'],
        additionalProperties: false
      }
    },
    acoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['enviar_mensagem', 'enquete_departamentos', 'aplicar_tag', 'delegar_departamento', 'delegar_atendente', 'mudar_status', 'notificar', 'criar_lead'] },
          valor: { type: 'string', description: 'enviar_mensagem: texto com {{nome}} · enquete_departamentos: pergunta da enquete clicável cujas opções são os departamentos e o voto delega a conversa (ideal para triagem) · tag/departamento/atendente: nome · mudar_status: aberto|em_atendimento|aguardando|resolvido|fechado · notificar: texto do aviso aos admins · criar_lead: vazio' }
        },
        required: ['tipo', 'valor'],
        additionalProperties: false
      }
    }
  },
  required: ['nome', 'gatilho', 'cooldownHoras', 'condicoes', 'acoes'],
  additionalProperties: false
};

function systemAutomacao(contexto, ctxEscritorio) {
  return `Você monta automações de atendimento WhatsApp para um escritório de advocacia brasileiro.
Traduza o pedido do usuário em UMA automação no formato quando (gatilho) → se (condições, todas precisam valer) → então (ações em sequência).
${contexto || ''}${ctxEscritorio}
Regras: mensagens em pt-BR calorosas e curtas com {{nome}}; use nomes EXATOS de departamentos/tags/atendentes do contexto quando existirem; horários no formato "seg-sex 08:00-18:00"; para saudação de novo contato use gatilho conversa_criada; nunca invente departamentos que não estão no contexto.`;
}

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
/* texto do usuário da análise profunda: dados do lead, atendente e a conversa (igual ao front antigo) */
function contextoAnalise(p) {
  const lead = p.lead;
  return [
    lead ? `Dados do lead no CRM: nome ${lead.nome}${lead.empresa ? ', empresa ' + lead.empresa : ''}${lead.dor ? ', dor/interesse: ' + lead.dor : ''}${lead.valor ? ', valor potencial: ' + moeda.format(Number(lead.valor) || 0) : ''}, etapa atual: ${lead.etapa}.` : '',
    `O atendente na conversa é: ${p.atendente || 'Atendente'}.`,
    '',
    'CONVERSA:',
    p.conversaTexto || ''
  ].filter(Boolean).join('\n');
}

/* ---------------- pedido, chamada e leitura ---------------- */

function montarPedido(tipo, payload, cfg) {
  const p = payload || {};
  const ctx = contextoEscritorio(cfg.contextoIA);
  const base = {
    model: modeloValido(cfg.modelo),
    max_tokens: AJUSTES[tipo].max_tokens,
    output_config: { effort: AJUSTES[tipo].effort },
    // recusa por segurança: a API redireciona sozinha para um modelo alternativo
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default'
  };
  const nome = p.nomeContato || 'cliente';
  switch (tipo) {
    case 'ia_resumo':
      return Object.assign(base, { system: SYSTEM_RESUMO + ctx, messages: [{ role: 'user', content: `Conversa com ${nome}:\n\n${p.transcript || ''}` }] });
    case 'ia_pergunta':
      return Object.assign(base, { system: SYSTEM_PERGUNTA + ctx, messages: [{ role: 'user', content: `Conversa com ${nome}:\n\n${p.transcript || ''}\n\nPERGUNTA: ${p.pergunta || ''}` }] });
    case 'ia_analise':
      base.output_config.format = { type: 'json_schema', schema: SCHEMA_ANALISE };
      return Object.assign(base, { system: SYSTEM_COACH + ctx, messages: [{ role: 'user', content: contextoAnalise(p) }] });
    case 'ia_automacao':
      base.output_config.format = { type: 'json_schema', schema: SCHEMA_AUTOMACAO };
      return Object.assign(base, { system: systemAutomacao(p.contexto, ctx), messages: [{ role: 'user', content: p.pedido || '' }] });
    default: // ia_teste
      return Object.assign(base, { messages: [{ role: 'user', content: 'Responda apenas: ok' }] });
  }
}

/* erros pelas classes do SDK, nunca por texto. APIConnectionError antes de APIError (é subclasse). */
function traduzirErro(e) {
  if (e instanceof Anthropic.AuthenticationError) return new Error('chave da IA inválida: avise o administrador');
  if (e instanceof Anthropic.RateLimitError) return new Error('limite de uso da IA atingido, tente em instantes');
  if (e instanceof Anthropic.APIConnectionError) return new Error('sem conexão com a Anthropic, tente em instantes');
  if (e instanceof Anthropic.APIError) return new Error('erro da IA: ' + (e.message || e.type || e.status));
  return e;
}

/* o SDK já repete 2x em 429/529/5xx; se o Opus continuar sobrecarregado, uma tentativa com o Sonnet */
async function chamar(params, trocou) {
  const cliente = new Anthropic({ timeout: 90000, maxRetries: 2 });   // lê ANTHROPIC_API_KEY do ambiente
  try {
    const resposta = await cliente.beta.messages.create(params);
    return { resposta, modelo: params.model };
  } catch (e) {
    const sobrecarga = e instanceof Anthropic.APIError && (e.status === 529 || e.type === 'overloaded_error');
    if (sobrecarga && !trocou && params.model !== MODELO_ALTERNATIVO) {
      return chamar(Object.assign({}, params, { model: MODELO_ALTERNATIVO }), true);
    }
    throw traduzirErro(e);
  }
}

function usoDe(resposta, modelo) {
  const u = (resposta && resposta.usage) || {};
  return {
    modelo,
    entrada: u.input_tokens || 0,
    saida: u.output_tokens || 0,
    cacheLeitura: u.cache_read_input_tokens || 0,
    cacheEscrita: u.cache_creation_input_tokens || 0
  };
}

function lerResposta(tipo, resposta, modelo) {
  const uso = usoDe(resposta, modelo);
  if (tipo === 'ia_teste') return { ok: true, modelo, uso };
  if (resposta.stop_reason === 'refusal') throw new Error('A IA recusou este pedido.');
  // o raciocínio conta dentro de max_tokens: saída cortada seria JSON quebrado ou texto pela metade,
  // e "tente de novo" não resolveria (a causa é determinística) — melhor dizer o que houve
  if (resposta.stop_reason === 'max_tokens') throw new Error('a resposta da IA passou do tamanho máximo; tente com uma conversa menor ou avise o administrador');
  const bloco = (resposta.content || []).find(b => b.type === 'text');
  if (!bloco || !bloco.text) throw new Error('resposta vazia da IA, tente de novo');
  if (tipo === 'ia_analise' || tipo === 'ia_automacao') {
    let dados;
    try { dados = JSON.parse(bloco.text); } catch (e) { throw new Error('resposta inválida da IA, tente de novo'); }
    return { dados, uso };
  }
  return { texto: bloco.text.trim(), uso };
}

/* cfg = { modelo?: id, contextoIA?: { areas, diferenciais, honorarios } } */
async function executar(tipo, payload, cfg) {
  cfg = cfg || {};
  validarPayload(tipo, payload);
  if (!disponivel()) throw new Error('IA do escritório não configurada: defina ANTHROPIC_API_KEY nas variáveis do Railway');
  const params = montarPedido(tipo, payload, cfg);
  const { resposta, modelo } = await chamar(params, false);
  return lerResposta(tipo, resposta, modelo);
}

module.exports = { MODELOS, MODELO_PADRAO, TIPOS, LIMITES, disponivel, modeloValido, validarPayload, executar };
