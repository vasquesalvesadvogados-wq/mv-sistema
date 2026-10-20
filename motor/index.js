/* ============================================================
   mv-sistema — MOTOR WhatsApp v2
   Ponte entre o WhatsApp (Baileys) e o Supabase:
   • mensagens recebidas (texto E mídia, contatos E grupos) → `mensagens`
   • fila (pendente/agendada, texto e mídia) → disparada no WhatsApp
   • comandos do CRM (grupos, fotos, transcrição) → `motor_comandos`
   • estado/QR → `motor_estado` (o CRM exibe o QR)
============================================================ */

/* polyfill: alguns ambientes Node não expõem o crypto global que o Baileys usa */
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = require('crypto').webcrypto;
}

const http = require('http');
const pino = require('pino');
const QRCode = require('qrcode');
const crypto = require('crypto');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage, decryptPollVote, jidNormalizedUser, generateMessageIDV2, generateMessageID, BufferJSON, proto } = require('@whiskeysockets/baileys');
const db = require('./db');
const midia = require('./midia');
const ia = require('./ia');
const { useSupabaseAuthState, limparSessao } = require('./authstate');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let sock = null;
let situacaoAtual = 'desconectado';

/* LGPD/sigilo: o log nunca leva conteúdo de cliente (texto, nome, emoji) —
   só id curto, tipo, tamanho e os 4 últimos dígitos do telefone */
const idCurto = (id) => String(id || '').slice(0, 8) || '—';
function fimTel(t) {
  const s = String(t || '');
  const [antes, dominio] = s.split('@');
  const dig = String(antes || '').replace(/\D/g, '');
  return (dig ? '…' + dig.slice(-4) : '—') + (dominio ? '@' + dominio : '');
}

/* número que pode chegar como number, string, Long do protobuf ou Long já
   serializado em JSON ({low, high}) — caso das mensagens reprocessadas */
function numeroDe(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') return Number(v) || 0;
  if (typeof v.toNumber === 'function') { try { return v.toNumber(); } catch (e) {} }
  if (typeof v.low === 'number' && typeof v.high === 'number') return v.high * 4294967296 + (v.low >>> 0);
  return Number(v) || 0;
}

/* rede de proteção do processo: uma promessa rejeitada sem catch (comum no
   Baileys em quedas de rede) derrubava o motor inteiro. Agora loga e segue;
   se virar avalanche (>20 em 5 min) sai, e o Railway (restart ALWAYS) sobe limpo */
const _falhasProcesso = [];
function falhaNaoTratada(tipo, e) {
  const agora = Date.now();
  _falhasProcesso.push(agora);
  while (_falhasProcesso.length && agora - _falhasProcesso[0] > 5 * 60000) _falhasProcesso.shift();
  // só nome, mensagem curta e onde estourou — nada do conteúdo que estava sendo processado
  const pilha = e && e.stack ? String(e.stack).split('\n').slice(1, 4).map(l => l.trim()).join(' | ') : '';
  log('⚠️ ' + tipo + ':', ((e && e.name) || 'Erro') + ': ' + String((e && e.message) || e).slice(0, 160), pilha ? '· ' + pilha : '');
  if (_falhasProcesso.length > 20) {
    log('🛑 mais de 20 falhas não tratadas em 5 min — encerrando para o Railway reiniciar o motor');
    process.exit(1);
  }
}
process.on('unhandledRejection', (e) => falhaNaoTratada('promessa rejeitada sem tratamento', e));
process.on('uncaughtException', (e) => falhaNaoTratada('exceção não tratada', e));

/* fila por contato: os eventos do Baileys não esperam um ao outro, e duas
   mensagens do mesmo contato em paralelo criavam a conversa duas vezes ou
   disparavam a saudação em dobro. Cada chave roda uma tarefa por vez. */
const _filaPorContato = new Map();
const ESPERA_MAX_NA_FILA = 120000;   // tarefa pendurada (ex.: download sem resposta) não segura o contato para sempre
function emSerie(chave, tarefa) {
  const anterior = _filaPorContato.get(chave) || Promise.resolve();
  let timer;
  const vez = Promise.race([anterior, new Promise(r => { timer = setTimeout(r, ESPERA_MAX_NA_FILA); })])
    .finally(() => clearTimeout(timer));
  const atual = vez.then(tarefa, tarefa);
  const fim = atual.catch(() => {});
  _filaPorContato.set(chave, fim);
  fim.then(() => { if (_filaPorContato.get(chave) === fim) _filaPorContato.delete(chave); });
  return atual;
}

/* ajustes que falharam DEPOIS de uma ação que já aconteceu no WhatsApp/banco
   (ex.: marcar 'enviada' uma mensagem que já saiu). Repetidos a cada 30 s até
   dar certo — marcar erro faria o atendente reenviar e o cliente receber em dobro */
const ajustesPendentes = [];
function reaplicarDepois(rotulo, fn) {
  if (ajustesPendentes.length >= 1000) {
    const velho = ajustesPendentes.shift();
    log('⚠️ fila de ajustes cheia — descartando o mais antigo:', velho.rotulo);
  }
  ajustesPendentes.push({ rotulo, fn, desde: Date.now() });
  log('   ⏳ ajuste guardado para nova tentativa:', rotulo);
}
let _reaplicando = false;
async function reaplicarAjustes() {
  if (_reaplicando || !ajustesPendentes.length) return;
  _reaplicando = true;
  try {
    const lote = ajustesPendentes.splice(0, ajustesPendentes.length);
    for (const a of lote) {
      try { await a.fn(); log('   ✅ ajuste reaplicado:', a.rotulo); }
      catch (e) {
        if (Date.now() - a.desde > 24 * 3600000) log('⚠️ ajuste abandonado após 24 h:', a.rotulo, '—', e.message);
        else ajustesPendentes.push(a);
      }
    }
  } finally { _reaplicando = false; }
}

/* Id do WhatsApp gerado POR NÓS antes do envio. Motivo: o eco da mensagem
   enviada (messages.upsert com fromMe) pode chegar ANTES do patch que grava o
   externo_id devolvido pelo sendMessage — aí o dedup por externo_id não acha a
   linha e a mensagem aparece DUPLICADA no CRM. Com o id gerado antes, a linha
   já está carimbada quando o eco chega. */
function novoIdWa() {
  try {
    if (typeof generateMessageIDV2 === 'function') return generateMessageIDV2(sock && sock.user && sock.user.id);
    if (typeof generateMessageID === 'function') return generateMessageID();
  } catch (e) {}
  return '3EB0' + crypto.randomBytes(9).toString('hex').toUpperCase();
}

/* ---------- saúde e alerta por e-mail (Healthchecks.io) ---------- */
/* HC_URL (opcional): o Healthchecks manda e-mail quando os pings param ou
   quando recebe /fail. A URL é segredo — nunca vai para o log. */
// nome do sistema visto no WhatsApp (aparelho conectado), nos alertas e em GET /
const NOME_SISTEMA = String(process.env.NOME_SISTEMA || 'Sistema').trim();
const HC_URL = String(process.env.HC_URL || '').trim().replace(/\/+$/, '');
let aguardandoQrDesde = 0;      // desde quando esperamos a leitura do QR (zera ao conectar)
let doenteDesde = Date.now();   // o motor nasce "não saudável" até conectar

/* saudável = WhatsApp conectado, socket com usuário e o banco respondendo há < 3 min */
function saudavel() {
  const ok = db.saude().ultimoOk;
  return situacaoAtual === 'conectado' && !!(sock && sock.user) && !!ok && Date.now() - ok < 3 * 60000;
}
function motivoDoente() {
  if (situacaoAtual !== 'conectado') return 'WhatsApp ' + situacaoAtual;
  if (!sock || !sock.user) return 'conexão do WhatsApp sem usuário';
  return 'o banco não responde há mais de 3 min';
}
/* atualiza o relógio de "doente desde" e devolve se está saudável agora */
function conferirSaude() {
  const ok = saudavel();
  if (ok) doenteDesde = 0;
  else if (!doenteDesde) doenteDesde = Date.now();
  return ok;
}

/* ping no Healthchecks: melhor-esforço, nunca derruba nada e nunca loga a URL */
async function pingHC(sufixo, corpo) {
  if (!HC_URL) return;
  try {
    const opcoes = { signal: AbortSignal.timeout(10000) };
    if (corpo != null) { opcoes.method = 'POST'; opcoes.body = String(corpo).slice(0, 500); }
    await fetch(HC_URL + (sufixo || ''), opcoes);
  } catch (e) { /* alerta é extra: sem rede, o próprio silêncio dos pings dispara o e-mail */ }
}

/* ---------- estado visível no CRM ---------- */
async function estado(situacao, extras = {}) {
  // entrou agora em "aguardando QR"? avisa por e-mail: ninguém lê o QR se não souber que ele existe
  if (situacao === 'aguardando_qr' && situacaoAtual !== 'aguardando_qr') {
    pingHC('/fail', `Motor do Chat de ${NOME_SISTEMA} aguardando leitura do QR Code — o WhatsApp do escritório está desconectado.`);
  }
  if (situacao === 'aguardando_qr' && !aguardandoQrDesde) aguardandoQrDesde = Date.now();
  if (situacao === 'conectado') aguardandoQrDesde = 0;
  situacaoAtual = situacao;
  try {
    const linha = {
      id: 'principal',
      situacao,
      qr: extras.qr || '',
      numero: extras.numero || '',
      detalhe: extras.detalhe || '',
      atualizado_em: new Date().toISOString(),
      recursos: recursosDoMotor()
    };
    try { await db.upsert('motor_estado', [linha]); }
    catch (e) {
      // coluna recursos ainda não existe (chat-v17a não rodou): grava sem ela e segue
      if (e.code !== '42703' && e.code !== 'PGRST204') throw e;
      delete linha.recursos;
      await db.upsert('motor_estado', [linha]);
      log('coluna motor_estado.recursos ainda não existe (rode nuvem/chat-v17a.sql)');
    }
  } catch (e) { log('erro ao gravar estado:', e.message); }
}

/* o que o motor tem ativo — o front mostra em Configurações (IA do escritório, transcrição) */
function recursosDoMotor() {
  return { transcricao: midia.transcricaoDisponivel(), ia: ia.disponivel(), modelo: ia.modeloValido((_cfgGeral || {}).modeloIA) };
}

/* ---------- destino/jid ---------- */
function jidDe(conversa) {
  const tel = String(conversa.telefone || '');
  if (conversa.tipo === 'grupo' || tel.startsWith('grupo-')) {
    // fallback: reconstrói o jid do grupo a partir do telefone se grupo_jid estiver vazio
    return conversa.grupo_jid || (tel.replace(/^grupo-/, '') + '@g.us');
  }
  return tel.startsWith('lid-') ? tel.slice(4) + '@lid' : tel + '@s.whatsapp.net';
}

/* tradução de erros comuns de envio para algo acionável no CRM */
function erroDeEnvioLegivel(e) {
  const s = String((e && e.message) || e || '');
  if (/not-acceptable|406/i.test(s)) return 'o WhatsApp recusou o envio para este grupo — verifique se o número do escritório ainda é participante e tente de novo';
  if (/not-authorized|forbidden|403|announce/i.test(s)) return 'o grupo só permite mensagens de administradores (verifique as configurações do grupo no WhatsApp)';
  if (/item-not-found|404/i.test(s)) return 'destino não encontrado no WhatsApp (o número/grupo existe?)';
  if (/rate|429|overlimit/i.test(s)) return 'limite de envio do WhatsApp — aguarde alguns minutos';
  return s.slice(0, 180);
}

async function fotoDePerfil(jid) {
  try { return await sock.profilePictureUrl(jid, 'image'); } catch (e) { return ''; }
}

/* baixa a foto do WhatsApp e guarda no NOSSO storage — a URL do CDN deles expira.
   Tenta as duas identidades (número e LID) porque a consulta trava em contas migradas. */
async function salvarFotoPerfil(conversaId, jidBase, fotoAtual) {
  const tentativas = [jidBase];
  try {
    const mapa = sock.signalRepository && sock.signalRepository.lidMapping;
    if (mapa && jidBase.endsWith('@s.whatsapp.net') && mapa.getLIDForPN) {
      const l = await mapa.getLIDForPN(jidBase);
      if (l) tentativas.push(typeof l === 'string' ? l : String(l));
    }
  } catch (e) {}
  for (const j of tentativas) {
    try {
      const cdn = await sock.profilePictureUrl(j, 'image', 8000);
      if (!cdn) continue;
      const buf = await midia.baixarUrl(cdn);
      // ?v= = hash do CONTEÚDO: foto igual mantém a mesma URL (cache dos navegadores
      // continua válido = zero egress); foto nova troca o hash e quebra o cache na hora
      const marca = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10);
      if (fotoAtual && fotoAtual.endsWith('?v=' + marca)) return fotoAtual; // nada mudou: nem sobe de novo
      const url = await midia.subirMidia(`fotos/${conversaId}.jpg`, buf, 'image/jpeg');
      return url + '?v=' + marca;
    } catch (e) {}
  }
  return '';
}

/* varredura: renova as fotos de todas as conversas ativas (na inicialização e 1x/dia) */
let varrendoFotos = false;
async function varrerFotos() {
  if (varrendoFotos || !sock || situacaoAtual !== 'conectado') return;
  varrendoFotos = true;
  try {
    const convs = await db.select('conversas?arquivada=is.false&select=id,telefone,tipo,grupo_jid,foto_url&order=ultima_msg_em.desc.nullslast&limit=200');
    let ok = 0;
    for (const c of convs || []) {
      if (situacaoAtual !== 'conectado') break;
      const foto = await salvarFotoPerfil(c.id, jidDe(c), c.foto_url);
      // só grava se a foto realmente mudou — patch desnecessário dispara o delta sync de todos os atendentes
      if (foto && foto !== c.foto_url) { await db.patch(`conversas?id=eq.${c.id}`, { foto_url: foto }); ok++; }
      await new Promise(r => setTimeout(r, 1500)); // sem pressa: evita rate limit
    }
    log('🖼 varredura de fotos:', ok, 'de', (convs || []).length, 'atualizadas');
  } catch (e) { log('erro na varredura de fotos:', e.message); }
  varrendoFotos = false;
}

/* ---------- conversas ---------- */
/* configurações compartilhadas do escritório (linha 'geral' da tabela config) — cache 60s;
   `forcar` ignora o cache (a IA lê o modelo e o contexto na hora: o admin trocou, já vale) */
let _cfgGeral = null, _cfgGeralEm = 0;
async function configGeral(forcar) {
  if (!forcar && _cfgGeral && Date.now() - _cfgGeralEm < 60000) return _cfgGeral;
  try {
    const rows = await db.select('config?chave=eq.geral&select=valor');
    _cfgGeral = (rows && rows[0] && rows[0].valor) || {};
  } catch (e) { _cfgGeral = _cfgGeral || {}; }
  _cfgGeralEm = Date.now();
  return _cfgGeral;
}

async function garantirConversa(telefone, nome, lid) {
  // identidade dupla (chat-v11): procura pela IDENTIDADE DE PRIVACIDADE primeiro —
  // é o que impede a mesma pessoa de virar duas conversas quando a mensagem chega
  // ora pelo número, ora pelo lid
  if (!lid && String(telefone).startsWith('lid-')) lid = String(telefone).slice(4);
  if (temLid && lid) {
    const porLid = await db.select(`conversas?lid=eq.${encodeURIComponent(lid)}&select=*&limit=1`);
    if (porLid.length) {
      const c = porLid[0];
      // o número real acabou de se revelar para uma conversa presa no formato lid-?
      // → atualiza NO LUGAR (nada de conversa nova)
      if (!String(telefone).startsWith('lid-') && String(c.telefone).startsWith('lid-')) {
        try { await db.patch(`conversas?id=eq.${c.id}`, { telefone }); c.telefone = telefone; log('🪪 número revelado sem duplicar: ' + fimTel(telefone)); } catch (e) {}
      }
      if (nome && (!c.nome || c.nome.startsWith('Contato '))) {
        await db.patch(`conversas?id=eq.${c.id}`, { nome });
        c.nome = nome;
      }
      return c;
    }
  }
  const rows = await db.select(`conversas?telefone=eq.${telefone}&select=*`);
  if (rows.length) {
    const c = rows[0];
    // aprende a segunda identidade da conversa (backfill)
    if (temLid && lid && !c.lid) {
      try { await db.patch(`conversas?id=eq.${c.id}`, { lid }); c.lid = lid; } catch (e) {}
    }
    // melhora o nome se o atual for genérico
    if (nome && (!c.nome || c.nome.startsWith('Contato '))) {
      await db.patch(`conversas?id=eq.${c.id}`, { nome });
      c.nome = nome;
    }
    if (!c.foto_url) {
      const foto = await salvarFotoPerfil(c.id, telefone.startsWith('lid-') ? telefone.slice(4) + '@lid' : telefone + '@s.whatsapp.net');
      if (foto) { await db.patch(`conversas?id=eq.${c.id}`, { foto_url: foto }); c.foto_url = foto; }
    }
    return c;
  }
  // vincula lead automaticamente pelo telefone (não tenta em ids lid-)
  let alvo = null;
  if (!String(telefone).startsWith('lid-')) {
    const leads = await db.select(`leads?select=id,nome,telefone&telefone=neq.`);
    alvo = (leads || []).find(l => String(l.telefone || '').replace(/\D/g, '').endsWith(telefone.slice(-8)));
    // v6: contato novo sem lead no CRM? cria o lead na hora (origem WhatsApp) —
    // fecha o furo do funil; desligável em Configurações do CRM (autoCriarLead)
    if (!alvo) {
      try {
        const cfg = await configGeral();
        if (cfg.autoCriarLead !== false) {
          const criado = await db.insert('leads', [{
            nome: nome || 'Contato ' + telefone.slice(-4),
            telefone, origem: 'WhatsApp', etapa: 'Novo', temperatura: 'Morno',
            criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString()
          }]);
          if (criado && criado[0]) { alvo = { id: criado[0].id, nome: criado[0].nome }; log('🧲 lead criado automaticamente: ' + idCurto(criado[0].id)); }
        }
      } catch (e) { log('erro ao auto-criar lead:', e.message); }
    }
  }
  const linha = {
    telefone,
    tipo: 'individual',
    nome: nome || (alvo ? alvo.nome : 'Contato ' + telefone.slice(-4)),
    foto_url: '',
    lead_id: alvo ? alvo.id : null,
    status: 'aberto'
  };
  if (temLid && lid) linha.lid = lid;  // nasce já com as duas identidades
  let novo;
  try {
    novo = await db.insert('conversas', [linha]);
  } catch (e) {
    // 23505: outra mensagem do mesmo contato criou a conversa neste mesmo instante → usa a dela
    if (e.code !== '23505') throw e;
    const ja = (temLid && lid ? await db.select(`conversas?lid=eq.${encodeURIComponent(lid)}&select=*&limit=1`) : [])
      .concat(await db.select(`conversas?telefone=eq.${encodeURIComponent(telefone)}&select=*&limit=1`));
    if (!ja.length) throw e;
    return ja[0];
  }
  novo[0]._nova = true;
  const foto = await salvarFotoPerfil(novo[0].id, telefone.startsWith('lid-') ? telefone.slice(4) + '@lid' : telefone + '@s.whatsapp.net');
  if (foto) { await db.patch(`conversas?id=eq.${novo[0].id}`, { foto_url: foto }); novo[0].foto_url = foto; }
  return novo[0];
}

/* ---------- participantes de grupo ----------
   Formato gravado em conversas.participantes: { telefone, lid, nome, admin }.
   No Baileys rc14 cada participante vem como id @lid (com phoneNumber) ou
   @s.whatsapp.net (com lid), sem nome. Quando o número não vem, tenta o mapa
   de identidades; se nem ele souber, grava 'lid-<lid>' (o front sabe tratar).
   O nome chega depois, pelo pushName de cada mensagem (anotarParticipante). */
const digitosDe = j => String(j || '').split('@')[0].split(':')[0];

async function telefoneDoLid(lidJid) {
  try {
    const mapa = sock && sock.signalRepository && sock.signalRepository.lidMapping;
    if (!mapa) return '';
    for (const fn of ['getPNForLID', 'getPhoneForLID', 'getPnForLid']) {
      if (typeof mapa[fn] !== 'function') continue;
      let pn = null;
      try { pn = mapa[fn].call(mapa, lidJid); if (pn && pn.then) pn = await pn; } catch (e) {}
      const n = digitosDe(pn);
      if (/^\d{8,15}$/.test(n)) return n;
    }
  } catch (e) {}
  return '';
}

/* o mesmo participante, em qualquer identidade gravada: telefone, lid, 'lid-<lid>' ou o formato
   ANTIGO do motor (o lid cru no campo telefone, sem a chave lid) — era por não reconhecer este último
   que a pessoa aparecia em dobro nos grupos (vistoria de 09/10/2026) */
