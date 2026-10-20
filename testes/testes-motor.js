/* ============================================================
   Testes de execução do MOTOR (Onda 0) — Node, sem rede e sem instalar nada.
   O Baileys (WhatsApp), o pino, o qrcode e o banco (PostgREST) são simulados;
   o motor/index.js REAL roda por cima deles. Confere: limpeza de boot,
   recepção com deduplicação atômica, corrida de contato novo, falha do banco
   → fila de pendentes, horário que travava o motor, fila de envio que não
   marca erro depois de enviar, alçada nos comandos, código 440.

   Rodar, a partir da pasta do projeto:   node testes/testes-motor.js
============================================================ */
'use strict';
process.env.VISTORIA_ESPERA_MS = '50';   // vistoria dos grupos: pausas e espera do limite curtas no teste
const path = require('path');
const fs = require('fs');
const Module = require('module');
const { EventEmitter } = require('events');

let ok = 0, falhas = 0;
const imprimir = console.log.bind(console);   // o motor tem o console.log capturado mais abaixo
const afirma = (c, n) => { if (c) ok++; else { falhas++; imprimir('  FALHOU: ' + n); } };
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function ate(cond, ms = 4000) { const fim = Date.now() + ms; while (Date.now() < fim) { if (cond()) return true; await esperar(25); } return cond(); }

/* ---------- banco simulado ---------- */
const agora = () => new Date().toISOString();
const DB = {
  perfis: [
    { id: 'u-admin', papel: 'admin', ativo: true, permissoes: {}, departamento_id: null, departamento_ids: [] },
    { id: 'u-estag', papel: 'atendente', ativo: true, permissoes: { msg_enviar: true }, departamento_id: null, departamento_ids: [] }
  ],
  departamentos: [{ id: 'd-jur', nome: 'Jurídico', cor: '#13294B', permissoes: {} }, { id: 'd-fin', nome: 'Financeiro', cor: '#4C9673', permissoes: {} }],
  conversas: [], mensagens: [
    { id: 'm-presa', conversa_id: 'x', direcao: 'saida', tipo: 'texto', texto: 'presa', status: 'enviando', externo_id: 'P1', criado_em: agora(), atualizado_em: agora() }
  ],
  motor_comandos: [{ id: 'cmd-preso', tipo: 'reagir', payload: {}, autor: 'u-admin', status: 'processando', criado_em: agora() },
    { id: 'cmd-ia-preso', tipo: 'ia_resumo', payload: {}, autor: 'u-admin', status: 'processando', criado_em: agora() }],
  motor_estado: [], motor_sessao: [], motor_pendentes: [], mensagens_segredos: [], midias_pendentes: [], notificacoes: [], leads: [], followups: [],
  config: [], automacoes: [{
    id: 'a1', nome: 'Ausência', ativa: true, gatilho: 'mensagem_recebida', cooldown_horas: 12,
    condicoes: [{ tipo: 'fora_horario', valor: 'seg-sexta 08:00-18:00' }],   // antes: laço infinito
    acoes: [{ tipo: 'aplicar_tag', valor: 'Fora do horário' }], criado_em: agora()
  },
  // chat-v14a (o motor guarda as automações em cache por 60 s: entram no fixture, não no meio do teste)
  ...[
    ['a-boleto', [{ tipo: 'contem_texto', valor: 'boleto' }], [{ tipo: 'acrescentar_departamento', valor: 'Financeiro' }]],
    ['a-prazo', [{ tipo: 'contem_texto', valor: 'prazo' }, { tipo: 'departamento', valor: 'Jurídico' }], [{ tipo: 'aplicar_tag', valor: 'Prazo' }]],
    ['a-plantao', [{ tipo: 'contem_texto', valor: 'plantão' }], [{ tipo: 'delegar_departamento', valor: 'Financeiro' }]],
    ['a-triagem', [{ tipo: 'contem_texto', valor: 'triagem' }, { tipo: 'sem_departamento' }], [{ tipo: 'aplicar_tag', valor: 'Triagem' }]],
    ['a-encerrar', [{ tipo: 'contem_texto', valor: 'pode encerrar' }], [{ tipo: 'mudar_status', valor: 'resolvido' }]]
  ].map(([id, condicoes, acoes]) => ({ id, nome: id, ativa: true, gatilho: 'mensagem_recebida', cooldown_horas: 12, condicoes, acoes, criado_em: agora() }))
  ], automacao_log: [], tags: []
};
// semDeptos: simula o banco SEM a migração chat-v14a — a coluna departamento_ids
// não existe (42703 no select; PGRST204 quando vem no corpo de PATCH/POST)
// semEdicoes: banco SEM a migração chat-v14b (coluna mensagens.edicoes inexistente)
const regras = { falharInsertMensagem: 0, falharPatchMensagem: false, semDeptos: false, n400: 0, semEdicoes: false };
const rpcs = [];
let seq = 0;
const novoId = () => 'id-' + (++seq);

function filtrar(linhas, params) {
  for (const [k, v] of params.entries()) {
    // or=(status.eq.pendente,and(status.eq.agendada,...)): só o status é honrado — sem isto a
    // fila de envio reprocessava TODA mensagem de saída a cada ciclo e o limit=5 escondia as novas
    if (k === 'or') {
      const sts = [...v.matchAll(/status\.eq\.(\w+)/g)].map(m => m[1]);
      if (sts.length) linhas = linhas.filter(r => sts.includes(String(r.status)));
      continue;
    }
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
    if (v.startsWith('eq.')) linhas = linhas.filter(r => String(r[k]) === decodeURIComponent(v.slice(3)));
    else if (v.startsWith('neq.')) linhas = linhas.filter(r => String(r[k]) !== decodeURIComponent(v.slice(4)));
    else if (v.startsWith('in.(')) { const vs = v.slice(4, -1).split(','); linhas = linhas.filter(r => vs.includes(String(r[k]))); }
    else if (v.startsWith('not.in.(')) { const vs = v.slice(8, -1).split(','); linhas = linhas.filter(r => !vs.includes(String(r[k]))); }
    else if (v.startsWith('lt.')) linhas = linhas.filter(r => String(r[k] || '') < decodeURIComponent(v.slice(3)));
    else if (v.startsWith('gte.')) linhas = linhas.filter(r => String(r[k] || '') >= decodeURIComponent(v.slice(4)));
    else if (v.startsWith('is.')) { const x = v.slice(3); linhas = linhas.filter(r => String(r[k]) === x); }
    else if (v.startsWith('like.')) { const p = v.slice(5).replace('*', ''); linhas = linhas.filter(r => String(r[k] || '').startsWith(p)); }
  }
  return linhas;
}
const resp = (status, corpo) => ({ ok: status >= 200 && status < 300, status, text: async () => corpo == null ? '' : JSON.stringify(corpo), json: async () => corpo, headers: { get: () => null } });

global.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const metodo = opts.method || 'GET';
  if (!u.pathname.startsWith('/rest/v1/')) return resp(200, {});   // Healthchecks, storage etc.
  const cam = u.pathname.slice('/rest/v1/'.length);
  const corpo = opts.body ? JSON.parse(opts.body) : null;
  if (cam.startsWith('rpc/')) {
    rpcs.push({ nome: cam.slice(4), args: corpo });
    if (cam === 'rpc/registrar_entrada') {
      // espelha nuvem/chat-v15a.sql: mensagem do contato soma não lida, reabre e desarquiva
      const c = DB.conversas.find(x => x.id === corpo.cid);
      if (c) {
        if (corpo.entrada) { c.nao_lidas = (c.nao_lidas || 0) + 1; if (['resolvido', 'fechado'].includes(c.status)) c.status = 'aberto'; c.arquivada = false; }
        c.ultima_msg = corpo.previa;
      }
      return resp(200, null);
    }
    return resp(404, { code: 'PGRST202' });
  }
  const tabela = cam;
  if (!DB[tabela]) return resp(404, { code: '42P01' });
  if (regras.semDeptos && tabela === 'conversas') {
    // n400 conta só os 400 de CORPO (PATCH/POST): a sondagem de 60 s faz GETs com 42703 que não são "tentativa por ação"
    if (metodo === 'GET' && /departamento_ids/.test(u.searchParams.get('select') || '')) return resp(400, { code: '42703', message: 'column conversas.departamento_ids does not exist' });
    if (corpo && JSON.stringify(corpo).includes('"departamento_ids"')) { regras.n400++; return resp(400, { code: 'PGRST204', message: "Could not find the 'departamento_ids' column of 'conversas' in the schema cache" }); }
  }
  if (regras.semEdicoes && tabela === 'mensagens') {
    if (metodo === 'GET' && /edicoes/.test(u.searchParams.get('select') || '')) return resp(400, { code: '42703', message: 'column mensagens.edicoes does not exist' });
    if (corpo && JSON.stringify(corpo).includes('"edicoes"')) return resp(400, { code: 'PGRST204', message: "Could not find the 'edicoes' column of 'mensagens' in the schema cache" });
  }
  const linhas = filtrar(DB[tabela], u.searchParams);
  if (metodo === 'GET') {
    const lim = Number(u.searchParams.get('limit') || 1e9);
    return resp(200, linhas.slice(0, lim));
  }
  if (metodo === 'POST') {
    const lote = Array.isArray(corpo) ? corpo : [corpo];
    const upsert = /merge-duplicates/.test((opts.headers || {}).Prefer || '');
    if (tabela === 'mensagens' && regras.falharInsertMensagem > 0) { regras.falharInsertMensagem--; return resp(503, { message: 'banco fora' }); }
    const criadas = [];
    for (const r of lote) {
      const chave = (tabela === 'motor_pendentes' || tabela === 'mensagens_segredos' || tabela === 'midias_pendentes') ? 'externo_id' : (tabela === 'motor_sessao' ? 'chave' : (tabela === 'motor_estado' ? 'id' : 'id'));
      if (tabela === 'mensagens' && r.externo_id && DB.mensagens.some(x => x.externo_id === r.externo_id)) return resp(409, { code: '23505', message: 'duplicate key value violates unique constraint "uq_mensagens_externo"' });
      if (tabela === 'conversas' && DB.conversas.some(x => x.telefone === r.telefone)) return resp(409, { code: '23505', message: 'duplicate key conversas_telefone_key' });
      const existente = r[chave] != null && DB[tabela].find(x => x[chave] === r[chave]);
      if (existente && upsert) { Object.assign(existente, r); criadas.push(existente); continue; }
      const nova = Object.assign({ id: novoId(), criado_em: agora(), atualizado_em: agora(), nao_lidas: 0 }, r);
      DB[tabela].push(nova); criadas.push(nova);
    }
    // insert "lento": abre a janela da corrida entre duas mensagens do mesmo contato novo
    if (tabela === 'conversas') await esperar(30);
    return resp(201, criadas);
  }
  if (metodo === 'PATCH') {
    if (tabela === 'mensagens' && regras.falharPatchMensagem && corpo && corpo.status === 'enviada') return resp(503, { message: 'banco fora' });
    linhas.forEach(r => Object.assign(r, corpo, { atualizado_em: agora() }));
    return resp(204, null);
  }
  if (metodo === 'DELETE') { DB[tabela] = DB[tabela].filter(r => !linhas.includes(r)); return resp(204, null); }
  return resp(405, null);
};

