/* ============================================================
   Testes do front (Onda 0) — rodam no Node, sem navegador e sem rede.
   Carregam js/store.js e js/cloud.js num contexto isolado, com um banco
   PostgREST simulado em memória, e conferem as regras que não podem
   regredir: leitor de horário, cor segura, sync isolado por linha,
   trava contra exclusão em massa, paginação, campos do motor fora do
   upsert, preservação do que não subiu, modo local só em localhost.

   Rodar, a partir da pasta do projeto:   node testes/testes-front.js
============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
let ok = 0, falhas = 0;
function afirma(cond, nome) {
  if (cond) { ok++; } else { falhas++; console.log('  FALHOU: ' + nome); }
}
async function caso(nome, fn) {
  console.log('• ' + nome);
  try { await fn(); } catch (e) { falhas++; console.log('  ERRO: ' + (e && e.stack || e)); }
}

/* GREP(pastas, regex) — procura o regex linha a linha em arquivos .js/.css/.html/.json/.sql.
   `pastas` são caminhos relativos a RAIZ (arquivo ou pasta, percorrida recursivamente;
   node_modules é ignorado). Devolve ['arquivo:linha: trecho', ...]. */
function GREP(pastas, regex) {
  const EXT = /\.(js|css|html|json|sql)$/;
  const achados = [];
  const ler = rel => {
    const abs = path.join(RAIZ, rel);
    if (!fs.existsSync(abs)) return;
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      fs.readdirSync(abs).sort().forEach(n => { if (n !== 'node_modules') ler(path.join(rel, n)); });
    } else if (EXT.test(rel)) {
      fs.readFileSync(abs, 'utf8').split('\n').forEach((linha, i) => {
        if (regex.test(linha)) achados.push(rel + ':' + (i + 1) + ': ' + linha.trim().slice(0, 100));
      });
    }
  };
  pastas.forEach(ler);
  return achados;
}

/* lerTokensClaro() — mapa nome→'#RRGGBB' do tema claro. Junta todos os blocos cujo seletor é
   exatamente `:root` em css/tokens.css (os do modo noturno têm outro seletor e ficam de fora),
   resolve var(--x) recursivamente e devolve só o que termina em hex (#FFF vira #FFFFFF). */
function lerTokensClaro() {
  const css = fs.readFileSync(path.join(RAIZ, 'css/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const brutos = {};
  const BLOCO = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = BLOCO.exec(css))) {
    if (m[1].trim() !== ':root') continue;
    m[2].split(';').forEach(d => {
      const i = d.indexOf(':');
      const nome = d.slice(0, i).trim();
      if (i > 0 && nome.startsWith('--')) brutos[nome] = d.slice(i + 1).trim();
    });
  }
  const resolver = (v, prof) => {
    const r = /^var\((--[\w-]+)\)$/.exec(v);
    return r && prof < 20 && brutos[r[1]] !== undefined ? resolver(brutos[r[1]], prof + 1) : v;
  };
  const tokens = {};
  Object.keys(brutos).forEach(nome => {
    let v = resolver(brutos[nome], 0);
    if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + v.slice(1).split('').map(c => c + c).join('');
    if (/^#[0-9a-f]{6}$/i.test(v)) tokens[nome] = v.toUpperCase();
  });
  return tokens;
}

/* contraste(hexA, hexB) — razão de contraste WCAG 2.x: (L1 + 0,05) / (L2 + 0,05), com a
   luminância relativa calculada sobre o sRGB linearizado. */
function contraste(a, b) {
  const lum = hex => {
    const [r, g, bl] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/* Identidade do escritório: o mesmo js/escritorio.js que o navegador carrega, rodado num vm descartável
   para os testes lerem as chaves de ESCRITORIO.chaves em vez de repeti-las. */
const ESC = (() => {
  const c = { document: {} };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/escritorio.js'), 'utf8') + '\n;this.__esc = ESCRITORIO;', c);
  return c.__esc;
})();

/* Guarda de marca: nada publicado nem testado cita o escritório de origem.
   ESCOPO_GUARDA cresce com as tarefas seguintes (motor, nuvem). */
const MARCA = /Arca|\bARCA\b|\barca\b|[_-]arca\b|\barca(?=[A-Z_:-])|arcachat|arcajuridico|[Uu]ltracrm|ULTRA[ -]?CRM|ultra-(crm|motor)|Ultra Atendimento/;
const MARCA_CAIXA = /ultra[ -]?(crm|atendimento|motor)/i;
const ESCOPO_GUARDA = ['index.html', 'versao.json', 'vercel.json', 'js', 'css', 'testes', 'motor', 'nuvem'];

/* ---------- banco PostgREST simulado ---------- */
function novoBanco(tabelas) {
  const db = JSON.parse(JSON.stringify(tabelas));
  const chamadas = [];
  // semDeptos: banco SEM a migração chat-v14a (coluna departamento_ids inexistente: 42703 no
  // select, PGRST204 no corpo); semRpcDept: a RPC conversa_departamento não existe
  // semPresenca: banco SEM a migração chat-v16a (RPCs registrar_presenca/equipe_presenca ausentes)
  const regras = { recusar: null, semRede: false, maxRows: 1000, semDeptos: false, semRpcDept: false, semPresenca: false, rpcCampoErro: null };
  const uuidLista = s => (s.match(/[0-9a-f-]{8,}/gi) || []);

  async function fetchFalso(url, opts) {
    opts = opts || {};
    const metodo = opts.method || 'GET';
    const u = new URL(url);
    const cam = u.pathname.replace(/^\/rest\/v1\//, '').replace(/^\/auth\/v1\//, 'auth:');
    const corpo = opts.body ? JSON.parse(opts.body) : null;
    chamadas.push({ metodo, cam, q: u.search, corpo });
    if (regras.semRede) throw new TypeError('Failed to fetch');
    const resp = (status, dados, headers) => ({
      ok: status >= 200 && status < 300, status,
      headers: { get: k => (headers || {})[k.toLowerCase()] || null },
      text: async () => dados == null ? '' : JSON.stringify(dados),
      json: async () => dados
    });
    // como o Supabase: o token vem com o usuário (login pela tela depende disso para achar o perfil)
    if (cam.startsWith('auth:')) return resp(200, { access_token: 'novo', refresh_token: 'r2', expires_in: 3600, user: { id: 'u-admin', email: 'dono@mv.adv' } });
    if (cam.startsWith('rpc/')) {
      // chat-v18a: grava UMA chave de conversas.campos; regras.rpcCampoErro simula recusa
      if (cam === 'rpc/conversa_campo') {
        if (!db.campos_personalizados) return resp(404, { code: 'PGRST202' });
        if (regras.rpcCampoErro) return resp(regras.rpcCampoErro.status, { code: regras.rpcCampoErro.code, message: regras.rpcCampoErro.message });
        const c = (db.conversas || []).find(x => x.id === corpo.cid);
        if (!c) return resp(403, { code: '42501', message: 'conversa não encontrada ou sem acesso' });
        if (!db.campos_personalizados.find(k => k.id === corpo.chave)) return resp(404, { code: '23503', message: 'campo não encontrado' });
        c.campos = Object.assign({}, c.campos || {});
        const v = String(corpo.valor || '').trim();
        if (v) c.campos[corpo.chave] = v; else delete c.campos[corpo.chave];
        return resp(200, c.campos);
      }
      if (cam === 'rpc/marcar_lida') {
        const c = (db.conversas || []).find(x => x.id === corpo.cid); if (c) c.nao_lidas = 0;
        return resp(200, null);
      }
      if (cam === 'rpc/motor_qr') return resp(200, 'data:image/png;base64,AAAA');
      // chat-v16a: pulso de presença — prorroga o acesso em curso ou abre outro; devolve o id
      if (cam === 'rpc/registrar_presenca' && !regras.semPresenca) {
        const agora = new Date().toISOString();
        let a = corpo && corpo.sessao && (db.acessos || []).find(x => x.id === corpo.sessao);
        if (a) a.visto_em = agora;
        else { a = { id: 'ac-' + ((db.acessos || []).length + 1), perfil_id: 'u-admin', entrou_em: agora, visto_em: agora }; (db.acessos = db.acessos || []).push(a); }
        return resp(200, a.id);
      }
      if (cam === 'rpc/equipe_presenca' && !regras.semPresenca) {
        const m = {};
        (db.acessos || []).forEach(a => { if (!m[a.perfil_id] || m[a.perfil_id] < a.visto_em) m[a.perfil_id] = a.visto_em; });
        return resp(200, Object.keys(m).map(k => ({ perfil_id: k, visto_em: m[k] })));
      }
      if (cam === 'rpc/marcar_nao_lida' && !regras.semNaoLida) {
        const c = (db.conversas || []).find(x => x.id === corpo.cid); if (c) c.nao_lidas = Math.max(c.nao_lidas || 0, 1);
        return resp(200, null);
      }
      // chat-v14a: liga/desliga um departamento e devolve a lista (com o espelho, como o gatilho faz)
      if (cam === 'rpc/conversa_departamento' && !regras.semRpcDept && !regras.semDeptos) {
        const c = (db.conversas || []).find(x => x.id === corpo.cid);
        if (!c) return resp(400, { code: '42501' });
        const ids = (c.departamento_ids || (c.departamento_id ? [c.departamento_id] : [])).filter(x => x !== corpo.did);
        c.departamento_ids = corpo.ligar ? ids.concat(corpo.did) : ids;
        c.departamento_id = c.departamento_ids[0] || null;
        return resp(200, c.departamento_ids);
      }
      return resp(404, { code: 'PGRST202' });
    }
    const tabela = cam;
    if (!(tabela in db)) return resp(404, { code: '42P01', message: 'tabela inexistente' });
    const p = u.searchParams;
    if (regras.semDeptos && tabela === 'conversas') {
      if (metodo === 'GET' && /departamento_ids/.test(p.get('select') || '')) return resp(400, { code: '42703', message: 'column conversas.departamento_ids does not exist' });
      if (corpo && JSON.stringify(corpo).includes('"departamento_ids"')) return resp(400, { code: 'PGRST204', message: "Could not find the 'departamento_ids' column of 'conversas' in the schema cache" });
    }
    if (metodo === 'GET') {
      if (!db[tabela]) return resp(404, { code: 'PGRST205', message: 'tabela não existe' });   // migração ainda não rodou
      let linhas = db[tabela].slice();
      for (const [k, v] of p.entries()) {
        if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
        if (v.startsWith('eq.')) linhas = linhas.filter(r => String(r[k]) === v.slice(3));
        if (v.startsWith('in.(')) { const vals = v.slice(4, -1).split(','); linhas = linhas.filter(r => vals.includes(String(r[k]))); }
        if (v.startsWith('gt.')) linhas = linhas.filter(r => String(r[k] || '') > decodeURIComponent(v.slice(3)));
      }
      const total = linhas.length;
      const offset = Number(p.get('offset') || 0);
      let limit = Number(p.get('limit') || 1e9);
      limit = Math.min(limit, regras.maxRows);   // o corte do "Max rows"
      linhas = linhas.slice(offset, offset + limit);
      const h = { 'content-range': `${offset}-${offset + linhas.length - 1}/${total}` };
      return resp(200, linhas, h);
    }
    if (metodo === 'POST') {
      const lote = Array.isArray(corpo) ? corpo : [corpo];
      if (regras.recusar) {
        const ruim = lote.find(r => regras.recusar(tabela, r));
        if (ruim) return resp(403, { code: '42501', message: 'new row violates row-level security policy' });
      }
      lote.forEach(r => {
        if (!r.id) r.id = require('crypto').randomUUID();   // como o default gen_random_uuid() do banco (ex.: motor_comandos)
        const i = db[tabela].findIndex(x => x.id === r.id);
        if (i >= 0) db[tabela][i] = Object.assign({}, db[tabela][i], r); else db[tabela].push(Object.assign({}, r));
      });
      // Prefer: return=representation devolve as linhas gravadas (é como enviarComando lê o id do comando)
      const prefer = Object.entries(opts.headers || {}).find(([k]) => k.toLowerCase() === 'prefer');
      return resp(201, prefer && /return=representation/.test(prefer[1]) ? lote.map(r => Object.assign({}, r)) : null);
    }
    if (metodo === 'DELETE') {
      const ids = uuidLista(p.get('id') || '');
      const serie = (p.get('serie') || '').replace(/^eq\./, ''), gte = (p.get('data') || '').replace(/^gte\./, '');
      const alvo = r => ids.length ? ids.includes(r.id) : (!!serie && r.serie === serie && (!gte || r.data >= gte));
      const apagadas = db[tabela].filter(alvo);
      db[tabela] = db[tabela].filter(r => !alvo(r));
      // como o PostgREST: com Prefer: return=representation devolve as linhas apagadas (0 linhas = RLS barrou ou já não existia)
      const preferDel = Object.entries(opts.headers || {}).find(([k]) => k.toLowerCase() === 'prefer');
      return preferDel && /return=representation/.test(preferDel[1]) ? resp(200, apagadas) : resp(204, null);
    }
    if (metodo === 'PATCH') return resp(204, null);
    return resp(405, null);
  }
  return { db, chamadas, regras, fetch: fetchFalso };
}

/* ---------- contexto de navegador mínimo ---------- */
function novoContexto({ hostname = 'sistema.mv.adv.br', search = '', banco, sessao = true, soStore = false }) {
  const armaz = {};
  const toasts = [];
  const intervalos = [];
  const localStorage = {
    getItem: k => (k in armaz ? armaz[k] : null),
    setItem: (k, v) => { armaz[k] = String(v); },
    removeItem: k => { delete armaz[k]; }
  };
  if (sessao) localStorage.setItem(ESC.chaves.sessao, JSON.stringify({
    access_token: 'tok', refresh_token: 'r1', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u-admin', email: 'dono@mv.adv' }
  }));
  const elemento = () => ({ hidden: true, style: {}, innerHTML: '', textContent: '', setAttribute() {}, toggleAttribute() {}, matches: () => false, remove() {}, insertAdjacentHTML() {}, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, classList: { contains: () => false, toggle() {}, add() {}, remove() {} } });
  // elementos da tela de login e o botão Sair da barra lateral (guardam os ouvintes p/ o teste acionar)
  const ouvinte = () => { const e = elemento(); e.ouvintes = {}; e.value = ''; e.addEventListener = (t, fn) => { e.ouvintes[t] = fn; }; return e; };
  const els = { 'auth-entrar': ouvinte(), 'auth-email': ouvinte(), 'auth-senha': ouvinte(), 'auth-esqueci': ouvinte(), 'auth-error': elemento(), 'btn-sair': elemento() };
  // ouvintes do document (mousemove, keydown, visibilitychange…): o teste dispara com ctx.__doc('tipo')
  const docOuvintes = {};
  const ctx = {
    console, JSON, Math, Date, Promise, URL, URLSearchParams, AbortController, TextEncoder,
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, 5)),
    clearTimeout,
    setInterval: (fn, ms) => { intervalos.push({ fn, ms }); return intervalos.length; },
    clearInterval: () => {},
    queueMicrotask,
    localStorage,
    location: { hostname, search, hash: '#/inicio', protocol: 'https:', origin: 'https://' + hostname, pathname: '/', reload() { ctx.__recarregou = true; }, replace(h) { this.hash = h; } },
    document: {
      hidden: false, activeElement: null, body: { classList: { contains: () => false }, appendChild() {} },
      getElementById: id => (id === 'auth-gate' ? ctx.__gate : (els[id] || null)),
      querySelector: () => elemento(), createElement: () => elemento(),
      addEventListener: (t, fn) => { (docOuvintes[t] = docOuvintes[t] || []).push(fn); }
    },
    history: { replaceState() {} },
    crypto: { randomUUID: () => require('crypto').randomUUID(), getRandomValues: a => require('crypto').getRandomValues(a) },
    fetch: banco ? banco.fetch : async () => { throw new TypeError('sem rede'); },
    UI: { toast: (m, t) => toasts.push({ m, t }), refresh() {}, atualizarBadges() {}, navegar() {} },
    ICO: () => '',
    Cadence: { defaults: () => [], cancelarPendentes() {}, all() {} },
    alert() {}, confirm: () => true
  };
  ctx.__gate = elemento();
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext("window.SUPABASE_URL='https://exemplo.supabase.co'; window.SUPABASE_KEY='anon';", ctx);
  for (const f of soStore ? ['js/escritorio.js', 'js/store.js'] : ['js/escritorio.js', 'js/store.js', 'js/texto-wa.js', 'js/cloud.js']) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext('state = defaultState(); state.conversas=[]; state.mensagens=[]; state.departamentos=[]; state.respostasRapidas=[]; state.tags=[]; state.automacoes=[]; state.notificacoes=[]; state.time=[]; state.camposPersonalizados=[];', ctx);
  ctx.__toasts = toasts;
  ctx.__intervalos = intervalos;
  ctx.__armaz = armaz;
  ctx.__els = els;
  ctx.__doc = t => (docOuvintes[t] || []).forEach(fn => fn({ type: t }));
  return ctx;
}
const run = (ctx, codigo) => vm.runInContext(codigo, ctx);

/* banco padrão: o dono (admin), 2 departamentos, 3 conversas, 2 mensagens, 30 leads */
function bancoPadrao(extra) {
  const agora = new Date().toISOString();
  const leads = Array.from({ length: 30 }, (_, i) => ({ id: '00000000-0000-4000-8000-' + String(i).padStart(12, '0'), nome: 'Lead ' + i, telefone: '', email: '', empresa: '', link: '', tags: [], area: '', perfil: '', origem: '', etapa: 'Novo', temperatura: 'Morno', valor: 0, dor: '', notas: '', motivo_perda: '', dono: null, ganho_em: null, criado_em: agora, atualizado_em: agora }));
  return novoBanco(Object.assign({
    perfis: [{ id: 'u-admin', nome: 'Dono', email: 'dono@mv.adv', papel: 'admin', ativo: true, departamento_id: null, departamento_ids: [], permissoes: {}, horario_ativo: false, horario: 'seg-sex 08:00-18:00' }],
    leads, contratos: [], followups: [], analises: [], cadencias: [{ id: 'c1', nome: 'C', cenario: '', ref: '', passos: [] }], config: [],
    conversas: ['c-a', 'c-b', 'c-c'].map((id, i) => ({ id: '11111111-0000-4000-8000-00000000000' + i, telefone: '55450000000' + i, nome: id, foto_url: '', lead_id: null, departamento_id: null, responsavel: null, status: 'aberto', tags: [], nao_lidas: 2, ultima_msg: 'oi', ultima_msg_em: agora, arquivada: false, criado_em: agora, atualizado_em: agora, tipo: 'individual', grupo_jid: '', participantes: [] })),
    mensagens: [
      { id: '22222222-0000-4000-8000-000000000001', conversa_id: '11111111-0000-4000-8000-000000000000', direcao: 'entrada', tipo: 'texto', texto: 'oi', midia_url: '', autor: null, agendada_para: null, status: 'recebida', erro: '', externo_id: 'X1', criado_em: agora, atualizado_em: agora },
      { id: '22222222-0000-4000-8000-000000000002', conversa_id: '11111111-0000-4000-8000-000000000000', direcao: 'saida', tipo: 'texto', texto: 'olá', midia_url: '', autor: 'u-admin', agendada_para: null, status: 'enviada', erro: '', externo_id: 'X2', criado_em: agora, atualizado_em: agora }
    ],
    departamentos: [{ id: '33333333-0000-4000-8000-000000000001', nome: 'Jurídico', cor: '#5e8ab4', permissoes: {} }],
    respostas_rapidas: [], tags: [{ id: '44444444-0000-4000-8000-000000000001', nome: 'Urgente', cor: '#f87171' }, { id: '44444444-0000-4000-8000-000000000002', nome: 'VIP', cor: '#fbbf24' }],
    notificacoes: [], automacoes: [], motor_estado: [{ id: 'principal', situacao: 'conectado', numero: '', detalhe: '', atualizado_em: agora }],
    acessos: [], motor_comandos: [], campos_personalizados: []
  }, extra || {}));
}

/* carrega js/emojis.js + js/views-chat.js no simulador: o Chat de verdade, com um DOM mínimo
   (textarea do composer, input de arquivo, URL.createObjectURL). Devolve as views registradas. */
function carregarChat(ctx) {
  const vistas = {};
  Object.assign(ctx.UI, { registrar: (n, fn) => { vistas[n] = fn; }, modal() {}, fecharModal() {}, carregando: t => t || '', kbdTexto: () => '', hydrateIcons() {},
    ocupado() {}, livre() {}, copiar() {}, tema: { atual: () => 'claro', preferencia: () => 'claro', definir() {}, alternar() {} } });
  run(ctx, 'if (typeof Views === "undefined") globalThis.Views = {}; var AI = { configurado: () => false, MODELOS: [] };');
  ctx.__els['wa-input'] = { value: '', style: {}, placeholder: '', scrollHeight: 20, selectionStart: 0, selectionEnd: 0, focus() {}, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; } };
  ctx.__els['wa-file'] = { accept: '', dataset: {}, value: '', click() {} };
  ctx.document.querySelectorAll = () => [];
  ctx.URL = class extends URL { static createObjectURL() { return 'blob:simulado'; } static revokeObjectURL() {} };
  for (const f of ['js/emojis.js', 'js/views-chat.js']) vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f });
  return vistas;
}