const mesmoParticipante = (x, tel, lid) => !!x && ((!!tel && x.telefone === tel) ||
  (!!lid && (x.lid === lid || x.telefone === 'lid-' + lid || x.telefone === lid)));

async function montarParticipantes(meta, anteriores) {
  const prev = Array.isArray(anteriores) ? anteriores : [];
  const saida = [];
  for (const p of (meta && meta.participants) || []) {
    const id = String(p.id || '');
    const ehLid = id.endsWith('@lid');
    const lid = ehLid ? digitosDe(id) : (p.lid ? digitosDe(p.lid) : '');
    let tel = !ehLid ? digitosDe(id) : (p.phoneNumber ? digitosDe(p.phoneNumber) : '');
    if (!tel && ehLid) tel = await telefoneDoLid(id);
    // nome: o do WhatsApp se vier; senão o já anotado em QUALQUER registro antigo da pessoa (prefere o que tem nome)
    const antigos = prev.filter(x => mesmoParticipante(x, tel, lid));
    const nome = String(p.name || p.notify || (antigos.find(x => x.nome) || {}).nome || '');
    const ja = saida.find(x => mesmoParticipante(x, tel, lid));
    if (ja) {   // a metadata trouxe a mesma pessoa duas vezes (@lid e @s.whatsapp.net): funde, não repete
      if (tel && (!ja.telefone || ja.telefone.startsWith('lid-'))) ja.telefone = tel;
      if (lid && !ja.lid) ja.lid = lid;
      if (nome && !ja.nome) ja.nome = nome;
      ja.admin = ja.admin || !!p.admin;
      continue;
    }
    saida.push({ telefone: tel || (lid ? 'lid-' + lid : ''), lid, nome, admin: !!p.admin });
  }
  return saida;
}

/* nome real do participante vem no pushName da mensagem: anota no jsonb do grupo,
   casando pelo telefone ou pelo lid. Só grava quando algo mudou. */
const _nomesDeGrupo = new Map();   // grupo_jid -> Map(chave -> último nome anotado)
async function anotarParticipante(conversa, msg) {
  if (!conversa || conversa.tipo !== 'grupo' || !msg || !msg.key || msg.key.fromMe) return;
  const nome = String(msg.pushName || '').trim();
  if (!nome) return;
  const k = msg.key;
  const jid = String(k.participant || '');
  const alt = String(k.participantAlt || k.senderPn || '');
  const ehLid = jid.endsWith('@lid');
  const lid = ehLid ? digitosDe(jid) : (alt.endsWith('@lid') ? digitosDe(alt) : '');
  let tel = (!ehLid && jid) ? digitosDe(jid) : (alt.endsWith('@s.whatsapp.net') ? digitosDe(alt) : '');
  if (!tel && ehLid) tel = await telefoneDoLid(jid);
  if (!tel && !lid) return;
  const chave = tel ? 'tel:' + tel : 'lid:' + lid;
  let cache = _nomesDeGrupo.get(conversa.grupo_jid);
  if (!cache) { cache = new Map(); _nomesDeGrupo.set(conversa.grupo_jid, cache); }
  if (cache.get(chave) === nome) return;              // nada novo desde a última mensagem
  const lista = (Array.isArray(conversa.participantes) ? conversa.participantes : []).map(p => Object.assign({}, p));
  let p = lista.find(x => mesmoParticipante(x, tel, lid));
  if (!p) { p = { telefone: tel || 'lid-' + lid, lid, nome: '', admin: false }; lista.push(p); }
  const mudou = p.nome !== nome || (tel && p.telefone !== tel) || (lid && p.lid !== lid);
  p.nome = nome;
  if (tel) p.telefone = tel;
  if (lid) p.lid = lid;
  cache.set(chave, nome);
  if (!mudou) return;
  conversa.participantes = lista;
  await db.patch(`conversas?id=eq.${conversa.id}`, { participantes: lista });
}

async function garantirConversaGrupo(grupoJid) {
  const rows = await db.select(`conversas?grupo_jid=eq.${encodeURIComponent(grupoJid)}&select=*`);
  if (rows.length) return rows[0];
  let nome = 'Grupo', participantes = [];
  try {
    const meta = await sock.groupMetadata(grupoJid);
    nome = meta.subject || nome;
    participantes = await montarParticipantes(meta, []);
  } catch (e) { log('sem metadata do grupo:', e.message); }
  const telGrupo = 'grupo-' + grupoJid.split('@')[0];
  let novo;
  try {
    novo = await db.insert('conversas', [{
      telefone: telGrupo,
      tipo: 'grupo',
      grupo_jid: grupoJid,
      nome,
      foto_url: '',
      participantes,
      status: 'aberto'
    }]);
  } catch (e) {
    // 23505: o grupo acabou de ser criado por outra mensagem/comando em paralelo → usa o existente
    if (e.code !== '23505') throw e;
    const ja = await db.select(`conversas?telefone=eq.${encodeURIComponent(telGrupo)}&select=*&limit=1`);
    if (!ja.length) throw e;
    return ja[0];
  }
  const foto = await salvarFotoPerfil(novo[0].id, grupoJid);
  if (foto) { await db.patch(`conversas?id=eq.${novo[0].id}`, { foto_url: foto }); novo[0].foto_url = foto; }
  return novo[0];
}

async function atualizarMembros(conversaId, grupoJid) {
  const meta = await sock.groupMetadata(grupoJid);
  let anteriores = [];
  try { const r = await db.select(`conversas?id=eq.${conversaId}&select=participantes`); anteriores = (r && r[0] && r[0].participantes) || []; } catch (e) {}
  const participantes = await montarParticipantes(meta, anteriores);   // preserva os nomes já anotados
  await db.patch(`conversas?id=eq.${conversaId}`, { participantes, nome: meta.subject || undefined });
  return participantes;
}

/* vistoria dos grupos (comando grupos_vistoria, só admin — dono, 09/10/2026): percorre TODOS os grupos,
   consulta cada um no WhatsApp e regrava a lista de participantes como ela é lá — sem duplicados, com o
   número real e os nomes já anotados. Motivo: um formato antigo gravava o LID cru (14+ dígitos) como
   telefone, e o casamento não o reconhecia: a pessoa aparecia em dobro e com "número" errado.
   aplicar=false só devolve o relatório. Não mexe no nome do grupo. 250 ms entre grupos para não martelar. */
const chavesDe = p => [p && p.telefone, p && p.lid, p && String(p.telefone || '').startsWith('lid-') ? String(p.telefone).slice(4) : ''].filter(Boolean);
/* Na 1ª vistoria real (12/10/2026) consultar 118 grupos um a um em rajada fez o WhatsApp limitar as consultas
   a partir do ~40º (75 "erros" em grupos vivos). Agora: a LISTA GERAL dos grupos da conta vem numa consulta só
   (groupFetchAllParticipating); só o que não vier nela é consultado um a um, com pausa, e se o WhatsApp
   limitar espera-se e tenta-se de novo. O relatório diz o motivo de cada falha. */
const pausa = ms => new Promise(res => setTimeout(res, ms));
const VISTORIA_ESPERA = Number(process.env.VISTORIA_ESPERA_MS) || 5000;   // espera quando o WhatsApp limita as consultas
const ehLimite = e => /rate|overlimit|429|too many/i.test(String((e && e.message) || e));
function motivoDaConsulta(e) {
  const s = String((e && e.message) || e), cod = e && e.output && e.output.statusCode;
  if (ehLimite(e)) return 'o WhatsApp limitou as consultas; rode a vistoria de novo em alguns minutos';
  if (/not-authorized|forbidden|item-not-found|not-found/i.test(s) || cod === 403 || cod === 404) return 'o escritório não está mais neste grupo (ou ele foi apagado): arquive a conversa';
  return 'não consegui consultar o grupo no WhatsApp: ' + s.slice(0, 80);
}
async function metadataComRetentativa(jid) {
  try { return await sock.groupMetadata(jid); }
  catch (e) {
    if (!ehLimite(e)) throw e;
    await pausa(VISTORIA_ESPERA);
    return await sock.groupMetadata(jid);
  }
}
async function vistoriarGrupos(aplicar) {
  const todos = await db.select('conversas?tipo=eq.grupo&select=id,nome,grupo_jid,participantes&order=nome.asc');
  const grupos = (todos || []).filter(g => g.grupo_jid);
  const r = { grupos: grupos.length, consultados: 0, corrigidos: 0, comErro: 0, aplicado: !!aplicar, lidsCrus: 0, duplicatas: 0, semNumero: 0, detalhes: [] };
  let geral = null;
  if (typeof sock.groupFetchAllParticipating === 'function') {
    try { geral = await sock.groupFetchAllParticipating(); }
    catch (e) { log('vistoria: a lista geral de grupos falhou (' + String((e && e.message) || e).slice(0, 80) + '); consultando um a um'); }
  }
  const erros = {};
  for (const g of grupos) {
    const antigos = Array.isArray(g.participantes) ? g.participantes : [];
    let meta = geral && geral[g.grupo_jid];
    if (!meta) {
      try { meta = await metadataComRetentativa(g.grupo_jid); }
      catch (e) {
        const msg = String((e && e.message) || e).slice(0, 60);
        erros[msg] = (erros[msg] || 0) + 1;
        r.comErro++; r.detalhes.push({ id: g.id, nome: g.nome, erro: motivoDaConsulta(e) });
        await pausa(Math.min(1000, VISTORIA_ESPERA));
        continue;
      }
      await pausa(Math.min(1000, VISTORIA_ESPERA));   // consulta direta: devagar, para não ser limitado
    }
    r.consultados++;
    const novos = await montarParticipantes(meta, antigos);
    const casa = (a, n) => chavesDe(a).some(k => chavesDe(n).includes(k));
    const antigosCasados = antigos.filter(a => novos.some(n => casa(a, n)));
    const novosCasados = novos.filter(n => antigos.some(a => casa(a, n)));
    // "lid cru": telefone só de dígitos, sem a chave lid, que é o lid de alguém da lista nova ou é longo demais para ser telefone
    const lidCru = a => !a.lid && /^\d+$/.test(String(a.telefone || '')) && (String(a.telefone).length >= 14 || novos.some(n => n.lid === a.telefone));
    const det = {
      id: g.id, nome: g.nome, antes: antigos.length, depois: novos.length,
      lidsCrus: antigos.filter(lidCru).length,
      duplicatas: Math.max(0, antigosCasados.length - novosCasados.length),
      removidos: antigos.length - antigosCasados.length,
      incluidos: novos.length - novosCasados.length,
      semNumero: novos.filter(n => String(n.telefone).startsWith('lid-')).length
    };
    r.lidsCrus += det.lidsCrus; r.duplicatas += det.duplicatas; r.semNumero += det.semNumero;
    if (JSON.stringify(antigos) !== JSON.stringify(novos)) {
      r.corrigidos++;
      r.detalhes.push(det);
      if (aplicar) await db.patch(`conversas?id=eq.${g.id}`, { participantes: novos });
    }
  }
  log(`🔎 vistoria dos grupos: ${r.grupos} grupo(s), ${r.consultados} consultado(s)${geral ? ' (lista geral: ' + Object.keys(geral).length + ')' : ''}, ${r.corrigidos} com diferença${aplicar ? ' (regravados)' : ''}, ${r.comErro} com erro${Object.keys(erros).length ? ' · motivos: ' + JSON.stringify(erros).slice(0, 200) : ''}`);
  return r;
}

/* ---------- conteúdo das mensagens recebidas ---------- */
/* vários tipos chegam "embrulhados" — mensagens temporárias (ephemeral),
   ver-uma-vez (viewOnce) — e sem desembrulhar o conteúdo real se perde */
function desembrulhar(m) {
  let atual = m || {};
  for (let i = 0; i < 4; i++) {
    if (atual.ephemeralMessage && atual.ephemeralMessage.message) atual = atual.ephemeralMessage.message;
    else if (atual.viewOnceMessage && atual.viewOnceMessage.message) atual = atual.viewOnceMessage.message;
    else if (atual.viewOnceMessageV2 && atual.viewOnceMessageV2.message) atual = atual.viewOnceMessageV2.message;
    else if (atual.viewOnceMessageV2Extension && atual.viewOnceMessageV2Extension.message) atual = atual.viewOnceMessageV2Extension.message;
    // foto/vídeo que faz parte de um álbum: vem embrulhada, a mídia real está dentro
    else if (atual.associatedChildMessage && atual.associatedChildMessage.message) atual = atual.associatedChildMessage.message;
    else break;
  }
  return atual;
}

/* chaves que são metadados/protocolo, não conteúdo — não contam como "tipo perdido" */
const CHAVES_PROTOCOLO = ['messageContextInfo', 'senderKeyDistributionMessage', 'protocolMessage', 'reactionMessage', 'pollUpdateMessage', 'keepInChatMessage', 'deviceSentMessage'];

/* o WhatsApp manda uma SEGUNDA cópia (HD) de fotos/vídeos recém-recebidos, embrulhada em
   associatedChildMessage com messageAssociation HD_*_DUAL_UPLOAD: é a mesma mídia que já
   entrou 1–2 s antes — gravar de novo duplicava a foto na conversa.
   Enum AssociationType do Baileys rc14: HD_VIDEO_DUAL_UPLOAD = 5, HD_IMAGE_DUAL_UPLOAD = 10,
   HEVC_VIDEO_DUAL_UPLOAD = 19 (6 é STATUS_EXTERNAL_RESHARE — mensagem de verdade, entra). */
function ehCopiaHd(msg) {
  const cands = [msg.message, msg.message && msg.message.associatedChildMessage && msg.message.associatedChildMessage.message];
  for (const c of cands) {
    const assoc = c && c.messageContextInfo && c.messageContextInfo.messageAssociation;
    const tipo = assoc && assoc.associationType;
    if (tipo != null && /^(5|10|19|HD_VIDEO_DUAL_UPLOAD|HD_IMAGE_DUAL_UPLOAD|HEVC_VIDEO_DUAL_UPLOAD)$/.test(String(tipo))) return true;
  }
  return false;
}

function extrairConteudo(msg) {
  if (ehCopiaHd(msg)) return null;
  const m = desembrulhar(msg.message);
  if (m.conversation) return { tipo: 'texto', texto: m.conversation };
  if (m.extendedTextMessage) return { tipo: 'texto', texto: m.extendedTextMessage.text || '' };
  if (m.imageMessage) return { tipo: 'imagem', texto: m.imageMessage.caption || '', no: m.imageMessage, rotulo: 'Foto' };
  if (m.videoMessage) return { tipo: 'video', texto: m.videoMessage.caption || '', no: m.videoMessage, rotulo: 'Vídeo' };
  if (m.ptvMessage) return { tipo: 'video', texto: '', no: m.ptvMessage, rotulo: 'Vídeo' };
  if (m.audioMessage) return { tipo: 'audio', texto: '', no: m.audioMessage, ptt: !!m.audioMessage.ptt, rotulo: 'Áudio' };
  if (m.documentMessage) return { tipo: 'arquivo', texto: '', no: m.documentMessage, nome: m.documentMessage.fileName || 'Documento', rotulo: (m.documentMessage.fileName || 'Documento') };
  if (m.documentWithCaptionMessage) {
    const d = m.documentWithCaptionMessage.message.documentMessage;
    return { tipo: 'arquivo', texto: d.caption || '', no: d, nome: d.fileName || 'Documento', rotulo: (d.fileName || 'Documento') };
  }
  if (m.stickerMessage) return { tipo: 'figurinha', texto: '', no: m.stickerMessage, rotulo: 'Figurinha' };
  if (m.contactMessage) {
    const c = m.contactMessage;
    return { tipo: 'texto', texto: 'Contato compartilhado: ' + (c.displayName || '') + (c.vcard ? '\n' + c.vcard : '') };
  }
  if (m.contactsArrayMessage) {
    const cs = (m.contactsArrayMessage.contacts || []);
    return { tipo: 'texto', texto: 'Contatos compartilhados: ' + cs.map(c => c.displayName || '').filter(Boolean).join(', ') + '\n' + cs.map(c => c.vcard || '').filter(Boolean).join('\n') };
  }
  if (m.locationMessage) {
    const l = m.locationMessage;
    return { tipo: 'texto', texto: 'Localização: https://maps.google.com/?q=' + l.degreesLatitude + ',' + l.degreesLongitude + (l.name ? ' (' + l.name + ')' : '') };
  }
  if (m.liveLocationMessage) return { tipo: 'texto', texto: 'Localização em tempo real compartilhada (veja no celular)' };
  if (m.groupInviteMessage) return { tipo: 'texto', texto: 'Convite para o grupo: ' + (m.groupInviteMessage.groupName || '') };
  if (m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3) {
    const p = m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3;
    return { tipo: 'texto', texto: 'Enquete: ' + (p.name || '') + '\n' + (p.options || []).map(o => '- ' + (o.optionName || '')).join('\n') };
  }
  // álbum (várias fotos de uma vez): este registro é só o "envelope" que avisa quantas
  // fotos vêm a seguir — cada foto chega como mensagem própria logo depois. Gravar o
  // envelope virava "[tipo não suportado: albumMessage]" no meio da conversa (76 vezes
  // até 05/10/2026, sempre seguidas das fotos de verdade).
  if (m.albumMessage) return null;
  if (m.buttonsResponseMessage) return { tipo: 'texto', texto: m.buttonsResponseMessage.selectedDisplayText || m.buttonsResponseMessage.selectedButtonId || '' };
  if (m.listResponseMessage) return { tipo: 'texto', texto: m.listResponseMessage.title || '' };
  if (m.templateButtonReplyMessage) return { tipo: 'texto', texto: m.templateButtonReplyMessage.selectedDisplayText || '' };
  // rede de segurança: NENHUMA mensagem com conteúdo real pode sumir em silêncio —
  // tipo desconhecido vira registro visível no chat + aviso no log
  const restos = Object.keys(m).filter(k => !CHAVES_PROTOCOLO.includes(k));
  if (restos.length) {
    log('   ⚠️ tipo de mensagem ainda não suportado: ' + restos.join(', '));
    return { tipo: 'texto', texto: '[mensagem de tipo não suportado: ' + restos.join(', ') + ' — veja no celular]' };
  }
  return null;
}

/* resolve o telefone real a partir do jid (aceita o formato novo @lid) */
function resolverTelefone(msg) {
  const k = msg.key || {};
  const candidatos = [k.remoteJid, k.remoteJidAlt, k.senderPn, k.participant, k.participantAlt];
  for (const j of candidatos) {
    if (j && j.endsWith('@s.whatsapp.net')) {
      const n = j.split('@')[0];
      if (/^\d{8,15}$/.test(n)) return n;
    }
  }
  const lidJid = candidatos.find(j => j && j.endsWith('@lid'));
  if (lidJid) {
    const tentativas = [];
    try {
      const mapa = sock && sock.signalRepository && sock.signalRepository.lidMapping;
      if (mapa) {
        for (const fn of ['getPNForLID', 'getPhoneForLID', 'getPnForLid']) {
          if (typeof mapa[fn] === 'function') { try { tentativas.push(mapa[fn].call(mapa, lidJid)); } catch (e) {} }
        }
      }
    } catch (e) {}
    for (const pn of tentativas) {
      const s = typeof pn === 'string' ? pn : (pn && pn.then ? null : (pn || ''));
      if (s && s.includes('@')) {
        const n = s.split('@')[0];
        if (/^\d{8,15}$/.test(n)) return n;
      }
    }
    return 'lid-' + lidJid.split('@')[0];
  }
  return null;
}

/* acima disto não baixa: um vídeo enorme estoura a memória do motor no Railway.
   60 MB = limite do bucket `midias` (chat-v2.sql): acima disso o upload falharia de qualquer jeito */
const LIMITE_MIDIA = 60 * 1024 * 1024;

