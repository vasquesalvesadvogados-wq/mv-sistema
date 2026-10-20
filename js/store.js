/* ============ STORE — estado, persistência e utilitários ============ */

const STORAGE_KEY = ESCRITORIO.chaves.estado;

const ETAPAS = ['Novo', 'Contato Feito', 'Qualificado', 'Proposta Enviada', 'Negociação', 'Ganho', 'Perdido'];
const ETAPAS_ABERTAS = ['Novo', 'Contato Feito', 'Qualificado', 'Proposta Enviada', 'Negociação'];
const TEMPERATURAS = ['Quente', 'Morno', 'Frio'];
const ORIGENS_SUGERIDAS = ['Instagram', 'Facebook Ads', 'Google Ads', 'Orgânico', 'Tráfego Pago', 'Indicação', 'Site', 'WhatsApp', 'Telefone', 'Outro'];
const MOTIVOS_PERDA = ['Preço', 'Sem resposta / sumiu', 'Fechou com concorrente', 'Sem necessidade agora', 'Sem orçamento', 'Outro'];
const FORMAS_PAGAMENTO = ['À vista (PIX/dinheiro)', 'Cartão de crédito à vista', 'Cartão de crédito parcelado', 'Boleto parcelado', 'Transferência', 'Outro'];
const AREAS_CASO = ['Imobiliário', 'Trabalhista', 'Previdenciário', 'Tributário', 'Família', 'Divórcio', 'Inventário', 'Criminal', 'Cível', 'Consumidor', 'Empresarial', 'Contratos', 'Bancário', 'Usucapião', 'Outro'];
const PERFIS = ['A', 'B', 'C'];

let state = null;

function defaultState() {
  return {
    leads: [],
    analyses: [],
    followups: [],
    cadences: null, // preenchido por Cadence.defaults() no primeiro load
    settings: {
      nomeAtendente: '',
      empresa: '',
      modeloIA: 'claude-opus-5-5',     // IA do escritório: modelo escolhido pelo admin (viaja no config.geral)
      /* v6 — compartilhados pelo escritório (viajam no config.geral) */
      investimentoMkt: 0,
      investimentoPorMes: {},          // {'2026-08': 3000, ...} p/ CPL/CAC evolutivo
      metaLeads: 0, metaContratos: 0, metaReceita: 0,
      contextoIA: { areas: '', diferenciais: '', honorarios: '' },
      autoCriarLead: true,             // conversa nova no chat vira lead automaticamente
      analiseAutomatica: true,         // análise SPIN heurística ao resolver conversa
      janelaEnvio: '09:00-18:00',      // janela p/ envios automáticos de cadência
      esfriandoHoras: 6,               // lead quente sem resposta há X horas = alerta
      inatividadeHoras: 6,             // sessão parada há X horas encerra sozinha (0 desliga) — config do admin
      leadsVisao: 'lista',             // lista | kanban
      cadenciasEditadas: [],           // ids de cadências editadas (protegidas de atualizações)
      playbook: null                   // playbook editável (null = usa o padrão)
    },
    createdAt: new Date().toISOString()
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state = raw ? JSON.parse(raw) : defaultState();
  } catch (e) {
    console.error('Erro ao carregar dados', e);
    state = defaultState();
  }
  // migrações leves
  if (!state.settings) state.settings = defaultState().settings;
  if (!state.settings.modeloIA) state.settings.modeloIA = 'claude-opus-5-5';
  delete state.settings.reuniaoGeral;   // v6.25: a Reunião Geral virou evento do calendário (tipo reuniao_geral), não é mais regra
  delete state.settings.apiKey; delete state.settings.modelo;   // v6.21: a chave da IA saiu do navegador (fica no motor)
  // v6: novos settings compartilhados ganham default sem apagar o que existe
  const padrao = defaultState().settings;
  for (const k in padrao) if (state.settings[k] === undefined) state.settings[k] = padrao[k];
  if (!state.settings.contextoIA) state.settings.contextoIA = { areas: '', diferenciais: '', honorarios: '' };
  if (!state.settings.investimentoPorMes) state.settings.investimentoPorMes = {};
  if (!Array.isArray(state.leads)) state.leads = [];
  if (!Array.isArray(state.analyses)) state.analyses = [];
  if (!Array.isArray(state.followups)) state.followups = [];
  // módulo de atendimento (conversas WhatsApp)
  if (!Array.isArray(state.conversas)) state.conversas = [];
  if (!Array.isArray(state.mensagens)) state.mensagens = [];
  if (!Array.isArray(state.departamentos)) state.departamentos = [];
  if (!Array.isArray(state.respostasRapidas)) state.respostasRapidas = [];
  if (!Array.isArray(state.camposPersonalizados)) state.camposPersonalizados = [];   // chat-v18a: lista de campos do escritório
  if (!Array.isArray(state.time)) state.time = []; // perfis do time (somente leitura, vem da nuvem)
  if (!Array.isArray(state.tags)) state.tags = [];               // tags de conversas (Chat)
  if (!Array.isArray(state.notificacoes)) state.notificacoes = []; // minhas notificações (menções etc.)
  if (!Array.isArray(state.automacoes)) state.automacoes = [];   // automações (quando→se→então)
  state.conversas.forEach(c => {
    if (!c.tipo) c.tipo = 'individual';
    if (c.grupoJid == null) c.grupoJid = '';
    if (!Array.isArray(c.participantes)) c.participantes = [];
    normalizarDepartamentos(c);
  });
  // migração: campos novos (link, tags, contratos, área, perfil, ganhoEm)
  state.leads.forEach(l => {
    if (!Array.isArray(l.tags)) l.tags = parseTags(l.tags);
    if (l.link == null) l.link = '';
    if (!Array.isArray(l.contratos)) l.contratos = [];
    if (l.area == null) l.area = '';
    if (l.perfil == null) l.perfil = '';
    if (l.etapa === 'Ganho' && !l.ganhoEm) l.ganhoEm = l.atualizadoEm || l.criadoEm;
    // v6: trilhas e campos jurídicos
    if (!Array.isArray(l.eventos)) l.eventos = [];
    if (!Array.isArray(l.etapaHistorico) || !l.etapaHistorico.length) l.etapaHistorico = [{ etapa: l.etapa, em: l.criadoEm }];
    if (l.numeroProcesso == null) l.numeroProcesso = '';
    if (l.comarcaVara == null) l.comarcaVara = '';
    if (l.prazoLimite === undefined) l.prazoLimite = null;
  });
  if (state.settings.investimentoMkt == null) state.settings.investimentoMkt = 0;
  return state;
}

/* "Lead, Orgânico, Perfil A" → ['Lead','Orgânico','Perfil A'] */
function parseTags(v) {
  if (Array.isArray(v)) return v.map(t => String(t).trim()).filter(Boolean);
  return String(v || '').split(/[,;|]/).map(t => t.trim()).filter(Boolean)
    .filter((t, i, arr) => arr.indexOf(t) === i);
}