/* ---------- Baileys simulado ---------- */
const socks = [];
const enviados = [];
function fakeMakeWASocket() {
  const ev = new EventEmitter();
  const s = {
    ev, user: { id: '554591228323:7@s.whatsapp.net' },
    sendMessage: async (jid, conteudo, opcoes) => { enviados.push({ jid, conteudo, opcoes }); return { key: { id: opcoes && opcoes.messageId } }; },
    signalRepository: { lidMapping: { getPNForLID: async () => null, getLIDForPN: async () => null } },
    profilePictureUrl: async () => { throw new Error('sem foto'); },
    // rc14: id é @lid (com phoneNumber) ou @s.whatsapp.net (com lid); nunca traz nome
    groupMetadata: async jid => {
      if (String(jid).startsWith('fora-')) { const e = new Error('not-authorized'); e.output = { statusCode: 403 }; throw e; }
      if (String(jid).startsWith('limite-') && !global.__limiteJaFalhou) { global.__limiteJaFalhou = true; throw new Error('rate-overlimit'); }
      return { subject: 'Grupo', participants: [
        { id: '111@lid', phoneNumber: '5545999990011@s.whatsapp.net', admin: 'admin' },
        { id: '5545999990012@s.whatsapp.net', lid: '222@lid', admin: null },
        { id: '333@lid', admin: null }
      ] };
    },
    // lista geral dos grupos em que a conta está (uma consulta só): a vistoria usa antes de consultar um a um
    groupFetchAllParticipating: async () => ({ '120555@g.us': { subject: 'Grupo', participants: [
      { id: '111@lid', phoneNumber: '5545999990011@s.whatsapp.net', admin: 'admin' },
      { id: '5545999990012@s.whatsapp.net', lid: '222@lid', admin: null },
      { id: '333@lid', admin: null }
    ] } }),
    updateMediaMessage: async m => m, onWhatsApp: async () => [],
    end() { this.encerrado = true; }, ws: { close() {} }
  };
  socks.push(s);
  return s;
}
const baileysFalso = {
  default: fakeMakeWASocket,
  DisconnectReason: { loggedOut: 401, connectionReplaced: 440, timedOut: 408, restartRequired: 515 },
  fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
  // trocável pelo teste (global.__baixarFalso) para simular mídia expirada no WhatsApp
  downloadMediaMessage: (...a) => (global.__baixarFalso || (async () => Buffer.from('x')))(...a),
  // voto "decifrado": sempre a opção Financeiro (as opções vêm como sha256 do texto)
  decryptPollVote: () => ({ selectedOptions: [require('crypto').createHash('sha256').update(Buffer.from('Financeiro')).digest()] }),
  jidNormalizedUser: j => j,
  generateMessageIDV2: () => '3EB0' + Math.random().toString(16).slice(2, 12).toUpperCase(),
  generateMessageID: () => '3EB0' + Math.random().toString(16).slice(2, 12).toUpperCase(),
  BufferJSON: { replacer: (k, v) => v, reviver: (k, v) => v },
  initAuthCreds: () => ({ me: null }),
  // decode "protobuf" falso: a edição cifrada dos testes leva JSON dentro do AES-GCM real
  proto: { Message: { AppStateSyncKeyData: { fromObject: x => x }, decode: buf => JSON.parse(Buffer.from(buf).toString('utf8')) } }
};
/* SDK da Anthropic simulado: o motor/ia.js REAL roda por cima dele. global.__iaFalsa(params)
   decide a resposta; global.__iaChamadas guarda cada params para o teste inspecionar. */
class ErroAPIFalso extends Error { constructor(status, type, message) { super(message || type); this.status = status; this.type = type; } }
class AnthropicFalso {
  constructor(opcoes) {
    this.opcoes = opcoes;
    this.beta = { messages: { create: async params => {
      (global.__iaChamadas = global.__iaChamadas || []).push(params);
      const padrao = async () => ({ content: [{ type: 'text', text: 'resumo simulado' }], usage: { input_tokens: 100, output_tokens: 20 }, stop_reason: 'end_turn' });
      return (global.__iaFalsa || padrao)(params);
    } } };
  }
}
AnthropicFalso.default = AnthropicFalso;
AnthropicFalso.APIError = ErroAPIFalso;
AnthropicFalso.AuthenticationError = class extends ErroAPIFalso {};
AnthropicFalso.RateLimitError = class extends ErroAPIFalso {};
AnthropicFalso.APIConnectionError = class extends ErroAPIFalso {};
const carregarOriginal = Module._load;
Module._load = function (pedido, pai, ...resto) {
  if (pedido === '@whiskeysockets/baileys') return baileysFalso;
  if (pedido === '@anthropic-ai/sdk') return AnthropicFalso;
  if (pedido === 'pino') return () => ({ level: 'silent', child() { return this; }, info() {}, warn() {}, error() {}, debug() {}, trace() {} });
  if (pedido === 'qrcode') return { toDataURL: async () => 'data:image/png;base64,AAAA' };
  if (pedido === 'http') return { createServer: h => { global.__servidorHttp = h; return { listen() {} }; } };
  if (pedido === 'ffmpeg-static') return null;
  return carregarOriginal.call(this, pedido, pai, ...resto);
};

process.env.SUPABASE_URL = 'https://exemplo.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'k'.repeat(60);
process.env.HC_URL = '';
process.env.NOME_SISTEMA = 'Teste MV';
const logs = [];
const logOriginal = console.log;
console.log = (...a) => { logs.push(a.join(' ')); if (process.env.VERBOSO) logOriginal(...a); };

const msgTexto = (jid, id, texto, fromMe = false) => ({
  key: { remoteJid: jid, id, fromMe }, pushName: 'Cliente', messageTimestamp: Math.floor(Date.now() / 1000),
  message: { conversation: texto }
});