/* baixa a mídia da mensagem, sobe para o Storage e devolve os campos p/ salvar */
async function receberMidia(msg, conteudo, conversaId) {
  const tamanho = numeroDe(conteudo.no && conteudo.no.fileLength);
  if (tamanho > LIMITE_MIDIA) {
    const mb = Math.round(tamanho / 1048576);
    const mime = String(conteudo.no.mimetype || '').split(';')[0] || 'application/octet-stream';
    const nome = conteudo.nome || ((conteudo.rotulo || 'Arquivo') + '.' + midia.extDoMime(conteudo.no.mimetype));
    // chat-v16c: nada sobe agora — guarda só o que precisa para baixar depois, sob demanda
    // (botão "Baixar" na conversa). Buffers (mediaKey, hashes) vão em base64.
    let pendente = false;
    if (temMidiasPendentes && msg.key && msg.key.id) {
      try {
        await db.upsert('midias_pendentes', [{
          externo_id: msg.key.id, conversa_id: conversaId,
          key: { remoteJid: msg.key.remoteJid, id: msg.key.id, fromMe: !!msg.key.fromMe, participant: msg.key.participant || null },
          no: JSON.parse(JSON.stringify(conteudo.no, BufferJSON.replacer)),
          tipo: conteudo.tipo, mime, nome, tamanho
        }]);
        pendente = true;
      } catch (e) { log('   ⚠️ não guardei a mídia grande para baixar depois:', e.message); }
    }
    log('   ⚠️ mídia de ' + mb + ' MB acima do limite — ' + (pendente ? 'fica para baixar sob demanda' : 'não baixada') + ' (' + idCurto(msg.key && msg.key.id) + ', ' + conteudo.tipo + ')');
    return {
      campos: pendente ? { midia_nome: nome, midia_mime: mime, midia_tamanho: tamanho } : (conteudo.nome ? { midia_nome: conteudo.nome } : {}),
      buffer: null, grandeDemaisMb: mb, pendente
    };
  }
  try {
    // prazo: download/upload pendurado não pode travar a fila deste contato (cai no "sem mídia" abaixo)
    const buf = await comPrazo(downloadMediaMessage(msg, 'buffer', {}, {
      logger: pino({ level: 'silent' }),
      reuploadRequest: sock.updateMediaMessage
    }), 3 * 60000);
    const mime = String(conteudo.no.mimetype || '').split(';')[0] || 'application/octet-stream';
    const nome = conteudo.nome || midia.nomeArquivo(midia.extDoMime(conteudo.no.mimetype));
    const caminho = `${conversaId}/${midia.nomeArquivo(midia.extDoMime(conteudo.no.mimetype))}`;
    const url = await comPrazo(midia.subirMidia(caminho, buf, mime), 3 * 60000);
    return {
      campos: {
        midia_url: url, midia_mime: mime, midia_nome: nome,
        midia_tamanho: buf.length, midia_ptt: !!conteudo.ptt
      },
      buffer: buf, mime
    };
  } catch (e) {
    log('   ⚠️ falha ao baixar mídia:', e.message);
    return { campos: {}, buffer: null };
  }
}

/* devolve o id @lid da mensagem, se houver (para parear com o número real) */
function lidDaMensagem(msg) {
  const k = msg.key || {};
  const j = [k.remoteJid, k.remoteJidAlt, k.participant, k.participantAlt].find(x => x && x.endsWith('@lid'));
  return j ? j.split('@')[0] : null;
}

/* WhatsApp dá a cada contato DUAS identidades (número real e "lid" de privacidade);
   dependendo do caminho da mensagem chega uma ou outra, e isso pode gerar a MESMA
   pessoa em duas conversas (recebidas numa, enviadas noutra). Quando o par
   lid<->número é descoberto: funde as duas em uma só, preservando as mensagens. */
async function unificarLidComNumero(lid, telefone) {
  const presas = await db.select(`conversas?telefone=eq.lid-${lid}&select=id,nome,foto_url`);
  if (!presas.length) return;
  const convLid = presas[0];
  const reais = await db.select(`conversas?telefone=eq.${encodeURIComponent(telefone)}&select=id,nome,foto_url&limit=1`);
  if (!reais.length) {
    // só existe a versão lid-: basta trocar o telefone (histórico preservado)
    await db.patch(`conversas?id=eq.${convLid.id}`, { telefone });
    log('🔗 número revelado: conversa lid ' + fimTel(lid) + ' agora é ' + fimTel(telefone));
    return;
  }
  const convReal = reais[0];
  if (convReal.id === convLid.id) return;
  // as duas existem: move as mensagens da duplicata para a conversa real
  await db.patch(`mensagens?conversa_id=eq.${convLid.id}`, { conversa_id: convReal.id });
  // grava a identidade aprendida na sobrevivente — daqui em diante a duplicata nem nasce
  if (temLid) { try { await db.patch(`conversas?id=eq.${convReal.id}`, { lid }); } catch (e) {} }
  // aproveita nome/foto da duplicata se a real estiver sem
  const melhorias = {};
  if ((!convReal.nome || /^Contato \d+$/.test(convReal.nome)) && convLid.nome && !/^Contato \d+$/.test(convLid.nome)) melhorias.nome = convLid.nome;
  if (!convReal.foto_url && convLid.foto_url) melhorias.foto_url = convLid.foto_url;
  if (Object.keys(melhorias).length) { try { await db.patch(`conversas?id=eq.${convReal.id}`, melhorias); } catch (e) {} }
  try {
    await db.del(`conversas?id=eq.${convLid.id}`);
  } catch (e) {
    // alguma referência impede apagar: arquiva a casca vazia para sumir da lista
    try { await db.patch(`conversas?id=eq.${convLid.id}`, { arquivada: true, nome: '(fundida em ' + telefone + ')' }); } catch (e2) {}
  }
  log('🔗 conversas unificadas: lid ' + fimTel(lid) + ' fundida em ' + fimTel(telefone));
}

/* varredura de cura: resolve conversas presas no formato lid- por DUAS vias —
   1) o mapa de identidades da sessão (lid -> número; cresce conforme mensagens circulam)
   2) consulta reversa ao WhatsApp (número -> lid via onWhatsApp), que cobre os casos
      em que o par nunca apareceu junto numa mesma mensagem (órgãos/empresas) */
async function varrerLids() {
  if (!sock || situacaoAtual !== 'conectado') return;
  try {
    const presas = await db.select(`conversas?telefone=like.lid-*&select=telefone&limit=100`);
    if (!presas.length) return;
    let curadas = 0;

    // via 1: mapa da sessão
    const mapa = sock.signalRepository && sock.signalRepository.lidMapping;
    if (mapa) {
      for (const c of presas) {
        const lid = String(c.telefone).slice(4);
        let pn = null;
        for (const fn of ['getPNForLID', 'getPhoneForLID', 'getPnForLid']) {
          if (typeof mapa[fn] === 'function') {
            try { pn = await mapa[fn].call(mapa, lid + '@lid'); if (pn) break; } catch (e) {}
          }
        }
        const s = typeof pn === 'string' ? pn : '';
        if (s && s.includes('@')) {
          const n = s.split('@')[0];
          if (/^\d{8,15}$/.test(n)) { await unificarLidComNumero(lid, n); curadas++; }
        }
      }
    }

    // via 2: mapa local no sentido inverso (número -> lid) + consulta onWhatsApp
    const aindaPresas = await db.select(`conversas?telefone=like.lid-*&select=telefone&limit=100`);
    const lidsPresos = new Set((aindaPresas || []).map(c => String(c.telefone).slice(4)));
    if (lidsPresos.size) {
      const numeros = await db.select(`conversas?tipo=eq.individual&telefone=not.like.lid-*&select=telefone&order=ultima_msg_em.desc.nullslast&limit=150`);
      let debugou = false;
      for (const c of numeros || []) {
        if (!lidsPresos.size || situacaoAtual !== 'conectado') break;
        const tel = String(c.telefone);
        if (!/^\d{8,15}$/.test(tel)) continue;
        let lid = '';
        // 2a: mapa local (mesmo método que a busca de fotos usa)
        try {
          if (mapa && typeof mapa.getLIDForPN === 'function') {
            const l = await mapa.getLIDForPN(tel + '@s.whatsapp.net');
            const s = typeof l === 'string' ? l : String(l || '');
            if (s.includes('@lid')) lid = s.split('@')[0].split(':')[0];
          }
        } catch (e) {}
        // 2b: consulta ao WhatsApp
        if (!lid) {
          try {
            const r = await sock.onWhatsApp(tel + '@s.whatsapp.net');
            if (!debugou && lidsPresos.size) { debugou = true; log('   🔎 onWhatsApp(' + fimTel(tel) + ') campos=' + Object.keys((r && r[0]) || {}).join(',')); }
            const info = r && r[0];
            const lidJid = info && (info.lid || (String(info.jid || '').endsWith('@lid') ? info.jid : ''));
            if (lidJid) lid = String(lidJid).split('@')[0].split(':')[0];
          } catch (e) {}
          await new Promise(r => setTimeout(r, 800)); // espaçado: evita rate limit
        }
        if (lid && lidsPresos.has(lid)) {
          await unificarLidComNumero(lid, tel);
          lidsPresos.delete(lid);
          curadas++;
        }
      }
    }

    // via 3: foto de perfil idêntica — o ?v= da URL é o hash do CONTEÚDO da foto;
    // se a dupla (lid- e número) tem o MESMO hash e o par é ÚNICO, é a mesma entidade
    if (lidsPresos && lidsPresos.size) {
      const presasFoto = await db.select(`conversas?telefone=like.lid-*&select=telefone,foto_url&limit=100`);
      const reaisFoto = await db.select(`conversas?tipo=eq.individual&telefone=not.like.lid-*&select=telefone,foto_url&limit=400`);
      const hashDe = (u) => { const m = /\?v=([0-9a-f]{6,})$/.exec(String(u || '')); return m ? m[1] : ''; };
      const porHash = {};
      for (const c of reaisFoto || []) {
        const h = hashDe(c.foto_url);
        if (h) (porHash[h] = porHash[h] || []).push(String(c.telefone));
      }
      for (const c of presasFoto || []) {
        const h = hashDe(c.foto_url);
        const donos = h ? porHash[h] : null;
        if (donos && donos.length === 1) {   // só funde se o par for inequívoco
          const lid = String(c.telefone).slice(4);
          await unificarLidComNumero(lid, donos[0]);
          lidsPresos.delete(lid);
          curadas++;
          log('🔗 unificada pela foto de perfil (hash idêntico e único): lid ' + fimTel(lid) + ' = ' + fimTel(donos[0]));
        }
      }
      if (lidsPresos.size) log('🔗 identidades ainda não resolvidas: ' + lidsPresos.size + ' (re-tento na próxima varredura)');
    }
    if (curadas) log('🔗 varredura de identidades: ' + curadas + ' conversa(s) unificada(s)');
  } catch (e) {}
}

/* migração chat-v3 (reações) já rodou? verificado na inicialização */
let temReacoes = false;
/* migração chat-v11 (identidade dupla lid na conversa — anti-duplicata) já rodou? */
let temLid = false;
/* migração chat-v4 (citar/encaminhar) já rodou? */
let temCitado = false;
/* migração chat-v9 (apagar mensagens) já rodou? */
let temApagada = false;
/* migração chat-v14b (histórico de mensagens editadas) já rodou? */
let temEdicoes = false;
/* migração chat-v14c (segredo das mensagens, para decifrar edições cifradas) já rodou? */
let temSegredos = false;
let _limpezaSegredos = 0;
/* chat-v16c: arquivos grandes ficam no WhatsApp até alguém pedir (tabela midias_pendentes + bucket midias-grandes) */
let temMidiasPendentes = false;
let _limpezaGrandes = 0;

/* contextInfo da mensagem (citação/encaminhamento), presente em qualquer tipo.
   Desembrulha mensagem temporária/visualização única e olha um nível abaixo
   (documentWithCaptionMessage etc.): sem isso, o que o cliente ENCAMINHAVA nesses
   formatos chegava aqui como se fosse texto dele. */
function contextoDe(msg) {
  const m = desembrulhar(msg.message || {});
  for (const k of Object.keys(m)) {
    const no = m[k];
    if (!no || typeof no !== 'object') continue;
    if (no.contextInfo) return no.contextInfo;
    if (no.message && typeof no.message === 'object') {
      for (const k2 of Object.keys(no.message)) {
        const n2 = no.message[k2];
        if (n2 && typeof n2 === 'object' && n2.contextInfo) return n2.contextInfo;
      }
    }
  }
  return null;
}

function previaDoQuoted(qm) {
  if (!qm) return '';
  if (qm.conversation) return qm.conversation;
  if (qm.extendedTextMessage) return qm.extendedTextMessage.text || '';
  if (qm.imageMessage) return qm.imageMessage.caption || '📷 Foto';
  if (qm.videoMessage) return qm.videoMessage.caption || '🎬 Vídeo';
  if (qm.audioMessage) return '🎙 Áudio';
  if (qm.documentMessage) return '📄 ' + (qm.documentMessage.fileName || 'Documento');
  if (qm.stickerMessage) return '🩵 Figurinha';
  return '';
}

/* monta o snapshot da mensagem citada para gravar junto com a recebida */
async function citadoDe(ctx) {
  if (!ctx || !ctx.stanzaId) return null;
  let l = null;
  try {
    const rows = await db.select(`mensagens?externo_id=eq.${encodeURIComponent(ctx.stanzaId)}&select=id,texto,remetente,direcao,tipo,midia_nome&limit=1`);
    l = rows && rows[0];
  } catch (e) {}
  return {
    id: l ? l.id : null,
    externoId: ctx.stanzaId,
    texto: (l && l.texto) || previaDoQuoted(ctx.quotedMessage) || (l && l.midia_nome) || '',
    remetente: l ? (l.direcao === 'saida' ? '' : (l.remetente || '')) : '',
    minha: l ? l.direcao === 'saida' : false,
    participante: ctx.participant || '',
    tipo: l ? l.tipo : 'texto'
  };
}

/* citação sintetizada para o Baileys responder no WhatsApp.
   Em grupo a chave precisa do participante: para mensagem nossa é o nosso JID
   (sem isto, responder a si mesmo num grupo saía sem a citação); em conversa
   individual o participant não vai. */
function quotedDe(citado, destino) {
  if (!citado || !citado.externoId) return null;
  let participant;
  if (/@g\.us$/.test(destino || '')) {
    if (citado.minha) { try { participant = jidNormalizedUser(sock.user.id); } catch (e) {} }
    else participant = citado.participante || undefined;
  }
  return {
    key: { remoteJid: destino, id: citado.externoId, fromMe: !!citado.minha, participant },
    message: { conversation: String(citado.texto || ' ').slice(0, 300) }
  };
}

/* a própria mensagem nasce no front sem externo_id (só o motor o conhece): se a
   citação veio sem ele, busca pelo id da linha antes de montar a resposta */
async function completarCitado(citado) {
  if (!citado || citado.externoId || !citado.id) return;
  try {
    const rows = await db.select(`mensagens?id=eq.${encodeURIComponent(citado.id)}&select=externo_id,direcao,participante&limit=1`);
    const l = rows && rows[0];
    if (l && l.externo_id) {
      citado.externoId = l.externo_id;
      if (l.direcao === 'saida') citado.minha = true;
      if (l.participante && !citado.participante) citado.participante = l.participante;
    }
  } catch (e) {}
  if (!citado.externoId) log('   ↩️ citação sem id no WhatsApp (msg ' + idCurto(citado.id) + '): enviando sem citar');
}

/* estados de envio só andam para a frente: um ack atrasado (3 depois do 4) não
   rebaixa 'lida' para 'entregue'. 'erro' entra porque um ack prova que saiu. */
const ANTERIORES_DO_STATUS = { enviada: 'enviando,erro', entregue: 'enviando,enviada,erro', lida: 'enviando,enviada,entregue,erro' };
function patchStatusSemRegredir(externoId, status) {
  return db.patch(`mensagens?externo_id=eq.${encodeURIComponent(externoId)}&status=in.(${ANTERIORES_DO_STATUS[status]})`, { status });
}

/* alguém reagiu (ou removeu a reação) a uma mensagem */
async function aoReceberReacao(msg, reacao) {
  if (!temReacoes) return;
  try {
    const alvoId = reacao.key && reacao.key.id;
    if (!alvoId) return;
    const rows = await db.select(`mensagens?externo_id=eq.${encodeURIComponent(alvoId)}&select=id,reacoes&limit=1`);
    if (!rows.length) return;
    const minha = !!msg.key.fromMe;
    const de = String((msg.key.participant || msg.key.remoteJid || '')).split('@')[0];
    let reacoes = (rows[0].reacoes || []).filter(r => minha ? !r.minha : r.de !== de);
    // reação é um emoji: no máximo 16 caracteres (defesa extra — a tela também escapa)
    const emoji = Array.from(String(reacao.text || '')).slice(0, 16).join('');
    if (emoji) reacoes.push({ emoji, de, nome: minha ? '' : (msg.pushName || ''), minha });
    await db.patch(`mensagens?id=eq.${rows[0].id}`, { reacoes });
    log(minha ? '💫(celular)' : '💫', 'reação', emoji ? 'registrada' : 'removida', '· msg ' + idCurto(rows[0].id));
  } catch (e) { log('erro na reação:', e.message); }
}

/* ---------- mensagens EDITADAS ----------
   O aviso de edição é um protocolMessage (MESSAGE_EDIT) com a chave da mensagem
   original e o conteúdo novo em editedMessage. Chega direto, dentro de
   msg.message.editedMessage.message, e — em conversa com mensagens temporárias —
   embrulhado em ephemeralMessage/viewOnce. edicaoDe() desembrulha tudo. */
function edicaoDe(msg) {
  const m = desembrulhar(msg && msg.message);
  if (!m) return null;
  const pm = (m.editedMessage && m.editedMessage.message && desembrulhar(m.editedMessage.message).protocolMessage) || m.protocolMessage;
  if (!pm || !pm.editedMessage || !pm.key || !pm.key.id) return null;
  return pm;
}
/* texto novo na mensagem original; versão anterior vai para `edicoes` (chat-v14b).
   Sem a coluna (ou cache do PostgREST atrasado: 400 PGRST204/42703), cai no selo
   "(editada)" de antes — nunca deixa a edição se perder nem vira registro novo. */
async function aplicarEdicao(ed, msg) {
  const novoCont = extrairConteudo({ message: ed.editedMessage });
  if (!novoCont) return;
  let alvoR;
  try {
    alvoR = await db.select(`mensagens?externo_id=eq.${encodeURIComponent(ed.key.id)}&select=id,texto${temEdicoes ? ',edicoes' : ''}&limit=1`);
  } catch (e) {
    if (!(temEdicoes && e.status === 400 && (e.code === 'PGRST204' || e.code === '42703'))) throw e;
    temEdicoes = false;
    log('ℹ️ mensagens.edicoes não existe no banco — rode nuvem/chat-v14b.sql (até lá, só o selo "(editada)")');
    alvoR = await db.select(`mensagens?externo_id=eq.${encodeURIComponent(ed.key.id)}&select=id,texto&limit=1`);
  }
  if (!alvoR.length) { log('✏️ edição de mensagem que não está no CRM — ignorada'); return; }
  const alvo = alvoR[0];
  const SUFIXO = /\s*\((editada|editada no celular)\)$/;
  const novoTexto = String(novoCont.texto || '').replace(SUFIXO, '');
  const textoAntigo = String(alvo.texto || '').replace(SUFIXO, '');
  const seg = numeroDe(msg && msg.messageTimestamp);
  const quando = seg ? new Date(seg * 1000).toISOString() : new Date().toISOString();
  const quem = msg && msg.key && msg.key.fromMe ? 'pelo celular' : 'pelo contato';
  if (temEdicoes) {
    try {
      const anteriores = Array.isArray(alvo.edicoes) ? alvo.edicoes : [];
      await db.patch(`mensagens?id=eq.${alvo.id}`, { texto: novoTexto, edicoes: anteriores.concat({ texto: textoAntigo, em: quando }) });
      log('✏️ mensagem editada ' + quem + ' — versão anterior guardada');
      return;
    } catch (e) {
      if (!(e.status === 400 && (e.code === 'PGRST204' || e.code === '42703'))) throw e;
      temEdicoes = false;
      log('ℹ️ mensagens.edicoes não existe no banco — rode nuvem/chat-v14b.sql (até lá, só o selo "(editada)")');
    }
  }
  await db.patch(`mensagens?id=eq.${alvo.id}`, { texto: novoTexto + ' (editada)' });
  log('✏️ mensagem editada ' + quem + ' — CRM atualizado (sem histórico)');
}

/* ---------- segredo das mensagens e edições CIFRADAS (chat-v14c) ----------
   O WhatsApp novo manda a edição como secretEncryptedMessage: o conteúdo novo
   vem em AES-256-GCM com chave HKDF-SHA256(messageSecret da mensagem ORIGINAL,
   info = id + remetente original + quem editou + "Message Edit") e sem AAD
   (esquema do whatsmeow, msgsecret.go). O messageSecret chega junto com cada
   mensagem (messageContextInfo) e é guardado em mensagens_segredos — tabela só
   do motor. Sem ele, a edição virava "[tipo não suportado: secretEncryptedMessage]". */