/* Inteligência de tags: extrai origem, área do caso e perfil das tags do CRM */
function derivarDosTags(tags) {
  const out = {};
  const t = (tags || []).map(x => String(x).toLowerCase());
  const tem = re => t.find(x => re.test(x));
  if (tem(/org[âa]nico/)) out.origem = 'Orgânico';
  else if (tem(/instagram|\binsta\b/)) out.origem = 'Instagram';
  else if (tem(/facebook|meta ads/)) out.origem = 'Facebook Ads';
  else if (tem(/google/)) out.origem = 'Google Ads';
  else if (tem(/indica[çc][ãa]o|indicado/)) out.origem = 'Indicação';
  else if (tem(/tr[áa]fego|\bads\b|pago/)) out.origem = 'Tráfego Pago';
  else if (tem(/\bsite\b|landing/)) out.origem = 'Site';
  const areaMap = [
    [/imobili/, 'Imobiliário'], [/trabalh/, 'Trabalhista'], [/previden|inss|aposentad/, 'Previdenciário'],
    [/tribut|imposto|fiscal/, 'Tributário'], [/fam[íi]lia|pens[ãa]o|guarda/, 'Família'], [/div[óo]rcio/, 'Divórcio'],
    [/invent[áa]rio|sucess|heran[çc]a/, 'Inventário'], [/criminal|penal/, 'Criminal'], [/consumidor/, 'Consumidor'],
    [/empresarial|societ|holding/, 'Empresarial'], [/contrat/, 'Contratos'], [/banc[áa]rio|juros abusiv/, 'Bancário'],
    [/usucapi/, 'Usucapião'], [/c[íi]vel/, 'Cível']
  ];
  for (const [re, nome] of areaMap) { if (tem(re)) { out.area = nome; break; } }
  const p = tem(/^perfil\s*[abc]$/);
  if (p) out.perfil = p.slice(-1).toUpperCase();
  return out;
}

/* link direto para a conversa do lead: prioriza o link importado do CRM,
   senão monta wa.me com o telefone */
function chatLink(lead, text) {
  if (!lead) return '';
  if (lead.link) return lead.link;
  return lead.telefone ? waLink(lead.telefone, text) : '';
}

let _saveTimer = null;

/* grava o estado no navegador. No modo nuvem o banco é a fonte da verdade:
   aqui fica só a preferência local (settings, sem a chave da IA). Guardar
   leads, conversas e análises de clientes num navegador compartilhado era
   vazamento — e com o time inteiro estourava o limite de ~5 MB. */
function persistirLocal() {
  const naNuvem = typeof Cloud !== 'undefined' && Cloud.ativo();
  const dados = naNuvem
    ? { settings: Object.assign({}, state.settings), createdAt: state.createdAt }
    : state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dados));
}

/* garante que nada se perde se o usuário fechar a aba logo após editar; no
   modo nuvem, avisa se ainda há alteração que não chegou ao banco */
window.addEventListener('beforeunload', ev => {
  clearTimeout(_saveTimer);
  try { persistirLocal(); } catch (e) {}
  if (typeof Cloud !== 'undefined' && Cloud.ativo() && Cloud.temPendencia && Cloud.temPendencia()) {
    ev.preventDefault();
    ev.returnValue = '';
  }
});

function save() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      persistirLocal();
    } catch (e) {
      console.error('Erro ao salvar', e);
      UI.toast('Erro ao salvar dados no navegador', 'err');
    }
  }, 800); /* debounce maior: JSON.stringify do estado é caro; beforeunload garante o flush */
  // modo nuvem: envia as mudanças para o banco compartilhado
  if (typeof Cloud !== 'undefined' && Cloud.ativo()) Cloud.agendarSync();
}

/* ---------- utilitários ---------- */