(async () => {
  require(path.join(__dirname, '..', 'motor', 'index.js'));
  await ate(() => socks.length === 1);
  const titulo = t => logOriginal('• ' + t);

  titulo('boot limpa o que ficou preso');
  afirma(DB.mensagens.find(m => m.id === 'm-presa').status === 'erro', "'enviando' do boot vira erro visível");
  afirma(DB.motor_comandos.find(c => c.id === 'cmd-preso').status === 'erro', "'processando' do boot vira erro");

  const s = socks[0];
  s.ev.emit('connection.update', { connection: 'open' });
  await ate(() => (DB.motor_estado[0] || {}).situacao === 'conectado');
  afirma((DB.motor_estado[0] || {}).situacao === 'conectado', 'estado conectado gravado');
  afirma(DB.motor_comandos.find(c => c.id === 'cmd-ia-preso').status === 'erro', 'comando de IA preso em processando vira erro no boot');

  titulo('recepção: grava, conta via RPC, deduplica e não trava com horário inválido');
  const t0 = Date.now();
  s.ev.emit('messages.upsert', { type: 'notify', messages: [msgTexto('5545999990001@s.whatsapp.net', 'W1', 'olá')] });
  await ate(() => DB.mensagens.some(m => m.externo_id === 'W1'));
  afirma(DB.mensagens.some(m => m.externo_id === 'W1'), 'mensagem gravada');
  afirma(rpcs.some(r => r.nome === 'registrar_entrada' && r.args.entrada === true), 'não lidas via registrar_entrada');
  await ate(() => DB.automacao_log.length > 0, 1500);
  afirma(Date.now() - t0 < 3000, "automação com 'seg-sexta' não travou o motor");
  s.ev.emit('messages.upsert', { type: 'notify', messages: [msgTexto('5545999990001@s.whatsapp.net', 'W1', 'olá')] });
  await esperar(300);
  afirma(DB.mensagens.filter(m => m.externo_id === 'W1').length === 1, 'reentrega não duplica');

  titulo('corrida: duas mensagens de um número novo ao mesmo tempo');
  s.ev.emit('messages.upsert', { type: 'notify', messages: [msgTexto('5545999990002@s.whatsapp.net', 'W2', 'oi')] });
  s.ev.emit('messages.upsert', { type: 'notify', messages: [msgTexto('5545999990002@s.whatsapp.net', 'W3', 'tudo bem?')] });
  await ate(() => DB.mensagens.some(m => m.externo_id === 'W3') && DB.mensagens.some(m => m.externo_id === 'W2'));
  afirma(DB.conversas.filter(c => c.telefone === '5545999990002').length === 1, 'uma conversa só');
  afirma(DB.mensagens.some(m => m.externo_id === 'W2') && DB.mensagens.some(m => m.externo_id === 'W3'), 'as duas mensagens gravadas (antes a 2ª sumia)');

  titulo('banco fora na recepção → fila de pendentes (nada some)');
  regras.falharInsertMensagem = 1;
  s.ev.emit('messages.upsert', { type: 'notify', messages: [msgTexto('5545999990003@s.whatsapp.net', 'W4', 'importante')] });
  await ate(() => DB.motor_pendentes.some(p => p.externo_id === 'W4'));
  afirma(DB.motor_pendentes.some(p => p.externo_id === 'W4' && p.status === 'pendente'), 'mensagem guardada em motor_pendentes');

  titulo('fila de envio: enviada não vira erro se o banco falhar depois');
  const conv = DB.conversas.find(c => c.telefone === '5545999990001');
  DB.mensagens.push({ id: 'out-1', conversa_id: conv.id, direcao: 'saida', tipo: 'texto', texto: 'resposta', status: 'pendente', externo_id: '', criado_em: agora(), atualizado_em: agora(), conversas: undefined });
  // o select da fila pede conversas(telefone,...) embutido: o simulador devolve a linha crua; injeta o embutido
  Object.defineProperty(DB.mensagens[DB.mensagens.length - 1], 'conversas', { value: { telefone: conv.telefone, tipo: 'individual', grupo_jid: '' }, enumerable: true });
  regras.falharPatchMensagem = true;
  await ate(() => enviados.some(e => e.conteudo && e.conteudo.text === 'resposta'), 6000);
  afirma(enviados.some(e => e.conteudo && e.conteudo.text === 'resposta'), 'mensagem enviada ao WhatsApp');
  await esperar(9000); // as tentativas do db.js (400/1200/3000 ms) esgotam
  const out = DB.mensagens.find(m => m.id === 'out-1');
  afirma(out.status !== 'erro', "não virou 'erro' depois de sair (antes: atendente reenviava e o cliente recebia 2x)");
  afirma(logs.some(l => /ajuste guardado/.test(l)), 'o status ficou guardado para nova tentativa');
  regras.falharPatchMensagem = false;

  titulo('responder a própria mensagem: motor resolve o id no WhatsApp e cita (E5)');
  DB.conversas.push({ id: 'g1', telefone: '', tipo: 'grupo', grupo_jid: '120363@g.us', nome: 'Grupo', participantes: [], criado_em: agora(), atualizado_em: agora() });
  DB.mensagens.push({ id: 'own-1', conversa_id: 'g1', direcao: 'saida', tipo: 'texto', texto: 'anterior', status: 'enviada', externo_id: 'OWN1', participante: '', criado_em: agora(), atualizado_em: agora() });
  const comEmbutido = (m, conv) => { Object.defineProperty(m, 'conversas', { value: conv, enumerable: true }); DB.mensagens.push(m); };
  // o front gravou a citação ANTES de saber o externo_id da própria mensagem (nasce vazio)
  comEmbutido({ id: 'out-2', conversa_id: 'g1', direcao: 'saida', tipo: 'texto', texto: 'citando no grupo', status: 'pendente', externo_id: '',
    citado: { id: 'own-1', externoId: '', texto: 'anterior', minha: true, participante: '' }, criado_em: agora(), atualizado_em: agora() },
    { telefone: '', tipo: 'grupo', grupo_jid: '120363@g.us' });
  await ate(() => enviados.some(e => e.conteudo && e.conteudo.text === 'citando no grupo'), 8000);
  const envG = enviados.find(e => e.conteudo && e.conteudo.text === 'citando no grupo');
  const qG = envG && envG.opcoes && envG.opcoes.quoted;
  afirma(!!qG && qG.key.id === 'OWN1', 'externo_id da própria mensagem resolvido pelo motor (antes saía sem citação, em silêncio)');
  afirma(!!qG && qG.key.fromMe === true, 'citação marcada como minha');
  afirma(!!qG && /^554591228323/.test(qG.key.participant || ''), 'em grupo, participant = nosso JID');
  DB.mensagens.push({ id: 'own-2', conversa_id: conv.id, direcao: 'saida', tipo: 'texto', texto: 'anterior2', status: 'enviada', externo_id: 'OWN2', criado_em: agora(), atualizado_em: agora() });
  comEmbutido({ id: 'out-3', conversa_id: conv.id, direcao: 'saida', tipo: 'texto', texto: 'citando no privado', status: 'pendente', externo_id: '',
    citado: { id: 'own-2', externoId: 'OWN2', texto: 'anterior2', minha: true, participante: '' }, criado_em: agora(), atualizado_em: agora() },
    { telefone: conv.telefone, tipo: 'individual', grupo_jid: '' });
  await ate(() => enviados.some(e => e.conteudo && e.conteudo.text === 'citando no privado'), 8000);
  const envI = enviados.find(e => e.conteudo && e.conteudo.text === 'citando no privado');
  afirma(!!envI && envI.opcoes.quoted && envI.opcoes.quoted.key.participant === undefined, 'em conversa individual não vai participant');

  titulo('confirmação de leitura: não regride e aceita recibo por participante (E5)');
  s.ev.emit('messages.update', [{ key: { remoteJid: '120363@g.us', id: 'OWN1', fromMe: true }, update: { status: 4 } }]);
  await ate(() => DB.mensagens.find(m => m.id === 'own-1').status === 'lida');
  afirma(DB.mensagens.find(m => m.id === 'own-1').status === 'lida', 'ack 4 → lida');
  s.ev.emit('messages.update', [{ key: { remoteJid: '120363@g.us', id: 'OWN1', fromMe: true }, update: { status: 3 } }]);
  await esperar(300);
  afirma(DB.mensagens.find(m => m.id === 'own-1').status === 'lida', 'ack 3 atrasado não volta lida para entregue');
  DB.mensagens.push({ id: 'own-3', conversa_id: 'g1', direcao: 'saida', tipo: 'texto', texto: 'recibo', status: 'enviada', externo_id: 'R1', criado_em: agora(), atualizado_em: agora() });
  s.ev.emit('message-receipt.update', [{ key: { remoteJid: '120363@g.us', id: 'R1', fromMe: true }, receipt: { userJid: '5545999990007@s.whatsapp.net', readTimestamp: 1700000000 } }]);
  await ate(() => DB.mensagens.find(m => m.id === 'own-3').status === 'lida');
  afirma(DB.mensagens.find(m => m.id === 'own-3').status === 'lida', 'recibo de leitura de participante do grupo → lida');

  titulo('participantes do grupo com telefone real, lid e nome pelo pushName (E6)');
  const msgGrupo = (id, participant, pushName, texto, extra = {}) => ({
    key: Object.assign({ remoteJid: '120999@g.us', id, fromMe: false, participant }, extra), pushName,
    messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: texto }
  });
  s.ev.emit('messages.upsert', { type: 'notify', messages: [msgGrupo('G1', '111@lid', 'Fulano Silva', 'bom dia grupo')] });
  await ate(() => { const g = DB.conversas.find(c => c.grupo_jid === '120999@g.us'); return !!g && (g.participantes || []).some(p => p.nome === 'Fulano Silva'); }, 6000);
  const g = DB.conversas.find(c => c.grupo_jid === '120999@g.us');
  const ps = (g && g.participantes) || [];
  afirma(ps.some(p => p.telefone === '5545999990011' && p.lid === '111' && p.admin === true), 'participante @lid vira telefone real (phoneNumber) + lid + admin');
  afirma(ps.some(p => p.telefone === '5545999990012' && p.lid === '222'), 'participante por número guarda o lid');
  afirma(ps.some(p => p.telefone === 'lid-333'), 'lid sem número conhecido fica como lid-… (o front sabe tratar)');
  afirma(ps.find(p => p.telefone === '5545999990011').nome === 'Fulano Silva', 'nome do pushName anotado no participante certo (casado pelo lid)');
  s.ev.emit('messages.upsert', { type: 'notify', messages: [msgGrupo('G2', '5545999990012@s.whatsapp.net', 'Beltrana', 'oi')] });
  await ate(() => (DB.conversas.find(c => c.grupo_jid === '120999@g.us').participantes || []).some(p => p.nome === 'Beltrana'), 6000);
  afirma((DB.conversas.find(c => c.grupo_jid === '120999@g.us').participantes || []).find(p => p.telefone === '5545999990012').nome === 'Beltrana', 'nome casado pelo telefone');
  afirma(!logs.some(l => /Fulano|Beltrana/.test(l)), 'nome do participante não vai para o log');

  titulo('vistoria dos grupos: formato antigo (lid cru no telefone) é reconhecido, duplicatas somem, comando só para admin (E7)');
  // formato antigo do motor: o LID cru gravado como telefone (14+ dígitos), sem a chave lid — e a mesma pessoa de novo no formato novo
  DB.conversas.push({ id: 'g-vist', telefone: 'grupo-120555', tipo: 'grupo', grupo_jid: '120555@g.us', nome: 'Grupo Velho', arquivada: false, participantes: [
    { telefone: '111', admin: false, nome: 'Antigo Um' },
    { telefone: '5545999990011', lid: '111', nome: '', admin: true },
    { telefone: '99999999999999', admin: false }
  ], criado_em: agora(), atualizado_em: agora() });
  const acharCmd = id => DB.motor_comandos.find(c => c.id === id);
  const fimCmd = async id => { await ate(() => ['ok', 'erro'].includes(acharCmd(id).status), 8000); return acharCmd(id); };
  DB.motor_comandos.push({ id: 'cmd-vist-estag', tipo: 'grupos_vistoria', payload: { aplicar: true }, autor: 'u-estag', status: 'pendente', criado_em: agora() });
  let cv = await fimCmd('cmd-vist-estag');
  afirma(cv.status === 'erro' && /administradores/.test(cv.erro || ''), 'vistoria por atendente é recusada (só admin)');
  afirma(DB.conversas.find(c => c.id === 'g-vist').participantes.length === 3 && DB.conversas.find(c => c.id === 'g-vist').participantes[0].telefone === '111', 'recusada: nada mudou no grupo');
  DB.motor_comandos.push({ id: 'cmd-vist-seco', tipo: 'grupos_vistoria', payload: { aplicar: false }, autor: 'u-admin', status: 'pendente', criado_em: agora() });
  cv = await fimCmd('cmd-vist-seco');
  afirma(cv.status === 'ok' && cv.resultado && cv.resultado.grupos >= 1 && cv.resultado.aplicado === false, 'só conferir (aplicar: false) devolve o relatório sem gravar: ' + (cv.erro || ''));
  let det = cv.resultado && (cv.resultado.detalhes || []).find(d => d.id === 'g-vist');
  afirma(!!det && det.antes === 3 && det.depois === 3 && det.lidsCrus === 2 && det.duplicatas === 1 && det.removidos === 1 && det.incluidos === 2 && det.semNumero === 1, 'relatório do grupo: 3→3, 2 lids crus, 1 duplicata, 1 removido (saiu do grupo), 2 incluídos, 1 sem número: ' + JSON.stringify(det));
  afirma(DB.conversas.find(c => c.id === 'g-vist').participantes[0].telefone === '111', 'só conferir: lista continua como estava');
  DB.conversas.push({ id: 'g-fora', telefone: 'grupo-fora', tipo: 'grupo', grupo_jid: 'fora-1@g.us', nome: 'Grupo Fora', arquivada: false, participantes: [{ telefone: '99999999999991', admin: false }], criado_em: agora(), atualizado_em: agora() });
  DB.conversas.push({ id: 'g-limite', telefone: 'grupo-limite', tipo: 'grupo', grupo_jid: 'limite-1@g.us', nome: 'Grupo Limite', arquivada: false, participantes: [{ telefone: '99999999999992', admin: false }], criado_em: agora(), atualizado_em: agora() });
  DB.motor_comandos.push({ id: 'cmd-vist', tipo: 'grupos_vistoria', payload: { aplicar: true }, autor: 'u-admin', status: 'pendente', criado_em: agora() });
  cv = await fimCmd('cmd-vist');
  const detFora = (cv.resultado.detalhes || []).find(d => d.id === 'g-fora'), detLimite = (cv.resultado.detalhes || []).find(d => d.id === 'g-limite');
  afirma(!!detFora && /não está mais neste grupo/.test(detFora.erro || ''), 'grupo em que a conta não está (403): erro explica, lista fica como estava: ' + JSON.stringify(detFora));
  afirma(DB.conversas.find(c => c.id === 'g-fora').participantes[0].telefone === '99999999999991', 'grupo fora: nada regravado');
  afirma(!!detLimite && !detLimite.erro && detLimite.depois === 3 && DB.conversas.find(c => c.id === 'g-limite').participantes.length === 3, 'limite do WhatsApp (rate-overlimit) na 1ª consulta: espera e tenta de novo, e corrige: ' + JSON.stringify(detLimite));
  afirma(cv.resultado.comErro === 1 && cv.resultado.consultados >= 3, 'só o grupo fora conta como erro');
  afirma(cv.status === 'ok' && cv.resultado.aplicado === true && cv.resultado.corrigidos >= 1, 'aplicar: relatório diz quantos grupos foram corrigidos: ' + (cv.erro || ''));
  const pv = DB.conversas.find(c => c.id === 'g-vist').participantes;
  afirma(pv.length === 3 && pv.filter(p => p.lid === '111' || p.telefone === '111').length === 1, 'a pessoa que estava em dobro ficou uma vez só');
  afirma(pv.some(p => p.telefone === '5545999990011' && p.lid === '111' && p.admin === true && p.nome === 'Antigo Um'), 'número real + lid + admin, com o nome preservado do registro antigo');
  afirma(!pv.some(p => p.telefone === '99999999999999') && pv.some(p => p.telefone === '5545999990012' && p.lid === '222') && pv.some(p => p.telefone === 'lid-333'), 'quem saiu do grupo some; quem está entra; lid sem número fica lid-…');
  afirma(!pv.some(p => /^\d{14,}$/.test(p.telefone)), 'nenhum lid cru sobrou no telefone');
  // anotar o nome por mensagem: um registro antigo (lid cru) é atualizado no lugar, não duplicado
  DB.conversas.push({ id: 'g-vist2', telefone: 'grupo-120556', tipo: 'grupo', grupo_jid: '120556@g.us', nome: 'Grupo Velho 2', arquivada: false, participantes: [{ telefone: '111', admin: false }], criado_em: agora(), atualizado_em: agora() });
  s.ev.emit('messages.upsert', { type: 'notify', messages: [msgGrupo('G3', '111@lid', 'Nome Pelo Push', 'oi', { remoteJid: '120556@g.us', participantAlt: '5545999990011@s.whatsapp.net' })] });
  await ate(() => (DB.conversas.find(c => c.id === 'g-vist2').participantes || []).some(p => p.nome === 'Nome Pelo Push'), 6000);
  const pv2 = DB.conversas.find(c => c.id === 'g-vist2').participantes;
  afirma(pv2.length === 1 && pv2[0].telefone === '5545999990011' && pv2[0].lid === '111' && pv2[0].nome === 'Nome Pelo Push', 'mensagem de quem estava no formato antigo corrige o registro (número real + lid + nome) sem duplicar: ' + JSON.stringify(pv2));

  titulo('departamentos múltiplos nas automações: acrescentar = união, delegar = substitui (chat-v14a)');
  const convD = DB.conversas.find(c => c.telefone === '5545999990001');
  Object.assign(convD, { departamento_ids: ['d-jur'], departamento_id: 'd-jur', tags: [] });
  s.ev.emit('messages.upsert', { type: 'notify', messages: [msgTexto('5545999990001@s.whatsapp.net', 'D1', 'segue o boleto')] });
  await ate(() => (convD.departamento_ids || []).includes('d-fin'), 6000);
  afirma(JSON.stringify(convD.departamento_ids) === JSON.stringify(['d-jur', 'd-fin']) && convD.departamento_id === 'd-jur', 'acrescentar: Financeiro entra na lista, Jurídico continua e o espelho segue sendo o 1º');
  s.ev.emit('messages.upsert', { type: 'notify', messages: [msgTexto('5545999990001@s.whatsapp.net', 'D2', 'qual o prazo?')] });
  await ate(() => (convD.tags || []).includes('Prazo'), 6000);
  afirma((convD.tags || []).includes('Prazo'), "condição 'departamento' enxerga o 1º da lista");
  const convE = DB.conversas.find(c => c.telefone === '5545999990002');
  Object.assign(convE, { departamento_ids: ['d-fin', 'd-jur'], departamento_id: 'd-fin', tags: [] });
  s.ev.emit('messages.upsert', { type: 'notify', messages: [msgTexto('5545999990002@s.whatsapp.net', 'D3', 'prazo do recurso')] });
  await ate(() => (convE.tags || []).includes('Prazo'), 6000);
  afirma((convE.tags || []).includes('Prazo'), "condição 'departamento' enxerga o 2º da lista (antes só olhava departamento_id)");
  afirma(!(convE.tags || []).includes('Triagem') && !(convD.tags || []).includes('Triagem'), "'sem departamento' é falso com a lista preenchida");
  s.ev.emit('messages.upsert', { type: 'notify', messages: [msgTexto('5545999990002@s.whatsapp.net', 'D4', 'plantão urgente')] });
  await ate(() => JSON.stringify(convE.departamento_ids) === JSON.stringify(['d-fin']), 6000);
  afirma(JSON.stringify(convE.departamento_ids) === JSON.stringify(['d-fin']) && convE.departamento_id === 'd-fin', 'delegar substitui a lista inteira (as automações antigas contam com isso)');
  DB.conversas.push({ id: 'c-tri', telefone: '5545999990005', tipo: 'individual', grupo_jid: '', nome: 'Tri', participantes: [], tags: [], departamento_id: null, departamento_ids: [], criado_em: agora(), atualizado_em: agora() });
  s.ev.emit('messages.upsert', { type: 'notify', messages: [msgTexto('5545999990005@s.whatsapp.net', 'D6', 'triagem por favor')] });
  await ate(() => (DB.conversas.find(c => c.id === 'c-tri').tags || []).includes('Triagem'), 6000);
  afirma((DB.conversas.find(c => c.id === 'c-tri').tags || []).includes('Triagem'), "'sem departamento' é verdadeiro com a lista vazia");

  titulo('enquete de departamentos: o setor escolhido vai para a frente da lista e o time não perde o que marcou');
  const enquete = (id, convId, externo) => ({ id, conversa_id: convId, direcao: 'saida', tipo: 'enquete', texto: 'Setor?', status: 'enviada', externo_id: externo,
    enquete: { pergunta: 'Setor?', opcoes: ['Jurídico', 'Financeiro'], tipo: 'departamentos', secret: Buffer.from('segredo').toString('base64'), votos: {} }, criado_em: agora(), atualizado_em: agora() });
  const voto = (jid, id, externo) => ({ key: { remoteJid: jid, id, fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000),
    message: { pollUpdateMessage: { pollCreationMessageKey: { id: externo }, vote: {} } } });
  DB.conversas.push({ id: 'c-vA', telefone: '5545999990021', tipo: 'individual', grupo_jid: '', nome: 'Votante A', participantes: [], tags: [], departamento_id: 'd-jur', departamento_ids: ['d-jur'], criado_em: agora(), atualizado_em: agora() });
  DB.mensagens.push(enquete('enq-a', 'c-vA', 'ENQA'));
  s.ev.emit('messages.upsert', { type: 'notify', messages: [voto('5545999990021@s.whatsapp.net', 'VA1', 'ENQA')] });
  await ate(() => DB.mensagens.some(m => m.conversa_id === 'c-vA' && /direcionado/.test(m.texto || '')), 6000);
  const convA = DB.conversas.find(c => c.id === 'c-vA');
  afirma(JSON.stringify(convA.departamento_ids) === JSON.stringify(['d-fin', 'd-jur']) && convA.departamento_id === 'd-fin', 'individual: Financeiro na frente (espelho) e Jurídico mantido');
  afirma(DB.mensagens.some(m => m.conversa_id === 'c-vA' && /Financeiro/.test(m.texto || '')), 'confirmação ao cliente cita o setor escolhido');

  titulo('sem a migração chat-v14a: PGRST204 no corpo → cai para departamento_id e não repete o 400');
  regras.semDeptos = true; regras.n400 = 0;
  DB.conversas.push({ id: 'c-velha', telefone: '5545999990004', tipo: 'individual', grupo_jid: '', nome: 'Velha', participantes: [], tags: [], departamento_id: null, criado_em: agora(), atualizado_em: agora() });
  const convV = DB.conversas.find(c => c.id === 'c-velha');
  s.ev.emit('messages.upsert', { type: 'notify', messages: [msgTexto('5545999990004@s.whatsapp.net', 'D5', 'plantão agora')] });
  await ate(() => convV.departamento_id === 'd-fin', 6000);
  afirma(convV.departamento_id === 'd-fin', 'delegou pelo campo antigo depois do PGRST204');
  afirma(logs.some(l => /chat-v14a/.test(l)), 'avisou no log para rodar a migração');
  const n400Antes = regras.n400;
  DB.conversas.push({ id: 'c-velha2', telefone: '5545999990006', tipo: 'individual', grupo_jid: '', nome: 'Velha 2', participantes: [], tags: [], departamento_id: null, criado_em: agora(), atualizado_em: agora() });
  s.ev.emit('messages.upsert', { type: 'notify', messages: [msgTexto('5545999990006@s.whatsapp.net', 'D7', 'plantão de novo')] });
  await ate(() => DB.conversas.find(c => c.id === 'c-velha2').departamento_id === 'd-fin', 6000);
  afirma(DB.conversas.find(c => c.id === 'c-velha2').departamento_id === 'd-fin' && regras.n400 === n400Antes, 'segunda delegação já vai sem a lista: nenhum 400 novo');
  // acrescentar sem a coluna: fica só o 1º — e o log avisa (antes era perda silenciosa com "sucesso" na automação)
  DB.conversas.push({ id: 'c-velha3', telefone: '5545999990007', tipo: 'individual', grupo_jid: '', nome: 'Velha 3', participantes: [], tags: [], departamento_id: 'd-jur', criado_em: agora(), atualizado_em: agora() });
  s.ev.emit('messages.upsert', { type: 'notify', messages: [msgTexto('5545999990007@s.whatsapp.net', 'D8', 'segue o boleto')] });
  await ate(() => logs.some(l => /ficou só com o 1º/.test(l)), 6000);
  afirma(logs.some(l => /ficou só com o 1º/.test(l)) && DB.conversas.find(c => c.id === 'c-velha3').departamento_id === 'd-jur', 'acrescentar sem a coluna avisa no log e não mente sucesso');
  // enquete sem a coluna: o voto do cliente MOVE a conversa (campo antigo = setor escolhido)
  DB.conversas.push({ id: 'c-vB', telefone: '5545999990022', tipo: 'individual', grupo_jid: '', nome: 'Votante B', participantes: [], tags: [], departamento_id: 'd-jur', criado_em: agora(), atualizado_em: agora() });
  DB.mensagens.push(enquete('enq-b', 'c-vB', 'ENQB'));
  s.ev.emit('messages.upsert', { type: 'notify', messages: [voto('5545999990022@s.whatsapp.net', 'VB1', 'ENQB')] });
  await ate(() => DB.conversas.find(c => c.id === 'c-vB').departamento_id === 'd-fin', 6000);
  afirma(DB.conversas.find(c => c.id === 'c-vB').departamento_id === 'd-fin', 'enquete sem a coluna move a conversa para o setor votado');
  regras.semDeptos = false;

  titulo('mensagem editada pelo contato: texto novo na original, versão anterior guardada; embrulhada em ephemeral também');
  const edicao = (jid, id, alvo, texto, embrulhar) => {
    const proto = { protocolMessage: { type: 14, key: { remoteJid: jid, id: alvo, fromMe: false }, editedMessage: { conversation: texto } } };
    return { key: { remoteJid: jid, id, fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000),
      message: embrulhar ? { ephemeralMessage: { message: proto } } : proto };
  };
  const antesEd = DB.mensagens.length;
  s.ev.emit('messages.upsert', { type: 'notify', messages: [edicao('5545999990001@s.whatsapp.net', 'E1', 'W1', 'olá, corrigido', true)] });
  await ate(() => (DB.mensagens.find(m => m.externo_id === 'W1') || {}).texto === 'olá, corrigido', 6000);
  const w1 = DB.mensagens.find(m => m.externo_id === 'W1');
  afirma(w1.texto === 'olá, corrigido', 'texto da mensagem original trocado (aviso embrulhado em ephemeralMessage)');
  afirma(Array.isArray(w1.edicoes) && w1.edicoes.length === 1 && w1.edicoes[0].texto === 'olá' && /^\d{4}-/.test(w1.edicoes[0].em || ''), 'versão anterior guardada em edicoes com a hora');
  afirma(DB.mensagens.length === antesEd && !DB.mensagens.some(m => m.externo_id === 'E1'), 'o aviso de edição não vira mensagem nova nem "tipo não suportado"');
  s.ev.emit('messages.upsert', { type: 'notify', messages: [edicao('5545999990001@s.whatsapp.net', 'E2', 'W1', 'olá, corrigido de novo', false)] });
  await ate(() => (DB.mensagens.find(m => m.externo_id === 'W1') || {}).texto === 'olá, corrigido de novo', 6000);
  afirma(w1.edicoes.length === 2 && w1.edicoes[1].texto === 'olá, corrigido', 'segunda edição empilha a versão anterior');
  afirma(!logs.some(l => /corrigido/.test(l)), 'texto editado não vai para o log');

  titulo('edição CIFRADA (secretEncryptedMessage): segredo guardado na chegada, texto novo decifrado');
  const cripto = require('crypto');
  const segredo = cripto.randomBytes(32);
  const jidS = '5545999990001@s.whatsapp.net';
  s.ev.emit('messages.upsert', { type: 'notify', messages: [{ key: { remoteJid: jidS, id: 'S1', fromMe: false }, pushName: 'Cliente', messageTimestamp: Math.floor(Date.now() / 1000),
    message: { conversation: 'texto original', messageContextInfo: { messageSecret: segredo } } }] });
  await ate(() => DB.mensagens_segredos.some(x => x.externo_id === 'S1'), 6000);
  afirma(DB.mensagens_segredos.some(x => x.externo_id === 'S1' && x.segredo === segredo.toString('base64') && x.remetente === jidS), 'segredo da mensagem guardado em mensagens_segredos (com o remetente)');
  // mesmo esquema do whatsmeow: HKDF(segredo, info = id + remetente original + editor + "Message Edit"), AES-256-GCM sem AAD
  const cifrar = (id, orig, mod, objeto) => {
    const chave = Buffer.from(cripto.hkdfSync('sha256', segredo, Buffer.alloc(0), Buffer.concat([Buffer.from(id), Buffer.from(orig), Buffer.from(mod), Buffer.from('Message Edit')]), 32));
    const iv = cripto.randomBytes(12);
    const c = cripto.createCipheriv('aes-256-gcm', chave, iv);
    const corpo = Buffer.concat([c.update(Buffer.from(JSON.stringify(objeto))), c.final()]);
    return { encPayload: Buffer.concat([corpo, c.getAuthTag()]), encIv: iv };
  };
  const envS = cifrar('S1', jidS, jidS, { protocolMessage: { editedMessage: { conversation: 'texto editado às escondidas' } } });
  s.ev.emit('messages.upsert', { type: 'notify', messages: [{ key: { remoteJid: jidS, id: 'SE1', fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000),
    message: { secretEncryptedMessage: { targetMessageKey: { remoteJid: jidS, id: 'S1', fromMe: false }, encPayload: envS.encPayload, encIv: envS.encIv, secretEncType: 2 } } }] });
  await ate(() => (DB.mensagens.find(m => m.externo_id === 'S1') || {}).texto === 'texto editado às escondidas', 6000);
  const s1 = DB.mensagens.find(m => m.externo_id === 'S1');
  afirma(s1.texto === 'texto editado às escondidas' && Array.isArray(s1.edicoes) && s1.edicoes.length === 1 && s1.edicoes[0].texto === 'texto original', 'edição cifrada decifrada: texto novo na original + versão anterior');
  afirma(!DB.mensagens.some(m => m.externo_id === 'SE1') && !DB.mensagens.some(m => /não suportado/.test(m.texto || '')), 'nada de "[tipo não suportado: secretEncryptedMessage]" na conversa');
  afirma(!logs.some(l => /escondidas|texto original/.test(l)), 'texto decifrado não vai para o log');
  // sem segredo guardado (mensagem anterior ao chat-v14c): a original é marcada, sem registro de erro
  const envW = cifrar('W2', jidS, jidS, { conversation: 'x' });
  s.ev.emit('messages.upsert', { type: 'notify', messages: [{ key: { remoteJid: '5545999990002@s.whatsapp.net', id: 'SE2', fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000),
    message: { secretEncryptedMessage: { targetMessageKey: { remoteJid: '5545999990002@s.whatsapp.net', id: 'W2', fromMe: false }, encPayload: envW.encPayload, encIv: envW.encIv, secretEncType: 2 } } }] });
  await ate(() => /editada no celular/.test((DB.mensagens.find(m => m.externo_id === 'W2') || {}).texto || ''), 6000);
  afirma(/\(editada no celular\)$/.test(DB.mensagens.find(m => m.externo_id === 'W2').texto) && !DB.mensagens.some(m => m.externo_id === 'SE2'), 'sem segredo: original marcada "(editada no celular)" em vez de registro de erro');

  // sem a migração chat-v14b: cai no selo "(editada)" de antes, sem perder a edição
  regras.semEdicoes = true;
  const w2 = DB.mensagens.find(m => m.externo_id === 'W2');
  s.ev.emit('messages.upsert', { type: 'notify', messages: [edicao('5545999990002@s.whatsapp.net', 'E3', 'W2', 'oi editado', false)] });
  await ate(() => /editado/.test((DB.mensagens.find(m => m.externo_id === 'W2') || {}).texto || ''), 6000);
  afirma(w2.texto === 'oi editado (editada)' && !('edicoes' in w2 && Array.isArray(w2.edicoes) && w2.edicoes.length), 'sem a coluna: texto novo + selo "(editada)"');
  afirma(logs.some(l => /chat-v14b/.test(l)), 'avisou no log para rodar a migração');
  regras.semEdicoes = false;

  titulo('resolvido/fechado arquivam; mensagem nova reabre e desarquiva (chat-v15a)');
  DB.conversas.push({ id: 'c-enc', telefone: '5545999990031', tipo: 'individual', grupo_jid: '', nome: 'Encerra', participantes: [], tags: [], departamento_id: null, departamento_ids: [], status: 'em_atendimento', arquivada: false, nao_lidas: 0, criado_em: agora(), atualizado_em: agora() });
  s.ev.emit('messages.upsert', { type: 'notify', messages: [msgTexto('5545999990031@s.whatsapp.net', 'RS1', 'obrigado, pode encerrar')] });
  await ate(() => DB.conversas.find(c => c.id === 'c-enc').status === 'resolvido', 6000);
  const cEnc = DB.conversas.find(c => c.id === 'c-enc');
  afirma(cEnc.status === 'resolvido' && cEnc.arquivada === true, 'automação "mudar status → resolvido" também arquiva');
  s.ev.emit('messages.upsert', { type: 'notify', messages: [msgTexto('5545999990031@s.whatsapp.net', 'RS2', 'na verdade tenho outra dúvida')] });
  await ate(() => cEnc.arquivada === false, 6000);
  afirma(cEnc.arquivada === false && cEnc.status === 'aberto' && cEnc.nao_lidas >= 1, 'mensagem nova do contato devolve a conversa à caixa, aberta e não lida');

  titulo('mensagem encaminhada pelo contato chega marcada, mesmo embrulhada (temporária / documento com legenda)');
  s.ev.emit('messages.upsert', { type: 'notify', messages: [{ key: { remoteJid: '5545999990001@s.whatsapp.net', id: 'F1', fromMe: false }, pushName: 'Cliente', messageTimestamp: Math.floor(Date.now() / 1000),
    message: { ephemeralMessage: { message: { extendedTextMessage: { text: 'olha isso que me mandaram', contextInfo: { isForwarded: true, forwardingScore: 2 } } } } } }] });
  s.ev.emit('messages.upsert', { type: 'notify', messages: [{ key: { remoteJid: '5545999990001@s.whatsapp.net', id: 'F2', fromMe: false }, pushName: 'Cliente', messageTimestamp: Math.floor(Date.now() / 1000),
    message: { conversation: 'mensagem normal, minha mesmo' } }] });
  await ate(() => DB.mensagens.some(m => m.externo_id === 'F1') && DB.mensagens.some(m => m.externo_id === 'F2'), 6000);
  afirma(DB.mensagens.find(m => m.externo_id === 'F1').encaminhada === true, 'encaminhada dentro de ephemeralMessage é marcada');
  afirma(DB.mensagens.find(m => m.externo_id === 'F2').encaminhada === false, 'mensagem comum não é marcada');

  titulo('álbum de fotos: o envelope albumMessage não vira registro; a foto embrulhada em associatedChildMessage entra como imagem');
  const base = { key: { remoteJid: '5545999990001@s.whatsapp.net', fromMe: false }, pushName: 'Cliente', messageTimestamp: Math.floor(Date.now() / 1000) };
  s.ev.emit('messages.upsert', { type: 'notify', messages: [
    Object.assign({}, base, { key: Object.assign({}, base.key, { id: 'AL0' }), message: { albumMessage: { expectedImageCount: 2, expectedVideoCount: 0 } } }),
    Object.assign({}, base, { key: Object.assign({}, base.key, { id: 'AL1' }), message: { associatedChildMessage: { message: { imageMessage: { mimetype: 'image/jpeg', caption: 'foto 1 do álbum', fileLength: 10 } } } } }),
    // cópia HD da foto que já chegou (HD_IMAGE_DUAL_UPLOAD = 10; vídeo = 5 e HEVC = 19): não vira segunda foto
    Object.assign({}, base, { key: Object.assign({}, base.key, { id: 'AL1HD' }), message: { associatedChildMessage: { message: { imageMessage: { mimetype: 'image/jpeg', caption: 'foto 1 do álbum', fileLength: 10 }, messageContextInfo: { messageAssociation: { associationType: 10, parentMessageKey: { id: 'AL1' } } } } } } }),
    Object.assign({}, base, { key: Object.assign({}, base.key, { id: 'AL1HDV' }), message: { videoMessage: { mimetype: 'video/mp4', fileLength: 10 }, messageContextInfo: { messageAssociation: { associationType: 'HD_VIDEO_DUAL_UPLOAD' } } } }),
    // 6 é STATUS_EXTERNAL_RESHARE: mensagem de verdade, tem que entrar
    Object.assign({}, base, { key: Object.assign({}, base.key, { id: 'RESH6' }), message: { associatedChildMessage: { message: { imageMessage: { mimetype: 'image/jpeg', caption: 'repost de status', fileLength: 10 }, messageContextInfo: { messageAssociation: { associationType: 6 } } } } } }),
    Object.assign({}, base, { key: Object.assign({}, base.key, { id: 'AL2' }), message: { conversation: 'depois do álbum' } })
  ] });
  await ate(() => DB.mensagens.some(m => m.externo_id === 'AL2'), 6000);
  afirma(!DB.mensagens.some(m => m.externo_id === 'AL0'), 'envelope do álbum não é gravado');
  afirma(!DB.mensagens.some(m => m.externo_id === 'AL1HD') && !DB.mensagens.some(m => m.externo_id === 'AL1HDV'), 'cópias HD (10 no filho, 5 por nome no nível de fora) não são gravadas (sem foto/vídeo duplicado)');
  const resh = DB.mensagens.find(m => m.externo_id === 'RESH6');
  afirma(!!resh && resh.tipo === 'imagem' && resh.texto === 'repost de status', 'associationType 6 (STATUS_EXTERNAL_RESHARE) é mensagem real e entra');
  afirma(!DB.mensagens.some(m => /tipo não suportado: (albumMessage|associatedChildMessage)/.test(m.texto || '')), 'nenhum "tipo não suportado" para álbum');
  const foto = DB.mensagens.find(m => m.externo_id === 'AL1');
  afirma(!!foto && foto.tipo === 'imagem' && foto.texto === 'foto 1 do álbum', 'foto do álbum entra como imagem com a legenda');

  titulo('arquivo grande (chat-v16c): entra sem baixar, com nome/tamanho; "baixar_midia" sob demanda sobe para midias-grandes e liga o link');
  s.ev.emit('messages.upsert', { type: 'notify', messages: [Object.assign({}, base, { key: Object.assign({}, base.key, { id: 'BIG1' }),
    message: { documentMessage: { fileName: 'Conversa exportada.zip', mimetype: 'application/zip', fileLength: 137 * 1048576, mediaKey: Buffer.from('k'.repeat(32)), url: 'https://mmg.whatsapp.net/x', directPath: '/x', fileSha256: Buffer.from('s'.repeat(32)) } } })] });
  await ate(() => DB.mensagens.some(m => m.externo_id === 'BIG1'), 6000);
  const big = DB.mensagens.find(m => m.externo_id === 'BIG1');
  afirma(big.tipo === 'arquivo' && !big.midia_url && big.midia_nome === 'Conversa exportada.zip' && big.midia_tamanho === 137 * 1048576 && !/grande demais/.test(big.texto || ''), 'mensagem com nome e tamanho, sem download e sem o aviso antigo');
  const pend = DB.midias_pendentes.find(x => x.externo_id === 'BIG1');
  // buffers viram base64 (BufferJSON: {type:'Buffer', data:'…'}; os objetos proto do Baileys já chegam como string)
  const mk = pend && pend.no && pend.no.mediaKey;
  afirma(!!pend && pend.tipo === 'arquivo' && pend.key.remoteJid === base.key.remoteJid && (typeof mk === 'string' || (mk && mk.type === 'Buffer')), 'referência guardada em midias_pendentes (key + nó da mídia serializado)');
  DB.motor_comandos.push({ id: 'cmd-big', tipo: 'baixar_midia', payload: { mensagemId: big.id }, autor: 'u-admin', status: 'pendente', criado_em: agora() });
  await ate(() => DB.motor_comandos.find(c => c.id === 'cmd-big').status !== 'pendente' && DB.motor_comandos.find(c => c.id === 'cmd-big').status !== 'processando', 8000);
  const cmdBig = DB.motor_comandos.find(c => c.id === 'cmd-big');
  afirma(cmdBig.status === 'ok' && /\/storage\/v1\/object\/public\/midias-grandes\//.test((cmdBig.resultado || {}).url || ''), 'comando ok com a URL no bucket midias-grandes: ' + (cmdBig.erro || ''));
  afirma(!!big.midia_url && big.midia_url === cmdBig.resultado.url && !!pend.caminho && !!pend.baixado_em, 'mensagem ganhou o link e a referência marca caminho + data do download');
  // quem não enxerga a conversa (sem departamento, sem conversas_todas) não ganha o link público
  DB.motor_comandos.push({ id: 'cmd-big2', tipo: 'baixar_midia', payload: { mensagemId: big.id }, autor: 'u-estag', status: 'pendente', criado_em: agora() });
  DB.motor_comandos.push({ id: 'cmd-big3', tipo: 'baixar_midia', payload: { mensagemId: big.id }, autor: 'u-admin', status: 'pendente', criado_em: agora() });
  await ate(() => ['cmd-big2', 'cmd-big3'].every(id => ['ok', 'erro'].includes(DB.motor_comandos.find(c => c.id === id).status)), 8000);
  afirma(/sem alçada para ver esta conversa/.test(DB.motor_comandos.find(c => c.id === 'cmd-big2').erro || ''), 'estagiário sem acesso à conversa não baixa');
  afirma(DB.motor_comandos.find(c => c.id === 'cmd-big3').resultado.url === big.midia_url, 'pedido repetido (admin) devolve o mesmo link sem baixar de novo');
  // mídia expirada no WhatsApp: comando fecha com erro claro e a fila de downloads continua
  s.ev.emit('messages.upsert', { type: 'notify', messages: [Object.assign({}, base, { key: Object.assign({}, base.key, { id: 'BIG2' }),
    message: { documentMessage: { fileName: 'Video audiencia.mp4', mimetype: 'video/mp4', fileLength: 300 * 1048576, mediaKey: Buffer.from('k'.repeat(32)), url: 'https://mmg.whatsapp.net/y', directPath: '/y' } } })] });
  await ate(() => DB.mensagens.some(m => m.externo_id === 'BIG2'), 6000);
  const big2 = DB.mensagens.find(m => m.externo_id === 'BIG2');
  global.__baixarFalso = async () => { throw Object.assign(new Error('Not Found'), { output: { statusCode: 404 } }); };
  DB.motor_comandos.push({ id: 'cmd-big4', tipo: 'baixar_midia', payload: { mensagemId: big2.id }, autor: 'u-admin', status: 'pendente', criado_em: agora() });
  await ate(() => ['ok', 'erro'].includes(DB.motor_comandos.find(c => c.id === 'cmd-big4').status), 8000);
  const cmdBig4 = DB.motor_comandos.find(c => c.id === 'cmd-big4');
  afirma(cmdBig4.status === 'erro' && /não tem mais este arquivo/.test(cmdBig4.erro || ''), '404 do WhatsApp vira "não tem mais este arquivo — peça para reenviar": ' + cmdBig4.erro);
  afirma(!big2.midia_url && !DB.midias_pendentes.find(x => x.externo_id === 'BIG2').caminho, 'nada gravado no erro (referência continua para tentar depois)');
  delete global.__baixarFalso;
  DB.motor_comandos.push({ id: 'cmd-big5', tipo: 'baixar_midia', payload: { mensagemId: big2.id }, autor: 'u-admin', status: 'pendente', criado_em: agora() });
  await ate(() => ['ok', 'erro'].includes(DB.motor_comandos.find(c => c.id === 'cmd-big5').status), 8000);
  afirma(DB.motor_comandos.find(c => c.id === 'cmd-big5').status === 'ok' && !!big2.midia_url, 'depois do erro a fila segue: novo pedido baixa normalmente');

  titulo('alçada nos comandos');
  DB.motor_comandos.push({ id: 'cmd-apagar', tipo: 'apagar_mensagem', payload: { mensagemId: 'out-1' }, autor: 'u-estag', status: 'pendente', criado_em: agora() });
  DB.motor_comandos.push({ id: 'cmd-grupo', tipo: 'criar_grupo', payload: { nome: 'G', telefones: ['5545999990009'] }, autor: 'u-estag', status: 'pendente', criado_em: agora() });
  await ate(() => ['cmd-apagar', 'cmd-grupo'].every(id => DB.motor_comandos.find(c => c.id === id).status !== 'pendente'), 8000);
  afirma(/sem alçada/.test(DB.motor_comandos.find(c => c.id === 'cmd-apagar').erro || ''), 'estagiário sem msg_apagar não apaga');
  // com a alçada msg_apagar, apaga mesmo sem ser o autor (mensagem mandada pelo celular não tem autor)
  DB.perfis.find(p => p.id === 'u-estag').permissoes.msg_apagar = true;
  const outApagar = DB.mensagens.find(m => m.id === 'out-1');
  outApagar.autor = null; outApagar.conversas = { telefone: '5545999990001', tipo: 'individual', grupo_jid: '' };
  DB.motor_comandos.push({ id: 'cmd-apagar2', tipo: 'apagar_mensagem', payload: { mensagemId: 'out-1' }, autor: 'u-estag', status: 'pendente', criado_em: agora() });
  await ate(() => ['ok', 'erro'].includes(DB.motor_comandos.find(c => c.id === 'cmd-apagar2').status), 8000);
  afirma(DB.motor_comandos.find(c => c.id === 'cmd-apagar2').status === 'ok' && outApagar.apagada === true, 'com msg_apagar apaga mensagem sem autor: ' + (DB.motor_comandos.find(c => c.id === 'cmd-apagar2').erro || ''));
  afirma(enviados.some(e => e.conteudo && e.conteudo.delete && e.conteudo.delete.id === outApagar.externo_id), 'mandou a revogação ao WhatsApp com o id da mensagem');
  afirma(/sem alçada/.test(DB.motor_comandos.find(c => c.id === 'cmd-grupo').erro || ''), 'estagiário sem grupos_criar não cria grupo');

  titulo('IA do escritório: módulo motor/ia.js');
  try {
    const ia = require(path.join(__dirname, '..', 'motor', 'ia.js'));
    afirma(ia.MODELO_PADRAO === 'claude-opus-5-5' && ia.MODELOS.map(m => m.id).join(',') === 'claude-opus-5-5,claude-sonnet-5-5', 'modelos atuais, Opus 5.5 padrão');
    afirma(ia.modeloValido('claude-sonnet-5-5') === 'claude-sonnet-5-5' && ia.modeloValido('claude-opus-4-8') === 'claude-opus-5-5' && ia.modeloValido(undefined) === 'claude-opus-5-5', 'id fora da lista cai no padrão');
    delete process.env.ANTHROPIC_API_KEY;
    afirma(ia.disponivel() === false, 'sem chave: indisponível');
    process.env.ANTHROPIC_API_KEY = 'sk-ant-teste';
    afirma(ia.disponivel() === true, 'com chave: disponível (variável lida na hora)');
    let erroTam = ''; try { ia.validarPayload('ia_resumo', { transcript: 'x'.repeat(150001) }); } catch (e) { erroTam = e.message; }
    afirma(/longa demais/.test(erroTam), 'transcript acima de 150.000 caracteres recusado');
    global.__iaChamadas = []; global.__iaFalsa = null;
    let r = await ia.executar('ia_resumo', { transcript: 'Cliente: oi', nomeContato: 'Maria' }, { modelo: 'claude-opus-5-5', contextoIA: { areas: 'Família' } });
    afirma(r.texto === 'resumo simulado' && r.uso.entrada === 100 && r.uso.saida === 20 && r.uso.modelo === 'claude-opus-5-5', 'resumo devolve texto e uso');
    let p = global.__iaChamadas[0];
    afirma(p.model === 'claude-opus-5-5' && p.fallbacks === 'default' && p.betas.includes('server-side-fallback-2026-07-01') && p.output_config.effort === 'medium' && !('thinking' in p) && p.max_tokens === 4000, 'chamada com fallback, esforço médio, sem thinking, 4000 tokens');
    afirma(/Família/.test(p.system) && /Maria/.test(p.messages[0].content) && /Cliente: oi/.test(p.messages[0].content), 'prompt no motor, com contexto do escritório e dados do navegador');
    global.__iaFalsa = async () => ({ content: [{ type: 'text', text: JSON.stringify({ resumo: 'ok', scoreGeral: 70 }) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' });
    r = await ia.executar('ia_analise', { conversaTexto: 'A: oi\nB: olá', atendente: 'Ana', lead: { nome: 'Lead X', etapa: 'Novo' } }, { modelo: 'claude-opus-5-5' });
    p = global.__iaChamadas.at(-1);
    afirma(r.dados.scoreGeral === 70 && p.output_config.effort === 'high' && p.output_config.format.type === 'json_schema' && p.max_tokens === 16000 && /Lead X/.test(p.messages[0].content), 'análise: esforço alto, json_schema, 16000 tokens, lead no prompt, dados parseados');
    global.__iaFalsa = async () => ({ content: [{ type: 'text', text: '{quebrado' }], usage: {}, stop_reason: 'end_turn' });
    await ia.executar('ia_automacao', { pedido: 'x', contexto: '' }, {}).then(() => afirma(false, 'json inválido deveria falhar'), e => afirma(/inválida/.test(e.message), 'json inválido → erro "resposta inválida"'));
    global.__iaFalsa = async () => ({ content: [{ type: 'text', text: '{"resumo":' }], usage: {}, stop_reason: 'max_tokens' });
    await ia.executar('ia_analise', { conversaTexto: 'x', atendente: 'A', lead: null }, {}).then(() => afirma(false, 'max_tokens deveria falhar'), e => afirma(/tamanho máximo/.test(e.message), 'saída cortada (max_tokens) → erro claro, não "inválida"'));
    global.__iaFalsa = async () => ({ content: [], usage: {}, stop_reason: 'end_turn' });
    await ia.executar('ia_resumo', { transcript: 'x' }, {}).then(() => afirma(false, 'vazio deveria falhar'), e => afirma(/vazia/.test(e.message), 'resposta sem texto → erro "vazia"'));
    global.__iaFalsa = async () => ({ content: [], usage: {}, stop_reason: 'refusal' });
    await ia.executar('ia_resumo', { transcript: 'x' }, {}).then(() => afirma(false, 'recusa deveria falhar'), e => afirma(/recusou/.test(e.message), 'recusa persistente → erro "recusou"'));
    global.__iaFalsa = async params => { if (params.model === 'claude-opus-5-5') throw new AnthropicFalso.APIError(529, 'overloaded_error', 'Overloaded'); return { content: [{ type: 'text', text: 'via sonnet' }], usage: { input_tokens: 5, output_tokens: 5 }, stop_reason: 'end_turn' }; };
    r = await ia.executar('ia_resumo', { transcript: 'x' }, { modelo: 'claude-opus-5-5' });
    afirma(r.texto === 'via sonnet' && r.uso.modelo === 'claude-sonnet-5-5', '529 persistente no Opus → uma tentativa com o Sonnet');
    global.__iaFalsa = async () => { throw new AnthropicFalso.AuthenticationError(401, 'authentication_error', 'invalid x-api-key'); };
    await ia.executar('ia_resumo', { transcript: 'x' }, {}).then(() => afirma(false, '401 deveria falhar'), e => afirma(/chave da IA inválida/.test(e.message), '401 → "chave da IA inválida"'));
    global.__iaFalsa = async () => { throw new AnthropicFalso.RateLimitError(429, 'rate_limit_error', 'rate'); };
    await ia.executar('ia_resumo', { transcript: 'x' }, {}).then(() => afirma(false, '429 deveria falhar'), e => afirma(/limite de uso da IA/.test(e.message), '429 → "limite de uso da IA"'));
    global.__iaFalsa = null;
    r = await ia.executar('ia_teste', {}, { modelo: 'claude-sonnet-5-5' });
    afirma(r.ok === true && r.modelo === 'claude-sonnet-5-5' && global.__iaChamadas.at(-1).max_tokens <= 64, 'teste: ok, modelo, chamada mínima');
  } catch (e) { falhas++; imprimir('  ERRO: ' + (e && e.stack || e)); }

  titulo('IA do escritório: fila de comandos');
  try {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-teste'; global.__iaFalsa = null; global.__iaChamadas = [];
    const achar = id => DB.motor_comandos.find(c => c.id === id);
    const cmdIA = (id, tipo, payload, autor) => DB.motor_comandos.push({ id, tipo, payload, autor, status: 'pendente', criado_em: agora() });
    const fim = async id => { await ate(() => ['ok', 'erro'].includes(achar(id).status), 8000); return achar(id); };
    cmdIA('ia-1', 'ia_resumo', { transcript: 'Cliente: SEGREDO-DO-CLIENTE-123', nomeContato: 'Maria' }, 'u-admin');
    let c = await fim('ia-1');
    afirma(c.status === 'ok' && c.resultado.texto === 'resumo simulado' && c.resultado.uso.entrada === 100 && c.resultado.uso.modelo === 'claude-opus-5-5', 'admin: resumo ok, uso e modelo padrão gravados');
    cmdIA('ia-2', 'ia_resumo', { transcript: 'x' }, 'u-estag');
    c = await fim('ia-2'); afirma(c.status === 'erro' && /sem alçada para resumir/.test(c.erro), 'estagiário sem ia_analise → sem alçada');
    DB.departamentos.find(d => d.id === 'd-jur').permissoes = { ia_analise: true };
    DB.perfis.find(p => p.id === 'u-estag').departamento_ids = ['d-jur'];
    cmdIA('ia-3', 'ia_resumo', { transcript: 'x' }, 'u-estag');
    c = await fim('ia-3'); afirma(c.status === 'ok', 'alçada herdada do departamento vale');
    DB.conversas.push({ id: 'cv-fin', nome: 'Fin', telefone: '1', responsavel: null, departamento_id: 'd-fin', departamento_ids: ['d-fin'], status: 'aberto' });
    cmdIA('ia-4', 'ia_pergunta', { conversaId: 'cv-fin', transcript: 'x', pergunta: 'q' }, 'u-estag');
    c = await fim('ia-4'); afirma(/sem alçada para ver esta conversa/.test(c.erro), 'conversa de outro departamento recusada');
    cmdIA('ia-5', 'ia_pergunta', { conversaId: 'cv-nao-existe', transcript: 'x', pergunta: 'q' }, 'u-admin');
    c = await fim('ia-5'); afirma(/conversa não encontrada/.test(c.erro), 'conversa inexistente → erro claro');
    cmdIA('ia-6', 'ia_teste', {}, 'u-estag');
    c = await fim('ia-6'); afirma(/administradores/.test(c.erro), 'ia_teste por estagiário recusado');
    cmdIA('ia-7', 'ia_teste', {}, 'u-admin');
    c = await fim('ia-7'); afirma(c.resultado.ok === true && c.resultado.modelo === 'claude-opus-5-5', 'ia_teste por admin devolve ok e modelo');
    DB.config.push({ chave: 'geral', valor: { modeloIA: 'claude-sonnet-5-5', contextoIA: { areas: 'Imobiliário' } } });
    cmdIA('ia-8', 'ia_resumo', { transcript: 'x' }, 'u-admin');
    c = await fim('ia-8');
    afirma(c.resultado.uso.modelo === 'claude-sonnet-5-5' && /Imobiliário/.test(global.__iaChamadas.at(-1).system), 'config.geral lida na hora: modelo e contexto do escritório');
    cmdIA('ia-9', 'ia_automacao', { pedido: 'x', contexto: '' }, 'u-estag');
    c = await fim('ia-9'); afirma(/sem alçada para criar automações/.test(c.erro), 'ia_automacao exige automacoes_editar');
    delete process.env.ANTHROPIC_API_KEY;
    cmdIA('ia-10', 'ia_resumo', { transcript: 'x' }, 'u-admin');
    c = await fim('ia-10'); afirma(/não configurada/.test(c.erro) && /ANTHROPIC_API_KEY/.test(c.erro), 'sem chave → "não configurada" com o nome da variável');
    process.env.ANTHROPIC_API_KEY = 'sk-ant-teste';
    global.__iaFalsa = async () => { await esperar(600); return { content: [{ type: 'text', text: 'lento' }], usage: {}, stop_reason: 'end_turn' }; };
    cmdIA('ia-11', 'ia_resumo', { transcript: 'x' }, 'u-admin');
    DB.motor_comandos.push({ id: 'rg-1', tipo: 'reagir', payload: { mensagemId: 'nao-existe', emoji: '👍' }, autor: 'u-admin', status: 'pendente', criado_em: agora() });
    await ate(() => ['ok', 'erro'].includes(achar('rg-1').status), 8000);
    afirma(achar('ia-11').status === 'processando', 'IA em voo não prende a fila: reagir fechou antes');
    c = await fim('ia-11'); afirma(c.status === 'ok' && c.resultado.texto === 'lento', 'e a IA fecha depois, por conta própria');
    global.__iaFalsa = null;
    for (let i = 0; i < 40; i++) DB.motor_comandos.push({ id: 'lim-' + i, tipo: 'ia_resumo', payload: {}, autor: 'u-estag', status: 'ok', criado_em: agora() });
    cmdIA('ia-12', 'ia_resumo', { transcript: 'x' }, 'u-estag');
    c = await fim('ia-12'); afirma(/limite de 40/.test(c.erro), '41º pedido na hora → limite');
    const socksAntes = socks.length;
    socks.at(-1).ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 515 } } } });
    await ate(() => socks.length > socksAntes, 6000);   // o motor reconecta num socket novo e fica 'desconectado' até o 'open'
    cmdIA('ia-13', 'ia_resumo', { transcript: 'x' }, 'u-admin');
    DB.motor_comandos.push({ id: 'rg-2', tipo: 'reagir', payload: { mensagemId: 'nao-existe', emoji: '👍' }, autor: 'u-admin', status: 'pendente', criado_em: agora() });
    c = await fim('ia-13'); afirma(c.status === 'ok' && achar('rg-2').status === 'pendente', 'WhatsApp desconectado: IA roda, comando de WhatsApp espera');
    socks.at(-1).ev.emit('connection.update', { connection: 'open' });
    await ate(() => achar('rg-2').status !== 'pendente', 8000);
    afirma(DB.motor_estado[0] && DB.motor_estado[0].recursos && DB.motor_estado[0].recursos.ia === true && DB.motor_estado[0].recursos.modelo === 'claude-sonnet-5-5', 'motor_estado.recursos publica ia e modelo');
  } catch (e) { falhas++; imprimir('  ERRO: ' + (e && e.stack || e)); }

  titulo('logs sem conteúdo de cliente');
  afirma(!logs.some(l => /importante|tudo bem\?|resposta/.test(l) && !/ajuste/.test(l)), 'nenhum texto de mensagem no log');
  afirma(!logs.some(l => /5545999990001/.test(l)), 'telefone completo não aparece no log');
  afirma(!logs.some(l => l.includes('SEGREDO-DO-CLIENTE-123')), 'logs da IA sem o texto da conversa');

  titulo('440 (outra instância) não reconecta em laço');
  const antes = socks.length;
  socks[socks.length - 1].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 440 } } } });
  await esperar(1500);
  afirma(socks.length === antes, 'nenhum socket novo em 1,5 s (espera 2 min)');
  afirma((DB.motor_estado[0] || {}).situacao === 'erro', 'estado de erro visível');

  titulo('identidade do motor: nome vem de NOME_SISTEMA');
  const chamarHttp = url => {
    let status, corpo;
    global.__servidorHttp({ url }, { writeHead(s) { status = s; }, end(c) { corpo = c; } });
    return { status, corpo };
  };
  const raiz = chamarHttp('/');
  afirma(raiz.status === 200, 'GET / responde 200');
  const jsonRaiz = JSON.parse(raiz.corpo);
  afirma(jsonRaiz.motor === 'mv-motor' && jsonRaiz.nome === 'Teste MV', 'GET / traz motor mv-motor e o nome do ambiente');
  const saude = JSON.parse(chamarHttp('/saude').corpo);
  afirma('saudavel' in saude, 'GET /saude devolve JSON com saudavel');
  const fonteMotor = fs.readFileSync(path.join(__dirname, '..', 'motor', 'index.js'), 'utf8');
  afirma(/browser: \[NOME_SISTEMA, 'Chrome'/.test(fonteMotor), 'aparelho conectado usa NOME_SISTEMA');
  afirma(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'motor', 'package.json'), 'utf8')).name === 'mv-motor', 'pacote do motor se chama mv-motor');

  logOriginal(`\n${ok} verificações OK, ${falhas} falha(s).`);
  process.exit(falhas ? 1 : 0);
})().catch(e => { logOriginal('ERRO no teste:', e); process.exit(1); });