const semDevice = j => { try { return jidNormalizedUser(j); } catch (e) { return String(j || ''); } };
function segredoDe(msg) {
  const topo = msg && msg.message;
  if (!topo) return null;
  const ctx = topo.messageContextInfo || desembrulhar(topo).messageContextInfo;
  const s = ctx && ctx.messageSecret;
  return s && s.length ? Buffer.from(s) : null;
}
function remetenteDe(msg) {
  const k = (msg && msg.key) || {};
  if (k.fromMe) { try { return semDevice(sock.user.id); } catch (e) { return ''; } }
  return semDevice(k.participant || k.remoteJid || '');
}
async function guardarSegredo(msg) {
  if (!temSegredos) return;
  const s = segredoDe(msg);
  const id = msg && msg.key && msg.key.id;
  if (!s || !id) return;
  try {
    await db.upsert('mensagens_segredos', [{ externo_id: id, segredo: s.toString('base64'), remetente: remetenteDe(msg) }]);
  } catch (e) {
    if (tabelaInexistente(e)) temSegredos = false;
    log('   ⚠️ não guardei o segredo da mensagem:', e.message);
  }
}
function decifrarComSegredo(encPayload, encIv, segredo, info) {
  const chave = Buffer.from(crypto.hkdfSync('sha256', segredo, Buffer.alloc(0), info, 32));
  const dados = Buffer.from(encPayload);
  const corpo = dados.subarray(0, dados.length - 16), tag = dados.subarray(dados.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', chave, Buffer.from(encIv));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(corpo), d.final()]);
}
/* o motor soube da edição mas não tem como ler o texto novo: marca a original */
async function marcarEditadaSemConteudo(externoId) {
  const r = await db.select(`mensagens?externo_id=eq.${encodeURIComponent(externoId)}&select=id,texto&limit=1`);
  if (!r.length) return;
  const base = String(r[0].texto || '').replace(/\s*\((editada|editada no celular)\)$/, '');
  await db.patch(`mensagens?id=eq.${r[0].id}`, { texto: base + ' (editada no celular)' });
}
async function aplicarEdicaoCifrada(sem, msg) {
  const alvo = sem.targetMessageKey || {};
  if (!alvo.id) return;
  const tipo = sem.secretEncType;
  if (!(tipo === 2 || tipo === 'MESSAGE_EDIT')) { log('🔐 secretEncryptedMessage de tipo ' + tipo + ' — ignorado'); return; }
  if (!temSegredos) {
    log('ℹ️ edição cifrada recebida sem a tabela mensagens_segredos — rode nuvem/chat-v14c.sql (original marcada como editada)');
    await marcarEditadaSemConteudo(alvo.id);
    return;
  }
  let rows = [];
  try { rows = await db.select(`mensagens_segredos?externo_id=eq.${encodeURIComponent(alvo.id)}&select=segredo,remetente&limit=1`); }
  catch (e) { if (tabelaInexistente(e)) temSegredos = false; else throw e; }
  if (!rows.length) {
    log('🔐 edição cifrada de mensagem sem segredo guardado (anterior ao chat-v14c?) — original marcada como editada');
    await marcarEditadaSemConteudo(alvo.id);
    return;
  }
  const segredo = Buffer.from(rows[0].segredo, 'base64');
  const k = msg.key || {};
  // remetente original e quem editou: lid e número (sem device) — testa as combinações, como no voto
  const origens = new Set([rows[0].remetente, alvo.participant, alvo.fromMe ? null : k.remoteJid, k.remoteJidAlt, k.senderPn,
    alvo.fromMe ? (sock && sock.user && sock.user.id) : null].filter(Boolean).map(semDevice));
  const editores = new Set([k.participant, k.remoteJid, k.participantAlt, k.remoteJidAlt, k.senderPn].filter(Boolean).map(semDevice));
  const mapa = sock && sock.signalRepository && sock.signalRepository.lidMapping;
  for (const conjunto of [origens, editores]) {
    for (const j of Array.from(conjunto)) {
      try {
        if (mapa && j.endsWith('@lid') && mapa.getPNForLID) { const pn = await mapa.getPNForLID(j); if (pn) conjunto.add(semDevice(pn)); }
        if (mapa && j.endsWith('@s.whatsapp.net') && mapa.getLIDForPN) { const l = await mapa.getLIDForPN(j); if (l) conjunto.add(semDevice(l)); }
      } catch (e) {}
    }
  }
  let plano = null;
  busca:
  for (const o of origens) {
    for (const e of editores) {
      try {
        plano = decifrarComSegredo(sem.encPayload, sem.encIv, segredo, Buffer.concat([Buffer.from(alvo.id), Buffer.from(o), Buffer.from(e), Buffer.from('Message Edit')]));
        break busca;
      } catch (err) {}
    }
  }
  if (!plano) {
    log('🔐 não consegui decifrar a edição · origens=' + Array.from(origens).map(fimTel).join(',') + ' editores=' + Array.from(editores).map(fimTel).join(','));
    await marcarEditadaSemConteudo(alvo.id);
    return;
  }
  const dec = proto.Message.decode(plano);
  const interno = (dec.protocolMessage && dec.protocolMessage.editedMessage) || (dec.editedMessage && dec.editedMessage.message) || dec;
  await aplicarEdicao({ key: alvo, editedMessage: interno }, msg);
}

async function aoReceberMensagens({ messages, type }) {
  for (const msg of messages) {
    try {
      const jid = msg.key.remoteJid || '';
      if (jid === 'status@broadcast' || jid.endsWith('@newsletter')) continue;
      if (msg.message && msg.message.reactionMessage) { await aoReceberReacao(msg, msg.message.reactionMessage); continue; }
      const pm = msg.message && msg.message.protocolMessage;
      if (pm && (pm.type === 0 || pm.type === 'REVOKE') && pm.key && pm.key.id) {
        if (temApagada) {
          try {
            await db.patch(`mensagens?externo_id=eq.${encodeURIComponent(pm.key.id)}`, { apagada: true });
            log('🚫 mensagem apagada ' + (msg.key.fromMe ? 'pelo celular' : 'pelo contato') + ' (conteúdo preservado no CRM)');
          } catch (e) {}
        }
        continue;
      }
      if (msg.message && msg.message.pollUpdateMessage) { await aoReceberVoto(msg); continue; }
      // EDIÇÃO de mensagem (pelo contato ou por nós, de qualquer aparelho).
      // O aviso de edição pode vir embrulhado (ephemeral/viewOnce, mensagem
      // temporária): sem desembrulhar, caía em processarMensagem e virava um
      // registro "[tipo não suportado: editedMessage]" na conversa — o erro que o
      // time via. Atualiza a mensagem ORIGINAL com o texto novo e guarda a versão
      // anterior em `edicoes` (chat-v14b); sem a coluna, volta ao selo "(editada)".
      const ed = edicaoDe(msg);
      if (ed) {
        try { await aplicarEdicao(ed, msg); }
        catch (e) { log('erro ao aplicar edição:', e.message); }
        continue;
      }
      // edição CIFRADA (WhatsApp novo): decifra com o segredo guardado da mensagem original
      const sem = desembrulhar(msg.message).secretEncryptedMessage;
      if (sem) {
        try { await aplicarEdicaoCifrada(sem, msg); }
        catch (e) { log('erro ao aplicar edição cifrada:', e.message); }
        continue;
      }
    } catch (e) { log('erro ao processar mensagem:', e.message); continue; }
    // conteúdo (texto/mídia): um erro aqui NÃO pode perder a mensagem → vai para o reprocesso
    try {
      await processarMensagem(msg);
    } catch (e) {
      log('⚠️ falha ao gravar mensagem recebida (' + idCurto(msg.key && msg.key.id) + '):', e.message, '— guardada para nova tentativa');
      await guardarPendente(msg, e);
    }
  }
}

/* conversa: registra a chegada da mensagem (não lidas, reabertura, prévia).
   Com a chat-v12a usa a função registrar_entrada (incremento atômico; prévia e
   ordem só mudam se a mensagem for a mais recente); sem ela, o patch antigo. */
let temRpcEntrada = null;        // null = ainda não sabemos · false = não existe (re-testa a cada 60 s)
let _avisouRpcEntrada = false;
async function registrarNaConversa(conversa, previa, quandoIso, entrada) {
  if (temRpcEntrada !== false) {
    try {
      await db.rpc('registrar_entrada', { cid: conversa.id, previa: String(previa || '').slice(0, 120), quando: quandoIso, entrada });
      if (temRpcEntrada !== true) { temRpcEntrada = true; log('🧮 registrar_entrada ativa (não lidas com incremento atômico)'); }
      return;
    } catch (e) {
      if (!(e.status === 404 || e.code === 'PGRST202')) throw e;
      temRpcEntrada = false;
      if (!_avisouRpcEntrada) { _avisouRpcEntrada = true; log('ℹ️ registrar_entrada não existe — rode nuvem/chat-v12a.sql; usando o modo antigo'); }
    }
  }
  // modo antigo (pré chat-v12a): ler + somar + gravar
  const patchConv = {
    ultima_msg: String(previa || '').slice(0, 120),
    ultima_msg_em: new Date().toISOString()
  };
  if (entrada) {
    patchConv.nao_lidas = (conversa.nao_lidas || 0) + 1;
    if (conversa.status === 'resolvido' || conversa.status === 'fechado') patchConv.status = 'aberto';
    if (conversa.arquivada) patchConv.arquivada = false;   // mensagem nova devolve a conversa à caixa do departamento
  }
  await db.patch(`conversas?id=eq.${conversa.id}`, patchConv);
}

/* grava UMA mensagem de conteúdo (texto/mídia), recebida ou enviada pelo celular.
   LANÇA em erro — quem chama guarda a mensagem para reprocesso (nada some em
   silêncio). opcoes.reprocesso = veio da fila de pendentes. */
async function processarMensagem(msg, opcoes = {}) {
  const jid = (msg.key && msg.key.remoteJid) || '';
  // uma de cada vez por contato: o grupo, ou o telefone já resolvido
  // (lid e número caem na mesma fila quando o mapa de identidades conhece o par)
  const chave = jid.endsWith('@g.us') ? jid : (resolverTelefone(msg) || jid);
  return emSerie(chave, () => gravarMensagem(msg, opcoes));
}

async function gravarMensagem(msg, opcoes) {
  const jid = msg.key.remoteJid || '';
  const conteudo = extrairConteudo(msg);
  if (!conteudo) return;
  // segredo da mensagem (edições cifradas, chat-v14c): guarda em paralelo, nunca atrasa a mensagem
  guardarSegredo(msg).catch(() => {});
  if (jid.endsWith('@lid')) {
    const k = msg.key;
    log('   🔎 mensagem via lid ' + fimTel(jid) + ' · alt=' + (k.remoteJidAlt ? fimTel(k.remoteJidAlt) : '—') + ' · senderPn=' + (k.senderPn ? fimTel(k.senderPn) : '—'));
  }
  const grupo = jid.endsWith('@g.us');

  let conversa, remetente = '';
  if (grupo) {
    conversa = await garantirConversaGrupo(jid);
    if (!msg.key.fromMe) {
      const pTel = String(msg.key.participant || '').split('@')[0];
      remetente = msg.pushName || (/^\d+$/.test(pTel) ? pTel : '');
      // nome e telefone reais do participante ficam no grupo; nunca atrasa nem derruba a mensagem
      try { await anotarParticipante(conversa, msg); } catch (e) { log('   ⚠️ não anotei o participante:', e.message); }
    }
  } else {
    const telefone = resolverTelefone(msg);
    if (!telefone) { log(`   ⚠️ sem telefone resolvível para jid=${fimTel(jid)}`); return; }
    // WhatsApp revelou o número real de um contato que estava preso no formato @lid?
    // → migra a conversa antiga (preserva o histórico) em vez de criar outra
    const lid = lidDaMensagem(msg);
    if (lid && !telefone.startsWith('lid-')) {
      try { await unificarLidComNumero(lid, telefone); } catch (e) {}
    }
    // fromMe: o pushName é o NOSSO nome — não pode batizar a conversa do contato
    conversa = await garantirConversa(telefone, msg.key.fromMe ? '' : (msg.pushName || ''), lid);
  }

  // dedupe ANTES da mídia: evita baixar de novo o arquivo de uma mensagem repetida
  const externoId = msg.key.id || '';
  if (externoId) {
    const ja = await db.select(`mensagens?externo_id=eq.${encodeURIComponent(externoId)}&select=id&limit=1`);
    if (ja.length) return;
  }

  // mídia: baixa e sobe para o Storage
  let camposMidia = {};
  let texto = conteudo.texto;
  if (conteudo.no) {
    const recebida = await receberMidia(msg, conteudo, conversa.id);
    camposMidia = recebida.campos;
    if (recebida.grandeDemaisMb && !recebida.pendente) {
      texto = `[arquivo de ${recebida.grandeDemaisMb} MB grande demais para o sistema — veja no celular]` + (conteudo.texto ? '\n' + conteudo.texto : '');
    }
    // pendente (chat-v16c): a mensagem entra só com nome/tamanho/tipo; o Chat mostra "Baixar (N MB)"
  }

  const entrada = !msg.key.fromMe;
  // horário da MENSAGEM (não o de agora): reentregas depois de uma queda ficam no lugar certo
  const quando = new Date((numeroDe(msg.messageTimestamp) || Date.now() / 1000) * 1000);
  let extrasV4 = {};
  if (temCitado) {
    const ctx = contextoDe(msg);
    extrasV4 = {
      citado: await citadoDe(ctx),
      encaminhada: !!(ctx && (ctx.isForwarded || ctx.forwardingScore))
    };
  }
  try {
    await db.insert('mensagens', [{
      conversa_id: conversa.id,
      direcao: entrada ? 'entrada' : 'saida',
      tipo: conteudo.tipo,
      texto,
      remetente,
      status: entrada ? 'recebida' : 'enviada',
      externo_id: externoId,
      criado_em: quando.toISOString(),
      ...camposMidia,
      ...(temReacoes ? { participante: grupo ? String(msg.key.participant || '') : '' } : {}),
      ...extrasV4
    }]);
  } catch (e) {
    // 23505 = o índice único de externo_id (chat-v12a) barrou uma repetida: já está gravada, não é erro
    if (e.code === '23505') { log('   ↩️ mensagem já gravada (' + idCurto(externoId) + ') — ignorada'); return; }
    throw e;
  }

  // transcrição de áudio: só sob demanda (botão ✨ no CRM → comando 'transcrever'),
  // para não gastar créditos com áudios que ninguém pediu para transcrever

  // a mensagem JÁ está salva: se a conversa não atualizar, não manda para o reprocesso
  // (o dedupe pularia e a conversa nunca seria atualizada) — guarda o ajuste e repete
  const previa = texto || conteudo.rotulo || '';
  try {
    await registrarNaConversa(conversa, previa, quando.toISOString(), entrada);
  } catch (e) {
    log('⚠️ mensagem gravada, mas a conversa não foi atualizada (' + idCurto(conversa.id) + '):', e.message);
    reaplicarDepois('conversa ' + idCurto(conversa.id) + ' · nova mensagem', () => registrarNaConversa(conversa, previa, quando.toISOString(), entrada));
  }
  log(entrada ? '📥' : '📤(celular)', 'conv ' + idCurto(conversa.id), '·', conteudo.tipo, '·', previa.length + ' car.' + (opcoes && opcoes.reprocesso ? ' · reprocessada' : ''));

  // automações (quando → se → então)
  if (entrada) {
    // o lead falou: cala a cadência antes de qualquer outra coisa (sempre, mesmo se antiga)
    await pausarCadencia(conversa);
    // só mensagem fresca (≤ 10 min) dispara automação: reentrega após queda não repete saudação/ausência
    const idadeMin = (Date.now() - quando.getTime()) / 60000;
    if (idadeMin <= 10) {
      const textoAuto = conteudo.texto || (camposMidia.transcricao || '');
      if (conversa._nova) await rodarAutomacoes('conversa_criada', conversa, textoAuto);
      await rodarAutomacoes('mensagem_recebida', conversa, textoAuto);
    } else {
      log('   ⏭ automações puladas: mensagem de ' + Math.round(idadeMin) + ' min atrás (reentregue)');
    }
  }
}

/* ---------- reprocesso de mensagens que não puderam ser gravadas ---------- */
/* Antes, uma falha do banco na hora da recepção perdia a mensagem (só ia para
   o log). Agora ela vai para motor_pendentes (chat-v12a) — ou, sem a tabela ou
   com o banco fora, para uma fila em memória — e é tentada de novo a cada 30 s. */
let pendentesNoBanco = true;        // a tabela motor_pendentes existe? (re-testada a cada 60 s)
const pendentesMemoria = [];        // { externo_id, payload, tentativas, erro }
const MAX_PENDENTES_MEMORIA = 500;
const MAX_TENTATIVAS = 20;

const tabelaInexistente = (e) => !!e && (e.status === 404 || e.code === '42P01' || e.code === 'PGRST205');
function desativarPendentesNoBanco() {
  if (!pendentesNoBanco) return;
  pendentesNoBanco = false;
  log('ℹ️ tabela motor_pendentes não existe — rode nuvem/chat-v12a.sql; por ora as pendentes ficam só na memória');
}
/* a mensagem do Baileys tem Buffers (chaves da mídia): o BufferJSON preserva no jsonb */
const serializarMsg = (msg) => JSON.parse(JSON.stringify(msg, BufferJSON.replacer));
const desserializarMsg = (p) => JSON.parse(JSON.stringify(p), BufferJSON.reviver);
const textoErro = (e) => String((e && e.message) || e || '').slice(0, 300);

function guardarNaMemoria(item) {
  const i = pendentesMemoria.findIndex(x => x.externo_id === item.externo_id);
  if (i >= 0) pendentesMemoria.splice(i, 1);
  if (pendentesMemoria.length >= MAX_PENDENTES_MEMORIA) {
    const velha = pendentesMemoria.shift();
    log('⚠️ fila de pendentes em memória cheia (' + MAX_PENDENTES_MEMORIA + ') — descartando a mais antiga (' + idCurto(velha.externo_id) + ')');
  }
  pendentesMemoria.push(item);
}

/* guarda no banco (sobrevive a reinício); se não der, na memória. Nunca lança. */
async function guardarItemPendente(item) {
  if (pendentesNoBanco) {
    try {
      await db.upsert('motor_pendentes', [{
        externo_id: item.externo_id, payload: item.payload, erro: item.erro,
        status: 'pendente', tentativas: item.tentativas, atualizado_em: new Date().toISOString()
      }]);
      return;
    } catch (e) {
      if (tabelaInexistente(e)) desativarPendentesNoBanco();
      else log('⚠️ não consegui guardar a pendente no banco (' + e.message + ') — fica na memória');
    }
  }
  guardarNaMemoria(item);
}

async function guardarPendente(msg, erro) {
  let payload;
  try { payload = serializarMsg(msg); }
  catch (e) { log('⚠️ não consegui serializar a mensagem ' + idCurto(msg.key && msg.key.id) + ' para reprocesso:', e.message); return; }
  const externo_id = (msg.key && msg.key.id) || ('sem-id-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
  await guardarItemPendente({ externo_id, payload, tentativas: 1, erro: textoErro(erro) });
}

/* desistiu depois de 20 tentativas: avisa os administradores no sino do CRM */
async function descartarPendente(externoId, erro) {
  log('⚠️ mensagem recebida DESCARTADA após ' + MAX_TENTATIVAS + ' tentativas (' + idCurto(externoId) + '): ' + String(erro || '').slice(0, 160));
  try {
    const ps = await db.select('perfis?ativo=is.true&papel=eq.admin&select=id');
    const linhas = (ps || []).map(p => ({
      perfil_id: p.id, tipo: 'aviso',
      texto: `⚠️ Uma mensagem recebida no WhatsApp não pôde ser gravada no sistema depois de ${MAX_TENTATIVAS} tentativas — confira no celular do escritório (ref. ${idCurto(externoId)}).`
    }));
    if (linhas.length) await db.insert('notificacoes', linhas);
  } catch (e) { log('erro ao avisar os administradores:', e.message); }
}

let reprocessando = false;
async function reprocessarPendentes() {
  // precisa do WhatsApp conectado: a mídia é baixada pela conexão (sem ela entraria sem o arquivo)
  if (reprocessando || !sock || situacaoAtual !== 'conectado') return;
  reprocessando = true;
  try {
    // 1) fila em memória
    const lote = pendentesMemoria.splice(0, pendentesMemoria.length);
    for (const item of lote) {
      try {
        await processarMensagem(desserializarMsg(item.payload), { reprocesso: true });
        log('♻️ pendente gravada (memória) · ' + idCurto(item.externo_id));
      } catch (e) {
        item.tentativas++;
        item.erro = textoErro(e);
        if (item.tentativas >= MAX_TENTATIVAS) await descartarPendente(item.externo_id, item.erro);
        else await guardarItemPendente(item);   // tenta passar para o banco; senão volta para a memória
      }
    }
    // 2) tabela motor_pendentes (só as que não foram mexidas nos últimos 20 s — evita tentar 2x na mesma volta)
    if (!pendentesNoBanco) return;
    const antesDe = new Date(Date.now() - 20000).toISOString();
    let rows = [];
    try {
      rows = await db.select(`motor_pendentes?status=eq.pendente&atualizado_em=lt.${antesDe}&order=criado_em.asc&limit=20&select=externo_id,payload,tentativas`);
    } catch (e) {
      if (tabelaInexistente(e)) desativarPendentesNoBanco();
      else log('erro ao ler motor_pendentes:', e.message);
      return;
    }
    for (const r of rows || []) {
      const filtro = `motor_pendentes?externo_id=eq.${encodeURIComponent(r.externo_id)}`;
      try {
        await processarMensagem(desserializarMsg(r.payload), { reprocesso: true });
        try { await db.patch(filtro, { status: 'ok', erro: '', atualizado_em: new Date().toISOString() }); } catch (e) {}
        log('♻️ pendente gravada · ' + idCurto(r.externo_id));
      } catch (e) {
        const n = (Number(r.tentativas) || 0) + 1;
        const descartar = n >= MAX_TENTATIVAS;
        try {
          await db.patch(filtro, { tentativas: n, erro: textoErro(e), status: descartar ? 'descartada' : 'pendente', atualizado_em: new Date().toISOString() });
        } catch (e2) {}
        if (descartar) await descartarPendente(r.externo_id, textoErro(e));
      }
    }
  } catch (e) {
    log('erro no reprocesso de pendentes:', e.message);
  } finally {
    reprocessando = false;
  }
}

/* confirmações de entrega/leitura */
async function aoAtualizarMensagens(updates) {
  for (const u of updates) {
    try {
      const st = u.update && u.update.status;
      const id = u.key && u.key.id;
      if (!st || !id) continue;
      const mapa = { 2: 'enviada', 3: 'entregue', 4: 'lida' };
      if (mapa[st]) await patchStatusSemRegredir(id, mapa[st]);
    } catch (e) {}
  }
}

/* recibos por participante (grupos e, às vezes, individuais): em grupo o
   WhatsApp só azula quando todos leram; aqui o primeiro recibo já marca */
async function aoReceberRecibos(itens) {
  for (const it of itens || []) {
    try {
      const k = it.key || {};
      const r = it.receipt || {};
      if (!k.fromMe || !k.id) continue;
      const st = r.readTimestamp ? 'lida' : (r.receiptTimestamp ? 'entregue' : null);
      if (st) await patchStatusSemRegredir(k.id, st);
    } catch (e) {}
  }
}

/* ---------- fila de envio (pendentes + agendadas vencidas) ---------- */
async function montarConteudoEnvio(m) {
  if (m.tipo === 'texto') return { text: m.texto };
  const buf = await midia.baixarUrl(m.midia_url);
  const caption = m.texto || undefined;
  if (m.tipo === 'imagem') return { image: buf, caption };
  if (m.tipo === 'video') return { video: buf, caption };
  if (m.tipo === 'figurinha') return { sticker: await midia.paraFigurinha(buf).catch(() => buf) };
  if (m.tipo === 'audio') {
    if (m.midia_ptt) {
      // áudio gravado no CRM → converte para o formato de voz do WhatsApp
      try {
        const opus = await midia.paraOpus(buf);
        return { audio: opus, ptt: true, mimetype: 'audio/ogg; codecs=opus' };
      } catch (e) {
        log('   ⚠️ conversão opus falhou, enviando como áudio comum:', e.message);
        return { audio: buf, mimetype: m.midia_mime || 'audio/mp4' };
      }
    }
    return { audio: buf, mimetype: m.midia_mime || 'audio/mp4' };
  }
  // arquivo/documento
  return { document: buf, fileName: m.midia_nome || 'arquivo', mimetype: m.midia_mime || 'application/octet-stream', caption };
}

let enviando = false;
async function processarFila() {
  if (enviando || !sock || situacaoAtual !== 'conectado') return;
  enviando = true;
  try {
    const agora = new Date().toISOString();
    const extras = temCitado ? ',citado,encaminhada' : '';
    const fila = await db.select(
      `mensagens?select=id,texto,tipo,midia_url,midia_mime,midia_nome,midia_ptt${extras},conversa_id,conversas(telefone,tipo,grupo_jid)` +
      `&direcao=eq.saida&tipo=not.in.(anotacao,enquete)` +
      `&or=(status.eq.pendente,and(status.eq.agendada,agendada_para.lte.${agora}))` +
      `&order=criado_em.asc&limit=5`
    );
    if (fila && fila.length) log('📮 fila:', fila.length, 'mensagem(ns) para enviar');
    for (const m of fila || []) {
      const conv = m.conversas;
      if (!conv || (!conv.telefone && !conv.grupo_jid) || (m.tipo !== 'texto' && !m.midia_url) || (m.tipo === 'texto' && !m.texto)) {
        await db.patch(`mensagens?id=eq.${m.id}`, { status: 'erro', erro: 'mensagem sem destino ou sem conteúdo' });
        continue;
      }
      const idWa = novoIdWa();
      await db.patch(`mensagens?id=eq.${m.id}`, { status: 'enviando', externo_id: idWa });
      let r = null, saiu = false;
      try {
        const destino = jidDe(conv);
        log('   📤→', fimTel(destino), '(' + m.tipo + ')');
        // prazo só na montagem (download/conversão): pendurar aqui travava a fila inteira;
        // o sendMessage não leva prazo — cortá-lo no meio poderia enviar E marcar erro
        const conteudo = await comPrazo(montarConteudoEnvio(m), 3 * 60000);
        const opcoes = { messageId: idWa };
        if (temCitado && m.citado) {
          await completarCitado(m.citado);
          const q = quotedDe(m.citado, destino);
          if (q) opcoes.quoted = q;
        }
        if (temCitado && m.encaminhada) conteudo.contextInfo = { isForwarded: true, forwardingScore: 1 };
        r = await sock.sendMessage(destino, conteudo, opcoes);
        saiu = true;
      } catch (e) {
        // só aqui é erro de verdade: montar o conteúdo ou o WhatsApp falhou — a mensagem NÃO saiu
        log('erro no envio:', e.message);
        const corpoErro = { status: 'erro', erro: erroDeEnvioLegivel(e) };
        try { await db.patch(`mensagens?id=eq.${m.id}`, corpoErro); }
        catch (e2) { reaplicarDepois('msg ' + idCurto(m.id) + ' → erro', () => db.patch(`mensagens?id=eq.${m.id}&status=eq.enviando`, corpoErro)); }
      }
      if (saiu) {
        // a mensagem JÁ SAIU no WhatsApp: daqui em diante NADA vira 'erro' (o atendente
        // reenviaria e o cliente receberia em dobro). Falhou gravar? guarda e repete a cada 30 s.
        const idFinal = (r && r.key && r.key.id) || idWa;
        const quando = new Date().toISOString();
        const rotulos = { imagem: '📷 Foto', video: '🎬 Vídeo', audio: '🎙 Áudio', arquivo: '📄 ' + (m.midia_nome || 'Documento'), figurinha: '🩵 Figurinha' };
        const previa = m.texto || rotulos[m.tipo] || '';
        try {
          await db.patch(`mensagens?id=eq.${m.id}`, { status: 'enviada', externo_id: idFinal });
        } catch (e) {
          log('⚠️ mensagem enviada, mas o status não foi gravado (' + idCurto(m.id) + '):', e.message);
          // só se ainda estiver 'enviando' (ou 'erro' posto pela limpeza de queda): não rebaixa 'entregue'/'lida'
          reaplicarDepois('msg ' + idCurto(m.id) + ' → enviada', () =>
            db.patch(`mensagens?id=eq.${m.id}&status=in.(enviando,erro)`, { status: 'enviada', externo_id: idFinal, erro: '' }));
        }
        try {
          await db.patch(`conversas?id=eq.${m.conversa_id}`, { ultima_msg: previa.slice(0, 120), ultima_msg_em: quando });
        } catch (e) {
          log('⚠️ mensagem enviada, mas a prévia da conversa não foi gravada (' + idCurto(m.conversa_id) + '):', e.message);
          // não passa por cima de uma prévia mais nova que tenha chegado nesse meio-tempo
          reaplicarDepois('conversa ' + idCurto(m.conversa_id) + ' · prévia', () =>
            db.patch(`conversas?id=eq.${m.conversa_id}&or=(ultima_msg_em.is.null,ultima_msg_em.lt.${quando})`, { ultima_msg: previa.slice(0, 120), ultima_msg_em: quando }));
        }
        log('📤', fimTel(conv.telefone || conv.grupo_jid), '·', m.tipo, '·', previa.length + ' car.');
      }
      // espaçamento anti-spam entre envios (1,2 a 3 segundos)
      await new Promise(r => setTimeout(r, 1200 + Math.random() * 1800));
    }
  } catch (e) { log('erro na fila:', e.message); }
  enviando = false;
}

/* ============================================================
   AUTOMAÇÕES (quando → se → então) — configuradas no CRM,
   executadas aqui 24/7 com trava anti-repetição por conversa
============================================================ */
let temAutomacoes = false;
let _autos = [], _autosEm = 0;

async function carregarAutomacoes() {
  if (!temAutomacoes) return [];
  if (Date.now() - _autosEm < 60000) return _autos;
  try {
    _autos = await db.select('automacoes?ativa=is.true&select=*&order=criado_em.asc') || [];
    _autosEm = Date.now();
  } catch (e) {}
  return _autos;
}

/* "seg-sex 08:00-18:00" | "seg,qua,sex 09:00-12:00" | "todos 08:00-18:00" */
function dentroDoHorario(spec) {
  try {
    const m = String(spec || '').trim().toLowerCase().match(/^(\S+)\s+(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
    if (!m) return true;
    // aceita abreviado e por extenso ("seg-sexta", "sáb", "sex."): antes um nome fora
    // da lista virava undefined e o laço abaixo girava para sempre, travando o motor inteiro
    const nomes = {
      dom: 0, domingo: 0, seg: 1, segunda: 1, ter: 2, terca: 2, 'terça': 2, qua: 3, quarta: 3,
      qui: 4, quinta: 4, sex: 5, sexta: 5, sab: 6, 'sáb': 6, sabado: 6, 'sábado': 6
    };
    const dia = (x) => nomes[String(x || '').replace(/\./g, '').trim()];
    let dias = new Set();
    if (m[1] === 'todos') dias = new Set([0, 1, 2, 3, 4, 5, 6]);
    else if (m[1].includes('-')) {
      const [a, b] = m[1].split('-').map(dia);
      if (a == null || b == null) return true;   // dia irreconhecível: não bloqueia a automação
      for (let d = a, voltas = 0; voltas < 7; d = (d + 1) % 7, voltas++) { dias.add(d); if (d === b) break; }
    } else m[1].split(',').forEach(x => { const d = dia(x); if (d != null) dias.add(d); });
    // horário de Brasília (UTC-3, sem horário de verão)
    const agora = new Date(Date.now() - 3 * 3600000);
    const minutos = agora.getUTCHours() * 60 + agora.getUTCMinutes();
    return dias.has(agora.getUTCDay()) && minutos >= (+m[2] * 60 + +m[3]) && minutos <= (+m[4] * 60 + +m[5]);
  } catch (e) { return true; }
}

async function condicaoPassa(cond, conversa, texto) {
  const t = String(texto || '').toLowerCase();
  switch (cond.tipo) {
    case 'contem_texto':
      return String(cond.valor || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean).some(p => t.includes(p));
    case 'nao_contem':
      return !String(cond.valor || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean).some(p => t.includes(p));
    case 'primeira_mensagem': {
      const rows = await db.select(`mensagens?conversa_id=eq.${conversa.id}&direcao=eq.entrada&select=id&limit=2`);
      return (rows || []).length <= 1;
    }
    case 'fora_horario': return !dentroDoHorario(cond.valor);
    case 'dentro_horario': return dentroDoHorario(cond.valor);
    case 'sem_departamento': return !idsDeDepartamento(conversa).length;
    case 'departamento': {
      // chat-v14a: a conversa pode estar em vários departamentos — vale se ALGUM tem o nome
      const ids = idsDeDepartamento(conversa);
      if (!ids.length) return false;
      const ds = await db.select(`departamentos?id=in.(${ids.join(',')})&select=nome`);
      const nome = String(cond.valor || '').trim().toLowerCase();
      return (ds || []).some(d => (d.nome || '').toLowerCase() === nome);
    }
    case 'individual': return conversa.tipo !== 'grupo';
    case 'grupo': return conversa.tipo === 'grupo';
    default: return true;
  }
}

async function executarAcao(acao, conversa) {
  const v = String(acao.valor || '').trim();
  if (acao.tipo === 'enviar_mensagem') {
    const nome = (conversa.nome || '').startsWith('Contato ') ? 'tudo bem' : (conversa.nome || '').split(/\s+/)[0];
    await db.insert('mensagens', [{
      conversa_id: conversa.id, direcao: 'saida', tipo: 'texto',
      texto: v.replace(/\{\{\s*nome\s*\}\}/gi, nome), status: 'pendente'
    }]);
  } else if (acao.tipo === 'aplicar_tag') {
    const tags = Array.from(new Set([...(conversa.tags || []), v]));
    await db.patch(`conversas?id=eq.${conversa.id}`, { tags });
    conversa.tags = tags;
    try { // garante a tag no catálogo (idempotente)
      const ja = await db.select(`tags?nome=eq.${encodeURIComponent(v)}&select=id&limit=1`);
      if (!ja.length) await db.insert('tags', [{ nome: v }]);
    } catch (e) {}
  } else if (acao.tipo === 'delegar_departamento' || acao.tipo === 'acrescentar_departamento') {
    // delegar = SUBSTITUI (as automações já gravadas contam com isso e precisam poder MOVER
    // a conversa, ex.: fora do horário → Plantão); acrescentar = UNIÃO (mantém os outros).
    const ds = await db.select(`departamentos?select=id,nome`);
    const d = (ds || []).find(x => x.nome.toLowerCase() === v.toLowerCase());
    if (!d) throw new Error('departamento não encontrado: ' + v);
    const atuais = acao.tipo === 'acrescentar_departamento' ? await departamentosAtuais(conversa) : [];
    await gravarDepartamentos(conversa, atuais.includes(d.id) ? atuais : atuais.concat(d.id));
  } else if (acao.tipo === 'delegar_atendente') {
    const ps = await db.select(`perfis?ativo=is.true&select=id,nome`);
    const p = (ps || []).find(x => (x.nome || '').toLowerCase().startsWith(v.toLowerCase()));
    if (p) {
      await db.patch(`conversas?id=eq.${conversa.id}`, { responsavel: p.id });
      await db.insert('notificacoes', [{ perfil_id: p.id, tipo: 'delegacao', conversa_id: conversa.id, texto: `🤖 Automação delegou ${conversa.nome} para você` }]);
    } else throw new Error('atendente não encontrado: ' + v);
  } else if (acao.tipo === 'mudar_status') {
    // resolvido/fechado arquivam; status em aberto devolve à caixa (o banco aplica o mesmo por gatilho, chat-v15a)
    const st = v || 'em_atendimento';
    await db.patch(`conversas?id=eq.${conversa.id}`, { status: st, arquivada: st === 'resolvido' || st === 'fechado' });
  } else if (acao.tipo === 'notificar') {
    const ps = await db.select(`perfis?ativo=is.true&papel=eq.admin&select=id`);
    const linhas = (ps || []).map(p => ({ perfil_id: p.id, tipo: 'aviso', conversa_id: conversa.id, texto: `🤖 ${v.replace(/\{\{\s*nome\s*\}\}/gi, conversa.nome)}` }));
    if (linhas.length) await db.insert('notificacoes', linhas);
  } else if (acao.tipo === 'enquete_departamentos') {
    const ds = await db.select('departamentos?select=nome&order=nome.asc');
    const opcoes = (ds || []).map(x => x.nome);
    if (!opcoes.length) throw new Error('nenhum departamento cadastrado para a enquete');
    await enviarEnquete(conversa, v || 'Com qual setor você quer falar? Toque numa opção 👇', opcoes, 'departamentos');
  } else if (acao.tipo === 'criar_lead') {
    if (!conversa.lead_id && conversa.tipo !== 'grupo' && !String(conversa.telefone).startsWith('lid-')) {
      const novo = await db.insert('leads', [{ nome: conversa.nome, telefone: conversa.telefone, origem: 'WhatsApp', etapa: 'Novo' }]);
      if (novo && novo[0]) await db.patch(`conversas?id=eq.${conversa.id}`, { lead_id: novo[0].id });
    }
  }
}

/* ---------- pausa de cadência ---------- */
/* O lead respondeu → cala a cadência. Isto vive AQUI, e não no navegador, porque
   o gancho do front (js/cloud.js) só roda com alguém de aba aberta e visível:
   resposta que chega de madrugada ou no fim de semana nunca era vista, e o
   follow-up disparava assim mesmo. O motor vê toda mensagem, 24/7. */
let _fuMsgOk = null;   // a migração crm-v2 (followups.msg_id) foi rodada?

async function pausarCadencia(conversa) {
  const leadId = conversa && conversa.lead_id;
  if (!leadId) return 0;   // conversa sem lead vinculado: não há cadência para parar

  if (_fuMsgOk === null) {
    try { await db.select('followups?select=msg_id&limit=1'); _fuMsgOk = true; }
    catch (e) { _fuMsgOk = false; }
    if (!_fuMsgOk) log('⚠️ followups.msg_id não existe — rode nuvem/crm-v2.sql no Supabase, ' +
                       'senão as mensagens de cadência continuarão sendo enviadas depois da resposta');
  }
  if (!_fuMsgOk) return 0;

  try {
    const pend = await db.select(`followups?lead_id=eq.${leadId}&status=eq.pendente&select=id,msg_id`);
    if (!pend || !pend.length) return 0;

    // ORDEM IMPORTA: primeiro tira as mensagens da fila (é só isto que o motor lê para
    // enviar), só depois marca os follow-ups. Se invertesse e o segundo passo falhasse,
    // o CRM mostraria "cancelado" enquanto o WhatsApp continuaria disparando — que é
    // exatamente o bug que este bloco existe para corrigir.
    const msgIds = pend.map(f => f.msg_id).filter(Boolean);
    if (msgIds.length) {
      // cancela em vez de apagar (fica o histórico do que deixou de ir); a fila só lê pendente/agendada
      const filtro = `mensagens?id=in.(${msgIds.join(',')})&status=eq.agendada`;
      try {
        await db.patch(filtro, { status: 'cancelada' });
      } catch (e) {
        if (e.code !== '23514') throw e;
        // 23514 = restrição antiga sem 'cancelada' (chat-v12a não rodou): volta a apagar como antes
        await db.del(filtro);
      }
    }
    await db.patch(`followups?lead_id=eq.${leadId}&status=eq.pendente`,
      { status: 'cancelado', motivo: 'lead respondeu no WhatsApp' });

    log(`   🤫 cadência pausada: ${pend.length} follow-up(s), ${msgIds.length} envio(s) cancelado(s)`);
    return pend.length;
  } catch (e) {
    log('erro ao pausar cadência:', e.message);
    return 0;
  }
}

/* ---------- departamentos da conversa (chat-v14a: LISTA) ----------
   departamento_ids é a verdade; departamento_id é o espelho do 1º (o banco
   mantém os dois por gatilho). Sem a migração, só existe o campo antigo. */
let temDeptos = false;   // conversas.departamento_ids existe? (sondado na subida e na rechecagem)
const idsDeDepartamento = c => Array.isArray(c && c.departamento_ids)
  ? c.departamento_ids.filter(Boolean)
  : (c && c.departamento_id ? [c.departamento_id] : []);
/* lê do banco AGORA: o objeto `conversa` foi capturado vários awaits antes e
   um colega (ou outra automação) pode ter mexido na lista nesse meio-tempo */
async function departamentosAtuais(conversa) {
  if (!temDeptos) return idsDeDepartamento(conversa);
  try {
    const r = await db.select(`conversas?id=eq.${conversa.id}&select=departamento_id,departamento_ids&limit=1`);
    if (r && r[0]) { conversa.departamento_ids = r[0].departamento_ids; conversa.departamento_id = r[0].departamento_id; }
  } catch (e) {}
  return idsDeDepartamento(conversa);
}
/* grava a lista (e o espelho). Coluna desconhecida no CORPO volta do PostgREST
   como 400 PGRST204 (não 42703): desliga a flag e reenvia uma vez só com o
   campo antigo — nunca um 400 por ação. */
async function gravarDepartamentos(conversa, ids, extra) {
  ids = Array.from(new Set((ids || []).filter(Boolean)));
  const base = Object.assign({}, extra || {}, { departamento_id: ids[0] || null });
  if (temDeptos) {
    try {
      await db.patch(`conversas?id=eq.${conversa.id}`, Object.assign({ departamento_ids: ids }, base));
      conversa.departamento_ids = ids; conversa.departamento_id = ids[0] || null;
      return;
    } catch (e) {
      if (!(e.status === 400 && (e.code === 'PGRST204' || e.code === '42703'))) throw e;
      temDeptos = false;
      log('ℹ️ departamento_ids não existe no banco — rode nuvem/chat-v14a.sql (um departamento por conversa até lá)');
    }
  }
  await db.patch(`conversas?id=eq.${conversa.id}`, base);
  if (ids.length > 1) log('ℹ️ sem chat-v14a: conv', idCurto(conversa.id), 'ficou só com o 1º de', ids.length, 'departamentos — rode nuvem/chat-v14a.sql');
  conversa.departamento_id = ids[0] || null;
  conversa.departamento_ids = ids[0] ? [ids[0]] : [];
}
async function sondarDeptos(aviso) {
  if (temDeptos) return;
  try { await db.select('conversas?select=departamento_ids&limit=1'); temDeptos = true; log('🏷 vários departamentos por conversa ativos'); }
  catch (e) { if (aviso) log('ℹ️ vários departamentos por conversa desativados — rode nuvem/chat-v14a.sql no Supabase para ativar'); }
}

async function rodarAutomacoes(evento, conversa, texto) {
  if (!temAutomacoes) return;
  const autos = await carregarAutomacoes();
  for (const a of autos) {
    if (a.gatilho !== evento) continue;
    try {
      let ok = true;
      for (const cond of (a.condicoes || [])) {
        if (!(await condicaoPassa(cond, conversa, texto))) { ok = false; break; }
      }
      if (!ok) continue;
      // trava anti-repetição por conversa
      const horas = Number(a.cooldown_horas) || 12;
      const desde = new Date(Date.now() - horas * 3600000).toISOString();
      const ja = await db.select(`automacao_log?automacao_id=eq.${a.id}&conversa_id=eq.${conversa.id}&executado_em=gte.${desde}&select=id&limit=1`);
      if (ja.length) continue;
      for (const acao of (a.acoes || [])) await executarAcao(acao, conversa);
      await db.insert('automacao_log', [{
        automacao_id: a.id, conversa_id: conversa.id,
        detalhe: (a.acoes || []).map(x => x.tipo).join(', ')
      }]);
      log('🤖 automação:', a.nome, '→ conv', idCurto(conversa.id));
    } catch (e) { log('🤖 automação falhou:', a.nome, '—', e.message); }
  }
}

/* ============================================================
   ENQUETES CLICÁVEIS — o cliente toca na opção; o voto volta
   criptografado e o motor decifra e executa o roteamento
============================================================ */
let temEnquetes = false;

async function enviarEnquete(conversa, pergunta, opcoes, tipoEnquete) {
  if (!temEnquetes) throw new Error('rode nuvem/chat-v6.sql no Supabase para ativar as enquetes');
  const destino = jidDe(conversa);
  /* a linha entra ANTES do envio, já com o id: o eco da enquete não vira duplicata */
  const idWa = novoIdWa();
  const ins = await db.insert('mensagens', [{
    conversa_id: conversa.id, direcao: 'saida', tipo: 'enquete',
    texto: pergunta, status: 'enviando', externo_id: idWa,
    enquete: { pergunta, opcoes, tipo: tipoEnquete || 'geral', secret: '', votos: {} }
  }]);   // db.insert já devolve a linha criada
  const linhaId = ins && ins[0] && ins[0].id;
  let r;
  try {
    r = await sock.sendMessage(destino, { poll: { name: pergunta, values: opcoes, selectableCount: 1 } }, { messageId: idWa });
  } catch (e) {
    if (linhaId) await db.patch(`mensagens?id=eq.${linhaId}`, { status: 'erro', erro: erroDeEnvioLegivel(e) });
    throw e;
  }
  const secret = r && r.message && r.message.messageContextInfo && r.message.messageContextInfo.messageSecret;
  if (linhaId) await db.patch(`mensagens?id=eq.${linhaId}`, {
    status: 'enviada', externo_id: (r && r.key && r.key.id) || idWa,
    enquete: {
      pergunta, opcoes, tipo: tipoEnquete || 'geral',
      secret: secret ? Buffer.from(secret).toString('base64') : '',
      votos: {}
    }
  });
  await db.patch(`conversas?id=eq.${conversa.id}`, { ultima_msg: ('📊 ' + pergunta).slice(0, 120), ultima_msg_em: new Date().toISOString() });
  log('📊 enquete enviada → conv', idCurto(conversa.id), '(' + opcoes.length + ' opções)');
}

/* voto recebido: decifra, registra e roteia se for enquete de departamentos */
async function aoReceberVoto(msg) {
  try {
    const pu = msg.message.pollUpdateMessage;
    const alvoId = pu.pollCreationMessageKey && pu.pollCreationMessageKey.id;
    if (!alvoId) return;
    const rows = await db.select(`mensagens?externo_id=eq.${encodeURIComponent(alvoId)}&tipo=eq.enquete&select=id,conversa_id,enquete&limit=1`);
    if (!rows.length || !rows[0].enquete || !rows[0].enquete.secret) return;
    const reg = rows[0];
    const e = reg.enquete;

    // decifra o voto — contas no formato novo (LID) criptografam com a identidade LID,
    // então testamos todas as combinações criador × votante (LID e número)
    const criadores = [];
    try { if (sock.user.lid) criadores.push(jidNormalizedUser(sock.user.lid)); } catch (err) {}
    criadores.push(jidNormalizedUser(sock.user.id));

    const base = [msg.key.participant, msg.key.remoteJid, msg.key.participantAlt, msg.key.remoteJidAlt].filter(Boolean);
    const votantes = new Set(base.map(j => jidNormalizedUser(j)));
    const mapa = sock.signalRepository && sock.signalRepository.lidMapping;
    for (const vj of Array.from(votantes)) {
      try {
        if (mapa && vj.endsWith('@lid') && mapa.getPNForLID) {
          const pn = await mapa.getPNForLID(vj);
          if (pn) votantes.add(jidNormalizedUser(pn));
        }
        if (mapa && vj.endsWith('@s.whatsapp.net') && mapa.getLIDForPN) {
          const l = await mapa.getLIDForPN(vj);
          if (l) votantes.add(jidNormalizedUser(l));
        }
      } catch (err) {}
    }

    let voto = null;
    busca:
    for (const criador of criadores) {
      for (const voterJid of votantes) {
        try {
          voto = decryptPollVote(pu.vote, {
            pollCreatorJid: criador, pollMsgId: alvoId,
            pollEncKey: Buffer.from(e.secret, 'base64'), voterJid
          });
          if (voto) break busca;
        } catch (err) {}
      }
    }
    if (!voto) {
      log('🗳 não consegui decifrar o voto · criadores=' + criadores.map(fimTel).join(',') + ' votantes=' + Array.from(votantes).map(fimTel).join(','));
      return;
    }

    // opções selecionadas vêm como hash sha256 do texto da opção
    const hashes = (voto.selectedOptions || []).map(h => Buffer.from(h).toString('hex'));
    const escolha = (e.opcoes || []).find(op =>
      hashes.includes(crypto.createHash('sha256').update(Buffer.from(op)).digest('hex')));

    const votante = String((msg.key.participant || msg.key.remoteJid || '')).split('@')[0];
    const anterior = (e.votos || {})[votante];
    e.votos = e.votos || {};
    if (escolha) e.votos[votante] = escolha; else delete e.votos[votante];
    await db.patch(`mensagens?id=eq.${reg.id}`, { enquete: e });
    log('🗳 voto:', escolha ? 'registrado' : '(removido)', 'de', fimTel(votante), '· enquete', idCurto(reg.id));

    // enquete de departamentos: delega a conversa e confirma para o cliente.
    // Individual: troca o setor que ESTE votante tinha escolhido antes pelo novo e
    // mantém os que o time marcou. Grupo: o último voto manda na lista inteira
    // (um setor por participante acumularia três departamentos e três confirmações).
    if (escolha && escolha !== anterior && e.tipo === 'departamentos') {
      const ds = await db.select('departamentos?select=id,nome');
      const d = (ds || []).find(x => x.nome.toLowerCase() === escolha.toLowerCase());
      if (d) {
        const cr = await db.select(`conversas?id=eq.${reg.conversa_id}&select=id,tipo,departamento_id${temDeptos ? ',departamento_ids' : ''}&limit=1`);
        const conv = (cr && cr[0]) || { id: reg.conversa_id };
        let ids = [d.id];
        if (conv.tipo !== 'grupo') {
          const dAnt = anterior ? (ds || []).find(x => x.nome.toLowerCase() === String(anterior).toLowerCase()) : null;
          // o setor escolhido vai para a FRENTE: vira o espelho departamento_id (e, sem a
          // migração, é o único campo gravado) — coerente com a confirmação enviada ao cliente
          ids = [d.id].concat(idsDeDepartamento(conv).filter(x => x !== d.id && (!dAnt || x !== dAnt.id)));
        }
        await gravarDepartamentos(conv, ids, { status: 'aberto' });
        await db.insert('mensagens', [{
          conversa_id: reg.conversa_id, direcao: 'saida', tipo: 'texto', status: 'pendente',
          texto: `✅ Perfeito! Você foi direcionado para *${d.nome}*. Um momento que já vamos te atender. 🙌`
        }]);
        const ps = await db.select('perfis?ativo=is.true&papel=eq.admin&select=id');
        const notas = (ps || []).map(p => ({ perfil_id: p.id, tipo: 'aviso', conversa_id: reg.conversa_id, texto: `🗳 Cliente escolheu ${d.nome} na enquete` }));
        if (notas.length) await db.insert('notificacoes', notas);
        log('🗳→🏷 conversa delegada ao departamento', d.nome);
      }
    }
  } catch (err) { log('erro no voto da enquete:', err.message); }
}

/* ---------- comandos do CRM (grupos, fotos, transcrição, usuários) ---------- */
const jidsDeTelefones = tels => (tels || [])
  .map(t => String(t).replace(/\D/g, ''))
  .filter(t => t.length >= 8)
  .map(t => t + '@s.whatsapp.net');

/* alçada mínima para comandos de WhatsApp — mesma regra do pode() do front
   (js/views-chat.js): admin → sim; permissão própria → sim; permissão de um
   departamento dele → sim; nada configurado → vale o padrão.
   A regra completa (modelos de alçada + visibilidade da conversa) chega na Onda 1. */
const PERM_PADRAO = new Set(['conversas_criar', 'conversas_delegar', 'msg_enviar', 'msg_midia', 'msg_agendar',
  'msg_encaminhar', 'notas_criar', 'notas_apagar', 'tags_aplicar', 'rr_usar', 'ia_analise', 'ia_transcrever',
  'ver_kanban', 'ver_dashboard', 'acesso_crm']);
const PERM_DO_COMANDO = {
  criar_grupo: 'grupos_criar', grupo_add: 'grupos_membros', grupo_remover: 'grupos_membros',
  grupo_membros: 'grupos_membros', transcrever: 'ia_transcrever', reagir: 'msg_enviar',
  atualizar_foto: 'msg_enviar', apagar_mensagem: 'msg_apagar',
  ia_resumo: 'ia_analise', ia_pergunta: 'ia_analise', ia_analise: 'ia_analise', ia_automacao: 'automacoes_editar'
};
const ACAO_DO_COMANDO = {
  criar_grupo: 'criar grupos', grupo_add: 'adicionar membros ao grupo', grupo_remover: 'remover membros do grupo',
  grupo_membros: 'atualizar os membros do grupo', transcrever: 'transcrever áudios', reagir: 'reagir a mensagens',
  atualizar_foto: 'atualizar a foto do contato', apagar_mensagem: 'apagar esta mensagem',
  ia_resumo: 'resumir conversas com IA', ia_pergunta: 'buscar na conversa com IA', ia_analise: 'analisar conversas com IA', ia_automacao: 'criar automações com IA'
};
/* comandos que não precisam do WhatsApp: gestão de usuários e a IA do escritório. Rodam
   desconectados e não expiram pela regra dos 10 min sem conexão. */
const COMANDOS_SEM_WHATSAPP = new Set(['criar_usuario', 'excluir_usuario', ...ia.TIPOS]);

/* perfil + departamentos do autor do comando; null = autor ausente ou inativo */
async function alcadaDe(autorId) {
  if (!autorId) return null;
  const id = encodeURIComponent(autorId);
  let rows, alcadas = true;
  try {
    rows = await db.select(`perfis?id=eq.${id}&select=papel,ativo,permissoes,departamento_id,departamento_ids`);
  } catch (e) {
    // 42703 = coluna inexistente: chat-v8 (alçadas) não rodou → só exige perfil ativo, como o front pré-migração
    if (e.code !== '42703') throw e;
    rows = await db.select(`perfis?id=eq.${id}&select=papel,ativo`);
    alcadas = false;
  }
  const perfil = rows && rows[0];
  if (!perfil || !perfil.ativo) return null;
  const ids = (perfil.departamento_ids && perfil.departamento_ids.length) ? perfil.departamento_ids
    : (perfil.departamento_id ? [perfil.departamento_id] : []);
  let deptos = [];
  if (alcadas && ids.length) {
    const ds = await db.select('departamentos?select=id,permissoes');
    deptos = (ds || []).filter(d => ids.includes(d.id));
  }
  return { perfil, deptos, alcadas };
}

/* mesma regra de visibilidade da conversa que a RLS conversas_ler (chat-v15b): admin,
   departamento em comum, responsável ou alçada conversas_todas. Sem alçadas (pré chat-v8): vê. */
function podeVerConversaMotor(a, autorId, c) {
  if (!a) return false;
  if (!a.alcadas || a.perfil.papel === 'admin') return true;
  if (c && c.responsavel && c.responsavel === autorId) return true;
  const ids = (c && c.departamento_ids && c.departamento_ids.length) ? c.departamento_ids : (c && c.departamento_id ? [c.departamento_id] : []);
  if (ids.some(id => a.deptos.some(d => d.id === id))) return true;
  return podeAutor(a, 'conversas_todas');
}

function podeAutor(a, chave) {
  if (!a) return false;
  if (!a.alcadas) return true;                       // pré chat-v8: igual ao front
  if (a.perfil.papel === 'admin') return true;
  const proprias = a.perfil.permissoes || {};
  if (proprias[chave]) return true;
  if (a.deptos.some(d => d.permissoes && d.permissoes[chave])) return true;
  const nadaConfigurado = !Object.keys(proprias).length &&
    !a.deptos.some(d => d.permissoes && Object.keys(d.permissoes).length);
  return nadaConfigurado && PERM_PADRAO.has(chave);
}

let processandoComandos = false;
let _expirouComandosEm = 0;
async function processarComandos() {
  if (processandoComandos) return;
  const whatsappOk = !!sock && situacaoAtual === 'conectado';
  processandoComandos = true;
  try {
    // comandos de WhatsApp que esperaram mais de 10 min pela conexão expiram —
    // executar uma reação/grupo de horas atrás surpreenderia o atendente
    if (!whatsappOk && Date.now() - _expirouComandosEm > 30000) {
      _expirouComandosEm = Date.now();
      try {
        const limite = new Date(Date.now() - 10 * 60000).toISOString();
        await db.patch(`motor_comandos?status=eq.pendente&tipo=not.in.(${[...COMANDOS_SEM_WHATSAPP].join(',')})&criado_em=lt.${limite}`,
          { status: 'erro', erro: 'expirou: o WhatsApp estava desconectado — repita o comando', atualizado_em: new Date().toISOString() });
      } catch (e) { log('erro ao expirar comandos antigos:', e.message); }
    }
    // desconectado: busca só o que não precisa do WhatsApp — gestão de usuários e IA (antes,
    // 5 comandos de WhatsApp pendentes na frente da fila bloqueavam criar/excluir usuário para sempre)
    const soUsuarios = whatsappOk ? '' : `&tipo=in.(${[...COMANDOS_SEM_WHATSAPP].join(',')})`;
    const fila = await db.select(`motor_comandos?status=eq.pendente${soUsuarios}&order=criado_em.asc&limit=5&select=*`);
    for (const cmd of fila || []) {
      // comandos de WhatsApp esperam a conexão voltar; gestão de usuários e IA só usam o Supabase/Anthropic
      if (!whatsappOk && !COMANDOS_SEM_WHATSAPP.has(cmd.tipo)) continue;
      await db.patch(`motor_comandos?id=eq.${cmd.id}`, { status: 'processando', atualizado_em: new Date().toISOString() });
      let resultado = null;
      try {
        const p = cmd.payload || {};

        // alçada mínima antes de executar qualquer comando de WhatsApp
        let alcada = null;
        if (PERM_DO_COMANDO[cmd.tipo]) {
          alcada = await alcadaDe(cmd.autor);
          if (!alcada) throw new Error('sem alçada');
          // apagar_mensagem confere abaixo, junto com o autor da mensagem
          if (cmd.tipo !== 'apagar_mensagem' && !podeAutor(alcada, PERM_DO_COMANDO[cmd.tipo])) {
            throw new Error('sem alçada para ' + ACAO_DO_COMANDO[cmd.tipo]);
          }
        }

        if (cmd.tipo === 'criar_grupo') {
          const jids = jidsDeTelefones(p.telefones);
          if (!p.nome || !jids.length) throw new Error('informe nome e ao menos 1 participante');
          const g = await sock.groupCreate(p.nome, jids);
          // mesma fila da recepção: a 1ª mensagem do grupo novo não cria a conversa em dobro
          const conversa = await emSerie(g.id, () => garantirConversaGrupo(g.id));
          await db.patch(`conversas?id=eq.${conversa.id}`, { nome: p.nome });
          resultado = { conversaId: conversa.id, grupoJid: g.id };

        } else if (cmd.tipo === 'grupo_add' || cmd.tipo === 'grupo_remover') {
          const acao = cmd.tipo === 'grupo_add' ? 'add' : 'remove';
          await sock.groupParticipantsUpdate(p.grupoJid, jidsDeTelefones(p.telefones), acao);
          const rows = await db.select(`conversas?grupo_jid=eq.${encodeURIComponent(p.grupoJid)}&select=id`);
          if (rows.length) resultado = { participantes: await atualizarMembros(rows[0].id, p.grupoJid) };

        } else if (cmd.tipo === 'grupo_membros') {
          const rows = await db.select(`conversas?grupo_jid=eq.${encodeURIComponent(p.grupoJid)}&select=id`);
          if (!rows.length) throw new Error('grupo não encontrado');
          resultado = { participantes: await atualizarMembros(rows[0].id, p.grupoJid) };

        } else if (cmd.tipo === 'grupos_vistoria') {
          // só admin: percorre todos os grupos (1–2 min) e regrava as listas de participantes
          const a = await alcadaDe(cmd.autor);
          if (!a || a.perfil.papel !== 'admin') throw new Error('apenas administradores podem vistoriar os grupos');
          resultado = await vistoriarGrupos(p.aplicar !== false);

        } else if (cmd.tipo === 'atualizar_foto') {
          const rows = await db.select(`conversas?id=eq.${p.conversaId}&select=id,telefone,tipo,grupo_jid`);
          if (!rows.length) throw new Error('conversa não encontrada');
          const foto = await salvarFotoPerfil(rows[0].id, jidDe(rows[0]));
          if (!foto) throw new Error('o WhatsApp não devolveu a foto (contato sem foto ou com privacidade ativada)');
          await db.patch(`conversas?id=eq.${p.conversaId}`, { foto_url: foto });
          resultado = { foto };

        } else if (cmd.tipo === 'reagir') {
          if (!temReacoes) throw new Error('rode o arquivo nuvem/chat-v3.sql no Supabase para ativar as reações');
          const rows = await db.select(`mensagens?id=eq.${p.mensagemId}&select=id,externo_id,direcao,participante,reacoes,conversas(telefone,tipo,grupo_jid)`);
          if (!rows.length) throw new Error('mensagem não encontrada');
          const m = rows[0];
          if (!m.externo_id) throw new Error('esta mensagem ainda não tem id do WhatsApp (aguarde o envio dela)');
          const destino = jidDe(m.conversas);
          const key = { remoteJid: destino, id: m.externo_id, fromMe: m.direcao === 'saida' };
          if (m.direcao === 'entrada' && destino.endsWith('@g.us') && m.participante) key.participant = m.participante;
          await sock.sendMessage(destino, { react: { text: p.emoji || '', key } });
          const reacoes = (m.reacoes || []).filter(r => !r.minha);
          if (p.emoji) reacoes.push({ emoji: p.emoji, de: '', nome: p.autorNome || 'Atendente', minha: true });
          await db.patch(`mensagens?id=eq.${p.mensagemId}`, { reacoes });
          resultado = { reacoes };

        } else if (cmd.tipo === 'apagar_mensagem') {
          if (!temApagada) throw new Error('rode nuvem/chat-v9.sql no Supabase para ativar');
          const rows = await db.select(`mensagens?id=eq.${p.mensagemId}&select=id,externo_id,direcao,criado_em,autor,conversas(telefone,tipo,grupo_jid)`);
          if (!rows.length) throw new Error('mensagem não encontrada');
          const alvo = rows[0];
          // quem tem a alçada msg_apagar apaga qualquer mensagem enviada pela conta (dono, 05/10/2026 —
          // antes exigia ser admin ou o autor, e mensagem mandada pelo celular nem tem autor: dava "sem alçada")
          if (!podeAutor(alcada, 'msg_apagar')) throw new Error('sem alçada para ' + ACAO_DO_COMANDO.apagar_mensagem);
          if (alvo.direcao !== 'saida') throw new Error('só é possível apagar mensagens enviadas por vocês');
          if (!alvo.externo_id) throw new Error('mensagem ainda sem id do WhatsApp (aguarde o envio)');
          if (Date.now() - new Date(alvo.criado_em).getTime() > 48 * 3600000) throw new Error('o WhatsApp só permite apagar mensagens de até ~48 horas');
          const destino = jidDe(alvo.conversas);
          await sock.sendMessage(destino, { delete: { remoteJid: destino, id: alvo.externo_id, fromMe: true } });
          await db.patch(`mensagens?id=eq.${p.mensagemId}`, { apagada: true });
          resultado = { apagada: true };

        } else if (cmd.tipo === 'baixar_midia') {
          // arquivo grande sob demanda (chat-v16c): baixa do WhatsApp agora, em fluxo, e guarda 7 dias
          if (!temMidiasPendentes) throw new Error('rode nuvem/chat-v16c.sql no Supabase para ativar');
          const alc = await alcadaDe(cmd.autor);
          if (!alc) throw new Error('sem alçada');
          const rows = await db.select(`mensagens?id=eq.${encodeURIComponent(p.mensagemId)}&select=id,externo_id,conversa_id,midia_url,conversas(responsavel,departamento_id,departamento_ids)`);
          if (!rows.length) throw new Error('mensagem não encontrada');
          const alvo = rows[0];
          // o link do bucket é público: só quem enxerga a conversa (mesma regra da RLS conversas_ler) pode pedir
          if (!podeVerConversaMotor(alc, cmd.autor, alvo.conversas)) throw new Error('sem alçada para ver esta conversa');
          if (alvo.midia_url) {
            resultado = { url: alvo.midia_url };
          } else {
            const pend = alvo.externo_id ? await db.select(`midias_pendentes?externo_id=eq.${encodeURIComponent(alvo.externo_id)}&select=*`) : [];
            if (!pend.length) throw new Error('este arquivo não está mais disponível para baixar (chegou antes da atualização ou a referência de 90 dias expirou) — peça ao contato para reenviar');
            const pd = pend[0];
            const chaveNo = { arquivo: 'documentMessage', video: 'videoMessage', imagem: 'imageMessage', audio: 'audioMessage', figurinha: 'stickerMessage' }[pd.tipo] || 'documentMessage';
            const falsa = { key: pd.key, message: { [chaveNo]: reviverNoDeMidia(pd.no) } };
            // em segundo plano: um .zip de 137 MB leva minutos e não pode prender reagir/apagar/
            // transcrever na fila. O comando fica 'processando' e a tarefa fecha com ok/erro (uma por vez).
            resultado = EM_SEGUNDO_PLANO;
            _filaGrandes = _filaGrandes.then(() => baixarGrande(cmd, alvo, pd, falsa)).catch(() => {});
          }

        } else if (cmd.tipo === 'criar_usuario') {
          // segurança: o comando roda com a chave mestra — só admin ativo pode pedir
          const quem = cmd.autor ? await db.select(`perfis?id=eq.${cmd.autor}&select=papel,ativo`) : [];
          if (!quem.length || quem[0].papel !== 'admin' || !quem[0].ativo) {
            throw new Error('apenas administradores ativos podem criar usuários');
          }
          const email = String(p.email || '').trim().toLowerCase();
          const senha = String(p.senha || '');
          const nome = String(p.nome || '').trim();
          const papel = p.papel === 'admin' ? 'admin' : 'atendente';
          // apaga a senha do payload gravado no banco (o resto do time não deve lê-la)
          await db.patch(`motor_comandos?id=eq.${cmd.id}`, { payload: Object.assign({}, p, { senha: '(oculta)' }) });
          if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('informe um e-mail válido');
          if (senha.length < 8) throw new Error('a senha provisória precisa ter ao menos 8 caracteres');
          if (!nome) throw new Error('informe o nome do novo usuário');
          const novo = await db.criarUsuarioAuth(email, senha, nome);
          // o gatilho ao_criar_usuario já cria a linha em perfis; aqui garantimos os dados certos
          const perfil = { id: novo.id, nome, email, papel, ativo: true };
          if (Array.isArray(p.departamento_ids) && p.departamento_ids.length) perfil.departamento_ids = p.departamento_ids;
          await db.upsert('perfis', [perfil]);
          resultado = { userId: novo.id, email, papel };

        } else if (cmd.tipo === 'excluir_usuario') {
          // segurança: roda com a chave mestra — só admin ativo pode pedir
          const quem = cmd.autor ? await db.select(`perfis?id=eq.${cmd.autor}&select=papel,ativo`) : [];
          if (!quem.length || quem[0].papel !== 'admin' || !quem[0].ativo) {
            throw new Error('apenas administradores ativos podem excluir usuários');
          }
          const alvoId = String(p.perfilId || '');
          if (!alvoId) throw new Error('usuário não informado');
          if (alvoId === cmd.autor) throw new Error('você não pode excluir o seu próprio usuário');
          const alvoR = await db.select(`perfis?id=eq.${alvoId}&select=id,nome,email,papel`);
          if (!alvoR.length) throw new Error('usuário não encontrado');
          const alvo = alvoR[0];
          if (alvo.papel === 'admin') {
            const outros = await db.select(`perfis?papel=eq.admin&ativo=is.true&id=neq.${alvoId}&select=id&limit=1`);
            if (!outros.length) throw new Error('não é possível excluir o último administrador ativo');
          }
          try {
            await db.excluirUsuarioAuth(alvoId);      // o cascade auth.users -> perfis limpa o perfil junto
          } catch (e) {
            if (/foreign key|violates|23503/i.test(String(e.message))) {
              throw new Error('este usuário é dono de leads ou registros no CRM — reatribua-os primeiro, ou apenas desative o acesso');
            }
            throw e;
          }
          try { await db.del(`perfis?id=eq.${alvoId}`); } catch (e) {} // garantia extra se não houver cascade
          resultado = { excluido: alvoId, email: alvo.email };
          log('🗑 usuário excluído: ' + (alvo.email || alvoId));

        } else if (cmd.tipo === 'transcrever') {
          if (!midia.transcricaoDisponivel()) throw new Error('transcrição não configurada — defina GROQ_API_KEY nas variáveis do Railway');
          const rows = await db.select(`mensagens?id=eq.${p.mensagemId}&select=id,midia_url,midia_mime`);
          if (!rows.length || !rows[0].midia_url) throw new Error('áudio não encontrado');
          const buf = await midia.baixarUrl(rows[0].midia_url);
          const t = await midia.transcrever(buf, rows[0].midia_mime);
          await db.patch(`mensagens?id=eq.${p.mensagemId}`, { transcricao: t || '(sem fala reconhecível)' });
          resultado = { transcricao: t };

        } else if (ia.TIPOS.includes(cmd.tipo)) {
          // IA do escritório: valida agora (admin no teste, chave, tamanho, conversa visível,
          // limite por hora) e chama a Anthropic em segundo plano — ver prepararIA/executarIA
          resultado = await prepararIA(cmd, p, alcada);

        } else {
          throw new Error('comando desconhecido: ' + cmd.tipo);
        }

        if (resultado === EM_SEGUNDO_PLANO) { log('⚙️ comando em segundo plano:', cmd.tipo); continue; }
        // o comando JÁ foi executado: se gravar o 'ok' falhar, repete depois (não vira 'erro' nem fica preso)
        const corpoOk = { status: 'ok', resultado, erro: '', atualizado_em: new Date().toISOString() };
        try { await db.patch(`motor_comandos?id=eq.${cmd.id}`, corpoOk); }
        catch (e) { reaplicarDepois('comando ' + idCurto(cmd.id) + ' → ok', () => db.patch(`motor_comandos?id=eq.${cmd.id}&status=eq.processando`, corpoOk)); }
        log('⚙️ comando ok:', cmd.tipo);
      } catch (e) {
        const corpoErro = { status: 'erro', erro: String(e.message || e).slice(0, 200), atualizado_em: new Date().toISOString() };
        try { await db.patch(`motor_comandos?id=eq.${cmd.id}`, corpoErro); }
        catch (e2) { reaplicarDepois('comando ' + idCurto(cmd.id) + ' → erro', () => db.patch(`motor_comandos?id=eq.${cmd.id}&status=eq.processando`, corpoErro)); }
        log('⚙️ comando falhou:', cmd.tipo, e.message);
      }
    }
  } catch (e) { log('erro nos comandos:', e.message); }
  processandoComandos = false;
}

/* ---------- conexão com o WhatsApp ---------- */
/* reconexão com trava: nunca existem 2 sockets nem 2 reconexões agendadas
   (antes cada queda agendava um conectar() novo e o socket velho seguia vivo —
   eventos em dobro e o WhatsApp derrubando a sessão com 440) */
let reconectando = false;          // há reconexão agendada OU conectar() em andamento
let conectando = false;
let timerReconexao = null;
const RECUO_INICIAL = 5000, RECUO_MAX = 300000;
let recuoMs = RECUO_INICIAL;       // recuo crescente: 5 s → 10 → 20 → 40 → 80 → 160 → 300 s (zera ao conectar)

/* ms = espera fixa; sem ms = usa (e dobra) o recuo crescente */
function agendarReconexao(ms, motivo) {
  if (reconectando) return;        // já há uma a caminho
  reconectando = true;
  let espera = ms;
  if (espera == null) { espera = recuoMs; recuoMs = Math.min(recuoMs * 2, RECUO_MAX); }
  log('🔁 nova conexão em ' + Math.round(espera / 1000) + ' s (' + motivo + ')');
  timerReconexao = setTimeout(() => {
    timerReconexao = null;
    reconectando = false;
    conectar();
  }, espera);
}

/* desliga o socket anterior: sem ouvintes (não agenda outra reconexão) e fechado */
function encerrarSocket() {
  const velho = sock;
  sock = null;
  if (!velho) return;
  try { velho.ev.removeAllListeners(); } catch (e) {}
  try { if (typeof velho.end === 'function') velho.end(undefined); } catch (e) {}
  try { if (velho.ws && typeof velho.ws.close === 'function') velho.ws.close(); } catch (e) {}
}

/* promessa com prazo: a consulta de versão do WhatsApp Web às vezes pendura */
/* ---------- arquivo grande sob demanda (chat-v16c) ----------
   roda fora da fila de comandos (um de cada vez); fecha o comando com ok/erro sozinho */
const EM_SEGUNDO_PLANO = Symbol('comando em segundo plano');
let _filaGrandes = Promise.resolve();
async function baixarGrande(cmd, alvo, pd, falsa) {
  const fechar = async corpo => {
    const dados = Object.assign({ atualizado_em: new Date().toISOString() }, corpo);
    try { await db.patch(`motor_comandos?id=eq.${cmd.id}`, dados); }
    catch (e) { reaplicarDepois('comando ' + idCurto(cmd.id) + ' → ' + corpo.status, () => db.patch(`motor_comandos?id=eq.${cmd.id}&status=eq.processando`, dados)); }
  };
  const ctrl = new AbortController();
  let fluxo = null, caminho = null;
  const silencioso = { logger: pino({ level: 'silent' }) };
  try {
    // outro pedido (clique repetido, colega) pode ter baixado enquanto este esperava na fila: devolve o link
    const ja = await db.select(`mensagens?id=eq.${encodeURIComponent(alvo.id)}&select=midia_url`);
    if (ja[0] && ja[0].midia_url) { await fechar({ status: 'ok', resultado: { url: ja[0].midia_url }, erro: '' }); return; }
    log('📦 baixando arquivo grande sob demanda (' + Math.round(pd.tamanho / 1048576) + ' MB, ' + idCurto(pd.externo_id) + ')');
    try {
      fluxo = await comPrazo(downloadMediaMessage(falsa, 'stream', {}, Object.assign({
        // lido só na hora: se o WhatsApp caiu enquanto o pedido esperava, erro claro em vez de TypeError
        reuploadRequest: m => { if (!sock) throw new Error('WhatsApp desconectado — tente baixar de novo em instantes'); return sock.updateMediaMessage(m); }
      }, silencioso)), 2 * 60000);
    } catch (e) {
      const st = (e && e.output && e.output.statusCode) || (e && (e.statusCode || e.status));
      const msg = String((e && e.message) || e);
      if (st === 404 || st === 410 || st === 403) {
        // a mídia saiu do servidor do WhatsApp: pede ao celular do escritório para subir de novo e tenta mais uma vez
        try {
          if (sock && sock.updateMediaMessage) await comPrazo(sock.updateMediaMessage(falsa), 60000);
          fluxo = await comPrazo(downloadMediaMessage(falsa, 'stream', {}, silencioso), 2 * 60000);
        } catch (e2) { throw new Error('o WhatsApp não tem mais este arquivo (expirou no servidor deles) — peça ao contato para reenviar'); }
      } else if (/empty media key|no valid media url|not a media message/i.test(msg)) {
        throw new Error('a referência guardada deste arquivo está incompleta — peça ao contato para reenviar');
      } else if (/tempo esgotado/.test(msg)) {
        throw new Error('o download do WhatsApp demorou demais — tente de novo em instantes');
      } else throw e;
    }
    const ext = (pd.nome && pd.nome.includes('.')) ? pd.nome.split('.').pop().replace(/[^a-z0-9]/gi, '').slice(0, 6) : midia.extDoMime(pd.mime);
    caminho = `${pd.conversa_id}/${midia.nomeArquivo(ext)}`;
    const url = await comPrazo(midia.subirStream('midias-grandes', caminho, fluxo, pd.mime, ctrl.signal), 15 * 60000);
    await db.patch(`mensagens?id=eq.${encodeURIComponent(alvo.id)}`, { midia_url: url });
    await db.patch(`midias_pendentes?externo_id=eq.${encodeURIComponent(pd.externo_id)}`, { caminho, baixado_em: new Date().toISOString() });
    log('📦 arquivo grande no Storage (' + idCurto(pd.externo_id) + ') — some em 7 dias');
    await fechar({ status: 'ok', resultado: { url }, erro: '' });
  } catch (e) {
    // encerra de verdade o que ficou pendurado e não deixa objeto parcial no bucket
    ctrl.abort();
    if (fluxo && typeof fluxo.destroy === 'function') { try { fluxo.destroy(); } catch (x) {} }
    if (caminho) { try { await midia.apagarObjeto('midias-grandes', caminho); } catch (x) {} }
    log('⚙️ download grande falhou:', e.message);
    await fechar({ status: 'erro', erro: String(e.message || e).slice(0, 200) });
  }
}

/* nó de mídia guardado em midias_pendentes → objeto que o downloadMediaMessage aceita
   (mediaKey e hashes de volta a Buffer; o resto fica como veio) */
/* ---------- IA do escritório (spec: nuvem/PLANO-IA-ESCRITORIO.md) ----------
   A fila só valida e devolve EM_SEGUNDO_PLANO: a chamada à Anthropic leva de 5 a 60 s e não
   pode prender reagir/grupos/transcrição. Até IA_PARALELO chamadas ao mesmo tempo; as demais
   esperam a vaga. O comando fecha com ok/erro por conta própria (mesmo padrão de baixarGrande). */
const IA_LIMITE_HORA = 40;
const IA_PARALELO = 3;
let _iaEmVoo = 0;
const _iaEspera = [];   // quem aguarda vaga
function vagaIA() {
  if (_iaEmVoo < IA_PARALELO) { _iaEmVoo++; return Promise.resolve(); }
  return new Promise(r => _iaEspera.push(r)).then(() => { _iaEmVoo++; });
}
function soltarVagaIA() {
  _iaEmVoo--;
  const prox = _iaEspera.shift();
  if (prox) prox();
}
/* roda DENTRO da fila: tudo o que pode recusar na hora. `alcada` já veio de PERM_DO_COMANDO
   (null só no ia_teste, que exige admin). */
async function prepararIA(cmd, payload, alcada) {
  payload = payload || {};
  if (cmd.tipo === 'ia_teste') {
    const quem = cmd.autor ? await db.select(`perfis?id=eq.${encodeURIComponent(cmd.autor)}&select=papel,ativo`) : [];
    if (!quem.length || quem[0].papel !== 'admin' || !quem[0].ativo) throw new Error('apenas administradores ativos podem testar a IA');
  }
  if (!ia.disponivel()) throw new Error('IA do escritório não configurada: defina ANTHROPIC_API_KEY nas variáveis do Railway');
  ia.validarPayload(cmd.tipo, payload);
  if (payload.conversaId) {
    // mesma regra da RLS conversas_ler e do arquivo grande: só quem enxerga a conversa pede sobre ela
    const rows = await db.select(`conversas?id=eq.${encodeURIComponent(payload.conversaId)}&select=id,responsavel,departamento_id,departamento_ids`);
    if (!rows.length) throw new Error('conversa não encontrada');
    if (!podeVerConversaMotor(alcada, cmd.autor, rows[0])) throw new Error('sem alçada para ver esta conversa');
  }
  // limite por pessoa: o próprio comando já está na fila (processando), por isso o > e não >=
  const desde = new Date(Date.now() - 3600000).toISOString();
  const recentes = await db.select(`motor_comandos?autor=eq.${encodeURIComponent(cmd.autor)}&tipo=in.(${ia.TIPOS.join(',')})&criado_em=gte.${encodeURIComponent(desde)}&select=id&limit=${IA_LIMITE_HORA + 1}`);
  if ((recentes || []).length > IA_LIMITE_HORA) throw new Error(`limite de ${IA_LIMITE_HORA} pedidos de IA por hora atingido; tente mais tarde`);
  executarIA(cmd, payload).catch(() => {});
  return EM_SEGUNDO_PLANO;
}
/* roda FORA da fila. Logs sem conteúdo: só tipo, autor abreviado, modelo, tokens e duração. */
async function executarIA(cmd, payload) {
  const fechar = async corpo => {
    const dados = Object.assign({ atualizado_em: new Date().toISOString() }, corpo);
    try { await db.patch(`motor_comandos?id=eq.${cmd.id}`, dados); }
    catch (e) { reaplicarDepois('comando ' + idCurto(cmd.id) + ' → ' + corpo.status, () => db.patch(`motor_comandos?id=eq.${cmd.id}&status=eq.processando`, dados)); }
  };
  await vagaIA();
  const inicio = Date.now();
  try {
    const cfg = await configGeral(true);
    const r = await ia.executar(cmd.tipo, payload, { modelo: ia.modeloValido(cfg.modeloIA), contextoIA: cfg.contextoIA });
    await fechar({ status: 'ok', resultado: r, erro: '' });
    log('🤖 IA ' + cmd.tipo + ' · ' + idCurto(cmd.autor || '') + ' · ' + r.uso.modelo + ' · ' + r.uso.entrada + '/' + r.uso.saida + ' tokens · ' + (Date.now() - inicio) + ' ms');
  } catch (e) {
    await fechar({ status: 'erro', erro: String(e.message || e).slice(0, 200) });
    log('🤖 IA ' + cmd.tipo + ' falhou:', String(e.message || e).slice(0, 120));
  } finally { soltarVagaIA(); }
}

function reviverNoDeMidia(no) {
  let obj;
  try { obj = JSON.parse(JSON.stringify(no), BufferJSON.reviver); } catch (e) { obj = Object.assign({}, no); }
  for (const k of ['mediaKey', 'fileSha256', 'fileEncSha256', 'jpegThumbnail']) {
    if (typeof obj[k] === 'string') { try { obj[k] = Buffer.from(obj[k], 'base64'); } catch (e) {} }
  }
  return obj;
}

function comPrazo(promessa, ms) {
  let timer;
  return Promise.race([
    promessa,
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('tempo esgotado')), ms); })
  ]).finally(() => clearTimeout(timer));
}