function uid() {
  if (crypto && crypto.randomUUID) { try { return crypto.randomUUID(); } catch (e) {} }
  // fallback UUID v4 (compatível com o banco na nuvem)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function addDaysISO(baseISO, days) {
  const d = baseISO ? new Date(baseISO + 'T12:00:00') : new Date();
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* a semana começa no DOMINGO (pedido do dono) — vale para a Agenda do CRM */
const DOWS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function _d(iso) { return new Date(iso + 'T12:00:00'); }

/* primeiro dia da semana (domingo) de uma data ISO */
function inicioDaSemana(iso) {
  return addDaysISO(iso, -_d(iso).getDay());
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/* horas sem uso até a sessão encerrar sozinha (config do admin): 6 por padrão, 0 desliga, teto 24 */
function normHorasInatividade(v) {
  if (v == null || v === '') return 6;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 6;
  return Math.min(24, n);
}

/* "6 h", "2,5 h", "30 min" — para as mensagens sobre o limite de inatividade */
function fmtHorasInatividade(h) {
  h = Number(h) || 0;
  if (h < 1) return Math.round(h * 60) + ' min';
  return (Number.isInteger(h) ? String(h) : h.toLocaleString('pt-BR')) + ' h';
}

/* ---- presença do time (Configurações → Equipe; chat-v16a) ----
   cada aba manda um pulso por minuto: 3 pulsos sem resposta = offline */
const PRESENCA_ONLINE_MS = 3 * 60000;
function presencaOnline(vistoEm, agora) {
  if (!vistoEm) return false;
  const t = new Date(vistoEm).getTime();
  return !isNaN(t) && (agora || Date.now()) - t < PRESENCA_ONLINE_MS;
}
const _horaCurta = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const _diaLocal = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
/* "hoje às 14:32" / "ontem às 18:05" / "03/10 às 17:50" / "nunca entrou" */
function rotuloUltimoAcesso(vistoEm, agora) {
  if (!vistoEm) return 'nunca entrou';
  const t = new Date(vistoEm).getTime();
  if (isNaN(t)) return 'nunca entrou';
  const ref = agora || Date.now();
  const dia = _diaLocal(t);
  if (dia === _diaLocal(ref)) return 'hoje às ' + _horaCurta(t);
  if (dia === _diaLocal(ref - 86400000)) return 'ontem às ' + _horaCurta(t);
  return new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' às ' + _horaCurta(t);
}
/* acessos de um dia → ["08:02–12:10", "13:31–agora"]: junta os que se sobrepõem
   (duas abas abertas) e corta o que começou antes de `inicio` (acesso da madrugada) */
function periodosDeAcesso(acessos, agora, inicio) {
  const ref = agora || Date.now();
  const itens = (acessos || [])
    .map(a => ({ de: new Date(a.entrou_em).getTime(), ate: new Date(a.visto_em).getTime() }))
    .filter(x => !isNaN(x.de) && !isNaN(x.ate))
    .map(x => ({ de: inicio ? Math.max(x.de, inicio) : x.de, ate: x.ate }))
    .sort((a, b) => a.de - b.de);
  const blocos = [];
  itens.forEach(x => {
    const u = blocos[blocos.length - 1];
    if (u && x.de <= u.ate + PRESENCA_ONLINE_MS) u.ate = Math.max(u.ate, x.ate);
    else blocos.push({ de: x.de, ate: x.ate });
  });
  return blocos.map(b => _horaCurta(b.de) + '–' + (ref - b.ate < PRESENCA_ONLINE_MS ? 'agora' : _horaCurta(b.ate)));
}

function diasAte(iso) {
  // negativo = atrasado
  const hoje = new Date(todayISO() + 'T12:00:00');
  const alvo = new Date(iso + 'T12:00:00');
  return Math.round((alvo - hoje) / 86400000);
}

function fmtMoney(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function parseMoney(str) {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  let s = String(str).replace(/[R$\s.]/g, '').replace(',', '.');
  // caso "1.234,56" já tratado; caso "1234.56" original:
  if (!/,/.test(String(str)) && /\.\d{1,2}$/.test(String(str))) s = String(str).replace(/[R$\s]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function normPhone(p) {
  if (!p) return '';
  let d = String(p).replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d; // assume BR
  return d;
}

function waLink(phone, text) {
  const p = normPhone(phone);
  const t = text ? '?text=' + encodeURIComponent(text) : '';
  return p ? `https://wa.me/${p}${t}` : '';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const COR_PADRAO_DADO = '#5C7F9E'; /* cor-dado — aço-400: cor padrão de departamento/tag gravada no banco; única cor avulsa fora das listas */
/* cor gravada no banco (tag, departamento) que vai para dentro de style="".
   Qualquer usuário consegue gravar essas colunas pela API: sem esta trava, um
   valor como `red;" onmouseover="...` virava código na tela de todo o time. */
function corSegura(c) {
  return /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : COR_PADRAO_DADO;
}

/* ---------- horário ("seg-sex 08:00-18:00") ----------
   Um leitor só, usado pelo horário de acesso, pelas automações e pela
   validação dos formulários. O antigo entrava em laço infinito com um dia
   que ele não conhecia ("seg-sexta") e congelava a aba. */
const DIAS_SEMANA = {
  dom: 0, domingo: 0, seg: 1, segunda: 1, ter: 2, terca: 2, 'terça': 2, qua: 3, quarta: 3,
  qui: 4, quinta: 4, sex: 5, sexta: 5, sab: 6, 'sáb': 6, sabado: 6, 'sábado': 6
};

/* devolve {dias:Set, ini, fim} em minutos, ou null se o texto não for um horário válido */
function interpretarHorario(spec) {
  const m = String(spec || '').trim().toLowerCase().replace(/\./g, '')
    .match(/^(\S+)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [h1, m1, h2, m2] = [+m[2], +m[3], +m[4], +m[5]];
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
  const dias = new Set();
  if (m[1] === 'todos') [0, 1, 2, 3, 4, 5, 6].forEach(d => dias.add(d));
  else if (m[1].includes('-') && !m[1].includes(',')) {
    const [a, b] = m[1].split('-').map(x => DIAS_SEMANA[x]);
    if (a == null || b == null) return null;
    for (let d = a, n = 0; n < 7; n++, d = (d + 1) % 7) { dias.add(d); if (d === b) break; }
  } else {
    for (const x of m[1].split(',')) {
      if (DIAS_SEMANA[x] == null) return null;
      dias.add(DIAS_SEMANA[x]);
    }
  }
  return { dias, ini: h1 * 60 + m1, fim: h2 * 60 + m2 };
}

function horarioValido(spec) { return !!interpretarHorario(spec); }

/* agora está dentro da janela? Texto inválido = dentro (ninguém é desligado
   por erro de digitação — os formulários já recusam texto inválido) */
function dentroDoHorario(spec, agora) {
  const h = interpretarHorario(spec);
  if (!h) return true;
  const d = agora || new Date();
  const min = d.getHours() * 60 + d.getMinutes();
  return h.dias.has(d.getDay()) && min >= h.ini && min <= h.fim;
}

function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || '';
}

/* Substitui variáveis {{nome}}, {{atendente}}, {{empresa}} em templates */
/* ============ textos adaptativos por área jurídica (v6.1) ============
   Cada área tem: caso (como nomear a questão), pergunta (abertura SPIN de
   situação), dica (toque de valor/reciprocidade — orientação real e segura),
   urgencia (implicação sóbria, sem terrorismo) e beneficio (need-payoff).
   Tudo em tom OAB: informativo, sem promessa de resultado. */
const AREA_TEXTOS = {
  'Imobiliário': {
    documentos: 'RG e CPF, comprovante de residência, matrícula do imóvel e o contrato ou recibos da negociação',
    caso: 'a sua questão imobiliária',
    pergunta: 'a situação envolve compra e venda, aluguel ou regularização do imóvel',
    dica: 'antes de assinar qualquer documento sobre o imóvel, vale pedir a matrícula atualizada no cartório — é ela que revela penhoras, dívidas e restrições que não aparecem no contrato',
    urgencia: 'em questões de imóvel, prazos de registro e notificações costumam correr mesmo sem a gente perceber',
    beneficio: 'garantir segurança jurídica no seu imóvel, com cada passo documentado'
  },
  'Trabalhista': {
    documentos: 'RG e CPF, comprovante de residência, carteira de trabalho (física ou digital), contracheques e os comprovantes de jornada ou conversas que você guardou',
    caso: 'a sua questão trabalhista',
    pergunta: 'você ainda está na empresa ou o vínculo já foi encerrado',
    dica: 'guarde tudo: contracheques, mensagens com o empregador, escalas e comprovantes de jornada — na Justiça do Trabalho, quem documenta sai na frente',
    urgencia: 'direitos trabalhistas têm prazo de 2 anos após a saída para serem cobrados — e cada mês conta na conta final',
    beneficio: 'entender exatamente o que você tem direito a receber e o caminho para buscar isso'
  },
  'Previdenciário': {
    documentos: 'RG e CPF, comprovante de residência, extrato CNIS, carnês ou comprovantes de contribuição e, se for o caso, laudos e exames médicos',
    caso: 'a sua questão previdenciária',
    pergunta: 'você já fez o requerimento no INSS ou ainda está juntando a documentação',
    dica: 'antes de dar entrada no INSS, vale conferir o seu CNIS (extrato de contribuições) — a maioria das negativas nasce de vínculos que não constam lá',
    urgencia: 'cada mês sem o benefício correto é um valor que não volta sozinho — e a data do pedido influencia desde quando você recebe',
    beneficio: 'buscar o benefício correto, no valor correto, com a documentação forte desde o início'
  },
  'Tributário': {
    documentos: 'RG e CPF (ou cartão CNPJ), as notificações ou autos que você recebeu e os comprovantes de pagamento relacionados',
    caso: 'a sua questão tributária',
    pergunta: 'a situação envolve uma cobrança que você recebeu ou o planejamento dos seus impostos',
    dica: 'guarde as notificações com os envelopes e datas de recebimento — o prazo para se defender de uma cobrança fiscal conta a partir daí, e ele costuma ser curto',
    urgencia: 'em matéria fiscal, perder um prazo de defesa pode transformar uma cobrança discutível em dívida definitiva',
    beneficio: 'pagar apenas o que é devido, com a tranquilidade de estar em dia'
  },
  'Família': {
    documentos: 'RG e CPF, comprovante de residência, certidão de casamento ou de nascimento dos filhos e comprovantes de renda',
    caso: 'a sua questão de família',
    pergunta: 'a situação envolve filhos, pensão ou a partilha de bens',
    dica: 'mesmo em acordo amigável, formalizar tudo por escrito e homologar evita que combinados de hoje virem conflito amanhã — principalmente quando há filhos',
    urgencia: 'questões de família tendem a ficar mais difíceis com o tempo, principalmente quando envolvem convivência e pensão',
    beneficio: 'resolver com o mínimo de desgaste para você e para quem você ama, com tudo formalizado'
  },
  'Divórcio': {
    documentos: 'RG e CPF, certidão de casamento, pacto antenupcial (se houver), documentos dos bens do casal e certidão de nascimento dos filhos',
    caso: 'o seu divórcio',
    pergunta: 'vocês já conversaram sobre a divisão dos bens e, se houver filhos, sobre a guarda',
    dica: 'quando há consenso, o divórcio pode ser bem mais rápido e simples do que a maioria imagina — em alguns casos até em cartório; o desenho certo depende da situação de vocês',
    urgencia: 'enquanto o divórcio não é formalizado, patrimônio e obrigações dos dois continuam juridicamente entrelaçados',
    beneficio: 'encerrar esse ciclo com segurança, rapidez e o mínimo de atrito possível'
  },
  'Inventário': {
    documentos: 'RG e CPF dos herdeiros, certidão de óbito, certidões de casamento/nascimento da família, documentos dos bens e o testamento, se houver',
    caso: 'o inventário da sua família',
    pergunta: 'o falecimento é recente ou o inventário está pendente há algum tempo',
    dica: 'o prazo para abrir o inventário é de 2 meses após o falecimento — passado isso, incide multa sobre o imposto (ITCMD) que aumenta o custo para todos os herdeiros',
    urgencia: 'inventário parado significa bens bloqueados: ninguém vende, transfere ou movimenta até regularizar',
    beneficio: 'destravar os bens da família pagando o menor custo legal possível'
  },
  'Criminal': {
    documentos: 'RG e CPF e os documentos, intimações ou papéis do processo que você recebeu',
    caso: 'a sua questão criminal',
    pergunta: 'já existe inquérito ou processo em andamento, ou foi uma ocorrência recente',
    dica: 'em qualquer contato com a polícia ou a Justiça, você tem direito de ser acompanhado por um advogado antes de responder qualquer coisa — usar esse direito não é sinal de culpa, é proteção',
    urgencia: 'na esfera criminal, os primeiros atos do processo costumam ser decisivos para todo o resto',
    beneficio: 'ter uma defesa técnica desde o primeiro momento, com seus direitos preservados'
  },
  'Cível': {
    documentos: 'RG e CPF, comprovante de residência e os contratos, conversas e comprovantes ligados ao caso',
    caso: 'a sua questão',
    pergunta: 'me conta em poucas palavras o que aconteceu e com quem é a disputa',
    dica: 'reúna tudo que documenta a situação: conversas, contratos, comprovantes e fotos — organizados em ordem de data, eles valem muito na hora de agir',
    urgencia: 'a maioria das ações cíveis tem prazo (prescrição) — esperar demais pode significar perder o direito de cobrar',
    beneficio: 'transformar essa situação em um plano de ação claro, com começo, meio e fim'
  },
  'Consumidor': {
    documentos: 'RG e CPF, comprovante de residência, os protocolos de atendimento, notas fiscais e prints das conversas com a empresa',
    caso: 'o seu problema de consumo',
    pergunta: 'você já tentou resolver diretamente com a empresa — e tem os protocolos dessas tentativas',
    dica: 'anote todos os protocolos de atendimento e guarde prints das conversas — eles provam que a empresa teve a chance de resolver e não resolveu',
    urgencia: 'quanto mais recente o problema, mais forte a prova e melhor a chance de reparação',
    beneficio: 'ser reparado pelo que passou, incluindo o que a empresa deveria ter resolvido e não resolveu'
  },
  'Empresarial': {
    documentos: 'contrato social, cartão CNPJ, RG e CPF dos sócios e os contratos ou documentos ligados à questão',
    caso: 'a questão da sua empresa',
    pergunta: 'a situação envolve um contrato, um sócio ou uma disputa com terceiros',
    dica: 'empresas que revisam seus contratos-padrão uma vez por ano evitam a maior parte das disputas — o barato do modelo pronto da internet costuma sair caro',
    urgencia: 'no meio empresarial, uma pendência jurídica mal resolvida trava crédito, licitações e até a venda da empresa',
    beneficio: 'proteger o que você construiu e deixar a empresa juridicamente redonda para crescer'
  },
  'Contratos': {
    documentos: 'RG e CPF, o contrato em questão (com aditivos, se houver) e os comprovantes de pagamento',
    caso: 'o seu contrato',
    pergunta: 'o contrato ainda vai ser assinado ou o problema é com um contrato já em vigor',
    dica: 'nunca assine com pressa: as cláusulas de multa, rescisão e foro são justamente as que menos se lê e as que mais pesam depois',
    urgencia: 'depois de assinado, renegociar um contrato ruim é muito mais difícil do que revisá-lo antes',
    beneficio: 'assinar (ou sair de) um contrato com total clareza do que ele significa para você'
  },
  'Bancário': {
    documentos: 'RG e CPF, comprovante de residência, o contrato com o banco e os extratos da operação',
    caso: 'a sua questão com o banco',
    pergunta: 'a situação envolve juros que subiram, desconto indevido ou renegociação de dívida',
    dica: 'peça ao banco o extrato completo da operação e o contrato assinado — é seu direito, e é neles que aparecem as tarifas e juros que podem ser questionados',
    urgencia: 'juros abusivos crescem em silêncio: quanto antes a revisão, menor a bola de neve',
    beneficio: 'colocar os números na mesa e pagar apenas o que é justo'
  },
  'Usucapião': {
    documentos: 'RG e CPF, comprovante de residência e as contas antigas do imóvel (luz, água, IPTU) — quanto mais antigas, melhor',
    caso: 'a regularização do seu imóvel por usucapião',
    pergunta: 'há quanto tempo você está no imóvel e como foi a entrada — compra informal, herança ou ocupação',
    dica: 'guarde contas de luz e água antigas, IPTU e declarações de vizinhos — são elas que provam o tempo de posse, que é o coração da usucapião',
    urgencia: 'sem o registro, o imóvel não pode ser vendido, financiado nem deixado formalmente de herança',
    beneficio: 'transformar a sua posse em propriedade registrada, com valor de mercado real'
  }
};
const AREA_GENERICO = {
  documentos: 'RG e CPF, comprovante de residência e os documentos ligados ao caso',
  caso: 'o seu caso',
  pergunta: 'me conta em poucas palavras o que está acontecendo',
  dica: 'reúna e organize por data tudo que documenta a sua situação — contratos, conversas e comprovantes; com isso em mãos, a orientação sai muito mais precisa',
  urgencia: 'a maioria das questões jurídicas tem prazos que correm em silêncio',
  beneficio: 'sair da dúvida e ter um caminho claro para resolver'
};

function textosDaArea(lead) {
  const area = (lead && lead.area) || '';
  return AREA_TEXTOS[area] || AREA_GENERICO;
}

/* assinatura do atendente ("*Nome:*" na linha de cima), a mesma do envio normal do Chat. Vale também
   para as agendadas e para as mensagens programadas pela cadência: quem agenda/registra assina (dono, 14/10/2026) */
function assinarTexto(texto) {
  const p = (typeof Cloud !== 'undefined' && Cloud.ativo && Cloud.ativo() && Cloud.perfil && Cloud.perfil()) || null;
  return (p && p.exibir_assinatura && p.assinatura) ? '*' + p.assinatura + ':*\n' + texto : texto;
}

function renderTemplate(tpl, lead, extras) {
  const t = textosDaArea(lead);
  const ctx = {
    nome: primeiroNome(lead && lead.nome) || 'tudo bem',
    nome_completo: (lead && lead.nome) || '',
    atendente: primeiroNome(state.settings.nomeAtendente) || 'nossa equipe',
    empresa: state.settings.empresa || 'nosso escritório',
    /* v6.1 — adaptativos por área jurídica (resolvem sozinhos; nada de lacunas manuais) */
    area: (lead && lead.area) || 'Jurídico',
    caso: t.caso,
    pergunta: t.pergunta,
    dica: t.dica,
    urgencia: t.urgencia,
    beneficio: t.beneficio,
    dor: (lead && lead.dor && String(lead.dor).trim()) || t.caso,
    documentos: t.documentos || 'RG e CPF, comprovante de residência e os documentos ligados ao caso'
  };
  if (extras) Object.assign(ctx, extras); // ex.: hora_consulta / data_consulta
  return String(tpl || '').replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] != null ? ctx[k] : '');
}

/* ---------- operações de leads ---------- */

function getLead(id) { return state.leads.find(l => l.id === id); }

function novoLead(data) {
  const agora = data.criadoEm || new Date().toISOString();
  const etapa = ETAPAS.includes(data.etapa) ? data.etapa : 'Novo';
  const lead = {
    id: uid(),
    nome: data.nome || 'Sem nome',
    telefone: data.telefone || '',
    email: data.email || '',
    empresa: data.empresa || '',
    link: data.link || '',
    tags: parseTags(data.tags),
    area: data.area || '',
    perfil: data.perfil || '',
    contratos: [],
    ganhoEm: data.etapa === 'Ganho' ? agora : null,
    origem: data.origem || '',
    etapa,
    temperatura: TEMPERATURAS.includes(data.temperatura) ? data.temperatura : 'Morno',
    valor: parseMoney(data.valor),
    dor: data.dor || '',
    notas: data.notas || '',
    motivoPerda: '',
    /* v6 — campos jurídicos */
    numeroProcesso: data.numeroProcesso || '',
    comarcaVara: data.comarcaVara || '',
    prazoLimite: data.prazoLimite || null,
    /* v6 — trilhas */
    eventos: [],
    etapaHistorico: [{ etapa, em: agora }],
    criadoEm: agora,
    atualizadoEm: new Date().toISOString()
  };
  state.leads.unshift(lead);
  registrarEvento(lead, 'criado', 'Lead criado' + (lead.origem ? ' — origem: ' + lead.origem : ''));
  save();
  return lead;
}

/* ---------- timeline do lead (v6) ---------- */
function quemSou() {
  return (typeof Cloud !== 'undefined' && Cloud.ativo && Cloud.ativo() && Cloud.perfil() && Cloud.perfil().nome)
    || state.settings.nomeAtendente || '';
}

/* tipos: criado | etapa | temperatura | contrato | nota | followup | resposta | analise | sistema */
function registrarEvento(leadOuId, tipo, texto) {
  const lead = typeof leadOuId === 'string' ? getLead(leadOuId) : leadOuId;
  if (!lead) return;
  if (!Array.isArray(lead.eventos)) lead.eventos = [];
  lead.eventos.push({ em: new Date().toISOString(), tipo, texto: String(texto || '').slice(0, 500), autor: quemSou() });
  if (lead.eventos.length > 300) lead.eventos = lead.eventos.slice(-300);
}

function atualizarLead(id, patch) {
  const lead = getLead(id);
  if (!lead) return null;
  // trilhas automáticas de mudança (v6)
  if (patch.etapa && patch.etapa !== lead.etapa) {
    if (!Array.isArray(lead.etapaHistorico)) lead.etapaHistorico = [{ etapa: lead.etapa, em: lead.criadoEm }];
    lead.etapaHistorico.push({ etapa: patch.etapa, em: new Date().toISOString() });
    registrarEvento(lead, 'etapa', lead.etapa + ' → ' + patch.etapa);
  }
  if (patch.temperatura && patch.temperatura !== lead.temperatura) {
    registrarEvento(lead, 'temperatura', lead.temperatura + ' → ' + patch.temperatura);
  }
  Object.assign(lead, patch, { atualizadoEm: new Date().toISOString() });
  save();
  return lead;
}

function removerLead(id) {
  state.leads = state.leads.filter(l => l.id !== id);
  state.followups = state.followups.filter(f => f.leadId !== id);
  state.analyses = state.analyses.filter(a => a.leadId !== id);
  save();
}

function analisesDoLead(id) {
  return state.analyses.filter(a => a.leadId === id).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

/* ---------- helpers v6 (ponte com o Chat + gestão) ---------- */

/* conversa do Chat vinculada a este lead (a mais recente, se houver mais de uma) */
function conversaDoLead(leadId) {
  const cs = (state.conversas || []).filter(c => c.leadId === leadId && !c.arquivada);
  if (!cs.length) return null;
  return cs.sort((a, b) => String(b.ultimaMsgEm || '').localeCompare(String(a.ultimaMsgEm || '')))[0];
}

/* score de prioridade de atendimento: quem eu chamo primeiro?
   temperatura quente + valor + follow-up atrasado + prazo jurídico próximo */
/* Índice de follow-ups pendentes por lead, construído UMA vez por render.
   Sem ele, cada linha da lista varre state.followups inteiro — com 500 leads e
   2.000 follow-ups são ~1 milhão de comparações a cada tecla digitada na busca,
   e a ordenação por prioridade multiplica isso por log(n). */
function indicePendentes() {
  const idx = new Map();
  state.followups.forEach(f => {
    if (f.status !== 'pendente') return;
    const arr = idx.get(f.leadId);
    if (arr) arr.push(f); else idx.set(f.leadId, [f]);
  });
  idx.forEach(arr => arr.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))));
  return idx;
}

/* idx opcional: quem renderiza uma lista passa o índice e evita o O(n·m) */
function leadPrioridade(l, idx) {
  if (!ETAPAS_ABERTAS.includes(l.etapa)) return -1;
  let s = 0;
  if (l.temperatura === 'Quente') s += 40;
  else if (l.temperatura === 'Morno') s += 15;
  if (l.valor >= 20000) s += 25; else if (l.valor >= 8000) s += 15; else if (l.valor > 0) s += 6;
  const hoje = todayISO();
  const fus = idx ? (idx.get(l.id) || []) : state.followups.filter(f => f.leadId === l.id && f.status === 'pendente');
  if (fus.some(f => f.dueDate < hoje)) s += 30;        // follow-up atrasado
  else if (fus.some(f => f.dueDate === hoje)) s += 18; // follow-up hoje
  if (l.prazoLimite) {
    const dias = Math.ceil((new Date(l.prazoLimite) - new Date(hoje)) / 86400000);
    if (dias <= 7) s += 35; else if (dias <= 30) s += 18;
  }
  const etapaPeso = { 'Negociação': 12, 'Proposta Enviada': 10, 'Qualificado': 6, 'Contato Feito': 3, 'Novo': 4 };
  s += etapaPeso[l.etapa] || 0;
  return s;
}

/* grupos de leads duplicados (mesmo telefone normalizado ou mesmo e-mail) */
function leadsDuplicados() {
  const porChave = {};
  state.leads.forEach(l => {
    const tel = normPhone(l.telefone || '');
    const mail = (l.email || '').trim().toLowerCase();
    if (tel && tel.length >= 8) (porChave['t' + tel.slice(-8)] = porChave['t' + tel.slice(-8)] || []).push(l);
    else if (mail) (porChave['m' + mail] = porChave['m' + mail] || []).push(l);
  });
  return Object.values(porChave).filter(g => g.length > 1)
    .map(g => g.sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))); // mais antigo primeiro
}