/* carrega js/views-extra.js no simulador (Configurações). Mesmo DOM mínimo do Chat. */
function carregarExtra(ctx) {
  const vistas = {};
  Object.assign(ctx.UI, { registrar: (n, fn) => { vistas[n] = fn; }, modal() {}, fecharModal() {}, carregando: t => t || '', hydrateIcons() {}, ocupado() {}, livre() {}, copiar() {},
    tema: { atual: () => 'claro', preferencia: () => 'claro', definir() {}, alternar() {} } });
  run(ctx, 'if (typeof Views === "undefined") globalThis.Views = {}; var AI = { configurado: () => true, MODELOS: [{ id: "claude-opus-5-5", label: "Opus" }, { id: "claude-sonnet-5-5", label: "Sonnet" }] };');
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/views-extra.js'), 'utf8'), ctx, { filename: 'js/views-extra.js' });
  return vistas;
}

async function iniciado(opcoes) {
  const banco = (opcoes && opcoes.banco) || bancoPadrao(opcoes && opcoes.extra);
  const ctx = novoContexto(Object.assign({ banco }, opcoes || {}));
  const ok = await run(ctx, 'Cloud.iniciar()');
  return { ctx, banco, ok };
}
const esperar = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  /* ---------- funções puras de store.js ---------- */
  await caso('leitor de horário: aceita variações e nunca trava', () => {
    const ctx = novoContexto({ banco: null, sessao: false });
    const ini = Date.now();
    afirma(run(ctx, "horarioValido('seg-sex 08:00-18:00')") === true, 'seg-sex válido');
    afirma(run(ctx, "horarioValido('seg-sexta 08:00-18:00')") === true, 'seg-sexta (sinônimo) válido — antes travava');
    afirma(run(ctx, "horarioValido('segunda-sexta 8:00-18:30')") === true, 'segunda-sexta válido');
    afirma(run(ctx, "horarioValido('sex. 08:00-12:00')") === true, 'ponto final ignorado');
    afirma(run(ctx, "horarioValido('xx-yy 08:00-18:00')") === false, 'dia desconhecido recusado (não trava)');
    afirma(run(ctx, "horarioValido('seg-sex 25:00-18:00')") === false, 'hora inválida recusada');
    afirma(run(ctx, "horarioValido('todos 00:00-23:59')") === true, 'todos');
    afirma(run(ctx, "horarioValido('seg,qua,sex 09:00-17:00')") === true, 'lista de dias');
    afirma(run(ctx, "dentroDoHorario('xx-yy 08:00-18:00')") === true, 'texto inválido não desliga ninguém');
    afirma(run(ctx, "dentroDoHorario('seg-sex 08:00-18:00', new Date(2026,9,3,10,0))") === false, 'sábado fora');
    afirma(run(ctx, "dentroDoHorario('seg-sex 08:00-18:00', new Date(2026,9,1,10,0))") === true, 'quarta 10h dentro');
    afirma(run(ctx, "dentroDoHorario('sex-seg 08:00-18:00', new Date(2026,9,4,9,0))") === true, 'faixa que cruza o fim de semana (domingo)');
    afirma(Date.now() - ini < 500, 'nada demorou (sem laço infinito)');
  });

  await caso('cor segura e escape', () => {
    const ctx = novoContexto({ banco: null, sessao: false });
    afirma(run(ctx, "corSegura('#5e8ab4')") === '#5e8ab4', 'hex válido passa');
    afirma(run(ctx, "corSegura('red;\" onmouseover=\"alert(1)')") === '#5C7F9E' && run(ctx, 'COR_PADRAO_DADO') === '#5C7F9E', 'injeção vira a cor padrão (COR_PADRAO_DADO, aço-400)');
    afirma(run(ctx, "esc('<img src=x onerror=alert(1)>')").indexOf('<') === -1, 'esc remove <');
  });

  await caso('cancelar agendada não apaga a linha', () => {
    const ctx = novoContexto({ banco: null, sessao: false });
    afirma(run(ctx, "var m={status:'agendada'}; cancelarAgendadaLocal(m) && m.status==='cancelada'") === true, 'agendada vira cancelada');
    afirma(run(ctx, "var m2={status:'enviada'}; cancelarAgendadaLocal(m2)===false && m2.status==='enviada'") === true, 'enviada não é tocada');
  });

  /* ---------- modo local ---------- */
  await caso('?semnuvem só vale em localhost', () => {
    const prod = novoContexto({ banco: null, sessao: false, search: '?semnuvem' });
    afirma(run(prod, 'Cloud.configurado()') === true, 'em produção ?semnuvem é ignorado');
    const local = novoContexto({ banco: null, sessao: false, search: '?semnuvem', hostname: 'localhost' });
    afirma(run(local, 'Cloud.configurado()') === false, 'em localhost ?semnuvem liga o modo local');
  });

  /* ---------- carga e paginação ---------- */
  await caso('carga pagina listas maiores que o "Max rows"', async () => {
    const agora = new Date().toISOString();
    const muitas = Array.from({ length: 2500 }, (_, i) => ({ id: 'c' + String(i).padStart(5, '0'), telefone: 't' + i, nome: 'n', departamento_id: null, responsavel: null, status: 'aberto', tags: [], nao_lidas: 0, arquivada: false, criado_em: agora, atualizado_em: agora, tipo: 'individual', grupo_jid: '' }));
    const banco = bancoPadrao({ conversas: muitas });
    const { ctx, ok: abriu } = await iniciado({ banco });
    afirma(abriu === true, 'iniciou');
    afirma(run(ctx, 'state.conversas.length') === 2500, 'as 2500 conversas carregaram (antes: corte em 1000)');
  });

  /* ---------- sync ---------- */
  await caso('não lidas e prévia não sobem no upsert da conversa', async () => {
    const { ctx, banco } = await iniciado();
    banco.chamadas.length = 0;
    run(ctx, "state.conversas[0].naoLidas = 0; state.conversas[0].ultimaMsg='x';");
    await run(ctx, 'Cloud.sincronizar()');
    afirma(!banco.chamadas.some(c => c.metodo === 'POST' && c.cam === 'conversas'), 'nenhum upsert de conversas');
    run(ctx, "state.conversas[0].status = 'em_atendimento';");
    await run(ctx, 'Cloud.sincronizar()');
    const up = banco.chamadas.find(c => c.metodo === 'POST' && c.cam === 'conversas');
    afirma(up && !('nao_lidas' in up.corpo[0]) && !('ultima_msg' in up.corpo[0]) && !('foto_url' in up.corpo[0]), 'upsert sem campos do motor');
  });

  await caso('linha recusada vai para a quarentena e não trava o resto', async () => {
    const { ctx, banco } = await iniciado();
    banco.regras.recusar = (t, r) => t === 'mensagens' && r.texto === 'proibida';
    run(ctx, `registrarMensagem(state.conversas[0].id, { direcao: 'saida', texto: 'proibida' });
              registrarMensagem(state.conversas[0].id, { direcao: 'saida', texto: 'permitida' });
              state.tags[0].nome = 'Muito urgente';`);
    await run(ctx, 'Cloud.sincronizar()');
    afirma(banco.db.mensagens.some(m => m.texto === 'permitida'), 'a mensagem permitida subiu');
    afirma(!banco.db.mensagens.some(m => m.texto === 'proibida'), 'a recusada não está no banco');
    afirma(banco.db.tags.some(t => t.nome === 'Muito urgente'), 'outras tabelas subiram');
    afirma(run(ctx, "state.mensagens.find(m=>m.texto==='proibida').status") === 'erro', 'a recusada aparece com erro na conversa');
    afirma(run(ctx, 'Cloud.temPendencia()') === false, 'sem pendência: os pulsos seguem');
    afirma(run(ctx, 'Cloud.recusadas().length') === 1, 'uma linha em quarentena');
    banco.chamadas.length = 0;
    await run(ctx, 'Cloud.sincronizar()');
    afirma(!banco.chamadas.some(c => c.metodo === 'POST' && c.cam === 'mensagens'), 'a recusada não é reenviada em laço');
  });

  await caso('falha de rede deixa pendência e recupera depois', async () => {
    const { ctx, banco } = await iniciado();
    banco.regras.semRede = true;
    run(ctx, "registrarMensagem(state.conversas[1].id, { direcao: 'saida', texto: 'sem rede' });");
    await run(ctx, 'Cloud.sincronizar()');
    afirma(run(ctx, 'Cloud.temPendencia()') === true, 'pendência registrada');
    banco.regras.semRede = false;
    await run(ctx, 'Cloud.sincronizarAgora()');
    afirma(banco.db.mensagens.some(m => m.texto === 'sem rede'), 'subiu quando a rede voltou');
    afirma(run(ctx, 'Cloud.temPendencia()') === false, 'pendência resolvida');
  });

  await caso('exclusão em massa é bloqueada; exclusão pequena passa', async () => {
    const { ctx, banco } = await iniciado();
    banco.chamadas.length = 0;
    run(ctx, 'state.leads = [];'); // o que "Apagar todos os dados" fazia
    await run(ctx, 'Cloud.sincronizar()');
    afirma(!banco.chamadas.some(c => c.metodo === 'DELETE' && c.cam === 'leads'), 'nenhum DELETE de leads');
    afirma(banco.db.leads.length === 30, 'os 30 leads continuam no banco');
    afirma(ctx.__toasts.some(t => /exclusão em massa/.test(t.m)), 'avisou o bloqueio');
    const ctx2 = (await iniciado({ banco })).ctx;
    run(ctx2, "state.tags = state.tags.filter(t => t.nome !== 'VIP');");
    await run(ctx2, 'Cloud.sincronizar()');
    afirma(!banco.db.tags.some(t => t.nome === 'VIP'), 'apagar 1 tag funciona');
  });

  await caso('recarga não engole o que ainda não subiu', async () => {
    const { ctx, banco } = await iniciado();
    banco.regras.semRede = true;
    run(ctx, "state.conversas[2].status = 'aguardando';");
    await run(ctx, 'Cloud.sincronizar()');          // não subiu (sem rede)
    banco.regras.semRede = false;
    await run(ctx, 'Cloud.carregarTudo(true)');      // banco ainda diz 'aberto'
    afirma(run(ctx, 'state.conversas[2].status') === 'aguardando', 'a alteração local sobreviveu à recarga');
    await run(ctx, 'Cloud.sincronizarAgora()');
    afirma(banco.db.conversas[2].status === 'aguardando', 'e subiu no envio seguinte');
  });

  await caso('departamentos só entram no envio do admin', async () => {
    const banco = bancoPadrao({ perfis: [{ id: 'u-admin', nome: 'Ana', email: 'a@mv.adv', papel: 'atendente', ativo: true, departamento_ids: [], permissoes: {} }] });
    const { ctx } = await iniciado({ banco });
    banco.chamadas.length = 0;
    run(ctx, "state.departamentos.push({ id: '33333333-0000-4000-8000-000000000009', nome: 'Semente', cor: '#123456', permissoes: {} });");
    await run(ctx, 'Cloud.sincronizar()');
    afirma(!banco.chamadas.some(c => c.cam === 'departamentos' && c.metodo !== 'GET'), 'atendente não grava departamentos');
  });

  await caso('status do atendimento tem chip e glifo (E1)', async () => {
    const { ctx } = await iniciado();
    const lista = run(ctx, 'STATUS_ATENDIMENTO');
    afirma(lista.length === 5, 'cinco status');
    afirma(lista.every(s => /^chip-st-[a-z]+$/.test(s[3]) && typeof s[4] === 'string' && s[4]), 'todos com chip de status e ícone');
    afirma(run(ctx, "statusEncerra('resolvido') && statusEncerra('fechado') && !statusEncerra('aberto') && !statusEncerra('aguardando')"), 'resolvido e fechado encerram (arquivam); os outros não');
    const info = run(ctx, "statusAtendInfo('aguardando')");
    afirma(info.chip === 'chip-st-aguardando' && info.icone === 'clock' && info.label === 'Aguardando', 'info completa');
    afirma(run(ctx, "statusAtendInfo('inexistente').id") === 'aberto', 'desconhecido cai em aberto');
  });

  await caso('departamentos múltiplos: sem a migração só departamento_id; com ela a lista + espelho (chat-v14a)', async () => {
    const banco = bancoPadrao({ departamentos: [{ id: 'd-x', nome: 'X', cor: '#5e8ab4', permissoes: {} }, { id: 'd-y', nome: 'Y', cor: '#5e8ab4', permissoes: {} }] });
    banco.regras.semDeptos = true;
    const { ctx } = await iniciado({ banco });
    afirma(run(ctx, 'Cloud.deptsMultiplos()') === false, 'sem a coluna: deptsMultiplos() é false');
    const cid = run(ctx, 'state.conversas[0].id');
    banco.chamadas.length = 0;
    run(ctx, `definirDepartamentos('${cid}', ['d-x', 'd-y'])`);
    await run(ctx, 'Cloud.sincronizar()');
    const post1 = banco.chamadas.find(c => c.cam === 'conversas' && c.metodo === 'POST');
    afirma(!!post1 && post1.corpo[0].departamento_id === 'd-x' && !('departamento_ids' in post1.corpo[0]), 'upsert sem a coluna manda só departamento_id (= 1º da lista)');
    afirma(run(ctx, `getConversa('${cid}').departamentoId`) === 'd-x' && run(ctx, `getConversa('${cid}').departamentoIds.join()`) === 'd-x,d-y', 'no state a lista é a verdade e o espelho é o 1º');
    afirma(run(ctx, `atualizarConversa('${cid}', { departamentoId: 'd-y' }).departamentoIds.join()`) === 'd-y', 'patch legado só com o espelho vira lista');
    await run(ctx, 'Cloud.sincronizar()');   // deixa tudo subido antes da "migração"
    // a migração roda entre duas recargas
    banco.regras.semDeptos = false;
    await run(ctx, 'Cloud.carregarTudo(true)');
    afirma(run(ctx, 'Cloud.deptsMultiplos()') === true, 'a recarga seguinte detecta a coluna');
    banco.chamadas.length = 0;
    await run(ctx, 'Cloud.sincronizar()');
    afirma(!banco.chamadas.some(c => c.cam === 'conversas' && c.metodo === 'POST'), 'a coluna aparecer não sobe a tabela inteira');
    run(ctx, `definirDepartamentos('${cid}', ['d-y', 'd-x'])`);
    await run(ctx, 'Cloud.sincronizar()');
    const post2 = banco.chamadas.find(c => c.cam === 'conversas' && c.metodo === 'POST');
    afirma(!!post2 && JSON.stringify(post2.corpo[0].departamento_ids) === '["d-y","d-x"]' && post2.corpo[0].departamento_id === 'd-y', 'com a coluna: manda a lista e o espelho');
  });

  await caso('podeVerConversa olha a lista inteira (chat-v14a)', async () => {
    const { ctx } = await iniciado({ banco: bancoPadrao({ perfis: [{ id: 'u-admin', nome: 'Ana', email: 'a@mv.adv', papel: 'atendente', ativo: true, departamento_id: null, departamento_ids: ['d-a'], permissoes: {}, horario_ativo: false, horario: '' }] }) });
    const ve = o => run(ctx, `podeVerConversa(${JSON.stringify(o)})`);
    afirma(ve({ departamentoIds: [] }) === false, 'sem departamento: atendente NÃO vê (só admin / responsável / ver todos) — chat-v15b');
    afirma(ve({ departamentoIds: ['d-b'] }) === false, 'só de outro departamento: não vejo');
    afirma(ve({ departamentoIds: ['d-b', 'd-a'] }) === true, 'compartilhada com o meu (2ª posição): vejo');
    afirma(ve({ departamentoId: 'd-a' }) === true && ve({ departamento_ids: ['d-a'] }) === true && ve({ departamento_id: 'd-b' }) === false, 'objetos parciais (pulso e banco) funcionam');
    afirma(ve({ departamentoIds: ['d-b'], responsavel: 'u-admin' }) === true, 'delegada a mim: vejo');
  });

  await caso('ligar/desligar um departamento vai pela RPC e não reenvia a conversa (chat-v14a)', async () => {
    const banco = bancoPadrao({ departamentos: [{ id: 'd-x', nome: 'X', cor: '#5e8ab4', permissoes: {} }] });
    const { ctx } = await iniciado({ banco });
    const cid = run(ctx, 'state.conversas[0].id');
    banco.chamadas.length = 0;
    const lista = await run(ctx, `Cloud.alternarDepartamento('${cid}', 'd-x', true)`);
    const rpc = banco.chamadas.find(c => c.cam === 'rpc/conversa_departamento');
    afirma(!!rpc && rpc.corpo.cid === cid && rpc.corpo.did === 'd-x' && rpc.corpo.ligar === true, 'POST rpc/conversa_departamento {cid, did, ligar}');
    afirma(JSON.stringify(lista) === '["d-x"]', 'devolve a lista como ficou');
    run(ctx, `definirDepartamentos('${cid}', ${JSON.stringify(lista)}); Cloud.conversaSincronizada('${cid}')`);
    banco.chamadas.length = 0;
    await run(ctx, 'Cloud.sincronizar()');
    afirma(!banco.chamadas.some(c => c.cam === 'conversas' && c.metodo === 'POST'), 'sombra atualizada: o sync não reenvia a conversa inteira por cima');
    afirma(JSON.stringify(await run(ctx, `Cloud.alternarDepartamento('${cid}', 'd-x', false)`)) === '[]', 'desligar remove');
    // status mudado na mesma janela do toggle: a sombra remenda só os departamentos e o status sobe
    const l3 = await run(ctx, `Cloud.alternarDepartamento('${cid}', 'd-x', true)`);
    banco.chamadas.length = 0;
    run(ctx, `atualizarConversa('${cid}', { status: 'em_atendimento' }); definirDepartamentos('${cid}', ${JSON.stringify(l3)}); Cloud.conversaSincronizada('${cid}')`);
    await run(ctx, 'Cloud.sincronizar()');
    const p3 = banco.chamadas.find(c => c.cam === 'conversas' && c.metodo === 'POST');
    afirma(!!p3 && p3.corpo[0].status === 'em_atendimento' && JSON.stringify(p3.corpo[0].departamento_ids) === '["d-x"]', 'status alterado na mesma janela ainda sobe (a sombra só remenda os departamentos)');
    // sem a RPC: null → o chamador grava no state SEM mexer na sombra e o upsert leva a lista
    banco.regras.semRpcDept = true;
    afirma(await run(ctx, `Cloud.alternarDepartamento('${cid}', 'd-x', false)`) === null, 'sem a RPC (404) devolve null: o chamador cai no upsert');
    banco.chamadas.length = 0;
    run(ctx, `definirDepartamentos('${cid}', [])`);
    await run(ctx, 'Cloud.sincronizar()');
    const p4 = banco.chamadas.find(c => c.cam === 'conversas' && c.metodo === 'POST');
    afirma(!!p4 && JSON.stringify(p4.corpo[0].departamento_ids) === '[]' && p4.corpo[0].departamento_id === null, 'sem a RPC a mudança sobe pelo upsert da linha');
  });

  await caso('PGRST204 + uma linha recusada pela RLS no mesmo lote: só ela entra na quarentena (chat-v14a)', async () => {
    const banco = bancoPadrao({ departamentos: [{ id: 'd-x', nome: 'X', cor: '#5e8ab4', permissoes: {} }] });
    const { ctx } = await iniciado({ banco });
    banco.regras.semDeptos = true;   // cache do PostgREST atrasado
    const ids = JSON.parse(run(ctx, 'JSON.stringify(state.conversas.map(c => c.id))'));
    banco.regras.recusar = (t, r) => t === 'conversas' && r.id === ids[1];
    banco.chamadas.length = 0;
    run(ctx, ids.map(id => `atualizarConversa('${id}', { status: 'em_atendimento' });`).join(''));
    await run(ctx, 'Cloud.sincronizar()');
    const posts = banco.chamadas.filter(c => c.cam === 'conversas' && c.metodo === 'POST');
    afirma(posts.length === 5 && posts.slice(1).every(p => p.corpo.every(r => !('departamento_ids' in r))), 'lote com a lista → PGRST204 → lote sem a lista → 403 → linha a linha sem a lista');
    afirma(banco.db.conversas.filter(c => c.status === 'em_atendimento').map(c => c.id).sort().join() === [ids[0], ids[2]].sort().join(), 'as duas linhas aceitas foram gravadas; só a recusada ficou de fora');
    banco.chamadas.length = 0;
    await run(ctx, 'Cloud.sincronizar()');
    afirma(!banco.chamadas.some(c => c.cam === 'conversas' && c.metodo === 'POST'), 'a recusada está na quarentena e as outras não voltam a subir');
    banco.regras.recusar = null;
  });

  await caso('PGRST204 logo depois da migração: reenvia sem a lista em vez de pôr na quarentena (chat-v14a)', async () => {
    const banco = bancoPadrao({ departamentos: [{ id: 'd-x', nome: 'X', cor: '#5e8ab4', permissoes: {} }] });
    const { ctx } = await iniciado({ banco });
    afirma(run(ctx, 'Cloud.deptsMultiplos()') === true, 'sondagem viu a coluna');
    banco.regras.semDeptos = true;   // cache do PostgREST atrasado: corpo com a lista leva 400 PGRST204
    const cid = run(ctx, 'state.conversas[0].id');
    run(ctx, `definirDepartamentos('${cid}', ['d-x'])`);
    banco.chamadas.length = 0;
    await run(ctx, 'Cloud.sincronizar()');
    const posts = banco.chamadas.filter(c => c.cam === 'conversas' && c.metodo === 'POST');
    afirma(posts.length === 2 && 'departamento_ids' in posts[0].corpo[0] && !('departamento_ids' in posts[1].corpo[0]) && posts[1].corpo[0].departamento_id === 'd-x', 'segunda tentativa no mesmo ciclo, sem a lista');
    afirma(run(ctx, 'Cloud.deptsMultiplos()') === false, 'desligou a flag até a próxima sondagem');
    afirma(banco.db.conversas.find(c => c.id === cid).departamento_id === 'd-x' && ctx.__toasts.every(t => !/recus|quarentena|alçada/i.test(t.m)), 'gravou e nenhum aviso de recusa');
    banco.chamadas.length = 0;
    await run(ctx, 'Cloud.sincronizar()');
    afirma(!banco.chamadas.some(c => c.cam === 'conversas' && c.metodo === 'POST'), 'nada pendente no ciclo seguinte (a sombra foi reescrita sem a lista: as outras conversas não sobem)');
  });

  await caso('mensagens editadas: edicoes desce do banco e nunca sobe (chat-v14b)', async () => {
    const agora = new Date().toISOString();
    const { ctx, banco } = await iniciado({ extra: { mensagens: [
      { id: '22222222-0000-4000-8000-000000000009', conversa_id: '11111111-0000-4000-8000-000000000000', direcao: 'entrada', tipo: 'texto', texto: 'oi corrigido', midia_url: '', autor: null, agendada_para: null, status: 'recebida', erro: '', externo_id: 'X9', criado_em: agora, atualizado_em: agora, edicoes: [{ texto: 'oi', em: agora }] }
    ] } });
    const m = run(ctx, "state.mensagens.find(x => x.externoId === 'X9')");
    afirma(!!m && m.edicoes.length === 1 && m.edicoes[0].texto === 'oi', 'versões anteriores chegam ao state');
    afirma(run(ctx, "state.mensagens.filter(x => x.externoId !== 'X9').every(x => Array.isArray(x.edicoes))"), 'sem a coluna, edicoes é lista vazia');
    banco.chamadas.length = 0;
    run(ctx, "state.mensagens.find(x => x.externoId === 'X9').texto = 'mexido'; save();");
    await run(ctx, 'Cloud.sincronizar()');
    const post = banco.chamadas.find(c => c.cam === 'mensagens' && c.metodo === 'POST');
    afirma(!!post && !post.corpo.some(r => 'edicoes' in r), 'o front nunca manda edicoes (só o motor grava)');
  });

  await caso('formatação do WhatsApp nas bolhas (E4)', async () => {
    const { ctx } = await iniciado();
    const f = t => run(ctx, `formatarWa(${JSON.stringify(t)})`);
    afirma(f('oi *negrito* fim') === 'oi <strong>negrito</strong> fim', 'negrito');
    afirma(f('_itálico_ e ~tachado~') === '<em>itálico</em> e <s>tachado</s>', 'itálico e tachado');
    afirma(f('use `codigo` aqui') === 'use <code class="wa-mono">codigo</code> aqui', 'mono inline');
    afirma(f('```linha 1\nlinha 2```') === '<pre class="wa-mono">linha 1\nlinha 2</pre>', 'bloco mono multilinha');
    afirma(f('*_dentro_*') === '<strong><em>dentro</em></strong>', 'aninhado');
    afirma(f('a*b*c e 2*3*4') === 'a*b*c e 2*3*4', 'marcador colado em letra/número não formata');
    afirma(f('* solto* e *solto *') === '* solto* e *solto *', 'espaço junto ao marcador não formata');
    afirma(f('*abc\ndef*') === '*abc\ndef*', 'quebra de linha dentro não formata');
    afirma(f('*sem par') === '*sem par', 'marcador sem par fica literal');
    afirma(f('veja https://exemplo.com/a_b_c?x=*1* ok') === 'veja <a href="https://exemplo.com/a_b_c?x=*1*" target="_blank" rel="noopener noreferrer">https://exemplo.com/a_b_c?x=*1*</a> ok', 'URL intacta e sem formatação dentro');
    afirma(f('mande para ana_b_c@exemplo.com.br') === 'mande para ana_b_c@exemplo.com.br', 'underscore em e-mail não formata');
    afirma(f('<b>x</b> *ok*') === '&lt;b&gt;x&lt;/b&gt; <strong>ok</strong>', 'HTML vem escapado (XSS)');
    afirma(f('`*nao*`') === '<code class="wa-mono">*nao*</code>', 'dentro do mono nada formata');
    afirma(f('*Ana Souza:*\nOlá') === '<strong>Ana Souza:</strong>\nOlá', 'assinatura do atendente em negrito');
    const s = t => run(ctx, `semMarcadoresWa(${JSON.stringify(t)})`);
    afirma(s('oi *negrito* _it_ ~t~ `m`') === 'oi negrito it t m', 'prévia sem marcadores');
    afirma(s('a*b*c *sem par') === 'a*b*c *sem par', 'prévia mantém marcadores que não formam par');
  });

  await caso('marcar como não lida usa a RPC e cai no PATCH sem a migração (E2)', async () => {
    const { ctx, banco } = await iniciado();
    banco.chamadas.length = 0;
    const cid = run(ctx, 'state.conversas[0].id');
    await run(ctx, `Cloud.marcarNaoLida('${cid}')`);
    afirma(banco.chamadas.some(c => c.cam === 'rpc/marcar_nao_lida'), 'chamou rpc/marcar_nao_lida');
    afirma(banco.db.conversas.find(c => c.id === cid).nao_lidas >= 1, 'ficou com ao menos 1 não lida no banco (greatest)');
    afirma(!banco.chamadas.some(c => c.cam === 'conversas' && c.metodo !== 'GET'), 'não regravou a conversa');
    // sem a migração chat-v13a: a RPC responde 404 e o front usa o PATCH só da coluna
    banco.regras.semNaoLida = true;
    banco.chamadas.length = 0;
    await run(ctx, `Cloud.marcarNaoLida('${cid}')`);
    afirma(banco.chamadas.some(c => c.metodo === 'PATCH' && c.cam === 'conversas' && c.q.startsWith('?id=eq.') && c.corpo.nao_lidas === 1), 'fallback PATCH nao_lidas=1');
  });

  await caso('marcar como lida usa a RPC (sem regravar a conversa)', async () => {
    const { ctx, banco } = await iniciado();
    banco.chamadas.length = 0;
    await run(ctx, 'Cloud.marcarLida(state.conversas[0].id)');
    afirma(banco.chamadas.some(c => c.cam === 'rpc/marcar_lida'), 'chamou rpc/marcar_lida');
    afirma(banco.db.conversas[0].nao_lidas === 0, 'zerou no banco');
  });

  await caso('presença: pulso na entrada, prorroga o mesmo acesso e lista quem está online (P1)', async () => {
    const { ctx, banco } = await iniciado();
    await esperar(15);
    const pulsos = () => banco.chamadas.filter(c => c.cam === 'rpc/registrar_presenca');
    afirma(pulsos().length === 1 && pulsos()[0].corpo.sessao === null, 'primeiro pulso logo na entrada, sem sessão');
    afirma(banco.db.acessos.length === 1, 'abriu um acesso no banco');
    afirma(run(ctx, 'Cloud.presencaAtiva()') === true, 'presença sondada como disponível');
    // o laço de 1 min manda o id do acesso em curso: o banco prorroga em vez de abrir outro
    const laco = ctx.__intervalos.find(i => i.ms === 60000);
    await laco.fn(); await esperar(15);
    afirma(pulsos().length === 2 && pulsos()[1].corpo.sessao === 'ac-1', 'segundo pulso leva o id do acesso');
    afirma(banco.db.acessos.length === 1, 'não abriu um acesso novo');
    // aba escondida: não pulsa (a pessoa não está olhando)
    ctx.document.hidden = true;
    await laco.fn(); await esperar(15);
    afirma(pulsos().length === 2, 'aba escondida não pulsa');
    ctx.document.hidden = false;
    const pres = await run(ctx, 'Cloud.equipePresenca()');
    afirma(Array.isArray(pres) && pres.length === 1 && pres[0].perfil_id === 'u-admin' && run(ctx, `presencaOnline(${JSON.stringify(pres[0].visto_em)})`) === true, 'equipe_presenca: o dono aparece online');
    const hoje = await run(ctx, 'Cloud.acessosDeHoje()');
    afirma(Array.isArray(hoje) && hoje.length === 1 && banco.chamadas.some(c => c.cam === 'acessos' && /visto_em=gte\./.test(c.q)), 'admin lê os acessos de hoje (filtro por visto_em)');
  });

  await caso('presença: sem a migração a RPC responde 404 e o pulso se desliga (P2)', async () => {
    const { ctx, banco } = await iniciado();
    banco.regras.semPresenca = true;
    banco.chamadas.length = 0;
    await run(ctx, 'Cloud.iniciar()'); await esperar(15);
    const pulsos = () => banco.chamadas.filter(c => c.cam === 'rpc/registrar_presenca').length;
    afirma(pulsos() === 1 && run(ctx, 'Cloud.presencaAtiva()') === false, 'um 404 basta: presença marcada como ausente');
    const laco = ctx.__intervalos.find(i => i.ms === 60000);
    await laco.fn(); await laco.fn(); await esperar(15);
    afirma(pulsos() === 1, 'o laço de 1 min não insiste');
    afirma((await run(ctx, 'Cloud.equipePresenca()')) === null, 'equipe_presenca devolve null (card esconde a presença)');
    delete banco.db.acessos;
    afirma((await run(ctx, 'Cloud.acessosDeHoje()')) === null, 'tabela ausente → null, sem erro');
  });

  await caso('presença: online, último acesso e períodos do dia (P3)', async () => {
    const ctx = novoContexto({ banco: bancoPadrao() });
    const agora = new Date('2026-10-05T14:32:00').getTime();
    const h = t => run(ctx, `presencaOnline(${JSON.stringify(t)}, ${agora})`);
    afirma(h(new Date(agora - 2 * 60000).toISOString()) === true && h(new Date(agora - 4 * 60000).toISOString()) === false && h(null) === false, 'online = visto há menos de 3 min');
    const r = t => run(ctx, `rotuloUltimoAcesso(${JSON.stringify(t)}, ${agora})`);
    afirma(/^hoje às \d\d:\d\d$/.test(r(new Date(agora - 3600000).toISOString())), 'hoje às HH:MM');
    afirma(/^ontem às \d\d:\d\d$/.test(r(new Date(agora - 86400000).toISOString())), 'ontem às HH:MM');
    afirma(/^03\/10 às \d\d:\d\d$/.test(r(new Date(agora - 2 * 86400000).toISOString())) && r(null) === 'nunca entrou', 'data curta e "nunca entrou"');
    const iso = (hh, mm) => new Date(2026, 9, 5, hh, mm).toISOString();
    const acessos = [
      { entrou_em: iso(8, 2), visto_em: iso(12, 10) },
      { entrou_em: iso(9, 0), visto_em: iso(10, 0) },     // 2ª aba dentro do mesmo período: some
      { entrou_em: iso(13, 31), visto_em: new Date(agora - 60000).toISOString() }, // em curso
      { entrou_em: new Date(2026, 9, 4, 23, 50).toISOString(), visto_em: iso(0, 20) } // madrugada: corta no início do dia
    ];
    const per = run(ctx, `periodosDeAcesso(${JSON.stringify(acessos)}, ${agora}, ${new Date(2026, 9, 5).getTime()})`);
    afirma(JSON.stringify(per) === JSON.stringify(['00:00–00:20', '08:02–12:10', '13:31–agora']), 'períodos juntam abas, cortam a madrugada e marcam "agora": ' + JSON.stringify(per));
    afirma(JSON.stringify(run(ctx, 'periodosDeAcesso(null)')) === '[]', 'sem acessos → lista vazia');
  });

  await caso('botão Sair aparece em toda entrada: sessão guardada e login pela tela (S1)', async () => {
    const { ctx } = await iniciado();
    afirma(ctx.__els['btn-sair'].hidden === false, 'sessão guardada (F5): Sair visível');
    // login pela tela de entrada (quem foi criado agora entra por aqui)
    const banco = bancoPadrao();
    const ctx2 = novoContexto({ banco, sessao: false });
    afirma(ctx2.__els['btn-sair'].hidden === true, 'antes do login o botão fica escondido');
    run(ctx2, 'Cloud.prepararGate()');
    ctx2.__els['auth-email'].value = 'dono@mv.adv'; ctx2.__els['auth-senha'].value = 'segredo';
    await ctx2.__els['auth-entrar'].ouvintes.click();
    afirma(banco.chamadas.some(c => c.cam === 'auth:token' && c.q.includes('grant_type=password')), 'pediu o token com a senha');
    afirma(run(ctx2, 'Cloud.ativo()') === true && ctx2.__gate.hidden === true, 'entrou e a tela de login sumiu');
    afirma(ctx2.__els['btn-sair'].hidden === false, 'login pela tela: Sair visível (antes só aparecia no F5)');
  });

  await caso('inatividade: parado há mais de 6 h não volta a abrir sem login (S2)', async () => {
    const banco = bancoPadrao();
    const ctx = novoContexto({ banco });
    ctx.localStorage.setItem(ESC.chaves.atividade, JSON.stringify({ em: Date.now() - 7 * 3600000, limite: 6 * 3600000 }));
    const ok = await run(ctx, 'Cloud.iniciar()');
    afirma(ok === false && !ctx.__armaz[ESC.chaves.sessao] && !ctx.__armaz[ESC.chaves.atividade], 'não abriu; sessão e marca de uso apagadas');
    afirma(ctx.__gate.hidden === false && /6 h sem usar o sistema/.test(ctx.__els['auth-error'].textContent), 'tela de login com o motivo');
    afirma(banco.chamadas.length > 0 && banco.chamadas.every(c => c.cam.startsWith('auth:')), 'nada além do aviso ao servidor antes de encerrar (nenhum dado baixado)');
    afirma(banco.chamadas.some(c => c.cam === 'auth:logout' && c.q.includes('scope=local')), 'sessão revogada no servidor (logout só deste aparelho)');
    // parado há 5 h: abre normalmente e o relógio de uso continua de onde parou (recarga não é uso)
    const ctx2 = novoContexto({ banco: bancoPadrao() });
    const em = Date.now() - 5 * 3600000;
    ctx2.localStorage.setItem(ESC.chaves.atividade, JSON.stringify({ em, limite: 6 * 3600000 }));
    afirma((await run(ctx2, 'Cloud.iniciar()')) === true && run(ctx2, 'Cloud.ultimaAtividade()') === em, '5 h: abre e mantém o último uso gravado');
    const grav = JSON.parse(ctx2.__armaz[ESC.chaves.atividade]);
    afirma(grav.em === em && grav.limite === 6 * 3600000, 'sem config: gravação com o padrão de 6 h');
    // o limite do admin (config.geral) chega na recarga: vai para state e para a gravação
    const c10 = novoContexto({ banco: bancoPadrao({ config: [{ chave: 'geral', valor: { inatividadeHoras: 10 } }] }) });
    afirma((await run(c10, 'Cloud.iniciar()')) === true && run(c10, 'state.settings.inatividadeHoras') === 10 && JSON.parse(c10.__armaz[ESC.chaves.atividade]).limite === 36000000, 'config 10 h: vai para state e para a gravação');
    const c0 = novoContexto({ banco: bancoPadrao({ config: [{ chave: 'geral', valor: { inatividadeHoras: 0 } }] }) });
    c0.localStorage.setItem(ESC.chaves.atividade, JSON.stringify({ em: Date.now() - 30 * 86400000, limite: 0 }));
    afirma((await run(c0, 'Cloud.iniciar()')) === true && run(c0, 'state.settings.inatividadeHoras') === 0 && JSON.parse(c0.__armaz[ESC.chaves.atividade]).limite === 0, 'config 0: desligado, abre mesmo parado há 30 dias');
  });

  await caso('inatividade: o laço de 1 min encerra após N h sem uso e respeita o limite do admin (S3)', async () => {
    const { ctx, banco } = await iniciado();
    const laco = ctx.__intervalos.find(i => i.ms === 60000);
    // "parar" = nenhuma aba teve uso há N h: gravação compartilhada e relógio desta aba no passado
    const parar = (ctx, h) => { const em = Date.now() - h * 3600000; ctx.localStorage.setItem(ESC.chaves.atividade, JSON.stringify({ em, limite: 6 * 3600000 })); run(ctx, `Cloud.marcarAtividade(${em})`); };
    parar(ctx, 5);
    await laco.fn(); await esperar(15);
    afirma(run(ctx, 'Cloud.ativo()') === true, '5 h parado: segue conectado');
    parar(ctx, 7);
    await laco.fn(); await esperar(15);
    afirma(run(ctx, 'Cloud.ativo()') === false && !ctx.__armaz[ESC.chaves.sessao] && !ctx.__armaz[ESC.chaves.estado], '7 h parado: sessão encerrada e navegador limpo');
    afirma(banco.chamadas.some(c => c.cam === 'auth:logout' && c.q.includes('scope=local')), 'avisou o servidor (logout só deste aparelho)');
    afirma(ctx.__gate.hidden === false && /sem usar o sistema/.test(ctx.__els['auth-error'].textContent), 'tela de login com o motivo, na hora');
    afirma(ctx.__recarregou === true && /sem usar o sistema/.test(ctx.__armaz[ESC.chaves.motivoSaida] || ''), 'recarrega a página (nada do usuário fica em memória) e guarda o motivo para a tela de login');
    // depois da recarga: a tela de login mostra o motivo guardado; o próximo login apaga
    const cR = novoContexto({ banco: bancoPadrao(), sessao: false });
    cR.localStorage.setItem(ESC.chaves.motivoSaida, 'Você ficou mais de 6 h sem usar o sistema…');
    afirma((await run(cR, 'Cloud.iniciar()')) === false, 'sem sessão depois da recarga');
    run(cR, 'Cloud.mostrarGate()');
    afirma(/6 h sem usar/.test(cR.__els['auth-error'].textContent), 'tela de login explica o motivo depois da recarga');
    run(cR, 'Cloud.prepararGate()');
    cR.__els['auth-email'].value = 'dono@mv.adv'; cR.__els['auth-senha'].value = 'x';
    await cR.__els['auth-entrar'].ouvintes.click();
    afirma(run(cR, 'Cloud.ativo()') === true && !cR.__armaz[ESC.chaves.motivoSaida], 'novo login apaga o motivo guardado');
    // uso numa OUTRA aba (gravação recente) segura esta — e esta aba adota a marca mais nova
    const { ctx: c2 } = await iniciado();
    c2.localStorage.setItem(ESC.chaves.atividade, JSON.stringify({ em: Date.now() - 60000, limite: 6 * 3600000 }));
    run(c2, `Cloud.marcarAtividade(${Date.now() - 7 * 3600000})`);
    await c2.__intervalos.find(i => i.ms === 60000).fn(); await esperar(15);
    afirma(run(c2, 'Cloud.ativo()') === true, 'outra aba em uso: não encerra');
    // aba visível sem toque recarregando dados (4–5 min) NÃO regride a marca da aba que está em uso
    const recente = Date.now() - 30000;
    c2.localStorage.setItem(ESC.chaves.atividade, JSON.stringify({ em: recente, limite: 6 * 3600000 }));
    await run(c2, 'Cloud.carregarTudo(true)');
    afirma(JSON.parse(c2.__armaz[ESC.chaves.atividade]).em >= recente && run(c2, 'Cloud.ultimaAtividade()') >= recente, 'recarga periódica mantém a marca mais nova (de qualquer aba)');
    // limite do admin: 10 h segura; 0 desliga
    const { ctx: c3, banco: b3 } = await iniciado();
    run(c3, 'state.settings.inatividadeHoras = 10');
    parar(c3, 7);
    await c3.__intervalos.find(i => i.ms === 60000).fn(); await esperar(15);
    afirma(run(c3, 'Cloud.ativo()') === true, 'limite 10 h: 7 h parado segue conectado');
    run(c3, 'state.settings.inatividadeHoras = 0');
    parar(c3, 500);
    await c3.__intervalos.find(i => i.ms === 60000).fn(); await esperar(15);
    afirma(run(c3, 'Cloud.ativo()') === true, 'limite 0: nunca encerra');
    // o limite vai para config.geral (todo o time) e é lido de volta
    run(c3, 'state.settings.inatividadeHoras = 10; save();');
    await run(c3, 'Cloud.sincronizar()');
    const geral = (b3.db.config || []).find(r => r.chave === 'geral');
    afirma(!!geral && geral.valor.inatividadeHoras === 10, 'config.geral.inatividadeHoras = 10');
    const n = v => run(c3, `normHorasInatividade(${JSON.stringify(v)})`);
    afirma(n(undefined) === 6 && n('') === 6 && n('abc') === 6 && n(-1) === 6 && n(0) === 0 && n('2.5') === 2.5 && n(99) === 24, 'normHorasInatividade: padrão 6, 0 desliga, teto 24');
    const f = v => run(c3, `fmtHorasInatividade(${v})`);
    afirma(f(6) === '6 h' && f(0.5) === '30 min' && f(2.5) === '2,5 h', 'fmtHorasInatividade: 6 h / 30 min / 2,5 h');
  });

  await caso('inatividade: eventos reais gravam 1x/min; voltar para a aba e o mouse ao "acordar" conferem o limite (S4)', async () => {
    const { ctx } = await iniciado();
    // (a) mexer no mouse marca uso na memória; a gravação espera 1 min desde a última
    const antes = JSON.parse(ctx.__armaz[ESC.chaves.atividade]).em;
    const t = Date.now();
    ctx.__doc('mousemove');
    afirma(run(ctx, 'Cloud.ultimaAtividade()') >= t && JSON.parse(ctx.__armaz[ESC.chaves.atividade]).em === antes, 'mousemove marca uso; não regrava antes de 1 min');
    afirma(run(ctx, 'Cloud.ativo()') === true, 'segue conectado');
    // (b) computador dormiu com a aba visível: o primeiro mousemove ao acordar encerra, em vez de zerar o relógio
    const velho = Date.now() - 7 * 3600000;
    ctx.localStorage.setItem(ESC.chaves.atividade, JSON.stringify({ em: velho, limite: 6 * 3600000 }));
    run(ctx, `Cloud.marcarAtividade(${velho})`);
    ctx.__doc('mousemove'); await esperar(15);
    afirma(run(ctx, 'Cloud.ativo()') === false && ctx.__recarregou === true, 'mouse ao acordar: sessão encerrada (não virou "uso")');
    // (c) voltar para a aba (visibilitychange) também confere
    const { ctx: c2 } = await iniciado();
    c2.localStorage.setItem(ESC.chaves.atividade, JSON.stringify({ em: velho, limite: 6 * 3600000 }));
    run(c2, `Cloud.marcarAtividade(${velho})`);
    c2.document.hidden = true; c2.__doc('visibilitychange'); await esperar(15);
    afirma(run(c2, 'Cloud.ativo()') === true, 'aba escondida: nada acontece');
    c2.document.hidden = false; c2.__doc('visibilitychange'); await esperar(15);
    afirma(run(c2, 'Cloud.ativo()') === false, 'voltou para a aba depois de 7 h: encerrada');
    // (d) marca recente: voltar para a aba só pulsa a presença
    const { ctx: c3, banco: b3 } = await iniciado();
    b3.chamadas.length = 0;
    c3.__doc('visibilitychange'); await esperar(15);
    afirma(run(c3, 'Cloud.ativo()') === true && b3.chamadas.some(c => c.cam === 'rpc/registrar_presenca'), 'uso recente: segue conectado e pulsa a presença');
  });

  await caso('Sair dentro do Chat: ChatUI.sair com confirmação, botão no rail e no painel (S5)', async () => {
    const { ctx } = await iniciado();
    const vistas = carregarChat(ctx);
    afirma(typeof ctx.ChatUI.sair === 'function', 'ChatUI.sair existe');
    let html = '';
    try { html = vistas.atendimento(); } catch (e) { console.log('  (render do Chat falhou no simulador: ' + e.message + ')'); }
    afirma(/class="wa-rail-btn wa-rail-sair"[^>]*onclick="ChatUI\.sair\(\)"/.test(html), 'rail tem o botão Sair chamando ChatUI.sair');
    afirma(/Sair do sistema/.test(html) || _c_painelConfig(ctx, vistas), 'painel Configurações do Chat oferece "Sair do sistema"');
    // cancelar não sai; confirmar sai (mesmo caminho do botão da barra lateral)
    ctx.confirm = () => false;
    run(ctx, 'ChatUI.sair()'); await esperar(15);
    afirma(run(ctx, 'Cloud.ativo()') === true && !ctx.__recarregou, 'cancelou: continua conectado');
    ctx.confirm = () => true;
    run(ctx, 'ChatUI.sair()'); await esperar(15);
    afirma(run(ctx, 'Cloud.ativo()') === false && !ctx.__armaz[ESC.chaves.sessao] && ctx.__recarregou === true, 'confirmou: sessão encerrada e página recarregada');
  });
  await caso('anexos: até 5 por envio de qualquer tipo, saída em sequência (legenda só no 1º), "Documento" sem compressão, não lidas zeradas no modo espião (S6)', async () => {
    const { ctx, banco } = await iniciado();
    const vistas = carregarChat(ctx);
    const cid = run(ctx, 'state.conversas[0].id');
    run(ctx, "Cloud.uploadMidia = async f => ({ url: 'https://x/' + f.name, mime: f.type, nome: f.name, tamanho: f.size })");
    run(ctx, `ChatUI.abrir('${cid}')`);
    const arq = (name, type) => ({ name, type, size: 10 });
    ctx.ChatUI.arquivoEscolhido({ files: [arq('contrato.pdf', 'application/pdf'), arq('foto.png', 'image/png'), arq('video.mp4', 'video/mp4'), arq('planilha.xlsx', 'application/vnd.ms-excel'), arq('audio.mp3', 'audio/mpeg'), arq('extra.txt', 'text/plain')], dataset: {}, value: '' });
    let html = vistas.atendimento();
    afirma((html.match(/class="wa-anexo-item/g) || []).length === 5, '6 escolhidos → 5 na fila (teto por envio)');
    afirma(ctx.__toasts.some(t => /Só cabem mais/.test(t.m)), 'avisou que o 6º ficou de fora');
    ctx.ChatUI.limparAnexo(4); ctx.ChatUI.limparAnexo(3);
    afirma((vistas.atendimento().match(/class="wa-anexo-item/g) || []).length === 3, 'remoção individual tira só aquele arquivo');
    // modo espião com "zerar ao enviar": anexo zera as não lidas
    run(ctx, 'Object.assign(Cloud.perfil(), { modo_espiao: true, espiao_zera_ao_enviar: true }); state.conversas[0].naoLidas = 3');
    banco.chamadas.length = 0;
    ctx.__els['wa-input'].value = 'Segue o *contrato* assinado';
    const antes = run(ctx, 'state.mensagens.length');
    await run(ctx, 'ChatUI.enviar()'); await esperar(30);
    const lista = JSON.parse(run(ctx, `JSON.stringify(state.mensagens.slice(${antes}))`));
    afirma(lista.length === 3 && lista.map(m => m.tipo).join(',') === 'arquivo,imagem,video', 'três mensagens, na ordem da fila, cada tipo pelo MIME: ' + lista.map(m => m.tipo).join(','));
    afirma(lista[0].texto === 'Segue o *contrato* assinado' && lista[1].texto === '' && lista[2].texto === '', 'legenda só no primeiro');
    afirma(lista.every(m => m.direcao === 'saida' && m.conversaId === cid && String(m.midiaUrl).startsWith('https://x/')), 'todas de saída, na conversa certa, com a URL do upload');
    afirma(run(ctx, 'state.conversas[0].naoLidas') === 0 && banco.chamadas.some(c => c.cam === 'rpc/marcar_lida'), 'espião: anexo zera as não lidas (rpc marcar_lida)');
    afirma((vistas.atendimento().match(/class="wa-anexo-item/g) || []).length === 0, 'fila esvaziada depois do envio');
    // "Documento": foto escolhida por ali vai como arquivo (sem a compressão do WhatsApp)
    ctx.ChatUI.arquivoEscolhido({ files: [arq('scan.jpg', 'image/jpeg')], dataset: { documento: '1' }, value: '' });
    const antes2 = run(ctx, 'state.mensagens.length');
    await run(ctx, 'ChatUI.enviar()'); await esperar(30);
    afirma(run(ctx, `state.mensagens[${antes2}].tipo`) === 'arquivo', 'foto via "Documento" sai como arquivo');
    // modo anotação: o clipe some e anexar é recusado (nada vai para o cliente)
    run(ctx, 'ChatUI.toggleNota(true)');
    ctx.ChatUI.arquivoEscolhido({ files: [arq('x.pdf', 'application/pdf')], dataset: {}, value: '' });
    afirma(ctx.__toasts.some(t => /Saia do modo anotação/.test(t.m)) && !/title="Anexar"/.test(vistas.atendimento()), 'modo anotação: sem clipe e anexo recusado');
  });

  await caso('bolha: id do WhatsApp redesenha (barra de ações aparece), apagada mantém o conteúdo, anotação com linhas e menções, contato compartilhado vira cartão (S7)', async () => {
    const { ctx } = await iniciado();
    const vistas = carregarChat(ctx);
    const cid = run(ctx, 'state.conversas[0].id');
    run(ctx, `ChatUI.abrir('${cid}')`);
    const m = { id: 'm-nova', conversaId: cid, direcao: 'saida', tipo: 'texto', texto: 'oi', status: 'pendente', externoId: '', criadoEm: new Date().toISOString(), autor: 'u-admin' };
    const h1 = ctx.ChatUI.hashBolha(m);
    m.status = 'enviando'; m.externoId = 'WA1';
    const h2 = ctx.ChatUI.hashBolha(m);
    afirma(h1 !== h2, 'id do WhatsApp muda o núcleo da bolha (redesenha)');
    m.status = 'enviada';
    afirma(h2 !== ctx.ChatUI.hashBolha(m), 'sair de pendente/enviando muda o núcleo da bolha');
    run(ctx, `state.mensagens.push(${JSON.stringify(m)})`);
    let html = vistas.atendimento();
    afirma(/title="Apagar para o cliente"/.test(html), 'mensagem enviada com id tem o botão de apagar');
    run(ctx, "state.mensagens.find(x => x.id === 'm-nova').apagada = true");
    html = vistas.atendimento();
    const bolhaNova = html.slice(html.indexOf('data-mid="m-nova"')).split('<div class="wa-bolha ')[0];
    afirma(/Apagada para o cliente — continua visível para a equipe/.test(bolhaNova) && /class="wa-bolha-txt">oi<\/div>/.test(bolhaNova) && !/title="Apagar para o cliente"/.test(bolhaNova), 'apagada: selo + conteúdo preservado, sem ações');
    run(ctx, `state.time = [{ id: 'u-admin', nome: 'Dono MV' }, { id: 'u2', nome: 'Ana Souza' }]; state.mensagens.push({ id: 'n1', conversaId: '${cid}', direcao: 'saida', tipo: 'anotacao', texto: 'Linha 1\\n- item *forte*\\n@Ana veja https://x.com/@ana', status: 'recebida', criadoEm: new Date().toISOString(), autor: 'u-admin' })`);
    html = vistas.atendimento();
    const nota = (html.match(/<div class="wa-nota-txt">([\s\S]*?)<\/div>/) || [])[1] || '';
    afirma(/Linha 1\n- item <strong>forte<\/strong>\n/.test(nota), 'anotação mantém as quebras de linha e a formatação: ' + JSON.stringify(nota.slice(0, 60)));
    afirma(/<span class="mencao">@Ana<\/span> veja/.test(nota), 'menção destacada');
    afirma(/href="https:\/\/x\.com\/@ana"/.test(nota), 'menção dentro do link não quebra o href');
    // contato compartilhado (vCard do WhatsApp) vira cartão com ações
    run(ctx, `state.mensagens.push({ id: 'ct1', conversaId: '${cid}', direcao: 'entrada', tipo: 'texto', texto: 'Contato compartilhado: Alison\\nBEGIN:VCARD\\nVERSION:3.0\\nN:;Alison;;;\\nFN:Alison\\nTEL;type=CELL;type=VOICE;waid=554598340783:+55 45 99834-0783\\nEND:VCARD', status: 'recebida', criadoEm: new Date().toISOString() })`);
    html = vistas.atendimento();
    afirma(/class="wa-contato"/.test(html) && /<b>Alison<\/b>/.test(html) && /\+55 45 99834-0783/.test(html) && !/BEGIN:VCARD/.test(html), 'cartão com nome e telefone, sem o vCard cru');
    afirma(/participanteConversar\('554598340783','Alison'\)/.test(html) && /UI\.copiar\('554598340783'/.test(html) && /contatoParaLead\('Alison','554598340783'\)/.test(html), 'ações: conversar, copiar e salvar no CRM com o número do waid');
    // a lista mostra a última mensagem da conversa (c.ultimaMsg, que o motor grava com o vCard inteiro)
    run(ctx, `state.conversas[0].ultimaMsg = state.mensagens.find(x => x.id === 'ct1').texto`);
    html = vistas.atendimento();
    afirma(/Contato: Alison/.test(html) && !/wa-previa">[^<]*BEGIN:VCARD/.test(html), 'prévia na lista mostra "Contato: Alison" em vez do vCard cru');
    run(ctx, "ChatUI.contatoParaLead('Alison', '554598340783')");
    afirma(run(ctx, "state.leads.some(l => l.nome === 'Alison' && l.telefone === '554598340783')"), 'salvar no CRM cria o lead com nome e telefone');
  });

  await caso('emoji: busca em português e "Mais usados" por usuário; formatação: envolve a seleção ou insere o par (S8)', async () => {
    const { ctx } = await iniciado();
    const vistas = carregarChat(ctx);
    const cid = run(ctx, 'state.conversas[0].id');
    run(ctx, `ChatUI.abrir('${cid}')`);
    afirma(run(ctx, "typeof EMOJI_NOMES === 'object' && Object.keys(EMOJI_NOMES).length > 900"), 'js/emojis.js carregado com os nomes');
    run(ctx, 'ChatUI.toggleEmoji()');
    run(ctx, "ChatUI.emojiBusca('coração')");
    let grade = (vistas.atendimento().match(/id="wa-emojis-grid">([\s\S]*?)<\/div>/) || [])[1] || '';
    afirma(/❤️|🧡|💛/.test(grade) && !/🚗/.test(grade), 'busca "coração" (com acento) acha corações e não carros');
    run(ctx, "ChatUI.emojiBusca('')"); run(ctx, "ChatUI.emoji('🙏')"); run(ctx, "ChatUI.emoji('🙏')"); run(ctx, "ChatUI.emoji('👍')");
    afirma(ctx.__els['wa-input'].value.includes('🙏🙏👍'), 'emoji entra no texto');
    const rec = JSON.parse(ctx.__armaz[ESC.chaves.emojis + 'u-admin'] || '{}');
    afirma(rec['🙏'] === 2 && rec['👍'] === 1, 'mais usados contados por usuário (chave com o id do perfil)');
    run(ctx, 'ChatUI.emojiCat(0)');
    grade = (vistas.atendimento().match(/id="wa-emojis-grid">([\s\S]*?)<\/div>/) || [])[1] || '';
    afirma(grade.indexOf('🙏') >= 0 && grade.indexOf('🙏') < grade.indexOf('👍'), 'aba "Mais usados" lista os recentes, o mais usado primeiro');
    const ta = ctx.__els['wa-input'];
    ta.value = 'segue o contrato'; ta.selectionStart = 8; ta.selectionEnd = 16;
    run(ctx, "ChatUI.formatar('*')");
    afirma(ta.value === 'segue o *contrato*' && ta.selectionStart === 18, 'seleção envolvida com * e cursor depois: ' + ta.value);
    ta.value = 'x '; ta.selectionStart = ta.selectionEnd = 2;
    run(ctx, "ChatUI.formatar('_')");
    afirma(ta.value === 'x __' && ta.selectionStart === 3, 'sem seleção: par inserido com o cursor no meio');
    ta.value = 'a  b '; ta.selectionStart = 1; ta.selectionEnd = 5;
    run(ctx, "ChatUI.formatar('~')");
    afirma(ta.value === 'a  ~b~ ', 'espaços nas pontas da seleção ficam fora dos marcadores: ' + JSON.stringify(ta.value));
  });

  await caso('link da conversa: "Copiar link" no menu ⋯ copia o endereço e fecha o menu; #/atendimento/<id> abre a conversa, consome o id, avisa id desconhecido e acerta o filtro Arquivadas (S9)', async () => {
    const { ctx, banco } = await iniciado();
    const vistas = carregarChat(ctx);
    const cid = run(ctx, 'state.conversas[0].id');
    const cid2 = run(ctx, 'state.conversas[1].id');
    const cid3 = run(ctx, 'state.conversas[2].id');
    // 1) o menu de três pontinhos oferece o item, sem exigir alçada
    run(ctx, `ChatUI.abrir('${cid}')`);
    ctx.ChatUI.menuMais({ stopPropagation() {} });
    let html = vistas.atendimento();
    afirma(new RegExp(`onclick="ChatUI\\.copiarLink\\('${cid}'\\)"[^>]*>\\s*Copiar link da conversa`).test(html), 'menu ⋯ oferece "Copiar link da conversa"');
    // 2) copiar: endereço completo com o id; o menu fecha, então o retorno é o toast próprio (botao=null)
    let copiado = null;
    ctx.UI.copiar = (t, botao, aviso) => { copiado = { t, botao, aviso }; return Promise.resolve(true); };
    run(ctx, `ChatUI.copiarLink('${cid}')`);
    afirma(!!copiado && copiado.t === ctx.location.origin + '/#/atendimento/' + cid, 'copia o endereço completo da conversa: ' + (copiado && copiado.t));
    afirma(!!copiado && copiado.botao === null && /Link da conversa copiado/.test(copiado.aviso || ''), 'sem retorno no botão (o menu fecha) e com aviso próprio');
    afirma(!/Copiar link da conversa/.test(vistas.atendimento()), 'menu ⋯ fechou depois de copiar');
    // 3) rota com id: abre a conversa, zera não lidas, busca o histórico dela e tira o id da URL
    const trocas = [];
    ctx.history.replaceState = (a, b, url) => trocas.push(url);
    banco.chamadas.length = 0;
    html = vistas.atendimento(cid2); await esperar(20);   // marcar lida e histórico vão ao banco de forma assíncrona
    afirma(/<b>c-b<\/b>/.test(html), 'rota #/atendimento/<id> abre a conversa pedida');
    afirma(run(ctx, 'state.conversas[1].naoLidas') === 0 && banco.chamadas.some(c => c.cam === 'rpc/marcar_lida'), 'abrir pelo link zera as não lidas como um clique');
    afirma(banco.chamadas.some(c => c.cam === 'mensagens' && c.q.includes('conversa_id=eq.' + cid2)), 'abrir pelo link busca o histórico da conversa');
    afirma(trocas[trocas.length - 1] === '#/atendimento', 'o id sai da URL depois de aberto (link consumido uma vez)');
    // 4) consumido: fechar a conversa (não lida) e redesenhar a rota sem id não a traz de volta
    run(ctx, `ChatUI.marcarNaoLida('${cid2}')`); await esperar(15);
    afirma(/Selecione uma conversa/.test(vistas.atendimento()), 'depois de "não lida" a conversa continua fechada no redesenho');
    // 5) id desconhecido (apagada ou fora dos departamentos): aviso e Chat vazio
    ctx.__toasts.length = 0;
    html = vistas.atendimento('99999999-0000-4000-8000-000000000000');
    afirma(ctx.__toasts.some(t => t.t === 'err' && /Conversa não encontrada/.test(t.m)), 'id desconhecido avisa');
    afirma(/Selecione uma conversa/.test(html) && trocas[trocas.length - 1] === '#/atendimento', 'e o Chat abre sem conversa, com o id fora da URL');
    // 6) arquivada: a lista troca para Arquivadas para a conversa aparecer; conversa ativa devolve Tudo
    run(ctx, 'state.conversas[2].arquivada = true');
    html = vistas.atendimento(cid3);
    afirma(/<b>c-c<\/b>/.test(html) && /class="wa-chip ativo" onclick="ChatUI\.filtro\('arquivadas'\)"/.test(html), 'arquivada abre e a lista mostra Arquivadas');
    html = vistas.atendimento(cid);
    afirma(/<b>c-a<\/b>/.test(html) && /class="wa-chip ativo" onclick="ChatUI\.filtro\('tudo'\)"/.test(html), 'conversa ativa devolve o filtro Tudo');
    // 7) deslogado: a tela de login não mexe no endereço — depois de entrar, cai na conversa
    ctx.location.hash = '#/atendimento/' + cid;
    run(ctx, 'Cloud.mostrarGate()');
    afirma(ctx.location.hash === '#/atendimento/' + cid, 'tela de login preserva o link da conversa');
  });

  await caso('UI.copiar com botao=null: sem retorno no botão, só o toast com o aviso pedido (modo do "Copiar link")', async () => {
    const ctx = novoContexto({ banco: null });
    let escrito = null; const avisos = [];
    ctx.navigator = { clipboard: { writeText: async t => { escrito = t; } } };
    ctx.__els.toasts = { appendChild: el => avisos.push(el.textContent) };
    vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/ui-core.js'), 'utf8'), ctx, { filename: 'js/ui-core.js' });
    const ok = await run(ctx, "UI.copiar('https://x/#/atendimento/1', null, 'Link da conversa copiado.')");
    afirma(ok === true && escrito === 'https://x/#/atendimento/1', 'escreveu o texto na área de transferência');
    afirma(avisos.length === 1 && avisos[0] === 'Link da conversa copiado.', 'toast com o aviso pedido: ' + JSON.stringify(avisos));
    avisos.length = 0;
    await run(ctx, "UI.copiar('abc', null)");
    afirma(avisos[0] === 'Mensagem copiada.', 'sem aviso: texto padrão');
  });

  await caso('IA do escritório (front): ai.js manda o comando do contrato, espera o motor e traduz os erros', async () => {
    const { ctx, banco } = await iniciado();
    vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/ai.js'), 'utf8'), ctx, { filename: 'js/ai.js' });
    afirma(run(ctx, 'AI.configurado()') === true, 'na nuvem a IA conta como configurada (quem decide é o motor)');
    afirma(run(ctx, "AI.MODELOS.map(m => m.id).join(',')") === 'claude-opus-5-5,claude-sonnet-5-5', 'lista de modelos atual');
    const ultimo = () => banco.db.motor_comandos[banco.db.motor_comandos.length - 1];
    const fechar = (resultado, erro) => { const c = ultimo(); c.status = erro ? 'erro' : 'ok'; c.erro = erro || ''; c.resultado = resultado || null; };
    let pr = run(ctx, "AI.resumirConversa('Cliente: oi', 'Maria', 'conv-1')"); await esperar(10); fechar({ texto: 'resumo do motor', uso: {} });
    afirma(await pr === 'resumo do motor', 'resumo devolve o texto do motor');
    let cmd = ultimo();
    afirma(cmd.tipo === 'ia_resumo' && cmd.payload.conversaId === 'conv-1' && cmd.payload.transcript === 'Cliente: oi' && cmd.payload.nomeContato === 'Maria' && cmd.autor === 'u-admin', 'ia_resumo com o payload do contrato');
    pr = run(ctx, "AI.perguntarConversa('Cliente: oi', 'qual o prazo?', 'Maria', 'conv-1')"); await esperar(10); fechar({ texto: 'dia 10', uso: {} });
    afirma(await pr === 'dia 10' && ultimo().tipo === 'ia_pergunta' && ultimo().payload.pergunta === 'qual o prazo?', 'ia_pergunta com a pergunta');
    pr = run(ctx, "AI.analisarConversa({ conversaTexto: 'A: oi\\nB: olá', atendente: 'Ana' }, { nome: 'Lead X', empresa: 'E', dor: 'd', valor: 10, etapa: 'Novo' })"); await esperar(10); fechar({ dados: { scoreGeral: 80 }, uso: {} });
    afirma((await pr).scoreGeral === 80 && ultimo().tipo === 'ia_analise' && ultimo().payload.lead.nome === 'Lead X' && ultimo().payload.atendente === 'Ana' && !('conversaId' in ultimo().payload), 'ia_analise com conversa, atendente e lead, sem conversaId');
    pr = run(ctx, "AI.gerarAutomacao('dê boas-vindas', 'departamentos: X')"); await esperar(10); fechar({ dados: { nome: 'Boas-vindas' }, uso: {} });
    afirma((await pr).nome === 'Boas-vindas' && ultimo().tipo === 'ia_automacao' && ultimo().payload.pedido === 'dê boas-vindas' && ultimo().payload.contexto === 'departamentos: X', 'ia_automacao com pedido e contexto');
    pr = run(ctx, 'AI.testar()'); await esperar(10); fechar({ ok: true, modelo: 'claude-opus-5-5', uso: {} });
    afirma((await pr).modelo === 'claude-opus-5-5' && ultimo().tipo === 'ia_teste', 'testar manda ia_teste');
    pr = run(ctx, "AI.resumirConversa('x', 'M', 'c')"); await esperar(10); fechar(null, 'comando desconhecido: ia_resumo');
    await pr.then(() => afirma(false, 'deveria falhar'), e => afirma(/motor ainda não foi atualizado/.test(e.message), 'motor velho → "motor ainda não foi atualizado"'));
    pr = run(ctx, "AI.resumirConversa('x', 'M', 'c')"); await esperar(10); fechar(null, 'IA do escritório não configurada: defina ANTHROPIC_API_KEY nas variáveis do Railway');
    await pr.then(() => afirma(false, 'deveria falhar'), e => afirma(/ANTHROPIC_API_KEY/.test(e.message), 'admin vê a mensagem completa'));
    run(ctx, "Cloud.perfil().papel = 'atendente'");
    pr = run(ctx, "AI.resumirConversa('x', 'M', 'c')"); await esperar(10); fechar(null, 'IA do escritório não configurada: defina ANTHROPIC_API_KEY nas variáveis do Railway');
    await pr.then(() => afirma(false, 'deveria falhar'), e => afirma(/[Aa]vise o administrador/.test(e.message) && !/ANTHROPIC/.test(e.message), 'atendente vê "Avise o administrador", sem a variável'));
    pr = run(ctx, "AI.resumirConversa('x', 'M', 'c')");   // ninguém fecha: a espera de 120 s (timers encurtados no simulador) esgota
    await pr.then(() => afirma(false, 'deveria falhar'), e => afirma(/demorou demais/.test(e.message), 'espera esgotada → "A IA demorou demais"'));
  });

  await caso('IA do escritório (front): modeloIA é do admin e a chave sumiu do navegador', async () => {
    const agoraISO = new Date().toISOString();
    const { ctx, banco } = await iniciado({ extra: { config: [{ chave: 'geral', valor: { modeloIA: 'claude-opus-5-5', empresa: 'MV' }, atualizado_em: agoraISO }] } });
    afirma(run(ctx, 'state.settings.modeloIA') === 'claude-opus-5-5' && run(ctx, "'apiKey' in state.settings") === false && run(ctx, "'modelo' in state.settings") === false, 'carga: modeloIA do banco; apiKey e modelo antigos sumiram');
    // atendente trocando o modelo localmente não derruba o do banco (CHAVES_ADMIN); admin troca
    run(ctx, "Cloud.perfil().papel = 'atendente'; state.settings.modeloIA = 'claude-sonnet-5-5'; save();");
    banco.chamadas.length = 0;
    await run(ctx, 'Cloud.sincronizarAgora()'); await esperar(20);
    afirma(!banco.chamadas.some(c => c.cam.startsWith('config') && /claude-sonnet-5-5/.test(JSON.stringify(c.corpo || ''))), 'atendente: modeloIA do banco preservado no sync');
    run(ctx, "Cloud.perfil().papel = 'admin'; state.settings.modeloIA = 'claude-sonnet-5-5'; save();");
    banco.chamadas.length = 0;
    await run(ctx, 'Cloud.sincronizarAgora()'); await esperar(20);
    afirma(banco.chamadas.some(c => c.cam.startsWith('config') && /claude-sonnet-5-5/.test(JSON.stringify(c.corpo || ''))), 'admin: modeloIA novo sobe para config.geral');
    run(ctx, "Cloud.importarDados({ settings: { apiKey: 'sk-velha', modelo: 'claude-opus-4-8' }, leads: [] })");
    afirma(!ctx.__armaz[ESC.chaves.ia] && run(ctx, "'apiKey' in state.settings") === false, 'backup com chave antiga não grava nada no navegador');
    const semNuvem = novoContexto({ banco: null, sessao: false });
    vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/ai.js'), 'utf8'), semNuvem, { filename: 'js/ai.js' });
    afirma(run(semNuvem, 'AI.configurado()') === false, 'fora da nuvem a IA não existe');
  });

  await caso('Configurações: admin vê "IA do escritório" com modelo e Testar; ninguém vê "Chave da API"; atendente não vê IA', async () => {
    const { ctx } = await iniciado();
    const vistas = carregarExtra(ctx);
    let html = vistas.config();
    afirma(/IA do escritório/.test(html) && /id="cf-modelo-ia"/.test(html) && /claude-sonnet-5-5/.test(html) && /Views\.testarIA\(\)/.test(html), 'admin: cartão com seletor de modelo e Testar');
    afirma(!/Chave da API/.test(html) && !/sk-ant/.test(html) && !/platform\.claude\.com/.test(html), 'cartão da chave sumiu');
    run(ctx, "Cloud.perfil().papel = 'atendente'");
    html = vistas.config();
    afirma(!/IA do escritório/.test(html) && !/Chave da API/.test(html), 'atendente: nada de IA em Configurações');
    // indicador da IA: o modelo vem da escolha do admin (state.settings.modeloIA), não do motor_estado velho
    ctx.__els['ia-status'] = { innerHTML: '' };
    run(ctx, "state.settings.modeloIA = 'claude-sonnet-5-5'");
    run(ctx, "statusIA({ recursos: { ia: true, modelo: 'claude-opus-5-5' } })");
    afirma(/Ativa/.test(ctx.__els['ia-status'].innerHTML) && /Sonnet/.test(ctx.__els['ia-status'].innerHTML) && !/Opus/.test(ctx.__els['ia-status'].innerHTML), 'chip "Ativa" mostra o modelo escolhido pelo admin, não o gravado pelo motor');
    run(ctx, 'statusIA({ recursos: {} })');
    afirma(/sem a atualização/.test(ctx.__els['ia-status'].innerHTML), 'recursos vazio (motor antigo) → "sem a atualização", não "não configurada"');
    run(ctx, 'statusIA({ recursos: { ia: false } })');
    afirma(/Não configurada/.test(ctx.__els['ia-status'].innerHTML), 'ia: false → "Não configurada"');
    run(ctx, 'statusIA(null)');
    afirma(/sem resposta/.test(ctx.__els['ia-status'].innerHTML), 'sem linha → "Motor sem resposta"');
  });

  await caso('Chat e CRM: textos apontam para a IA do escritório, não para "sua chave"', async () => {
    const { ctx } = await iniciado();
    const vistas = carregarChat(ctx);
    try { run(ctx, "ChatUI.painel('config')"); } catch (e) { /* recolherRail: o simulador não tem .matches */ }
    const html = vistas.atendimento();
    afirma(/IA do escritório/.test(html) && !/[Cc]onfigure a chave/.test(html), 'painel Config do Chat fala da IA do escritório');
    const fonte = fs.readFileSync(path.join(RAIZ, 'js/views-chat.js'), 'utf8') + fs.readFileSync(path.join(RAIZ, 'js/views-analysis.js'), 'utf8');
    afirma(!/Configure a chave da IA/.test(fonte) && !/usa sua chave da Anthropic/.test(fonte) && !/Verifique sua chave/.test(fonte), 'nenhum texto antigo de chave sobrou no Chat nem no CRM');
    afirma(/iaResumo[\s\S]{0,700}AI\.resumirConversa\(conversaComoTexto\(c\), c\.nome, c\.id\)/.test(fonte), 'resumo passa o id da conversa');
    afirma(/AI\.perguntarConversa\(conversaComoTexto\(c\), pergunta, c\.nome, c\.id\)/.test(fonte), 'busca passa o id da conversa');
  });

  await caso('filtro de departamentos com mais de um: botão abre lista de marcar, soma departamentos, "Sem departamento" entra, Limpar zera, célula do dashboard escolhe um só', async () => {
    const { ctx } = await iniciado();
    const vistas = carregarChat(ctx);
    const jur = run(ctx, 'state.departamentos[0].id');
    run(ctx, "state.departamentos.push({ id: 'dep-fin', nome: 'Financeiro', cor: '#4C9673', permissoes: {} }); state.conversas[0].departamentoIds = ['" + jur + "']; state.conversas[1].departamentoIds = ['dep-fin']; state.conversas[2].departamentoIds = [];");
    const itens = html => (html.match(/class="wa-conv /g) || []).length;
    let html = vistas.atendimento();
    afirma(itens(html) === 3 && /class="wa-chip wa-filtro-depto "[^>]*>\s*Depto/.test(html) && !/<select onchange="ChatUI\.set\('dept'/.test(html), 'sem filtro: 3 conversas, botão "Depto", sem o select antigo');
    ctx.ChatUI.menuDepto({ stopPropagation() {} });
    html = vistas.atendimento();
    afirma((html.match(/class="wa-menu-opcao"/g) || []).length === 3 && /Sem departamento/.test(html) && /Financeiro/.test(html), 'lista aberta: Sem departamento + 2 departamentos');
    run(ctx, `ChatUI.deptoToggle('${jur}', true)`);
    html = vistas.atendimento();
    afirma(itens(html) === 1 && /<b>c-a<\/b>|>c-a</.test(html) && /class="wa-chip wa-filtro-depto ativo"[^>]*>\s*Jurídico/.test(html), 'um departamento: só as conversas dele, botão com o nome');
    run(ctx, "ChatUI.deptoToggle('dep-fin', true)");
    html = vistas.atendimento();
    afirma(itens(html) === 2 && /wa-filtro-depto ativo"[^>]*>\s*2 deptos/.test(html), 'dois departamentos: conversas de qualquer um deles, botão "2 deptos"');
    run(ctx, "ChatUI.deptoToggle('nenhum', true)");
    html = vistas.atendimento();
    afirma(itens(html) === 3 && /3 deptos/.test(html), '"Sem departamento" soma a fila de triagem');
    run(ctx, 'ChatUI.deptoLimpar()');
    html = vistas.atendimento();
    afirma(itens(html) === 3 && /wa-filtro-depto "[^>]*>\s*Depto/.test(html), 'Limpar zera o filtro');
    run(ctx, "ChatUI.dashFiltrar('aberto', 'tudo', 'dep-fin')");
    html = vistas.atendimento();
    afirma(itens(html) === 1 && /wa-filtro-depto ativo"[^>]*>\s*Financeiro/.test(html), 'célula do dashboard escolhe um departamento só');
  });

  await caso('notificações: não lidas primeiro com contagem, lidas em seção própria e esmaecidas', async () => {
    const { ctx } = await iniciado();
    const vistas = carregarChat(ctx);
    run(ctx, "state.notificacoes = [{ id: 'n-antiga', lida: true, tipo: 'mencao', texto: 'Antiga lida', criado_em: '2026-10-06T10:00:00Z' }, { id: 'n-nova', lida: false, tipo: 'mencao', texto: 'Marcou você', criado_em: '2026-10-07T10:00:00Z' }]");
    try { run(ctx, "ChatUI.painel('notificacoes')"); } catch (e) { /* recolherRail no simulador */ }
    let html = vistas.atendimento();
    const iNao = html.indexOf('Não lidas (1)'), iLidas = html.indexOf('>Lidas<');
    afirma(iNao > 0 && iLidas > iNao, 'seção "Não lidas (1)" vem antes de "Lidas"');
    afirma(html.indexOf('Marcou você') < html.indexOf('Antiga lida'), 'a não lida aparece antes da lida');
    afirma(/class="wa-notif lida"[^>]*onclick="ChatUI\.abrirNotif\('n-antiga'\)"/.test(html) && /class="wa-notif naolida"[^>]*onclick="ChatUI\.abrirNotif\('n-nova'\)"/.test(html), 'lida e não lida com classes próprias');
    run(ctx, "state.notificacoes.forEach(n => n.lida = true)");
    html = vistas.atendimento();
    afirma(/Nenhuma por ler/.test(html) && /Marcar todas/.test(html) === false, 'tudo lido: "Nenhuma por ler" e sem o botão Marcar todas');
  });

  const CAMPOS_TESTE = () => [{ id: 'cp-astrea', nome: 'Astrea', tipo: 'link', ordem: 1, criado_em: new Date().toISOString() }, { id: 'cp-proc', nome: 'Nº processo', tipo: 'texto', ordem: 2, criado_em: new Date().toISOString() }];
  await caso('campos personalizados: estado, sync, função conversa_campo e alçada campos_gerir (chat-v18a)', async () => {
    const { ctx, banco } = await iniciado({ extra: { campos_personalizados: CAMPOS_TESTE() } });
    afirma(run(ctx, 'JSON.stringify(state.camposPersonalizados.map(c => c.nome))') === '["Astrea","Nº processo"]', 'carga lê a tabela na ordem');
    afirma(run(ctx, 'Cloud.camposAtivos()') === true, 'sondagem: tabela presente');
    afirma(run(ctx, 'JSON.stringify(state.conversas[0].campos)') === '{}', 'conversa sem valores → objeto vazio');
    run(ctx, "state.conversas[0].campos = { 'cp-proc': '123' }; save();");
    banco.chamadas.length = 0; await run(ctx, 'Cloud.sincronizarAgora()'); await esperar(20);
    afirma(!banco.chamadas.some(c => c.cam === 'conversas' && /cp-proc/.test(JSON.stringify(c.corpo || ''))), 'a linha da conversa nunca sobe com campos');
    banco.chamadas.length = 0;
    const cid = run(ctx, 'state.conversas[0].id');
    const novo = await run(ctx, `Cloud.definirCampo('${cid}', 'cp-astrea', 'https://astrea.net.br/x')`);
    const ch = banco.chamadas.find(c => c.cam === 'rpc/conversa_campo');
    afirma(!!ch && ch.corpo.cid === cid && ch.corpo.chave === 'cp-astrea' && ch.corpo.valor === 'https://astrea.net.br/x', 'rpc conversa_campo com cid, chave e valor');
    afirma(!!novo && novo['cp-astrea'] === 'https://astrea.net.br/x', 'devolve o objeto de valores novo');
    run(ctx, "state.camposPersonalizados.push({ id: 'cp-drive', nome: 'Drive', tipo: 'link', ordem: 3 }); save();");
    banco.chamadas.length = 0; await run(ctx, 'Cloud.sincronizarAgora()'); await esperar(20);
    afirma(banco.chamadas.some(c => c.metodo === 'POST' && c.cam === 'campos_personalizados' && /Drive/.test(JSON.stringify(c.corpo))), 'campo novo sobe para campos_personalizados pelo sync');
    const vistas = carregarChat(ctx);
    afirma(run(ctx, "ChatUI.pode('campos_gerir')") === true, 'admin pode gerir');
    run(ctx, "Cloud.perfil().papel = 'atendente'; Cloud.perfil().permissoes = {};");
    afirma(run(ctx, "ChatUI.pode('campos_gerir')") === false, 'atendente sem a chave não gere (fora do padrão)');
    run(ctx, "Cloud.perfil().permissoes = { campos_gerir: true };");
    afirma(run(ctx, "ChatUI.pode('campos_gerir')") === true, 'com a chave no perfil, gere');
    void vistas;
    // banco sem a migração: carga não quebra, lista vazia, sondagem falsa, aviso ao admin
    const velho = bancoPadrao(); delete velho.db.campos_personalizados;
    const ctx2 = novoContexto({ banco: velho });
    afirma(await run(ctx2, 'Cloud.iniciar()') === true && run(ctx2, 'state.camposPersonalizados.length') === 0 && run(ctx2, 'Cloud.camposAtivos()') === false, 'sem a tabela: entra normal, lista vazia, camposAtivos falso');
  });

  await caso('campos personalizados no drawer: linhas na ordem, Link com abrir/copiar, salvar pela função, vazio apaga, erro volta, grupo também, busca acha pelo valor, modo local', async () => {
    const { ctx, banco } = await iniciado({ extra: { campos_personalizados: CAMPOS_TESTE() } });
    const vistas = carregarChat(ctx);
    const cid = run(ctx, 'state.conversas[0].id');
    // o banco falso guarda os mesmos valores que o estado: a função devolve o objeto completo do banco (é o que acontece em produção)
    banco.db.conversas[0].campos = { 'cp-astrea': 'https://astrea.net.br/x', 'cp-proc': 'a "b" <c>' };
    run(ctx, `state.conversas[0].campos = { 'cp-astrea': 'https://astrea.net.br/x', 'cp-proc': 'a "b" <c>' }; ChatUI.abrir('${cid}'); ChatUI.drawer(true);`);
    let html = vistas.atendimento();
    const iA = html.indexOf('wa-campo-pers-rotulo">Astrea<'), iP = html.indexOf('wa-campo-pers-rotulo">Nº processo<');
    afirma(iA > 0 && iP > iA, 'dois campos na ordem, abaixo das tags');
    afirma(/data-campo="cp-astrea"[^>]*value="https:\/\/astrea\.net\.br\/x"/.test(html) && /href="https:\/\/astrea\.net\.br\/x"[^>]*target="_blank"[^>]*rel="noopener"/.test(html) && /UI\.copiar\('https:\/\/astrea\.net\.br\/x', this\)/.test(html), 'Link com valor http: caixa, abrir em nova aba e copiar');
    const trecho = html.slice(html.indexOf('data-campo="cp-proc"'), html.indexOf('data-campo="cp-proc"') + 200);
    afirma(/value="a &quot;b&quot; &lt;c&gt;"/.test(trecho) && !/<c>/.test(trecho), 'valor com aspas e < escapado no atributo');
    banco.db.conversas[0].campos['cp-astrea'] = 'astrea.net.br/x';
    run(ctx, "state.conversas[0].campos['cp-astrea'] = 'astrea.net.br/x'"); html = vistas.atendimento();
    afirma(!/href="astrea\.net\.br/.test(html) && !/href="javascript/.test(html), 'link sem http não vira clicável');
    afirma(/Gerenciar campos personalizados/.test(html), 'admin vê o botão de gerenciar');
    banco.chamadas.length = 0;
    const caixa = { value: ' 0001234-56.2026 ', dataset: { campo: 'cp-proc' }, classList: { add(c) { this.c = c; }, remove() {} } };
    await ctx.ChatUI.salvarCampo(cid, 'cp-proc', caixa); await esperar(20);
    const ch = banco.chamadas.find(c => c.cam === 'rpc/conversa_campo');
    afirma(!!ch && ch.corpo.chave === 'cp-proc' && ch.corpo.valor === '0001234-56.2026' && run(ctx, "state.conversas[0].campos['cp-proc']") === '0001234-56.2026' && caixa.classList.c === 'salvo', 'salvar chama a função, aplica o retorno e marca salvo');
    await ctx.ChatUI.salvarCampo(cid, 'cp-proc', { value: '', dataset: {}, classList: { add() {}, remove() {} } }); await esperar(20);
    const ultimaRpc = banco.chamadas.filter(c => c.cam === 'rpc/conversa_campo').slice(-1)[0];
    afirma(ultimaRpc.corpo.valor === '' && run(ctx, "'cp-proc' in state.conversas[0].campos") === false, 'vazio manda valor vazio e a chave some');
    banco.regras.rpcCampoErro = { status: 403, code: '42501', message: 'conversa não encontrada ou sem acesso' };
    ctx.__toasts.length = 0;
    await ctx.ChatUI.salvarCampo(cid, 'cp-astrea', { value: 'https://outro', dataset: {}, classList: { add() {}, remove() {} } }); await esperar(20);
    afirma(run(ctx, "state.conversas[0].campos['cp-astrea']") === 'astrea.net.br/x' && ctx.__toasts.some(t => t.t === 'err' && /Sem acesso/.test(t.m)), 'recusa do banco: valor volta e avisa');
    banco.regras.rpcCampoErro = null;
    // um colega apagou o campo no banco enquanto a tela estava aberta: a função devolve 23503,
    // a pessoa lê "foi removido" e a seção redesenha SEM o campo (lista recarregada do banco)
    banco.db.campos_personalizados = banco.db.campos_personalizados.filter(k => k.id !== 'cp-proc');
    ctx.__toasts.length = 0;
    await ctx.ChatUI.salvarCampo(cid, 'cp-proc', { value: 'x', dataset: {}, classList: { add() {}, remove() {} } }); await esperar(30);
    afirma(ctx.__toasts.some(t => /foi removido/.test(t.m)), 'campo apagado por colega: "foi removido"');
    afirma(!/data-campo="cp-proc"/.test(vistas.atendimento()) && run(ctx, "state.camposPersonalizados.some(k => k.id === 'cp-proc')") === false, 'e a seção redesenha sem o campo (lista recarregada)');
    banco.chamadas.length = 0; await run(ctx, 'Cloud.sincronizarAgora()'); await esperar(20);
    afirma(!banco.chamadas.some(c => c.metodo === 'DELETE' && c.cam === 'campos_personalizados'), 'a recarga não gera exclusão fantasma no sync');
    run(ctx, "state.conversas[1].tipo = 'grupo'; ChatUI.abrir(state.conversas[1].id); ChatUI.drawer(true);");
    afirma(/wa-campo-pers-rotulo">Astrea</.test(vistas.atendimento()), 'grupo também tem a seção');
    run(ctx, "ChatUI.set('busca', 'astrea.net')");
    html = vistas.atendimento();
    afirma((html.match(/class="wa-conv /g) || []).length === 1, 'busca acha a conversa pelo valor do campo');
    run(ctx, "ChatUI.set('busca', '')");
    run(ctx, 'state.camposPersonalizados = []'); html = vistas.atendimento();
    afirma(/Nenhum campo personalizado ainda/.test(html), 'sem campos: texto curto');
    // admin na nuvem sem a migração vê o aviso
    const velho = bancoPadrao(); delete velho.db.campos_personalizados;
    const ctx2 = novoContexto({ banco: velho }); await run(ctx2, 'Cloud.iniciar()');
    const vistas2 = carregarChat(ctx2);
    run(ctx2, 'ChatUI.abrir(state.conversas[0].id); ChatUI.drawer(true);');
    afirma(/chat-v18a\.sql/.test(vistas2.atendimento()), 'admin sem a migração vê o aviso');
    // modo local (sem nuvem): salvar funciona só com o estado
    const local = novoContexto({ banco: null, sessao: false });
    carregarChat(local);
    run(local, "state.camposPersonalizados = [{ id: 'cp-l', nome: 'Local', tipo: 'texto', ordem: 1 }]; state.conversas = [{ id: 'cv-l', telefone: '5545000', nome: 'Local', status: 'aberto', tags: [], campos: {}, tipo: 'individual', departamentoIds: [], criadoEm: new Date().toISOString() }];");
    await local.ChatUI.salvarCampo('cv-l', 'cp-l', { value: 'sem nuvem', dataset: {}, classList: { add() {}, remove() {} } });
    afirma(run(local, "state.conversas[0].campos['cp-l']") === 'sem nuvem' && !local.__toasts.some(t => t.t === 'err'), 'modo local: valor guardado no estado, sem erro');
  });

  await caso('gerenciar campos personalizados: só com a alçada; criar, renomear, tipo, mover e excluir mexem no estado e sobem no sync', async () => {
    const { ctx, banco } = await iniciado({ extra: { campos_personalizados: CAMPOS_TESTE() } });
    const vistas = carregarChat(ctx);
    const cid = run(ctx, 'state.conversas[0].id');
    let modalHtml = ''; ctx.UI.modal = html => { modalHtml = html; };
    run(ctx, 'ChatUI.gerirCampos()');
    afirma(/Gerenciar campos personalizados/.test(modalHtml) && modalHtml.indexOf('Astrea') < modalHtml.indexOf('Nº processo') && /id="cp-novo-nome"/.test(modalHtml) && /id="cp-novo-tipo"/.test(modalHtml), 'janela com a lista na ordem e o formulário');
    ctx.__els['cp-novo-nome'] = { value: ' Drive ' }; ctx.__els['cp-novo-tipo'] = { value: 'link' };
    run(ctx, 'ChatUI.campoCriar()');
    const drive = JSON.parse(run(ctx, "JSON.stringify(state.camposPersonalizados.find(c => c.nome === 'Drive') || null)"));
    afirma(!!drive && drive.ordem === 3 && drive.tipo === 'link', 'criar: nome sem espaços nas pontas, ordem = maior + 1, tipo escolhido');
    ctx.__els['cp-novo-nome'] = { value: 'drive' }; ctx.__toasts.length = 0; run(ctx, 'ChatUI.campoCriar()');
    afirma(run(ctx, 'state.camposPersonalizados.length') === 3 && ctx.__toasts.some(t => /Já existe/.test(t.m)), 'nome repetido recusado, sem distinguir maiúsculas');
    ctx.ChatUI.campoRenomear('cp-proc', { value: 'Processo' });
    ctx.ChatUI.campoTipo('cp-proc', { value: 'link' });
    afirma(run(ctx, "state.camposPersonalizados.find(c => c.id === 'cp-proc').nome") === 'Processo' && run(ctx, "state.camposPersonalizados.find(c => c.id === 'cp-proc').tipo") === 'link', 'renomear e trocar tipo');
    run(ctx, "ChatUI.campoMover('cp-proc', -1)");
    afirma(run(ctx, "state.camposPersonalizados.find(c => c.id === 'cp-proc').ordem") < run(ctx, "state.camposPersonalizados.find(c => c.id === 'cp-astrea').ordem"), 'mover para cima troca a ordem com o vizinho');
    run(ctx, "state.conversas[0].campos = { 'cp-astrea': 'https://x' }");
    ctx.confirm = () => true; run(ctx, "ChatUI.campoExcluir('cp-astrea')");
    afirma(run(ctx, "state.camposPersonalizados.some(c => c.id === 'cp-astrea')") === false && run(ctx, "state.conversas[0].campos['cp-astrea']") === 'https://x', 'excluir tira o campo e mantém os valores guardados');
    banco.chamadas.length = 0; await run(ctx, 'Cloud.sincronizarAgora()'); await esperar(20);
    afirma(banco.chamadas.some(c => c.metodo === 'POST' && c.cam === 'campos_personalizados' && /Drive/.test(JSON.stringify(c.corpo)) && /Processo/.test(JSON.stringify(c.corpo))), 'campo novo e renomeado sobem');
    afirma(banco.chamadas.some(c => c.metodo === 'DELETE' && c.cam === 'campos_personalizados' && /cp-astrea/.test(c.q)), 'exclusão sobe');
    run(ctx, "Cloud.perfil().papel = 'atendente'; Cloud.perfil().permissoes = {};");
    run(ctx, `ChatUI.abrir('${cid}'); ChatUI.drawer(true);`);
    afirma(!/Gerenciar campos personalizados/.test(vistas.atendimento()), 'atendente sem alçada não vê o botão');
    modalHtml = ''; ctx.__toasts.length = 0; run(ctx, 'ChatUI.gerirCampos()');
    afirma(modalHtml === '' && ctx.__toasts.some(t => /[Ss]em alçada/.test(t.m)), 'e a janela recusa');
    afirma(/"arrow-down":/.test(fs.readFileSync(path.join(RAIZ, 'js/icones.js'), 'utf8')), 'ícone arrow-down cadastrado');
  });

  function _c_painelConfig(ctx, vistas) {
    try { run(ctx, "ChatUI.painel('config')"); return /Sair do sistema/.test(vistas.atendimento()); } catch (e) { return false; }
  }

  await caso('falta de internet no F5 não apaga a sessão', async () => {
    const ctx = novoContexto({ banco: null });
    const ok = await run(ctx, 'Cloud.iniciar()');
    afirma(ok === false, 'não abriu (sem rede)');
    afirma(!!ctx.__armaz[ESC.chaves.sessao], 'a sessão continua guardada');
  });

  await caso('sair limpa o navegador', async () => {
    const { ctx } = await iniciado();
    ctx.localStorage.setItem(ESC.chaves.ia, '{"apiKey":"sk-x"}');
    ctx.localStorage.setItem(ESC.chaves.estado, '{}');
    await run(ctx, 'Cloud.sair()');
    afirma(!ctx.__armaz[ESC.chaves.ia] && !ctx.__armaz[ESC.chaves.estado] && !ctx.__armaz[ESC.chaves.sessao], 'sessão, dados e chave da IA removidos');
  });

  await caso('apagar anotação interna: alçada notas_apagar liberada por padrão, botão na bolha e no drawer, DELETE direto no banco, recusa do banco mantém a anotação', async () => {
    const { ctx, banco } = await iniciado();
    const vistas = carregarChat(ctx);
    afirma(run(ctx, "ChatUI.pode('notas_apagar')") === true, 'admin pode apagar');
    run(ctx, "Cloud.perfil().papel = 'atendente'; Cloud.perfil().permissoes = {};");
    afirma(run(ctx, "ChatUI.pode('notas_apagar')") === true, 'atendente sem nada configurado: liberada (padrão de atendente)');
    run(ctx, "Cloud.perfil().permissoes = { notas_criar: true };");
    afirma(run(ctx, "ChatUI.pode('notas_apagar')") === false, 'perfil configurado sem a chave: não apaga');
    run(ctx, "Cloud.perfil().permissoes = { notas_apagar: true };");
    const cid = run(ctx, 'state.conversas[0].id');
    const N1 = '55555555-0000-4000-8000-000000000001', N2 = '55555555-0000-4000-8000-000000000002';
    const agora = new Date().toISOString();
    run(ctx, `ChatUI.abrir('${cid}'); state.time = [{ id: 'u2', nome: 'Ana' }]; state.mensagens.push({ id: '${N1}', conversaId: '${cid}', direcao: 'saida', tipo: 'anotacao', texto: 'nota da Ana', status: 'recebida', criadoEm: '${agora}', autor: 'u2' })`);
    banco.db.mensagens.push({ id: N1, conversa_id: cid, direcao: 'saida', tipo: 'anotacao', texto: 'nota da Ana', midia_url: '', autor: 'u2', status: 'recebida', erro: '', externo_id: '', criado_em: agora, atualizado_em: agora });
    let html = vistas.atendimento();
    afirma(new RegExp(`ChatUI\\.apagarNota\\('${N1}'\\)`).test(html), 'bolha da anotação de um colega tem o botão de apagar');
    run(ctx, "ChatUI.drawer(true); ChatUI.drawerTab('notas')");
    afirma(new RegExp(`ChatUI\\.apagarNota\\('${N1}'\\)`).test(vistas.atendimento()), 'drawer de anotações também tem o botão');
    // confirm cancelado: nada acontece
    ctx.confirm = () => false; banco.chamadas.length = 0;
    await run(ctx, `ChatUI.apagarNota('${N1}')`); await esperar(20);
    afirma(!banco.chamadas.some(c => c.metodo === 'DELETE') && run(ctx, `state.mensagens.some(m => m.id === '${N1}')`), 'cancelou a confirmação: nada apagado');
    ctx.confirm = () => true; banco.chamadas.length = 0; ctx.__toasts.length = 0;
    await run(ctx, `ChatUI.apagarNota('${N1}')`); await esperar(20);
    const del = banco.chamadas.find(c => c.metodo === 'DELETE' && c.cam === 'mensagens');
    afirma(!!del && del.q.includes('id=eq.' + N1) && /tipo=eq\.anotacao/.test(del.q), 'DELETE mensagens?id=eq.<id>&tipo=eq.anotacao (sem passar pelo motor)');
    afirma(!run(ctx, `state.mensagens.some(m => m.id === '${N1}')`) && !banco.db.mensagens.some(m => m.id === N1), 'anotação some do estado e do banco');
    afirma(ctx.__toasts.some(t => /Anotação apagada/.test(t.m)), 'aviso de sucesso');
    // o banco não apagou nada (RLS barrou, ou um colega já apagou): a anotação fica e o aviso explica
    run(ctx, `state.mensagens.push({ id: '${N2}', conversaId: '${cid}', direcao: 'saida', tipo: 'anotacao', texto: 'fantasma', status: 'recebida', criadoEm: '${agora}', autor: 'u2' })`);
    banco.chamadas.length = 0; ctx.__toasts.length = 0;
    await run(ctx, `ChatUI.apagarNota('${N2}')`); await esperar(20);
    afirma(run(ctx, `state.mensagens.some(m => m.id === '${N2}')`) && ctx.__toasts.some(t => t.t === 'err' && /já foi apagada/.test(t.m)), 'banco devolveu 0 linhas: anotação continua e o erro avisa');
    // sem a alçada o botão some da bolha e do drawer
    run(ctx, "Cloud.perfil().permissoes = { notas_criar: true };");
    afirma(!/ChatUI\.apagarNota\(/.test(vistas.atendimento()), 'sem a alçada: nenhum botão de apagar anotação');
  });

  await caso('Usuários e alçadas: departamentos da pessoa editáveis na janela "Gerenciar usuário" (caixas pré-marcadas; PATCH em perfis com a lista e o espelho)', async () => {
    const JUR = '33333333-0000-4000-8000-000000000001', COM = '33333333-0000-4000-8000-000000000002';
    const banco = bancoPadrao({
      perfis: [
        { id: 'u-admin', nome: 'Dono', email: 'dono@mv.adv', papel: 'admin', ativo: true, departamento_id: null, departamento_ids: [], permissoes: {}, horario_ativo: false, horario: 'seg-sex 08:00-18:00' },
        { id: 'u-ana', nome: 'Ana', email: 'ana@mv.adv', papel: 'atendente', ativo: true, departamento_id: JUR, departamento_ids: [JUR], permissoes: { msg_enviar: true }, horario_ativo: false, horario: '' }
      ],
      departamentos: [{ id: JUR, nome: 'Jurídico', cor: '#5e8ab4', permissoes: {} }, { id: COM, nome: 'Comercial', cor: '#5e8ab4', permissoes: {} }]
    });
    const { ctx } = await iniciado({ banco });
    carregarChat(ctx);
    ctx.__els['admin-corpo'] = { innerHTML: '' };
    let modalHtml = ''; ctx.UI.modal = html => { modalHtml = html; };
    run(ctx, 'ChatUI.telaUsuarios()'); await esperar(80);
    afirma(/ChatUI\.adminEditarUsuario\('u-ana'\)/.test(ctx.__els['admin-corpo'].innerHTML), 'lista de usuários carregada com a Ana');
    run(ctx, "ChatUI.adminEditarUsuario('u-ana')");
    const caixas = modalHtml.match(/<input type="checkbox" class="adu-dept"[^>]*>/g) || [];
    afirma(caixas.length === 2, 'duas caixas de departamento na janela (uma por departamento): ' + caixas.length);
    afirma(caixas.some(c => c.includes(JUR) && /checked/.test(c)) && caixas.some(c => c.includes(COM) && !/checked/.test(c)), 'Jurídico já marcado, Comercial não');
    afirma(/permTgl\('notas_apagar'/.test(modalHtml), 'matriz de permissões traz a alçada de apagar anotações');
    // troca: sai do Jurídico, entra no Comercial
    ctx.document.querySelectorAll = sel => sel === '.adu-dept' ? [{ value: JUR, checked: false }, { value: COM, checked: true }] : [];
    Object.assign(ctx.__els, { 'adu-papel': { value: 'atendente' }, 'adu-nome': { value: 'Ana' }, 'adu-ass': { value: '' }, 'adu-exibir': { checked: false },
      'adu-espiao': { checked: false }, 'adu-espiaozera': { checked: true }, 'adu-horativo': { checked: false }, 'adu-horario': { value: '' } });
    banco.chamadas.length = 0;
    await run(ctx, 'ChatUI.adminSalvarUsuario()'); await esperar(20);
    const patch = banco.chamadas.find(c => c.metodo === 'PATCH' && c.cam === 'perfis' && /id=eq\.u-ana/.test(c.q));
    afirma(!!patch && JSON.stringify(patch.corpo.departamento_ids) === JSON.stringify([COM]) && patch.corpo.departamento_id === COM, 'PATCH perfis com departamento_ids=[Comercial] e o espelho departamento_id');
    afirma(!!patch && patch.corpo.papel === 'atendente' && JSON.stringify(patch.corpo.permissoes) === JSON.stringify({ msg_enviar: true }), 'o resto do perfil segue no mesmo PATCH');
  });

  await caso('mensagens agendadas: painel diz quem agendou, clicar abre a conversa certa, cancelar deixa anotação interna com quem cancelou', async () => {
    const { ctx } = await iniciado();
    const vistas = carregarChat(ctx);
    const cid = run(ctx, 'state.conversas[1].id');   // 2ª conversa: prova que abre a do agendamento, não a primeira
    const AG = '66666666-0000-4000-8000-000000000001';
    const quando = new Date(Date.now() + 3600000).toISOString();
    run(ctx, `state.time = [{ id: 'u2', nome: 'Ana Souza' }]; state.mensagens.push({ id: '${AG}', conversaId: '${cid}', direcao: 'saida', tipo: 'texto', texto: 'Bom dia, segue o contrato', status: 'agendada', agendadaPara: '${quando}', criadoEm: new Date().toISOString(), autor: 'u2' })`);
    run(ctx, "ChatUI.painel('agendadas')");
    let html = vistas.atendimento();
    afirma(/agendada por <b>Ana<\/b>/.test(html), 'item do painel diz quem agendou (primeiro nome)');
    afirma(new RegExp(`<div class="wa-item" onclick="ChatUI\\.abrir\\('${cid}'\\)"`).test(html), 'clicar no item abre a conversa do agendamento');
    run(ctx, `ChatUI.abrir('${cid}')`);
    html = vistas.atendimento();
    afirma(/wa-ag-bar/.test(html) && !/Nenhuma mensagem agendada/.test(html), 'conversa aberta: a barra de agendadas desta conversa aparece (é a conversa certa)');
    ctx.confirm = () => true; ctx.__toasts.length = 0;
    run(ctx, `ChatUI.cancelarAgendada('${AG}')`);
    afirma(run(ctx, `state.mensagens.find(m => m.id === '${AG}').status`) === 'cancelada', 'agendada vira cancelada (a linha fica)');
    const n = JSON.parse(run(ctx, `JSON.stringify(state.mensagens.filter(m => m.conversaId === '${cid}' && m.tipo === 'anotacao').pop() || null)`));
    afirma(!!n && n.autor === 'u-admin' && /Dono cancelou a mensagem agendada para .+: “Bom dia, segue o contrato”/.test(n.texto), 'anotação interna na conversa do cliente registra quem cancelou, quando era e o texto: ' + (n && n.texto));
    html = vistas.atendimento();
    afirma(/class="wa-nota"/.test(html) && /Dono cancelou/.test(html), 'a anotação aparece na linha do tempo da conversa');
  });

  await caso('botão Conversas do rail: abre o painel e recarrega as conversas do banco, também quando já está nele; modo local só troca o painel', async () => {
    const { ctx, banco } = await iniciado();
    const vistas = carregarChat(ctx);
    const cid = run(ctx, 'state.conversas[0].id');
    afirma(/onclick="ChatUI\.painel\('conversas'\)"/.test(vistas.atendimento()), 'botão Conversas do rail chama ChatUI.painel');
    run(ctx, "ChatUI.painel('agendadas')");
    banco.chamadas.length = 0; ctx.__toasts.length = 0;
    run(ctx, "ChatUI.painel('conversas')"); await esperar(60);
    afirma(banco.chamadas.some(c => c.metodo === 'GET' && c.cam === 'conversas'), 'voltar para Conversas busca a lista de conversas no banco');
    afirma(ctx.__toasts.some(t => /Conversas atualizadas/.test(t.m)), 'avisa que atualizou');
    // já em Conversas: clicar de novo recarrega mesmo assim e traz o que mudou no banco
    const conv = banco.db.conversas.find(c => c.id === cid);
    conv.nome = 'Nome novo no banco'; conv.atualizado_em = new Date(Date.now() + 1000).toISOString();
    banco.chamadas.length = 0; ctx.__toasts.length = 0;
    run(ctx, "ChatUI.painel('conversas')"); await esperar(60);
    afirma(banco.chamadas.some(c => c.metodo === 'GET' && c.cam === 'conversas'), 'já no painel: clicar recarrega de novo');
    afirma(run(ctx, `state.conversas.find(c => c.id === '${cid}').nome`) === 'Nome novo no banco' && /Nome novo no banco/.test(vistas.atendimento()), 'a mudança feita no banco aparece na lista');
    // modo local (sem nuvem): só troca o painel, sem rede e sem aviso
    const local = novoContexto({ banco: null, sessao: false });
    const vLocal = carregarChat(local);
    local.__toasts.length = 0;
    run(local, "ChatUI.painel('agendadas'); ChatUI.painel('conversas'); ChatUI.painel('conversas');"); await esperar(30);
    afirma(/wa-rail-btn ativo" data-painel="conversas"/.test(vLocal.atendimento()) && !local.__toasts.length, 'modo local: painel Conversas ativo, nenhum aviso');
  });

  await caso('vistoria dos grupos (front): item em Configurações só para admin na nuvem; dispara grupos_vistoria e mostra o relatório do motor', async () => {
    const { ctx, banco } = await iniciado();
    const vistas = carregarChat(ctx);
    run(ctx, "ChatUI.painel('config')");
    let html = vistas.atendimento();
    afirma(/Vistoriar participantes dos grupos/.test(html) && /ChatUI\.vistoriarGrupos\(\)/.test(html), 'admin: item "Vistoriar participantes dos grupos" em Configurações');
    let modalHtml = ''; ctx.UI.modal = h => { modalHtml = h; }; ctx.confirm = () => true;
    const pr = run(ctx, 'ChatUI.vistoriarGrupos()'); await esperar(15);
    const cmd = banco.db.motor_comandos[banco.db.motor_comandos.length - 1];
    afirma(!!cmd && cmd.tipo === 'grupos_vistoria' && cmd.payload.aplicar === true && cmd.autor === 'u-admin', 'manda o comando grupos_vistoria com aplicar: true');
    cmd.status = 'ok'; cmd.erro = ''; cmd.resultado = { grupos: 118, consultados: 117, corrigidos: 96, comErro: 1, aplicado: true, lidsCrus: 402, duplicatas: 50, semNumero: 3,
      detalhes: [{ id: 'g1', nome: 'ADV - Teste', antes: 5, depois: 4, lidsCrus: 3, duplicatas: 1, removidos: 1, incluidos: 0, semNumero: 0 }, { id: 'g2', nome: 'Grupo Antigo', erro: 'não consegui consultar o grupo no WhatsApp' }] };
    await pr;
    afirma(/ADV - Teste/.test(modalHtml) && /5\s*→\s*4/.test(modalHtml) && /Grupo Antigo/.test(modalHtml) && /não consegui consultar/.test(modalHtml), 'relatório lista os grupos corrigidos (antes → depois) e os com erro');
    afirma(/96/.test(modalHtml) && /402/.test(modalHtml) && /50/.test(modalHtml), 'totais: grupos corrigidos, lids crus e duplicatas');
    run(ctx, "Cloud.perfil().papel = 'atendente'");
    afirma(!/Vistoriar participantes dos grupos/.test(vistas.atendimento()), 'atendente não vê o item');
  });

  await caso('cadência direto no contato (Chat): só com a alçada cadencias_aplicar; registrar cria o lead se faltar e programa as mensagens nesta conversa; cancelar tira da fila; grupo não tem', async () => {
    const { ctx } = await iniciado();
    vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/cadence.js'), 'utf8'), ctx, { filename: 'js/cadence.js' });   // o Cadence de verdade, não o esboço do simulador
    const vistas = carregarChat(ctx);
    run(ctx, `state.cadences = [{ id: 'c-teste', nome: 'Teste 2 toques', cenario: 'cenário x', ref: '', passos: [
      { dia: 0, canal: 'WhatsApp', titulo: 'Oi', objetivo: 'abrir', template: 'Olá {{nome}}, tudo bem?', hora: '' },
      { dia: 2, canal: 'WhatsApp', titulo: 'Retomar', objetivo: 'retomar', template: 'Passando para retomar, {{nome}}.', hora: '' } ] }];`);
    const cid = run(ctx, 'state.conversas[0].id');
    run(ctx, `ChatUI.abrir('${cid}'); ChatUI.drawer(true)`);
    let html = vistas.atendimento();
    afirma(/Cadência de follow-up/.test(html) && /ChatUI\.cadenciaRegistrar\(\)/.test(html), 'admin: seção de cadência no drawer com "Registrar cadência"');
    run(ctx, "Cloud.perfil().papel = 'atendente'; Cloud.perfil().permissoes = { msg_enviar: true };");
    afirma(!/Cadência de follow-up/.test(vistas.atendimento()) && run(ctx, "ChatUI.pode('cadencias_aplicar')") === false, 'sem a alçada: nada de cadência (fora do padrão de atendente)');
    run(ctx, "Cloud.perfil().permissoes = { msg_enviar: true, cadencias_aplicar: true };");
    afirma(/Cadência de follow-up/.test(vistas.atendimento()), 'com a alçada (departamento Comercial): seção no drawer');
    // registrar: a conversa não tem lead → cria e vincula; a janela lista as cadências do CRM
    let modalHtml = ''; ctx.UI.modal = h => { modalHtml = h; };
    afirma(run(ctx, `getConversa('${cid}').leadId`) == null, 'conversa sem lead antes');
    run(ctx, 'ChatUI.cadenciaRegistrar()');
    const leadId = run(ctx, `getConversa('${cid}').leadId`);
    afirma(!!leadId && run(ctx, `getLead('${leadId}').nome`) === 'c-a', 'lead criado e vinculado a partir da conversa');
    afirma(/id="cc-cad"/.test(modalHtml) && /Teste 2 toques \(2 toques\)/.test(modalHtml) && /id="cc-auto" checked/.test(modalHtml) && /ChatUI\.cadenciaConfirmar\(\)/.test(modalHtml), 'janela lista a cadência e já marca os envios automáticos');
    const amanha = run(ctx, 'addDaysISO(todayISO(), 1)');
    Object.assign(ctx.__els, { 'cc-cad': { value: 'c-teste' }, 'cc-data': { value: amanha }, 'cc-auto': { checked: true }, 'cc-hora': { value: '' } });
    ctx.__toasts.length = 0;
    run(ctx, 'ChatUI.cadenciaConfirmar()');
    const fus = JSON.parse(run(ctx, `JSON.stringify(state.followups.filter(f => f.leadId === '${leadId}'))`));
    afirma(fus.length === 2 && fus.every(f => f.status === 'pendente' && f.cadenciaId === 'c-teste') && fus[0].dueDate === amanha, '2 follow-ups pendentes na ficha do lead, a partir da data escolhida');
    const ags = JSON.parse(run(ctx, `JSON.stringify(state.mensagens.filter(m => m.conversaId === '${cid}' && m.status === 'agendada'))`));
    afirma(ags.length === 2 && /Olá c-a, tudo bem\?/.test(ags[0].texto) && fus.every(f => f.msgId), '2 mensagens programadas nesta conversa, com o nome preenchido, casadas com os follow-ups');
    afirma(ctx.__toasts.some(t => /Cadência registrada: 2 follow-up/.test(t.m) && /2 mensagem/.test(t.m)), 'aviso com os números');
    html = vistas.atendimento();
    afirma(/Teste 2 toques/.test(html) && /2 toque\(s\) pendente/.test(html) && /ChatUI\.cadenciaCancelar\(\)/.test(html), 'drawer mostra a cadência ativa, o próximo passo e o botão de cancelar');
    ctx.confirm = () => true;
    run(ctx, 'ChatUI.cadenciaCancelar()');
    afirma(run(ctx, `state.followups.filter(f => f.leadId === '${leadId}' && f.status === 'cancelado').length`) === 2 && run(ctx, `state.mensagens.filter(m => m.conversaId === '${cid}' && m.status === 'cancelada').length`) === 2, 'cancelar: follow-ups cancelados e mensagens fora da fila');
    afirma(/ChatUI\.cadenciaRegistrar\(\)/.test(vistas.atendimento()) && !/toque\(s\) pendente/.test(vistas.atendimento()), 'drawer volta a oferecer registrar');
    // grupo: sem cadência
    run(ctx, "var gcad = novaConversa({ nome: 'Grupo X', telefone: 'grupo-1', tipo: 'grupo' }); ChatUI.abrir(gcad.id); ChatUI.drawer(true);");
    afirma(!/Cadência de follow-up/.test(vistas.atendimento()), 'grupo: sem seção de cadência');
  });

  await caso('tags: ordem de lista (ordem, depois nome), reordenar com subir/descer (tags_gerir), drawer mostra só as aplicadas e adiciona pelo seletor; cor do texto por contraste; a ordem sobe no sync', async () => {
    const { ctx, banco } = await iniciado({ extra: { tags: [
      { id: 'tg-b', nome: 'PERFIL B', cor: '#D9C400', ordem: 2 },
      { id: 'tg-a', nome: 'LEAD', cor: '#E5E7EB', ordem: 1 },
      { id: 'tg-c', nome: 'T: FAMILIA', cor: '#0A1F5C', ordem: 3 },
      { id: 'tg-z', nome: 'Urgente', cor: '#C2564B', ordem: null } ] } });
    const vistas = carregarChat(ctx);
    afirma(run(ctx, 'ChatUI.tagsOrdenadas().map(t => t.nome).join("|")') === 'LEAD|PERFIL B|T: FAMILIA|Urgente', 'lista na ordem definida; sem ordem vai para o fim');
    afirma(/var\(--text-heading\)/.test(run(ctx, "ChatUI.estiloTag('#E5E7EB')")) && /var\(--text-on-brand\)/.test(run(ctx, "ChatUI.estiloTag('#0A1F5C')")) && /var\(--text-heading\)/.test(run(ctx, "ChatUI.estiloTag('#D9C400')")), 'texto escuro em fundo claro (cinza, amarelo), claro em fundo escuro (azul-marinho)');
    run(ctx, "ChatUI.painel('tags')");
    let html = vistas.atendimento();
    afirma(html.indexOf('>LEAD<') < html.indexOf('>PERFIL B<') && html.indexOf('>PERFIL B<') < html.indexOf('>T: FAMILIA<') && html.indexOf('>T: FAMILIA<') < html.indexOf('>Urgente<'), 'painel de tags lista na ordem');
    afirma(/ChatUI\.moverTag\('tg-b',-1\)/.test(html) && /ChatUI\.moverTag\('tg-b',1\)/.test(html), 'admin: botões de subir e descer');
    run(ctx, "ChatUI.moverTag('tg-c', -1)");
    afirma(run(ctx, 'ChatUI.tagsOrdenadas().map(t => t.nome).join("|")') === 'LEAD|T: FAMILIA|PERFIL B|Urgente', 'subir uma posição troca com a vizinha de cima');
    afirma(run(ctx, "state.tags.find(t => t.id === 'tg-z').ordem") === 4 && run(ctx, "state.tags.find(t => t.id === 'tg-c').ordem") === 2, 'ao mover, toda a lista ganha ordem numérica (a sem ordem vira a última)');
    banco.chamadas.length = 0; await run(ctx, 'Cloud.sincronizarAgora()'); await esperar(20);
    const up = banco.chamadas.find(c => c.cam === 'tags' && c.metodo === 'POST');
    afirma(!!up && up.corpo.some(t => t.id === 'tg-c' && t.ordem === 2), 'a ordem sobe para o banco (coluna sondada)');
    // drawer: só as aplicadas, em ordem de lista, com ×; o seletor lista as demais e adiciona ao escolher
    const cid = run(ctx, 'state.conversas[0].id');
    run(ctx, `atualizarConversa('${cid}', { tags: ['PERFIL B', 'LEAD'] }); ChatUI.abrir('${cid}'); ChatUI.drawer(true);`);
    html = vistas.atendimento();
    afirma((html.match(/data-tag="([^"]+)"/g) || []).join() === 'data-tag="LEAD",data-tag="PERFIL B"', 'drawer: só as tags aplicadas, na ordem da lista (não na ordem em que foram aplicadas)');
    afirma(new RegExp(`ChatUI\\.aplicarTag\\('${cid}', this\\.value\\)`).test(html) && /<option value="T: FAMILIA">/.test(html) && /<option value="Urgente">/.test(html) && !/<option value="LEAD">/.test(html), 'seletor "Adicionar tag" só com as que faltam, em ordem');
    afirma(new RegExp(`ChatUI\\.toggleTag\\('${cid}','LEAD'\\)`).test(html), 'cada chip aplicado tem o × para retirar');
    run(ctx, `ChatUI.aplicarTag('${cid}', 'Urgente')`);
    afirma(run(ctx, `getConversa('${cid}').tags.join('|')`) === 'PERFIL B|LEAD|Urgente' && (vistas.atendimento().match(/data-tag="([^"]+)"/g) || []).length === 3, 'escolher no seletor adiciona a tag');
    run(ctx, `ChatUI.aplicarTag('${cid}', 'Urgente'); ChatUI.aplicarTag('${cid}', '')`);
    afirma(run(ctx, `getConversa('${cid}').tags.length`) === 3, 'repetida ou vazia não entra');
    run(ctx, `ChatUI.toggleTag('${cid}', 'LEAD')`);
    afirma(run(ctx, `getConversa('${cid}').tags.join('|')`) === 'PERFIL B|Urgente', '× retira');
    // lista de conversas: chips das aplicadas na ordem da lista e com cor de texto por contraste
    run(ctx, 'ChatUI.drawer(false)');
    html = vistas.atendimento();
    afirma(/class="wa-minichip" style="background:#D9C400;color:var\(--text-heading\)">PERFIL B</.test(html), 'chip na lista de conversas: fundo amarelo com texto escuro');
    // sem alçada de aplicar: vê os chips, sem × e sem seletor; sem gerir: sem subir/descer
    run(ctx, "Cloud.perfil().papel = 'atendente'; Cloud.perfil().permissoes = { msg_enviar: true }; ChatUI.drawer(true);");
    html = vistas.atendimento();
    afirma((html.match(/data-tag="/g) || []).length === 2 && !/wa-tag-add/.test(html) && !/ChatUI\.toggleTag\(/.test(html), 'sem tags_aplicar: só vê as tags');
    run(ctx, "ChatUI.painel('tags')");
    afirma(!/ChatUI\.moverTag\(/.test(vistas.atendimento()), 'sem tags_gerir: sem botões de mover');
    const sql = fs.readFileSync(path.join(RAIZ, 'nuvem/000-baseline.sql'), 'utf8');
    afirma(/add column if not exists ordem integer/.test(sql), '000-baseline.sql: coluna ordem das tags');
  });

  await caso('nova conversa pela tela: o rascunho renderiza (lista, cabeçalho, drawer) sem erro e a 1ª mensagem cria a conversa; conversa com tag desconhecida também renderiza', async () => {
    const { ctx } = await iniciado();
    const vistas = carregarChat(ctx);
    const erros = [];
    ctx.__els['nc-nome'] = { value: 'Contato Novo' }; ctx.__els['nc-tel'] = { value: '(45) 99876-5432' };
    // como no navegador: fechar a janela APAGA os campos dela (UI.fecharModal esvazia o #modal)
    ctx.UI.fecharModal = () => { delete ctx.__els['nc-nome']; delete ctx.__els['nc-tel']; };
    try { run(ctx, 'ChatUI.novaConversa(); ChatUI.criarConversa();'); } catch (e) { erros.push('criarConversa: ' + e.message); }
    let html = '';
    try { html = vistas.atendimento(); } catch (e) { erros.push('render rascunho: ' + (e.stack || e.message)); }
    afirma(!erros.length, 'rascunho aberto sem exceção: ' + erros.join(' | '));
    afirma(/Contato Novo/.test(html) && /Conversa ainda não salva/.test(html), 'rascunho na tela com o nome e o aviso');
    try { run(ctx, 'ChatUI.drawer(true)'); html = vistas.atendimento(); } catch (e) { erros.push('drawer do rascunho: ' + (e.stack || e.message)); }
    afirma(!erros.length && /Dados do contato|wa-campo/.test(html), 'drawer do rascunho renderiza');
    run(ctx, "document.getElementById('wa-input').value = 'oi, tudo bem?'");
    try { await run(ctx, 'ChatUI.enviar()'); await esperar(30); } catch (e) { erros.push('enviar: ' + (e.stack || e.message)); }
    afirma(!erros.length && run(ctx, "state.conversas.some(c => c.telefone === '5545998765432' && c.nome === 'Contato Novo')"), '1ª mensagem cria a conversa de verdade: ' + erros.join(' | '));
    // conversa com uma tag que não está (mais) na lista: lista e drawer não podem quebrar
    const cid = run(ctx, "state.conversas.find(c => c.telefone === '5545998765432').id");
    run(ctx, `atualizarConversa('${cid}', { tags: ['Tag Que Sumiu'] }); ChatUI.abrir('${cid}'); ChatUI.drawer(true);`);
    try { html = vistas.atendimento(); } catch (e) { erros.push('tag desconhecida: ' + (e.stack || e.message)); }
    afirma(!erros.length && /Tag Que Sumiu/.test(html), 'tag desconhecida aparece sem quebrar: ' + erros.join(' | '));
  });

  await caso('mensagens agendadas: saem com a assinatura de quem agendou (agendar e cadência); íntegra legível numa janela, no painel e no popup', async () => {
    const { ctx } = await iniciado();
    vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/cadence.js'), 'utf8'), ctx, { filename: 'js/cadence.js' });
    const vistas = carregarChat(ctx);
    run(ctx, "Cloud.perfil().exibir_assinatura = true; Cloud.perfil().assinatura = 'Ana Souza - Assessora';");
    const cid = run(ctx, 'state.conversas[0].id');
    run(ctx, `ChatUI.abrir('${cid}')`);
    const longo = 'Prezado cliente, segue o resumo completo da reunião de hoje com todos os pontos tratados, prazos combinados, documentos pendentes e próximos passos para que nada se perca. '.repeat(3).trim();
    const amanha = run(ctx, 'addDaysISO(todayISO(), 1)');
    ctx.__els['ag-texto'] = { value: longo }; ctx.__els['ag-quando'] = { value: amanha + 'T09:00' };
    run(ctx, 'ChatUI.confirmarAgendamento()');
    const ag = JSON.parse(run(ctx, `JSON.stringify(state.mensagens.find(m => m.conversaId === '${cid}' && m.status === 'agendada'))`));
    afirma(!!ag && ag.texto.startsWith('*Ana Souza - Assessora:*\n') && ag.texto.endsWith(longo), 'agendada nasce com a assinatura na frente, como o envio normal');
    // painel: botão de íntegra; janela mostra o texto inteiro, quem agendou, quando e para quem
    run(ctx, "ChatUI.painel('agendadas')");
    let html = vistas.atendimento();
    afirma(new RegExp(`ChatUI\\.verAgendada\\('${ag.id}'\\)`).test(html), 'painel tem "Ler íntegra" em cada agendada');
    let modalHtml = ''; ctx.UI.modal = h => { modalHtml = h; };
    run(ctx, `ChatUI.verAgendada('${ag.id}')`);
    afirma(modalHtml.includes('nada se perca.') && (modalHtml.match(/nada se perca/g) || []).length === 3 && /Ana Souza - Assessora/.test(modalHtml), 'janela mostra a mensagem inteira (sem cortar) e a assinatura');
    afirma(/c-a/.test(modalHtml) && /Dono/.test(modalHtml) && new RegExp(`ChatUI\\.dispararAgendada\\('${ag.id}'\\)`).test(modalHtml) && new RegExp(`ChatUI\\.cancelarAgendada\\('${ag.id}'\\)`).test(modalHtml) && new RegExp(`ChatUI\\.abrir\\('${cid}'\\)`).test(modalHtml), 'janela diz para quem e quem agendou, e oferece disparar, cancelar e abrir a conversa');
    // popup da conversa: texto inteiro e botão de íntegra
    run(ctx, `ChatUI.painel('conversas'); ChatUI.abrir('${cid}'); ChatUI.toggleAgendadas();`);
    html = vistas.atendimento();
    afirma((html.match(/nada se perca/g) || []).length >= 3 && new RegExp(`ChatUI\\.verAgendada\\('${ag.id}'\\)`).test(html), 'popup da conversa não corta o texto e também abre a íntegra');
    // cadência registrada pelo chat: as mensagens programadas também levam a assinatura
    run(ctx, `state.cadences = [{ id: 'c-ass', nome: 'Assinada', cenario: '', ref: '', passos: [{ dia: 1, canal: 'WhatsApp', titulo: 'Oi', objetivo: '', template: 'Olá {{nome}}, tudo bem?', hora: '' }] }]; Cloud.perfil().permissoes = {}; Cloud.perfil().papel = 'admin';`);
    ctx.UI.modal = () => {};
    run(ctx, 'ChatUI.cadenciaRegistrar()');
    Object.assign(ctx.__els, { 'cc-cad': { value: 'c-ass' }, 'cc-data': { value: amanha }, 'cc-auto': { checked: true }, 'cc-hora': { value: '' } });
    run(ctx, 'ChatUI.cadenciaConfirmar()');
    const agCad = JSON.parse(run(ctx, `JSON.stringify(state.mensagens.filter(m => m.conversaId === '${cid}' && m.status === 'agendada' && /tudo bem/.test(m.texto)))`));
    afirma(agCad.length === 1 && agCad[0].texto === '*Ana Souza - Assessora:*\nOlá c-a, tudo bem?', 'mensagem programada pela cadência sai assinada por quem registrou');
  });

  await caso('cache local na nuvem guarda só a preferência', async () => {
    const { ctx } = await iniciado();
    run(ctx, "state.settings.modeloIA = 'claude-sonnet-5-5'; persistirLocal();");
    const salvo = JSON.parse(ctx.__armaz[ESC.chaves.estado]);
    afirma(!salvo.leads && !salvo.conversas && salvo.settings && salvo.settings.modeloIA === 'claude-sonnet-5-5' && !('apiKey' in salvo.settings), 'sem leads/conversas, com a preferência e sem campo de chave da IA');
  });

  await caso('banco: baseline único na ordem provada, sem módulos excluídos nem seeds de outro escritório', () => {
    const b = fs.readFileSync(path.join(RAIZ, 'nuvem/000-baseline.sql'), 'utf8');
    const ordem = ['schema.sql', 'schema-ajustes.sql', 'atendimento.sql', 'chat-v2.sql', 'chat-v11.sql', 'crm-v1.sql', 'crm-v2.sql', 'chat-v12a.sql', 'chat-v12b.sql', 'chat-v13a.sql', 'chat-v14a.sql', 'chat-v19a.sql', 'chat-v19c.sql'].map(f => b.indexOf('-- [origem: ' + f + ']'));
    afirma(ordem.every((p, i) => p >= 0 && (i === 0 || p > ordem[i - 1])), 'blocos presentes e em ordem: ' + ordem.join());
    afirma(!/create table[^;]*\b(fluxos|calendario_eventos|colaboradores|ausencias|colaboradores_log)\b/.test(b) && !/rh_calendario|carimbar_fluxo|carimbar_evento|reuniaoGeral|SEU-EMAIL-AQUI|OUTUBRO 2026|liberar-admin|estrutura-piloto/.test(b), 'sem Fluxos/RH/Calendário, sem placeholder, sem tags da origem');
    afirma(/add column if not exists ordem integer/.test(b) && /create policy/.test(b) && /storage\.buckets/.test(b) && /alter publication supabase_realtime/.test(b), 'estrutura essencial presente');
    afirma(!/insert into departamentos|insert into tags/i.test(b) && /create table if not exists config/.test(b), 'seeds de origem fora; tabela config presente');
    afirma(!fs.existsSync(path.join(RAIZ, 'nuvem/chat-v2.sql')) && fs.readdirSync(path.join(RAIZ, 'nuvem')).filter(f => f.endsWith('.sql')).sort().join() === '000-baseline.sql,001-mv-seed.sql,002-primeiro-admin.sql,conferir-esquema.sql', 'só os quatro .sql');
  });
  await caso('banco: seed genérica e primeiro admin por placeholder', () => {
    const s = fs.readFileSync(path.join(RAIZ, 'nuvem/001-mv-seed.sql'), 'utf8'), a = fs.readFileSync(path.join(RAIZ, 'nuvem/002-primeiro-admin.sql'), 'utf8');
    afirma(/Comercial/.test(s) && /Jurídico/.test(s) && /Financeiro/.test(s) && /Administrativo/.test(s) && /not exists \(select 1 from departamentos\)/.test(s), '4 departamentos, só se vazio');
    afirma(/cadencias_aplicar/.test(s) && /ilike 'comercial%'/i.test(s), 'alçada de cadência nos departamentos Comercial');
    afirma((s.match(/insert into respostas_rapidas/gi) || []).length >= 1 && !/9h às 18h|18h/.test(s), 'respostas rápidas sem horário fixo');
    afirma(/lower\(email\) = lower\('<E-MAIL-DO-SOCIO>'\)/.test(a) && /raise exception/.test(a), 'admin por placeholder');
  });

  await caso('guarda de marca: nenhum arquivo publicado cita o escritório de origem', () => {
    // ficam de fora só as linhas que contêm as palavras que procuram: a declaração da expressão
    // e as duas asserções que citam o nome antigo para provar que ele sumiu
    const achados = GREP(ESCOPO_GUARDA, MARCA).concat(GREP(ESCOPO_GUARDA, MARCA_CAIXA)).filter(l => !/^testes\/testes-front\.js:\d+: (const MARCA = |const MARCA_CAIXA = |afirma\(GREP\(\['css', 'js'\], |afirma\(\/PROJETO = )/.test(l));
    afirma(achados.length === 0, 'ocorrências:\n    ' + achados.join('\n    '));
  });

  await caso('camada de marca: escritorio.js é o 1º script e é síncrono; nomes saem de ESCRITORIO', () => {
    afirma(fs.existsSync(path.join(RAIZ, 'nuvem/publicar-motor.sh')) && !fs.existsSync(path.join(RAIZ, 'motor/railway.json')), 'motor sem railway.json; script de deploy presente');
    afirma(GREP(['css', 'js'], /\.arca-|arcaFade|arcaRise|--arca-/).length === 0, 'identificadores CSS renomeados');
    const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
    afirma(html.indexOf('<script src="js/escritorio.js') > 0 && html.indexOf('<script src="js/escritorio.js') < html.indexOf('<script>(function(){try{var p=localStorage') && !/escritorio\.js[^>]*defer/.test(html), 'posição e modo de carga');
    afirma(/<title><\/title>/.test(html) && (html.match(/data-marca="/g) || []).length >= 5, 'title vazio e pontos data-marca');
    const ctx = novoContexto({ banco: null, soStore: true });
    afirma(run(ctx, 'ESCRITORIO.sistema') === 'Marques e Vasques · Sistema' && run(ctx, 'Object.isFrozen(ESCRITORIO)') && run(ctx, 'STORAGE_KEY') === run(ctx, 'ESCRITORIO.chaves.estado'), 'store usa a chave do escritório');
  });

  await caso('publicar.py do MV: projeto, time e token do escritório', () => {
    const pub = fs.readFileSync(path.join(RAIZ, 'nuvem/publicar.py'), 'utf8');
    afirma(/PROJETO = 'mv-sistema'/.test(pub) && /TEAM_ID/.test(pub) && /\?teamId=/.test(pub) && /\.mv-vercel-token/.test(pub) && /--sim/.test(pub) && !/ultracrm/.test(pub), 'publicar.py do MV');
  });

  await caso('Fluxos saiu por inteiro do front e do motor', () => {
    const RX = /\bFluxos\b|fluxos_editar|ver_fluxos|state\.fluxos|resumoFluxo|novoFluxo|CORES_RAIA|TIPOS_NO|modo-fluxo|hub-fluxo|fluxos\.css|views-fluxos|fluxos-modelos|\bfluxos:/;
    const achados = GREP(['index.html', 'js', 'css', 'motor'], RX);
    afirma(achados.length === 0, 'restos de Fluxos:\n    ' + achados.join('\n    '));
    afirma(!fs.existsSync(path.join(RAIZ, 'js/views-fluxos.js')) && !fs.existsSync(path.join(RAIZ, 'css/fluxos.css')), 'arquivos apagados');
  });

  await caso('Calendário e RH saíram; helpers de data vivem no store', () => {
    const RX = /\bCalendario\b|Portal RH|\bRH\.|rh_calendario|colaborador|ausencia|views-rh|views-calendario|calendario\.js|rh\.css|segundaDaSemana|#\/rh\b|#\/datas|#\/colaboradores|aniversario/;
    // js/emojis.js fica fora: "aniversario" ali é palavra-chave da busca de emojis, não resto do RH
    const jsSemEmojis = fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f !== 'emojis.js').map(f => 'js/' + f);
    const achados = GREP(['index.html', 'css', ...jsSemEmojis], RX);
    afirma(achados.length === 0, 'restos:\n    ' + achados.join('\n    '));
    const ctx = novoContexto({ banco: null });
    afirma(run(ctx, "inicioDaSemana('2026-11-04')") === '2026-11-01' && run(ctx, "inicioDaSemana('2026-11-01')") === '2026-11-01' && run(ctx, 'DOWS[0]') === 'Dom', 'domingo da semana, inclusive na virada do mês');
  });

  await caso('#/usuarios vive no hub: admin vê a tela, atendente é devolvido ao Início', async () => {
    const { ctx } = await iniciado();                       // dono admin
    const vistas = carregarChat(ctx);
    vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/views-usuarios.js'), 'utf8'), ctx, { filename: 'js/views-usuarios.js' });
    afirma(/usuarios-pagina/.test(vistas.usuarios()), 'admin: tela de usuários');
    run(ctx, "Cloud.perfil().papel = 'atendente'");
    afirma(/Área do administrador/.test(vistas.usuarios()), 'atendente: aviso, sem a tela');
    // roteador: atendente em #/usuarios volta ao Início antes de qualquer render
    const c2 = novoContexto({ banco: null, soStore: true });   // só store.js: cloud.js definiria const Cloud
    run(c2, "var ChatUI = { pode: () => false }; var Cloud = { ativo: () => true, admin: () => false, perfil: () => ({}) };");
    vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/ui-core.js'), 'utf8'), c2, { filename: 'js/ui-core.js' });
    c2.location.hash = '#/usuarios'; run(c2, 'UI.navegar()');
    afirma(c2.location.hash === '#/inicio', 'atendente devolvido ao Início');
  });

  await caso('roteador: rota podada volta ao Início; admin passa em #/usuarios', () => {
    const c3 = novoContexto({ banco: null, soStore: true });
    run(c3, "var ChatUI = { pode: () => true }; var Cloud = { ativo: () => true, admin: () => true, perfil: () => ({}) };");
    vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/ui-core.js'), 'utf8'), c3, { filename: 'js/ui-core.js' });
    const el = () => ({ addEventListener() {}, removeEventListener() {}, textContent: '', innerHTML: '', scrollTop: 0, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, querySelectorAll: () => [], querySelector: () => null, setAttribute() {}, appendChild() {} });
    const els = { 'page-title': el(), nav: el(), 'topbar-acoes': el(), view: el() };
    c3.document.getElementById = id => els[id] || el();
    c3.document.querySelectorAll = () => [];
    c3.scrollTo = () => {};
    c3.document.body.classList = { contains: () => false, toggle() {}, add() {}, remove() {} };
    run(c3, "UI.registrar('inicio', () => ''); UI.registrar('usuarios', () => '');");
    c3.location.hash = '#/fluxos'; run(c3, 'UI.navegar()');
    afirma(c3.location.hash === '#/inicio', 'rota podada volta ao Início: ' + c3.location.hash);
    c3.location.hash = '#/usuarios'; run(c3, 'UI.navegar()');
    afirma(c3.location.hash === '#/usuarios', 'admin passa em #/usuarios: ' + c3.location.hash);
  });

  await caso('versão publicada bate nos 3 lugares (index.html ?v=, main.js APP_VERSAO, versao.json)', () => {
    const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
    const main = fs.readFileSync(path.join(RAIZ, 'js/main.js'), 'utf8');
    const json = JSON.parse(fs.readFileSync(path.join(RAIZ, 'versao.json'), 'utf8'));
    const v = (main.match(/APP_VERSAO = '([^']+)'/) || [])[1];
    const vs = new Set((html.match(/\?v=([0-9.]+)/g) || []).map(s => s.slice(3)));
    afirma(v && json.versao === v && vs.size === 1 && vs.has(v), 'versão única: ' + JSON.stringify({ v, json: json.versao, html: [...vs] }));
  });

  await caso('estrutura: rotas registradas, plataformas e títulos são exatamente os do MV', () => {
    const regs = GREP(['js'], /UI\.registrar\('/).map(l => l.match(/registrar\('([a-z]+)'/)[1]).sort();
    afirma(regs.join() === 'agenda,analisar,atendimento,cadencias,config,contratos,dashboard,inicio,leads,playbook,usuarios', 'rotas: ' + regs.join());
    afirma(GREP(['js'], /^const Views = \{\}/).length === 1 && /ui-core\.js/.test(GREP(['js'], /^const Views = \{\}/)[0]), 'Views declarado uma vez, em ui-core.js');
    const ctx = novoContexto({ banco: null, soStore: true });
    vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/ui-core.js'), 'utf8'), ctx, { filename: 'js/ui-core.js' });
    afirma(run(ctx, 'Object.keys(UI.PLATAFORMAS).join()') === 'chat,crm', 'plataformas = chat, crm');
    afirma(run(ctx, 'UI.PLATAFORMAS.crm.rotas.map(r => r[0]).join()') === 'dashboard,leads,analisar,contratos,agenda,cadencias,playbook', 'rotas do CRM');
    afirma(!/fluxos|modelos|rh|colaboradores|ausencias|datas/.test(run(ctx, 'Object.keys(UI.TITLES).join()')), 'títulos sem módulos excluídos');
  });
  await caso('alçadas: PERM_PADRAO do front = do motor, sem chaves de Fluxos; chave desconhecida no perfil não libera nada', async () => {
    const pega = txt => JSON.stringify(txt.match(/PERM_PADRAO = new Set\(\[([\s\S]*?)\]\)/)[1].match(/'([a-z_]+)'/g));
    const f = fs.readFileSync(path.join(RAIZ, 'js/views-chat.js'), 'utf8'), m = fs.readFileSync(path.join(RAIZ, 'motor/index.js'), 'utf8');
    afirma(pega(f) === pega(m) && !/fluxo/.test(pega(f)), 'padrões iguais e sem fluxos');
    const { ctx } = await iniciado(); carregarChat(ctx);
    run(ctx, "Cloud.perfil().papel = 'atendente'; Cloud.perfil().permissoes = { ver_fluxos: true }");
    afirma(run(ctx, "ChatUI.pode('ver_fluxos')") === true && run(ctx, "ChatUI.pode('acesso_crm')") === false, 'chave antiga só vale para ela mesma; nada mais é liberado');
  });
  await caso('Início do MV: saudação, sem widget de calendário, sem Fluxos, sem Portal RH', () => {
    const ctx = novoContexto({ banco: null }); const vistas = {};
    Object.assign(ctx.UI, { registrar: (n, fn) => { vistas[n] = fn; }, carregando: t => t });
    vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/views-inicio.js'), 'utf8'), ctx, { filename: 'js/views-inicio.js' });
    const html = vistas.inicio();
    afirma(/hub-saudacao/.test(html) && !/fluxo|Portal RH|hub-cal|Calendario|#\/rh/.test(html), 'hub limpo');
  });

  await caso('paleta: nenhum hex fora do tokens (exceções: cores-dado do store, ícones, emojis, favicon)', () => {
    // GREP corta o trecho em 100 caracteres; a marca /* cor-dado */ fica no fim da linha, então
    // a isenção olha a linha inteira do arquivo, não o trecho cortado
    const linhaInteira = l => { const [arq, n] = l.split(':'); return fs.readFileSync(path.join(RAIZ, arq), 'utf8').split('\n')[Number(n) - 1]; };
    const achados = GREP(['css/styles.css', 'css/chat.css', 'js'], /#[0-9a-fA-F]{6}\b/)
      .filter(l => !/^js\/(icones|emojis)\.js:/.test(l) && !/cor-dado/.test(linhaInteira(l)));
    afirma(achados.length === 0, 'hex fora do tokens:\n    ' + achados.join('\n    '));
    afirma(GREP(['css', 'js'], /--navy-|--blue-|--terra-|--arca-|surface-terra-soft/).length === 0, 'rampas antigas renomeadas: ' + GREP(['css', 'js'], /--navy-|--blue-|--terra-|surface-terra-soft/).slice(0, 5).join(' | '));
    // rgba da paleta antiga (azul, navy, bone, terracota, ink azulado): arquivos inteiros, sem o corte do GREP
    const fontes = ['css/tokens.css', 'css/styles.css', 'css/chat.css', ...fs.readdirSync(path.join(RAIZ, 'js')).map(f => 'js/' + f)]
      .map(r => fs.readFileSync(path.join(RAIZ, r), 'utf8')).join('\n');
    afirma(!/rgba\((94,138,180|140,168,199|8,31,44|5,22,31|239,238,234|229,158,109|162,172,180)/.test(fontes), 'rgba da paleta antiga fora de uso');
  });

  await caso('paleta: contraste AA nas combinações que mudaram de família', () => {
    const tokens = lerTokensClaro();
    const pares = [['--text-link', '--white', 4.5], ['--text-link', '--bone-100', 4.5], ['--btn-primary-fg', '--btn-primary-bg', 4.5], ['--btn-accent-fg', '--btn-accent-bg', 4.5], ['--text-on-nav', '--surface-nav', 4.5], ['--warning-600', '--warning-100', 4.5], ['--text-body', '--surface-app', 4.5], ['--text-muted', '--surface-card', 4.5], ['--aco-500', '--white', 3]];
    const ruins = pares.filter(([a, b, min]) => !tokens[a] || !tokens[b] || contraste(tokens[a], tokens[b]) < min)
      .map(([a, b, min]) => a + ' × ' + b + ' = ' + (tokens[a] && tokens[b] ? contraste(tokens[a], tokens[b]).toFixed(2) : 'sem hex') + ' (mín. ' + min + ')');
    afirma(ruins.length === 0, 'abaixo do mínimo: ' + ruins.join('; '));
    afirma(/^#[0-9a-f]{6}$/i.test(tokens['--abertura-seda-1'] || '') && /^#[0-9a-f]{6}$/i.test(tokens['--abertura-seda-2'] || '') && /^#[0-9a-f]{6}$/i.test(tokens['--abertura-seda-3'] || ''), 'tokens da seda resolvem para hex');
    afirma(tokens['--marca-grafite-900'] === '#1C1F24' && tokens['--marca-grafite-700'] === '#2E333B' && tokens['--marca-aco-400'] === '#5C7F9E' && tokens['--marca-aco-200'] === '#C5D0DA' && tokens['--marca-offwhite'] === '#F4F3EF' && tokens['--marca-ambar'] === '#D9A441', 'seis cores da paleta neutra');
    // a abertura lê a seda dos tokens e, sem eles, cai no caminho sem WebGL; nenhum hex de reserva no JS
    const ab = fs.readFileSync(path.join(RAIZ, 'js/ui-abertura.js'), 'utf8');
    afirma(/getPropertyValue\('--abertura-seda-' \+ n\)/.test(ab) && !/SEDA\.cores|cores:\s*\[/.test(ab), 'abertura lê --abertura-seda-1..3');
  });

  console.log(`\n${ok} verificações OK, ${falhas} falha(s).`);
  process.exit(falhas ? 1 : 0);
})();