/* gravação das credenciais: o Baileys dispara creds.update em rajada; junta as
   chamadas próximas numa só e, se o banco falhar, tenta até 5x — credencial
   perdida corrompe a sessão e obriga a ler o QR de novo. Nunca lança. */
function gravadorDeCreds(saveCreds) {
  let timer = null, gravando = false, deNovo = false, descartado = false;
  async function gravar() {
    timer = null;
    if (descartado) return;
    if (gravando) { deNovo = true; return; }
    gravando = true;
    try {
      for (let i = 1; i <= 5 && !descartado; i++) {
        try { await saveCreds(); break; }
        catch (e) {
          if (i === 5) log('⚠️ não consegui gravar as credenciais do WhatsApp após 5 tentativas:', e.message);
          else await new Promise(r => setTimeout(r, 1000 * i));
        }
      }
    } finally {
      gravando = false;
      if (deNovo && !descartado) { deNovo = false; agendar(); }
    }
  }
  function agendar() { if (!timer && !descartado) timer = setTimeout(gravar, 300); }
  // sessão encerrada: nada pendente pode regravar credenciais velhas depois da limpeza
  agendar.descartar = () => { descartado = true; if (timer) { clearTimeout(timer); timer = null; } };
  return agendar;
}

async function conectar() {
  if (conectando) return;
  conectando = true;
  reconectando = true;             // ninguém agenda outra enquanto este monta o socket
  if (timerReconexao) { clearTimeout(timerReconexao); timerReconexao = null; }
  let falha = null;
  try {
    encerrarSocket();
    const { state, saveCreds } = await useSupabaseAuthState();
    // versão do WhatsApp Web: se a consulta falhar ou demorar, o Baileys usa a embutida
    let version = null;
    try {
      const v = await comPrazo(fetchLatestBaileysVersion(), 10000);
      version = (v && v.version) || null;
    } catch (e) { log('ℹ️ versão do WhatsApp Web indisponível (' + e.message + ') — usando a embutida no Baileys'); }
    const s = makeWASocket({
      ...(version ? { version } : {}),
      auth: state,
      logger: pino({ level: 'warn' }),
      printQRInTerminal: false,
      browser: [NOME_SISTEMA, 'Chrome', '2.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false
    });
    sock = s;
    // daqui até o fim do try não há await: nenhum evento escapa antes dos ouvintes
    const salvarCreds = gravadorDeCreds(saveCreds);
    s.ev.on('creds.update', salvarCreds);

    s.ev.on('connection.update', async (u) => {
      if (sock !== s) return;      // evento atrasado de um socket já substituído
      try { await aoMudarConexao(s, u, salvarCreds); }
      catch (e) {
        log('erro no evento de conexão:', e.message);
        // a queda não pode ficar sem reconexão agendada por causa de um erro no tratamento
        if (u && u.connection === 'close') agendarReconexao(null, 'erro ao tratar a queda');
      }
    });

    s.ev.on('messages.upsert', aoReceberMensagens);
    s.ev.on('messages.update', aoAtualizarMensagens);
    s.ev.on('message-receipt.update', aoReceberRecibos);

    /* mudanças de participantes feitas pelo próprio WhatsApp → espelha no CRM */
    s.ev.on('group-participants.update', async ({ id }) => {
      try {
        const rows = await db.select(`conversas?grupo_jid=eq.${encodeURIComponent(id)}&select=id`);
        if (rows.length) await atualizarMembros(rows[0].id, id);
      } catch (e) {}
    });
  } catch (e) {
    falha = e;
  } finally {
    conectando = false;
    reconectando = false;
  }
  if (falha) {
    log('erro ao conectar ao WhatsApp:', falha.message);
    await estado('desconectado', { detalhe: 'Falha ao conectar — tentando de novo...' });
    agendarReconexao(null, 'falha ao montar a conexão');
  }
}

/* eventos de conexão do socket atual: QR, conectado, queda (com tratamento por código) */
async function aoMudarConexao(s, u, salvarCreds) {
  const { connection, lastDisconnect, qr } = u;
  if (qr) {
    // chegou a gerar QR = a rede até o WhatsApp funciona: o recuo volta ao começo
    // (o 515 logo depois da leitura do QR reconecta em 5 s, não no recuo acumulado)
    recuoMs = RECUO_INICIAL;
    const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 300 });
    await estado('aguardando_qr', { qr: dataUrl, detalhe: 'Escaneie com o WhatsApp do escritório: Configurações → Aparelhos conectados → Conectar aparelho' });
    log('🔲 QR gerado — aguardando leitura');
  }
  if (connection === 'open') {
    recuoMs = RECUO_INICIAL;     // conectou: o recuo volta ao começo
    const numero = (s.user && s.user.id ? s.user.id.split(':')[0] : '');
    await estado('conectado', { numero, detalhe: 'WhatsApp conectado e sincronizando' });
    log('✅ conectado como', fimTel(numero));
    /* mensagens presas em 'enviando' são de uma queda no meio do envio: a fila
       não as pega de novo (só pendente/agendada) e elas ficariam penduradas
       para sempre. Viram erro VISÍVEL — reenviar sozinho poderia duplicar no
       cliente, então a decisão fica com o atendente. */
    try {
      const limite = new Date(Date.now() - 2 * 60000).toISOString();
      await db.patch(
        `mensagens?status=eq.enviando&criado_em=lt.${limite}`,
        { status: 'erro', erro: 'envio interrompido por queda do motor — confira no celular se chegou antes de reenviar' }
      );
    } catch (e) {}
  }
  if (connection === 'close') {
    const codigo = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output
      ? lastDisconnect.error.output.statusCode : 0;
    const estavaNoQr = situacaoAtual === 'aguardando_qr';
    if (codigo === DisconnectReason.loggedOut) {            // 401: desconectado pelo celular
      log('🔌 sessão encerrada no celular — limpando e aguardando novo QR');
      salvarCreds.descartar();
      try { await limparSessao(); } catch (e) { log('erro ao limpar a sessão:', e.message); }
      await estado('desconectado', { detalhe: 'Sessão encerrada. Gerando novo QR Code...' });
      agendarReconexao(3000, 'sessão encerrada (401)');
    } else if (codigo === DisconnectReason.connectionReplaced) {   // 440: outra instância pegou a sessão
      log('⚠️ conexão substituída (440) — outra instância está usando esta sessão');
      await estado('erro', { detalhe: 'Outra instância do motor está usando esta sessão — confira se há dois serviços rodando no Railway.' });
      agendarReconexao(2 * 60000, 'conexão substituída (440)');
    } else if (codigo === 403 || codigo === 411) {
      // reconectar em laço depois de um banimento piora a situação: espera 30 min entre tentativas
      const detalhe = 'Possível banimento ou sessão inválida (código ' + codigo + ') — o motor NÃO vai reconectar em laço. Veja o runbook R3.';
      log('🛑 ' + detalhe);
      await estado('erro', { detalhe });
      pingHC('/fail', detalhe);
      agendarReconexao(30 * 60000, 'código ' + codigo);
    } else if (estavaNoQr && codigo === DisconnectReason.timedOut) {
      // 408 com QR na tela = o QR expirou sem leitura: gera outro logo (sem crescer o recuo),
      // senão quem abrir a tela para escanear poderia esperar até 5 min por um QR novo
      log('🔲 QR expirou sem leitura — gerando outro');
      await estado('aguardando_qr', { detalhe: 'QR Code expirado — gerando outro em instantes...' });
      agendarReconexao(RECUO_INICIAL, 'QR expirado');
    } else {
      log('conexão caiu (código', codigo + ') — reconectando...');
      await estado('desconectado', { detalhe: 'Reconectando...' });
      agendarReconexao(null, 'código ' + codigo);
    }
  }
}