/* funde o lead duplicado no principal (o mais antigo vence; história preservada) */
function mesclarLeads(principalId, duplicadoId) {
  const p = getLead(principalId), d = getLead(duplicadoId);
  if (!p || !d || p.id === d.id) return null;
  // dados: preenche buracos do principal com o que o duplicado tem
  ['email', 'empresa', 'link', 'area', 'perfil', 'origem', 'dor', 'numeroProcesso', 'comarcaVara', 'prazoLimite'].forEach(k => {
    if (!p[k] && d[k]) p[k] = d[k];
  });
  if (d.valor > (p.valor || 0)) p.valor = d.valor;
  p.tags = Array.from(new Set([...(p.tags || []), ...(d.tags || [])]));
  if (d.notas) p.notas = (p.notas ? p.notas + '\n---\n' : '') + d.notas;
  p.contratos = [...(p.contratos || []), ...(d.contratos || [])].sort((a, b) => b.data.localeCompare(a.data));
  p.eventos = [...(p.eventos || []), ...(d.eventos || [])].sort((a, b) => a.em.localeCompare(b.em));
  // filhos apontam para o principal
  state.followups.forEach(f => { if (f.leadId === d.id) f.leadId = p.id; });
  state.analyses.forEach(a => { if (a.leadId === d.id) a.leadId = p.id; });
  (state.conversas || []).forEach(c => { if (c.leadId === d.id) c.leadId = p.id; });
  registrarEvento(p, 'sistema', 'Lead duplicado mesclado: ' + (d.nome || d.telefone || d.id));
  state.leads = state.leads.filter(l => l.id !== d.id);
  p.atualizadoEm = new Date().toISOString();
  save();
  return p;
}

/* investimento de marketing de um mês ('2026-08'): histórico > valor único legado */
function investimentoDoMes(mes) {
  const h = state.settings.investimentoPorMes || {};
  if (h[mes] != null) return Number(h[mes]) || 0;
  return Number(state.settings.investimentoMkt) || 0;
}

/* métricas de um período [deISO, ateISO] com comparação implícita ao período anterior */
function metricasPeriodo(deISO, ateISO) {
  const dentro = iso => iso && iso.slice(0, 10) >= deISO && iso.slice(0, 10) <= ateISO;
  const leads = state.leads.filter(l => dentro(l.criadoEm));
  const ganhos = state.leads.filter(l => l.etapa === 'Ganho' && dentro(l.ganhoEm));
  const perdidos = state.leads.filter(l => l.etapa === 'Perdido' && dentro(l.atualizadoEm));
  const receita = ganhos.reduce((s, l) => s + (l.contratos || []).reduce((x, c) => x + (c.valor - (c.desconto || 0)), 0), 0);
  const fusFeitos = state.followups.filter(f => f.status === 'feito' && dentro(f.feitoEm));
  // investimento: soma dos meses que o período toca
  let investimento = 0;
  const meses = new Set();
  for (let d = new Date(deISO); d <= new Date(ateISO); d.setDate(d.getDate() + 1)) meses.add(d.toISOString().slice(0, 7));
  meses.forEach(m => investimento += investimentoDoMes(m));
  const fechados = ganhos.length + perdidos.length;
  return {
    de: deISO, ate: ateISO,
    leads: leads.length, ganhos: ganhos.length, perdidos: perdidos.length,
    conversao: fechados ? Math.round(ganhos.length / fechados * 100) : null,
    receita, followupsFeitos: fusFeitos.length, investimento,
    cpl: investimento && leads.length ? Math.round(investimento / leads.length) : null,
    cac: investimento && ganhos.length ? Math.round(investimento / ganhos.length) : null
  };
}