/* ---------- inicialização ---------- */
/* servidor de saúde: sobe UMA vez, fora do main (que pode ser re-tentado).
   "/" responde 200 sempre (o deploy do Railway exige); "/saude" responde 503
   quando o motor está doente há mais de 5 min (exceto aguardando QR há < 5 min) */
let _servidorNoAr = false;
function iniciarServidor() {
  if (_servidorNoAr) return;
  _servidorNoAr = true;
  http.createServer((req, res) => {
    const caminho = String(req.url || '/').split('?')[0];
    if (caminho === '/saude') {
      const ok = conferirSaude();
      const agora = Date.now();
      const qrRecente = situacaoAtual === 'aguardando_qr' && aguardandoQrDesde && agora - aguardandoQrDesde < 5 * 60000;
      const doente = !ok && !!doenteDesde && agora - doenteDesde > 5 * 60000 && !qrRecente;
      res.writeHead(doente ? 503 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(doente
        ? { saudavel: false, motivo: motivoDoente(), desde: new Date(doenteDesde).toISOString() }
        : { saudavel: ok, situacao: situacaoAtual }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ motor: 'mv-motor', nome: NOME_SISTEMA, versao: 2, situacao: situacaoAtual, transcricao: midia.transcricaoDisponivel(), ia: ia.disponivel() }));
  }).listen(process.env.PORT || 3000);
}