/* ---------- contratos (serviços contratados) ---------- */

function addContrato(leadId, c) {
  const lead = getLead(leadId);
  if (!lead) return null;
  if (!Array.isArray(lead.contratos)) lead.contratos = [];
  const contrato = {
    id: uid(),
    servico: c.servico || 'Serviço',
    data: c.data || todayISO(),
    valor: parseMoney(c.valor),
    formaPagamento: c.formaPagamento || '',
    parcelas: Math.max(1, parseInt(c.parcelas) || 1),
    desconto: parseMoney(c.desconto),
    obs: c.obs || ''
  };
  lead.contratos.push(contrato);
  lead.contratos.sort((a, b) => b.data.localeCompare(a.data));
  registrarEvento(lead, 'contrato', contrato.servico + ' — ' + (contrato.valor ? 'R$ ' + contrato.valor.toLocaleString('pt-BR') : 'sem valor'));
  lead.atualizadoEm = new Date().toISOString();
  save();
  return contrato;
}

function atualizarContrato(leadId, cid, patch) {
  const lead = getLead(leadId);
  const c = lead && (lead.contratos || []).find(x => x.id === cid);
  if (!c) return null;
  Object.assign(c, patch);
  lead.contratos.sort((a, b) => b.data.localeCompare(a.data));
  lead.atualizadoEm = new Date().toISOString();
  save();
  return c;
}

function removerContrato(leadId, cid) {
  const lead = getLead(leadId);
  if (!lead) return;
  lead.contratos = (lead.contratos || []).filter(x => x.id !== cid);
  save();
}

function valorContrato(c) { return Math.max(0, (c.valor || 0) - (c.desconto || 0)); }
function totalContratado(lead) { return (lead.contratos || []).reduce((s, c) => s + valorContrato(c), 0); }

/* ---------- atendimento (conversas WhatsApp) ---------- */

/* [id, rótulo, hex, classe do .chip, glifo ICO()]
   O hex é dado (gráficos, ponto do kanban); na interface o status é um .chip
   do sistema com glifo (DESIGN.md §9), nunca a cor crua em texto miúdo. */
/* [id, rótulo, cor de dado (kanban/gráficos — igual ao --status-*-fill), classe do chip, ícone].
   Cores (formato do ChatGuru): aberto vermelho, em atendimento azul, aguardando laranja,
   resolvido verde, fechado cinza. */
const STATUS_ATENDIMENTO = [
  ['aberto', 'Aberto', '#F07B7B', 'chip-st-aberto', 'inbox'], /* cor-dado */
  ['em_atendimento', 'Em atendimento', '#7CCB94', 'chip-st-atendimento', 'message-circle'], /* cor-dado */
  ['aguardando', 'Aguardando', '#E3C25C', 'chip-st-aguardando', 'clock'], /* cor-dado */
  ['resolvido', 'Resolvido', '#4FA06E', 'chip-st-resolvido', 'check'], /* cor-dado */
  ['fechado', 'Fechado', '#A9B2BC', 'chip-st-fechado', 'archive'] /* cor-dado */
];
/* resolvido e fechado encerram o atendimento: a conversa sai da caixa (arquivada) e
   só volta se chegar mensagem nova ou se alguém reabrir. O banco aplica a mesma
   regra por gatilho (chat-v15a), para automações e abas antigas. */
const STATUS_ENCERRADOS = ['resolvido', 'fechado'];
function statusEncerra(s) { return STATUS_ENCERRADOS.includes(s); }

function statusAtendInfo(s) {
  const x = STATUS_ATENDIMENTO.find(v => v[0] === s) || STATUS_ATENDIMENTO[0];
  return { id: x[0], label: x[1], cor: x[2], chip: x[3], icone: x[4] };
}

function getConversa(id) { return state.conversas.find(c => c.id === id); }