/* re-verifica as migrações pendentes a cada 60s — ativam sozinhas, sem reiniciar o motor */
let _rechecagemAtiva = false;
function iniciarRechecagemMigracoes() {
  if (_rechecagemAtiva) return;     // main pode rodar de novo após falha: nada de timer em dobro
  _rechecagemAtiva = true;
  setInterval(async () => {
    if (!temReacoes) { try { await db.select('mensagens?select=reacoes&limit=1'); temReacoes = true; log('💫 reações ativas'); } catch (e) {} }
    if (!temCitado) { try { await db.select('mensagens?select=citado&limit=1'); temCitado = true; log('↩️ responder/encaminhar ativos'); } catch (e) {} }
    if (!temAutomacoes) { try { await db.select('automacoes?select=id&limit=1'); temAutomacoes = true; log('🤖 automações ativas'); } catch (e) {} }
    if (!temApagada) { try { await db.select('mensagens?select=apagada&limit=1'); temApagada = true; log('🚫 apagar mensagens ativo'); } catch (e) {} }
    if (!temEdicoes) { try { await db.select('mensagens?select=edicoes&limit=1'); temEdicoes = true; log('✏️ histórico de mensagens editadas ativo'); } catch (e) {} }
    if (!temSegredos) { try { await db.select('mensagens_segredos?select=externo_id&limit=1'); temSegredos = true; log('🔐 edições cifradas ativas (segredo das mensagens guardado)'); } catch (e) {} }
    // segredos só servem para editar/votar na mensagem: 30 dias bastam; limpa uma vez por dia
    if (temSegredos && Date.now() - _limpezaSegredos > 24 * 3600000) {
      _limpezaSegredos = Date.now();
      try { await db.del('mensagens_segredos?criado_em=lt.' + encodeURIComponent(new Date(Date.now() - 30 * 86400000).toISOString())); } catch (e) {}
    }
    if (!temMidiasPendentes) { try { await db.select('midias_pendentes?select=externo_id&limit=1'); temMidiasPendentes = true; log('📦 arquivos grandes sob demanda ativos'); } catch (e) {} }
    // arquivo grande baixado há mais de 7 dias sai do Storage (o botão "Baixar" volta na conversa);
    // a referência para baixar de novo fica 90 dias — depois o WhatsApp já não teria a mídia
    if (temMidiasPendentes && Date.now() - _limpezaGrandes > 24 * 3600000) {
      _limpezaGrandes = Date.now();
      try {
        const velhas = await db.select('midias_pendentes?baixado_em=lt.' + encodeURIComponent(new Date(Date.now() - 7 * 86400000).toISOString()) + '&caminho=not.is.null&select=externo_id,caminho&limit=50');
        for (const v of velhas || []) {
          try {
            await midia.apagarObjeto('midias-grandes', v.caminho);
            await db.patch('mensagens?externo_id=eq.' + encodeURIComponent(v.externo_id), { midia_url: '' });
            await db.patch('midias_pendentes?externo_id=eq.' + encodeURIComponent(v.externo_id), { caminho: null, baixado_em: null });
          } catch (e) { log('⚠️ faxina de arquivo grande falhou (' + idCurto(v.externo_id) + '):', e.message); }
        }
        if (velhas && velhas.length) log('🧹 arquivos grandes apagados do Storage após 7 dias: ' + velhas.length);
        // só referências SEM arquivo no bucket (as com arquivo saem pela faxina de 7 dias e caem aqui na rodada seguinte)
        await db.del('midias_pendentes?caminho=is.null&criado_em=lt.' + encodeURIComponent(new Date(Date.now() - 90 * 86400000).toISOString()));
      } catch (e) {}
    }
    if (!temEnquetes) { try { await db.select('mensagens?select=enquete&limit=1'); temEnquetes = true; log('📊 enquetes ativas'); } catch (e) {} }
    if (!temLid) { try { await db.select('conversas?select=lid&limit=1'); temLid = true; log('🪪 identidade dupla ativa (anti-duplicata)'); } catch (e) {} }
    await sondarDeptos(false);
    // chat-v12a: fila de pendentes no banco e registrar_entrada (a próxima mensagem testa a função de novo)
    if (!pendentesNoBanco) { try { await db.select('motor_pendentes?select=externo_id&limit=1'); pendentesNoBanco = true; log('♻️ fila de pendentes no banco ativa'); } catch (e) {} }
    if (temRpcEntrada === false) temRpcEntrada = null;
  }, 60000);
}