/* exibição amigável do telefone (esconde o identificador técnico @lid do WhatsApp) */
function telExibicao(tel) {
  if (!tel) return '';
  if (String(tel).startsWith('lid-')) return 'via WhatsApp';
  const d = String(tel).replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) {
    const ddd = d.slice(2, 4), resto = d.slice(4);
    return `(${ddd}) ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
  }
  return tel;
}

function conversaPorTelefone(tel) {
  const t = normPhone(tel);
  return state.conversas.find(c => normPhone(c.telefone) === t);
}

function departamentosAtend() {
  if (!state.departamentos.length) {
    // departamentos padrão do modo local: aço-400, grafite-700 e success-400 da paleta
    state.departamentos = [
      { id: uid(), nome: 'Comercial', cor: '#5C7F9E' }, /* cor-dado */
      { id: uid(), nome: 'Jurídico', cor: '#2E333B' }, /* cor-dado */
      { id: uid(), nome: 'Financeiro', cor: '#4C9673' } /* cor-dado */
    ];
    save();
  }
  return state.departamentos;
}

function novaConversa(data) {
  const existente = conversaPorTelefone(data.telefone);
  if (existente) return existente;
  const leadMatch = state.leads.find(l => l.telefone && normPhone(l.telefone) === normPhone(data.telefone));
  const c = {
    id: uid(),
    telefone: normPhone(data.telefone),
    tipo: data.tipo || 'individual',
    grupoJid: data.grupoJid || '',
    participantes: data.participantes || [],
    nome: data.nome || (leadMatch ? leadMatch.nome : '') || 'Contato ' + String(data.telefone).slice(-4),
    fotoUrl: '',
    leadId: data.leadId || (leadMatch ? leadMatch.id : null),
    departamentoIds: idsDeDepartamento(data),
    departamentoId: idsDeDepartamento(data)[0] || null,
    responsavel: data.responsavel || null,
    status: 'aberto',
    tags: parseTags(data.tags),
    naoLidas: 0,
    ultimaMsg: '',
    ultimaMsgEm: null,
    arquivada: false,
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString()
  };
  state.conversas.unshift(c);
  save();
  return c;
}

function mensagensDaConversa(cid) {
  // agendamento cancelado nunca saiu: fica fora da conversa, dos relatórios e da IA
  return state.mensagens.filter(m => m.conversaId === cid && m.status !== 'cancelada')
    .sort((a, b) => (a.criadoEm || '').localeCompare(b.criadoEm || ''));
}

/* registra mensagem e atualiza o resumo da conversa */
function registrarMensagem(cid, m) {
  const c = getConversa(cid);
  if (!c) return null;
  const msg = {
    id: uid(),
    conversaId: cid,
    direcao: m.direcao || 'saida',
    tipo: m.tipo || 'texto',
    texto: m.texto || '',
    midiaUrl: m.midiaUrl || '',
    midiaMime: m.midiaMime || '',
    midiaNome: m.midiaNome || '',
    midiaTamanho: m.midiaTamanho || 0,
    midiaPtt: !!m.midiaPtt,
    transcricao: m.transcricao || '',
    mencoes: m.mencoes || [],
    remetente: m.remetente || '',
    reacoes: m.reacoes || [],
    citado: m.citado || null,
    encaminhada: !!m.encaminhada,
    enquete: m.enquete || null,
    apagada: !!m.apagada,
    autor: m.autor != null ? m.autor : (typeof Cloud !== 'undefined' && Cloud.ativo() && Cloud.perfil() ? Cloud.perfil().id : null),
    agendadaPara: m.agendadaPara || null,
    status: m.status || (m.direcao === 'entrada' ? 'recebida' : (m.agendadaPara ? 'agendada' : 'pendente')),
    erro: '',
    externoId: '',
    criadoEm: m.criadoEm || new Date().toISOString()
  };
  state.mensagens.push(msg);
  // agendada ainda não saiu: não pode virar a "última mensagem" da conversa
  if (msg.tipo !== 'anotacao' && msg.status !== 'agendada') {
    c.ultimaMsg = (msg.texto || previaDeMidia(msg)).slice(0, 120);
    c.ultimaMsgEm = msg.criadoEm;
    if (msg.direcao === 'entrada') {
      c.naoLidas = (c.naoLidas || 0) + 1;
      if (c.status === 'resolvido' || c.status === 'fechado') c.status = 'aberto';
    }
  }
  c.atualizadoEm = new Date().toISOString();
  save();
  return msg;
}

/* cancela uma mensagem agendada SEM apagar a linha: ela vira 'cancelada'.
   Apagar fazia o sync emitir DELETE — e, se o motor já tivesse enviado,
   sumia do histórico uma mensagem que o cliente recebeu. Devolve false se
   ela já tinha saído da fila. */
function cancelarAgendadaLocal(m) {
  if (!m || m.status !== 'agendada') return false;
  m.status = 'cancelada';
  m.erro = '';
  return true;
}

function atualizarConversa(id, patch) {
  const c = getConversa(id);
  if (!c) return null;
  // patch legado só com o espelho ({departamentoId}) vira lista: nenhum caminho muda só o espelho
  if (patch && patch.departamentoId !== undefined && patch.departamentoIds === undefined) {
    patch = Object.assign({}, patch, { departamentoIds: patch.departamentoId ? [patch.departamentoId] : [] });
  }
  Object.assign(c, patch, { atualizadoEm: new Date().toISOString() });
  if (patch && patch.departamentoIds !== undefined) normalizarDepartamentos(c);
  save();
  return c;
}

function nomeDoPerfil(idPerfil) {
  if (!idPerfil) return '';
  const p = (state.time || []).find(x => x.id === idPerfil);
  return p ? primeiroNome(p.nome) : '';
}

/* prévia textual de uma mensagem de mídia (lista de conversas, notificações,
   transcripts e CSV — por isso é SEMPRE texto puro, sem markup) */
function previaDeMidia(m) {
  return {
    imagem: 'Foto', video: 'Vídeo', audio: 'Áudio',
    arquivo: (m.midiaNome || 'Documento'), figurinha: 'Figurinha',
    enquete: 'Enquete'
  }[m.tipo] || 'Mídia';
}

/* nome do ícone (biblioteca ICO) correspondente ao tipo de mídia — para
   contextos HTML: `${ICO(iconeDeMidia(m))} ${esc(previaDeMidia(m))}` */
function iconeDeMidia(m) {
  return {
    imagem: 'camera', video: 'video', audio: 'mic',
    arquivo: 'file-text', figurinha: 'sticker', enquete: 'chart-column'
  }[m.tipo] || 'paperclip';
}

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n >= 1048576) return (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

/* mime → tipo de mensagem do Chat */
function tipoDoMime(mime) {
  const m = String(mime || '');
  if (m.startsWith('image/')) return 'imagem';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'arquivo';
}

function tagCor(nome) {
  const t = (state.tags || []).find(x => x.nome === nome);
  return corSegura(t && t.cor);
}

/* ---------- departamentos de uma conversa (chat-v14a: LISTA) ----------
   Uma conversa pode estar em mais de um departamento (decisão do dono: a
   triagem é manual e o caso pode ser de mais de um). A lista departamentoIds
   é a verdade; departamentoId é o espelho do 1º item, mantido para as abas,
   automações e a coluna antiga do banco. Aceita objetos parciais (o pulso de
   45s e o modo sem migração só trazem departamento_id). */
function idsDeDepartamento(c) {
  if (!c) return [];
  const lista = Array.isArray(c.departamentoIds) ? c.departamentoIds
    : Array.isArray(c.departamento_ids) ? c.departamento_ids : null;
  if (lista) return lista.filter(Boolean);
  const unico = c.departamentoId !== undefined ? c.departamentoId : c.departamento_id;
  return unico ? [unico] : [];
}
function normalizarDepartamentos(c) {
  c.departamentoIds = idsDeDepartamento(c);
  c.departamentoId = c.departamentoIds[0] || null;
  return c;
}
/* troca a lista inteira (ordem preservada, sem repetidos) e mantém o espelho */
function definirDepartamentos(cid, ids) {
  const limpos = Array.from(new Set((ids || []).filter(Boolean)));
  return atualizarConversa(cid, { departamentoIds: limpos, departamentoId: limpos[0] || null });
}

/* Visibilidade por departamento — ESPELHO da policy do banco (chat-v8 + chat-v14a):
   admin | sem depto | delegada a mim | algum depto da conversa na MINHA LISTA | alçada conversas_todas.
   ATENÇÃO: desde a v8 o vínculo do perfil é departamento_ids (LISTA); o campo
   antigo departamento_id é só legado. Filtrar pelo antigo escondia do atendente
   as conversas delegadas ao departamento dele — o banco entregava e o front sumia. */
function podeVerConversa(c) {
  if (typeof Cloud === 'undefined' || !Cloud.ativo()) return true;
  const eu = Cloud.perfil();
  if (!eu || eu.papel === 'admin') return true;
  if (c.responsavel === eu.id) return true;
  const ids = idsDeDepartamento(c);
  const meus = (eu.departamento_ids && eu.departamento_ids.length)
    ? eu.departamento_ids
    : (eu.departamento_id ? [eu.departamento_id] : []);
  if (ids.some(id => meus.includes(id))) return true;
  // sem departamento (ainda não distribuída) só o admin vê — desde a chat-v15b;
  // antes era "visível a todo o time", o que mostrava o histórico inteiro a qualquer atendente
  return !!(typeof ChatUI !== 'undefined' && ChatUI.pode && ChatUI.pode('conversas_todas'));
}

/* ---------- métricas ---------- */

function metricas() {
  const leads = state.leads;
  const abertos = leads.filter(l => ETAPAS_ABERTAS.includes(l.etapa));
  const ganhos = leads.filter(l => l.etapa === 'Ganho');
  const perdidos = leads.filter(l => l.etapa === 'Perdido');
  const fechados = ganhos.length + perdidos.length;

  const fus = state.followups.filter(f => f.status === 'pendente');
  const hoje = todayISO();
  const fusHoje = fus.filter(f => f.dueDate === hoje);
  const fusAtrasados = fus.filter(f => f.dueDate < hoje);
  const fusFeitos = state.followups.filter(f => f.status === 'feito');

  const scores = state.analyses.map(a => a.scores && a.scores.geral).filter(n => typeof n === 'number');
  const scoreMedio = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  const porEtapa = {};
  ETAPAS.forEach(e => porEtapa[e] = leads.filter(l => l.etapa === e).length);

  const porTemp = {};
  TEMPERATURAS.forEach(t => porTemp[t] = abertos.filter(l => l.temperatura === t).length);

  const porOrigem = {};
  leads.forEach(l => { const o = l.origem || 'Sem origem'; porOrigem[o] = (porOrigem[o] || 0) + 1; });

  const porMotivo = {};
  perdidos.forEach(l => { const m = l.motivoPerda || 'Não informado'; porMotivo[m] = (porMotivo[m] || 0) + 1; });

  const porArea = {};
  leads.forEach(l => { if (l.area) porArea[l.area] = (porArea[l.area] || 0) + 1; });

  // receita real (contratos) e ticket médio
  const receitaContratada = leads.reduce((s, l) => s + totalContratado(l), 0);
  const clientesComContrato = leads.filter(l => (l.contratos || []).length).length;
  const ticketMedio = clientesComContrato
    ? Math.round(receitaContratada / clientesComContrato)
    : (ganhos.length ? Math.round(ganhos.reduce((s, l) => s + (l.valor || 0), 0) / ganhos.length) : null);

  // CPL e CAC do mês atual (dependem do investimento configurado)
  const mesAtual = todayISO().slice(0, 7);
  const leadsNoMes = leads.filter(l => (l.criadoEm || '').slice(0, 7) === mesAtual).length;
  const ganhosNoMes = leads.filter(l => l.etapa === 'Ganho' && ((l.ganhoEm || l.atualizadoEm || '').slice(0, 7) === mesAtual)).length;
  const inv = Number(state.settings.investimentoMkt) || 0;

  return {
    receitaContratada, clientesComContrato, ticketMedio, porArea,
    leadsNoMes, ganhosNoMes,
    cpl: inv && leadsNoMes ? Math.round(inv / leadsNoMes) : null,
    cac: inv && ganhosNoMes ? Math.round(inv / ganhosNoMes) : null,
    investimentoMkt: inv,
    total: leads.length,
    abertos: abertos.length,
    ganhos: ganhos.length,
    perdidos: perdidos.length,
    taxaConversao: fechados ? Math.round(ganhos.length / fechados * 100) : null,
    pipeline: abertos.reduce((s, l) => s + (l.valor || 0), 0),
    receitaGanha: ganhos.reduce((s, l) => s + (l.valor || 0), 0),
    fusHoje: fusHoje.length,
    fusAtrasados: fusAtrasados.length,
    fusPendentes: fus.length,
    fusFeitos: fusFeitos.length,
    disciplinaFollowup: (fusFeitos.length + fusAtrasados.length) ? Math.round(fusFeitos.length / (fusFeitos.length + fusAtrasados.length) * 100) : null,
    scoreMedio, porEtapa, porTemp, porOrigem, porMotivo,
    analises: state.analyses.length
  };
}

/* série diária de leads criados entre duas datas (inclusive) */
function leadsPorDia(iniISO, fimISO) {
  const mapa = {};
  state.leads.forEach(l => {
    const d = (l.criadoEm || '').slice(0, 10);
    if (d >= iniISO && d <= fimISO) mapa[d] = (mapa[d] || 0) + 1;
  });
  const serie = [];
  let d = iniISO;
  while (d <= fimISO) {
    serie.push({ data: d, label: d.slice(8, 10), value: mapa[d] || 0, hoje: d === todayISO() });
    d = addDaysISO(d, 1);
  }
  return serie;
}

/* receita contratada por mês (últimos n meses) */
function receitaPorMes(n) {
  const meses = [];
  const base = new Date(todayISO() + 'T12:00:00');
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const chave = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    meses.push({ chave, label: d.toLocaleDateString('pt-BR', { month: 'short' }) + '/' + String(d.getFullYear()).slice(2), value: 0 });
  }
  state.leads.forEach(l => (l.contratos || []).forEach(c => {
    const m = meses.find(x => x.chave === (c.data || '').slice(0, 7));
    if (m) m.value += valorContrato(c);
  }));
  return meses;
}

/* ---------- dados de exemplo ---------- */

const CONVERSA_EXEMPLO = `Atendente: Bom dia, Mariana! Tudo bem? Aqui é o Rafael. Vi que você preencheu nosso formulário sobre a consultoria. Me conta, o que te motivou a buscar ajuda agora?
Mariana: Oi Rafael, tudo sim! Então, estou com muita dificuldade pra organizar a parte de contratos da minha empresa, tá tudo atrasado.
Atendente: Entendo, Mariana. E hoje, como vocês fazem esse controle? Há quanto tempo isso vem acontecendo?
Mariana: A gente usa planilha mesmo, mas já tem uns 6 meses que virou uma bagunça. Já perdemos até um prazo importante.
Atendente: Imagino o quanto isso preocupa. E se continuar assim, qual o impacto que isso pode ter pro negócio nos próximos meses?
Mariana: Ah, a gente pode tomar multa, perder cliente... é bem sério.
Atendente: Faz sentido. Se existisse uma forma de resolver isso em 30 dias, com acompanhamento próximo, isso ajudaria vocês?
Mariana: Ajudaria demais! Quanto custa esse serviço?
Atendente: Antes de falar de valores, deixa eu te mostrar como funciona: nós assumimos toda a gestão dos contratos, com revisão jurídica e alertas de prazo. Clientes como a TechLog reduziram atrasos em 90% no primeiro mês. O investimento é de R$ 2.500/mês.
Mariana: Hmm, achei um pouco caro... vou pensar e te falo.
Atendente: Entendo, Mariana. Quando você diz que precisa pensar, o que exatamente ainda não ficou claro pra você? É o valor em si ou o retorno que isso traria?
Mariana: Acho que preciso ver com meu sócio, ele que cuida do financeiro.
Atendente: Perfeito, faz todo sentido envolver ele. Que tal marcarmos uma conversa rápida de 20 minutos com vocês dois na quinta às 10h? Assim ele tira as dúvidas direto comigo.
Mariana: Pode ser, quinta às 10 funciona.
Atendente: Fechado! Vou te enviar o convite. Até quinta, Mariana!`;

function seedDemo() {
  const demo = [
    { nome: 'Mariana Souza', telefone: '11988887777', email: 'mariana@exemplo.com', empresa: 'Souza Log', origem: 'Instagram', etapa: 'Proposta Enviada', temperatura: 'Quente', valor: 30000, dor: 'Gestão de contratos desorganizada' },
    { nome: 'Carlos Pereira', telefone: '11977776666', email: 'carlos@exemplo.com', empresa: 'CP Transportes', origem: 'Google Ads', etapa: 'Contato Feito', temperatura: 'Morno', valor: 18000, dor: 'Passivo trabalhista' },
    { nome: 'Fernanda Lima', telefone: '21966665555', email: 'fer@exemplo.com', empresa: 'Bella Estética', origem: 'Indicação', etapa: 'Qualificado', temperatura: 'Quente', valor: 12000, dor: 'Contratos com fornecedores' },
    { nome: 'João Batista', telefone: '31955554444', email: '', empresa: 'JB Construções', origem: 'Site', etapa: 'Novo', temperatura: 'Morno', valor: 45000, dor: '' },
    { nome: 'Ana Clara Reis', telefone: '11944443333', email: 'ana@exemplo.com', empresa: 'AC Moda', origem: 'Facebook Ads', etapa: 'Ganho', temperatura: 'Quente', valor: 15000, dor: 'Regularização societária' },
    { nome: 'Roberto Nunes', telefone: '41933332222', email: '', empresa: 'RN Alimentos', origem: 'Google Ads', etapa: 'Perdido', temperatura: 'Frio', valor: 20000, dor: '' }
  ];
  const criados = demo.map(d => novoLead(d));
  atualizarLead(criados[5].id, { motivoPerda: 'Preço' });

  // cadência aplicada em 2 leads
  Cadence.aplicar(criados[1].id, 'speed-to-lead');
  Cadence.aplicar(criados[0].id, 'pos-proposta');

  // análise real da conversa de exemplo
  const resultado = Analysis.analyze(CONVERSA_EXEMPLO, { atendente: 'Atendente', leadId: criados[0].id });
  state.analyses.unshift(resultado);
  save();
  return criados.length;
}