/* timers do motor: registrados UMA vez (o main pode ser re-tentado após falha) */
let _rotinasAtivas = false;
function iniciarRotinas() {
  if (_rotinasAtivas) return;
  _rotinasAtivas = true;
  setInterval(processarFila, 2000);
  setInterval(processarComandos, 4000);
  setInterval(reprocessarPendentes, 30000);    // mensagens recebidas que falharam ao gravar
  setInterval(reaplicarAjustes, 30000);        // status/prévias que falharam DEPOIS do envio
  setTimeout(varrerLids, 45000);               // cura conversas duplicadas (lid<->número) após conectar
  setInterval(varrerLids, 6 * 3600 * 1000);    // e re-tenta a cada 6h (o mapa de identidades cresce com o uso)
  setTimeout(varrerFotos, 90000);              // renova as fotos logo após conectar
  setInterval(varrerFotos, 7 * 24 * 3600 * 1000);  // e depois 1x por semana (egress: fotos raramente mudam)
  // batimento cardíaco: só bate com o motor SAUDÁVEL — atualizado_em parado faz o CRM
  // avisar o time; e o Healthchecks, sem ping, avisa por e-mail
  setInterval(() => {
    if (!conferirSaude()) return;
    db.patch('motor_estado?id=eq.principal', { atualizado_em: new Date().toISOString() }).catch(() => {});
    pingHC();
  }, 60000);
}

let _limpezaDeBootFeita = false;
async function main() {
  if (!db.configurado()) {
    log('⏸ aguardando configuração: defina SUPABASE_URL e SUPABASE_SERVICE_KEY nas variáveis do Railway');
    setInterval(() => log('⏸ aguardando SUPABASE_SERVICE_KEY...'), 60000);
    return;
  }
  // o Motor v2 precisa da migração chat-v2.sql (mídias, grupos, comandos)
  for (;;) {
    try { await db.select('conversas?select=grupo_jid&limit=1'); break; }
    catch (e) {
      log('⏸ aguardando migração: rode nuvem/chat-v2.sql no SQL Editor do Supabase');
      await estado('erro', { detalhe: 'Motor v2 no ar, mas falta rodar o arquivo nuvem/chat-v2.sql no SQL Editor do Supabase (mídias, grupos, tags). Ele ativa sozinho depois disso.' });
      await new Promise(r => setTimeout(r, 30000));
    }
  }
  // migração chat-v3 (reações): opcional — sem ela o motor funciona, só não grava reações
  try { await db.select('mensagens?select=reacoes&limit=1'); temReacoes = true; log('💫 reações ativas'); }
  catch (e) { log('ℹ️ reações desativadas — rode nuvem/chat-v3.sql no Supabase para ativar'); }
  // migração chat-v11 (identidade dupla — anti-duplicata): idem
  try { await db.select('conversas?select=lid&limit=1'); temLid = true; log('🪪 identidade dupla ativa (anti-duplicata)'); }
  catch (e) { log('ℹ️ anti-duplicata desativado — rode nuvem/chat-v11.sql no Supabase para ativar'); }
  // migração chat-v14a (vários departamentos por conversa): idem
  await sondarDeptos(true);
  // migração chat-v4 (responder/encaminhar): idem
  try { await db.select('mensagens?select=citado&limit=1'); temCitado = true; log('↩️ responder/encaminhar ativos'); }
  catch (e) { log('ℹ️ responder/encaminhar desativados — rode nuvem/chat-v4.sql no Supabase para ativar'); }
  // migração chat-v9 (apagar mensagens): idem
  try { await db.select('mensagens?select=apagada&limit=1'); temApagada = true; log('🚫 apagar mensagens ativo'); }
  catch (e) { log('ℹ️ apagar mensagens desativado — rode nuvem/chat-v9.sql no Supabase para ativar'); }
  // migração chat-v14b (histórico de edições): idem
  try { await db.select('mensagens?select=edicoes&limit=1'); temEdicoes = true; log('✏️ histórico de mensagens editadas ativo'); }
  catch (e) { log('ℹ️ histórico de edições desativado — rode nuvem/chat-v14b.sql no Supabase para ativar'); }
  // migração chat-v14c (segredo das mensagens → edições cifradas): idem
  try { await db.select('midias_pendentes?select=externo_id&limit=1'); temMidiasPendentes = true; log('📦 arquivos grandes sob demanda ativos'); }
  catch (e) { log('ℹ️ arquivos grandes sob demanda desativados — rode nuvem/chat-v16c.sql no Supabase para ativar'); }
  try { await db.select('mensagens_segredos?select=externo_id&limit=1'); temSegredos = true; log('🔐 edições cifradas ativas (segredo das mensagens guardado)'); }
  catch (e) { log('ℹ️ edições cifradas desativadas — rode nuvem/chat-v14c.sql no Supabase para ativar'); }
  // migração chat-v5 (automações): idem
  try { await db.select('automacoes?select=id&limit=1'); temAutomacoes = true; log('🤖 automações ativas'); }
  catch (e) { log('ℹ️ automações desativadas — rode nuvem/chat-v5.sql no Supabase para ativar'); }
  // migração chat-v6 (enquetes clicáveis): idem
  try { await db.select('mensagens?select=enquete&limit=1'); temEnquetes = true; log('📊 enquetes ativas'); }
  catch (e) { log('ℹ️ enquetes desativadas — rode nuvem/chat-v6.sql no Supabase para ativar'); }
  // migração chat-v12a (fila de pendentes da recepção): sem ela, as pendentes ficam só na memória
  try { await db.select('motor_pendentes?select=externo_id&limit=1'); pendentesNoBanco = true; log('♻️ fila de pendentes no banco ativa'); }
  catch (e) { if (tabelaInexistente(e)) desativarPendentesNoBanco(); }
  iniciarRechecagemMigracoes();
  // reset de sessão por variável (um disparo): mude RESETAR_SESSAO p/ qualquer valor
  // novo no Railway e o motor limpa o pareamento e gera QR novo no próximo boot
  const tokenReset = process.env.RESETAR_SESSAO || '';
  if (tokenReset) {
    try {
      const rows = await db.select('motor_sessao?chave=eq.__reset_aplicado__&select=valor');
      const aplicado = rows && rows[0] && rows[0].valor && rows[0].valor.token;
      if (aplicado !== tokenReset) {
        log('🧹 RESETAR_SESSAO novo detectado — limpando o pareamento do WhatsApp');
        await limparSessao();
        await db.upsert('motor_sessao', [{ chave: '__reset_aplicado__', valor: { token: tokenReset }, atualizado_em: new Date().toISOString() }]);
        await estado('desconectado', { detalhe: 'Sessão resetada — gerando novo QR Code...' });
      }
    } catch (e) { log('erro no reset de sessão:', e.message); }
  }
  // no boot nada está em voo: 'enviando' e 'processando' que sobraram são de antes da
  // queda/reinício — viram erro VISÍVEL (reenviar sozinho poderia duplicar no cliente)
  if (!_limpezaDeBootFeita) {
    _limpezaDeBootFeita = true;
    try {
      await db.patch('mensagens?status=eq.enviando',
        { status: 'erro', erro: 'envio interrompido por queda do motor — confira no celular se chegou antes de reenviar' });
    } catch (e) { log('erro ao liberar mensagens presas em "enviando":', e.message); }
    try {
      await db.patch('motor_comandos?status=eq.processando',
        { status: 'erro', erro: 'o motor reiniciou durante a execução — confira e repita', atualizado_em: new Date().toISOString() });
    } catch (e) { log('erro ao liberar comandos presos em "processando":', e.message); }
  }
  await estado('desconectado', { detalhe: 'Motor v2 iniciando...' });
  await conectar();                // não lança: se falhar, agenda a própria reconexão
  iniciarRotinas();
}

/* falha na inicialização não derruba mais o processo: loga e tenta de novo em 30 s
   (o servidor de saúde e os timers já registrados não são duplicados) */
function iniciar() {
  main().catch((e) => {
    log('erro na inicialização:', (e && e.message) || e, '— nova tentativa em 30 s');
    setTimeout(iniciar, 30000);
  });
}

iniciarServidor();
iniciar();
