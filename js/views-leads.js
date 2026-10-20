/* ============ VIEW: LEADS (lista, detalhe, cadastro, importação) ============ */

/* campoData: QUAL data o intervalo de/até filtra. O dashboard mede coisas diferentes
   em campos diferentes (ganho em ganhoEm, perda em atualizadoEm), então sem isto um
   clique em "Ganhos do mês" devolveria outro conjunto — errado e silencioso.
   somenteIds: recorte já calculado noutro lugar (ex.: "Esfriando agora"), sem predicado
   equivalente aqui. rotulo: o que a tela mostra como origem do recorte. */
let _filtroLeads = { busca: '', etapa: '', temp: '', tag: '', origem: '', area: '', de: '', ate: '', ordem: 'recentes', motivoPerda: '', campoData: 'criadoEm', somenteIds: null, rotulo: '', rapidos: [] };
let _leadsSel = new Set();    // ids selecionados p/ ações em massa
let _leadsFiltradosIds = [];  // ids do último filtro renderizado (p/ "selecionar todos")
let _massaIds = [];           // alvo da ação em massa em andamento
let _maisFiltros = false;     // acordeão dos filtros avançados (os <select>)
let _analiseAberta = null;    // id da análise expandida na ficha (a aba "Analisar" saiu do menu)
let _analiseLead = null;      // de qual lead ela é — para não vazar entre fichas

UI.registrar('leads', (param, query) => {
  if (param) {
    if (_analiseLead && _analiseLead !== param) { _analiseAberta = null; _analiseLead = null; }
    return renderLeadDetalhe(param);
  }
  _analiseAberta = null; _analiseLead = null;
  aplicarQueryNosFiltros(query);   // a URL é a fonte da verdade do filtro
  return renderLeadsLista();
});

/* ---------- filtros na URL ----------
   Antes, `_filtroLeads` era só uma variável de módulo: não dava para compartilhar
   nem favoritar uma lista filtrada, o botão Voltar não desfazia nada, e — pior —
   o filtro NUNCA se limpava sozinho, então dava para sair da tela, voltar e ver
   uma lista parcial sem entender por quê. Agora a URL é quem manda. */
const CHAVES_FILTRO = ['busca','etapa','temp','tag','origem','area','de','ate','ordem','motivoPerda','campoData'];

function filtroParaQuery() {
  const f = _filtroLeads;
  const q = new URLSearchParams();
  CHAVES_FILTRO.forEach(k => {
    const v = f[k];
    if (!v) return;
    if (k === 'ordem' && v === 'recentes') return;        // padrões não sujam a URL
    if (k === 'campoData' && v === 'criadoEm') return;
    q.set(k, v);
  });
  if ((f.rapidos || []).length) q.set('rapidos', f.rapidos.join(','));
  // o rótulo viaja sempre: é ele que explica na tela (e num link compartilhado)
  // POR QUE a lista está parcial
  if (f.rotulo) q.set('rotulo', f.rotulo);
  // já o recorte por ids é uma lista de uuids — não cabe na URL. Fica na memória
  // e a URL carrega só o marcador que manda preservá-lo.
  if (f.somenteIds) q.set('drill', '1');
  return q.toString();
}

function aplicarQueryNosFiltros(query) {
  const idsAntes = _filtroLeads.somenteIds;
  const f = filtroLeadsVazio();
  if (query) {
    CHAVES_FILTRO.forEach(k => { const v = query.get(k); if (v) f[k] = v; });
    const r = query.get('rapidos');
    if (r) f.rapidos = r.split(',').filter(Boolean);
    f.rotulo = query.get('rotulo') || '';
    if (query.get('drill') === '1') f.somenteIds = idsAntes;
  }
  _filtroLeads = f;
}

/* replaceState: muda a URL sem criar entrada no histórico e sem disparar
   hashchange (que provocaria um segundo render) */
function sincronizarURL() {
  const q = filtroParaQuery();
  const alvo = '#/leads' + (q ? '?' + q : '');
  if (location.hash !== alvo) history.replaceState(null, '', alvo);
}

/* ponto único de mudança de filtro — antes eram 11 handlers inline mexendo
   direto no objeto global, cada um com seu próprio UI.refresh() */
Views.setFiltro = (chave, valor) => {
  _filtroLeads[chave] = valor;
  if (chave === 'etapa') _filtroLeads.motivoPerda = '';
  sincronizarURL();
  UI.refresh();
};

/* ---------- atalhos de um clique ----------
   Os seis recortes que o time realmente pede no dia a dia e que os <select>
   não sabiam expressar. Combináveis (AND) e com contagem ao vivo, para a
   pessoa ver onde está o trabalho antes de clicar. */
const ATALHOS_LEAD = [
  { id: 'atrasados', rot: 'Atrasados',  ico: 'alarm-clock', cor: 'chip-red',
    dica: 'Follow-up com data vencida — o que mais custa confiança',
    ok: (l, ctx) => (ctx.idx.get(l.id) || []).some(f => f.dueDate < ctx.hoje) },
  { id: 'hoje', rot: 'Vencem hoje', ico: 'calendar', cor: 'chip-amber',
    dica: 'Follow-up agendado para hoje',
    ok: (l, ctx) => (ctx.idx.get(l.id) || []).some(f => f.dueDate === ctx.hoje) },
  { id: 'sempasso', rot: 'Sem próximo passo', ico: 'clipboard-list', cor: 'chip-gray',
    dica: 'Lead aberto sem nenhum contato agendado',
    ok: (l, ctx) => ETAPAS_ABERTAS.includes(l.etapa) && !(ctx.idx.get(l.id) || []).length },
  { id: 'prazo', rot: 'Prazo ≤ 7d', ico: 'alarm-clock', cor: 'chip-red',
    dica: 'Prazo jurídico vencendo — não espera cadência',
    ok: (l, ctx) => { if (!l.prazoLimite) return false;
      return Math.ceil((new Date(l.prazoLimite) - new Date(ctx.hoje)) / 86400000) <= 7; } },
  { id: 'quentes', rot: 'Quentes', ico: 'flame', cor: 'chip-amber',
    dica: 'Temperatura quente',
    ok: (l) => l.temperatura === 'Quente' },
  { id: 'meus', rot: 'Meus', ico: 'user', cor: 'chip-blue',
    dica: 'Leads em que você é o responsável',
    so: () => !!meuPerfilId(),
    ok: (l, ctx) => !!ctx.eu && l.dono === ctx.eu }
];

/* id do perfil logado — `dono` no banco é uuid de perfis, não nome */
function meuPerfilId() {
  return (typeof Cloud !== 'undefined' && Cloud.ativo && Cloud.ativo() &&
          Cloud.perfil() && Cloud.perfil().id) || null;
}

function atalhosDisponiveis() {
  return ATALHOS_LEAD.filter(a => !a.so || a.so());
}

Views.toggleAtalho = (id) => {
  const arr = _filtroLeads.rapidos || (_filtroLeads.rapidos = []);
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1); else arr.push(id);
  sincronizarURL();
  UI.refresh();
};

function renderLeadsLista() {
  const f = _filtroLeads;
  const idxFus = indicePendentes();   // uma varredura só, em vez de uma por linha
  let leads = [...state.leads];
  if (f.busca) {
    const b = f.busca.toLowerCase();
    leads = leads.filter(l => (l.nome + ' ' + l.empresa + ' ' + l.telefone + ' ' + l.email + ' ' + (l.tags || []).join(' ')).toLowerCase().includes(b));
  }
  if (f.etapa) leads = leads.filter(l => l.etapa === f.etapa);
  if (f.etapa === 'Perdido' && f.motivoPerda) leads = leads.filter(l => (l.motivoPerda || 'Não informado') === f.motivoPerda);
  if (f.temp) leads = leads.filter(l => l.temperatura === f.temp);
  if (f.tag) leads = leads.filter(l => (l.tags || []).includes(f.tag));
  // o dashboard rotula origem vazia como "Sem origem"; sem a sentinela o clique não casaria com nada
  if (f.origem) leads = leads.filter(l => (l.origem || 'Sem origem') === f.origem);
  if (f.area) leads = leads.filter(l => l.area === f.area);
  if (f.somenteIds) { const ids = new Set(f.somenteIds); leads = leads.filter(l => ids.has(l.id)); }
  const campoData = f.campoData || 'criadoEm';
  if (f.de) leads = leads.filter(l => (l[campoData] || '').slice(0, 10) >= f.de);
  if (f.ate) leads = leads.filter(l => (l[campoData] || '').slice(0, 10) <= f.ate);

  // a contagem dos atalhos sai da base JÁ filtrada pelo resto — assim o número no
  // chip é o que você vai ver ao clicar, e não um total solto que não bate com a tela
  const ctxAtalho = { idx: idxFus, hoje: todayISO(), eu: meuPerfilId() };
  const rapidos = f.rapidos || [];
  const aplicarAtalhos = (lista, ids) => ids.reduce((acc, id) => {
    const a = ATALHOS_LEAD.find(x => x.id === id);
    return a ? acc.filter(l => a.ok(l, ctxAtalho)) : acc;
  }, lista);
  // o contador de cada chip considera os OUTROS chips já ligados: é literalmente
  // "quantos sobram se eu ligar este". Contar sobre a base crua fazia o número
  // mentir assim que dois atalhos eram combinados.
  const atalhos = atalhosDisponiveis().map(a => {
    const base = aplicarAtalhos(leads, rapidos.filter(id => id !== a.id));
    return { ...a, n: base.filter(l => a.ok(l, ctxAtalho)).length };
  });
  leads = aplicarAtalhos(leads, rapidos);

  const ordens = {
    recentes: (a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''),
    antigos: (a, b) => (a.criadoEm || '').localeCompare(b.criadoEm || ''),
    valor: (a, b) => (b.valor || 0) - (a.valor || 0),
    nome: (a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'),
    prioridade: (a, b) => leadPrioridade(b, idxFus) - leadPrioridade(a, idxFus)
  };
  leads.sort(ordens[f.ordem] || ordens.recentes);
  _leadsFiltradosIds = leads.map(l => l.id);
  [..._leadsSel].forEach(id => { if (!getLead(id)) _leadsSel.delete(id); }); // limpa ids órfãos
  const visao = ['kanban', 'hoje'].includes(state.settings.leadsVisao) ? state.settings.leadsVisao : 'lista';
  const dups = leadsDuplicados();
  const todasTags = [...new Set(state.leads.flatMap(l => l.tags || []))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const todasOrigens = [...new Set(state.leads.map(l => l.origem).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const todasAreas = [...new Set(state.leads.map(l => l.area).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const avancadosAtivos = !!(f.etapa || f.temp || f.tag || f.origem || f.area || f.de || f.ate || f.motivoPerda);
  if (avancadosAtivos) _maisFiltros = true;   // não esconder filtro ligado: some sem explicação
  const filtrosAtivos = !!(f.busca || f.etapa || f.temp || f.tag || f.origem || f.area || f.de || f.ate || f.motivoPerda || f.somenteIds || f.rotulo || rapidos.length);
  const valorFiltrado = leads.reduce((s, l) => s + (l.valor || 0), 0);
  const motivosPresentes = f.etapa === 'Perdido'
    ? [...new Set(state.leads.filter(l => l.etapa === 'Perdido').map(l => l.motivoPerda || 'Não informado'))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    : [];
  const todosSel = leads.length > 0 && leads.every(l => _leadsSel.has(l.id));
  const parcialSel = !todosSel && leads.some(l => _leadsSel.has(l.id));
  // o traço do "selecionar todos" é a propriedade indeterminate, que só existe em JS:
  // liga-se logo depois que a tabela entra no DOM (antes da pintura). O data-parcial
  // do template já desenha o estado, então isso não anima nada a cada re-render.
  if (parcialSel) queueMicrotask(sincronizarSelTodosLeads);

  const linhas = leads.map(l => {
    const fus = idxFus.get(l.id) || [];
    const prox = fus[0];
    const atrasado = prox && prox.dueDate < todayISO();
    const prio = leadPrioridade(l, idxFus);
    return `<tr class="${prio >= 60 ? 'lead-prior-alta' : ''}" onclick="location.hash='#/leads/${l.id}'">
      <td class="lead-check" onclick="event.stopPropagation();if(event.target===this)this.querySelector('input').click()"><input type="checkbox" aria-label="Selecionar ${esc(l.nome)}" ${_leadsSel.has(l.id) ? 'checked' : ''} onchange="Views.toggleSelLead('${l.id}',this.checked)"></td>
      <td><div class="td-strong">${esc(l.nome)}</div><div class="td-dim">${esc(l.empresa || l.email || l.telefone || '')}</div>
        ${(l.tags || []).length ? `<div class="td-dim" style="font-size:.72rem">${ICO('tag')} ${l.tags.slice(0, 3).map(esc).join(' · ')}${l.tags.length > 3 ? ' +' + (l.tags.length - 3) : ''}</div>` : ''}</td>
      <td>${UI.chipEtapa(l.etapa)}</td>
      <td>${UI.chipTemp(l.temperatura)}</td>
      <td class="td-dim">${esc(l.origem || '—')}</td>
      <td class="td-num">${l.valor ? fmtMoney(l.valor) : '<span class="td-dim">—</span>'}</td>
      <td>${prox ? `<span class="chip ${atrasado ? 'chip-red' : 'chip-gray'}">${atrasado ? ICO('alarm-clock') : ICO('calendar')} ${fmtDate(prox.dueDate)}</span>` : '<span class="td-dim">sem cadência</span>'}</td>
      <td class="td-dim td-num">${fmtDate(l.criadoEm && l.criadoEm.slice(0, 10))}</td>
    </tr>`;
  }).join('');

  const tabela = leads.length ? `<div class="table-wrap"><table>
    <thead><tr><th class="lead-check" onclick="if(event.target===this)this.querySelector('input').click()"><input type="checkbox" title="Selecionar todos os filtrados" ${todosSel ? 'checked' : ''} ${parcialSel ? 'data-parcial' : ''} onchange="Views.selTodosLeads(this.checked)"></th><th>Lead</th><th>Etapa</th><th>Temp.</th><th>Origem</th><th>Valor</th><th>Próx. follow-up</th><th>Criado</th></tr></thead>
    <tbody>${linhas}</tbody>
  </table></div>` : `<div class="card"><div class="empty"><div class="big">${ICO('users')}</div><h3>Nenhum lead encontrado</h3><p>Importe o CSV do seu CRM ou cadastre seu primeiro lead.</p>
    <div class="flex" style="justify-content:center"><button class="btn btn-primary" onclick="Views.abrirNovoLead()">+ Novo Lead</button><button class="btn" onclick="Views.abrirImportCSV()">${ICO('upload')} Importar CSV</button></div></div></div>`;

  return `
  ${f.rotulo ? `<div class="card mb lead-drill">
    <span>${ICO('filter')} Mostrando <b>${esc(f.rotulo)}</b> — ${leads.length} lead(s)</span>
    <button class="btn btn-ghost btn-sm right" onclick="Views.limparFiltrosLeads()">${ICO('x')} Ver todos</button>
  </div>` : ''}
  <div class="lead-atalhos">
    ${atalhos.map(a => `<button class="chip ${rapidos.includes(a.id) ? a.cor + ' atalho-on' : 'chip-gray'}"
      title="${esc(a.dica)}" onclick="Views.toggleAtalho('${a.id}')">${ICO(a.ico)} ${esc(a.rot)}
      <b>${a.n}</b></button>`).join('')}
    ${rapidos.length ? `<button class="chip chip-gray" onclick="Views.limparAtalhos()">${ICO('x')} limpar atalhos</button>` : ''}
  </div>
  <div class="toolbar">
    <span class="lead-visao-toggle">
      <button class="btn btn-sm ${visao === 'hoje' ? 'btn-primary' : 'btn-ghost'}" onclick="Views.setLeadsVisao('hoje')" title="Fila de trabalho: quem precisa de contato agora">${ICO('zap')} Hoje</button>
      <button class="btn btn-sm ${visao === 'lista' ? 'btn-primary' : 'btn-ghost'}" onclick="Views.setLeadsVisao('lista')">${ICO('list')} Lista</button>
      <button class="btn btn-sm ${visao === 'kanban' ? 'btn-primary' : 'btn-ghost'}" onclick="Views.setLeadsVisao('kanban')">${ICO('kanban')} Kanban</button>
    </span>
    <input placeholder="Buscar por nome, empresa, telefone..." value="${esc(f.busca)}"
      oninput="_filtroLeads.busca=this.value;Views.refiltrarLeads(this)">
${_maisFiltros ? `${visao === 'kanban' ? '' : `    <select onchange="Views.setFiltro('etapa',this.value)">
      <option value="">Todas as etapas</option>
      ${ETAPAS.map(e => `<option ${f.etapa === e ? 'selected' : ''}>${e}</option>`).join('')}
    </select>`}
    ${f.etapa === 'Perdido' ? `<select onchange="Views.setFiltro('motivoPerda',this.value)" title="Filtrar pelo motivo da perda">
      <option value="">Todos os motivos</option>
      ${motivosPresentes.map(m => `<option ${f.motivoPerda === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
    </select>
    <button class="btn btn-sm" onclick="Views.abrirCadenciaMassa('reaquecimento')" title="Aplica uma cadência de reativação nos leads selecionados (ou em todos os filtrados)">${ICO('megaphone')} Aplicar cadência de reativação</button>` : ''}
    <select onchange="Views.setFiltro('temp',this.value)">
      <option value="">Todas temperaturas</option>
      ${TEMPERATURAS.map(t => `<option ${f.temp === t ? 'selected' : ''}>${t}</option>`).join('')}
    </select>
    ${todasOrigens.length ? `<select onchange="Views.setFiltro('origem',this.value)">
      <option value="">Todas as origens</option>
      ${todasOrigens.map(o => `<option ${f.origem === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
    </select>` : ''}
    ${todasAreas.length ? `<select onchange="Views.setFiltro('area',this.value)">
      <option value="">Todas as áreas</option>
      ${todasAreas.map(a => `<option ${f.area === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}
    </select>` : ''}
    ${todasTags.length ? `<select onchange="Views.setFiltro('tag',this.value)">
      <option value="">Todas as tags</option>
      ${todasTags.map(t => `<option ${f.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
    </select>` : ''}
    <span class="flex" style="gap:6px" title="Filtrar pela data de entrada do lead (funciona para qualquer período do histórico)">
      <label style="margin:0;align-self:center">Entrou de</label>
      <input type="date" style="width:auto" value="${f.de}" onchange="Views.setFiltro('de',this.value)">
      <label style="margin:0;align-self:center">até</label>
      <input type="date" style="width:auto" value="${f.ate}" onchange="Views.setFiltro('ate',this.value)">
    </span>` : ''}
    <select onchange="Views.setFiltro('ordem',this.value)">
      ${[['recentes', '↓ Mais recentes'], ['antigos', '↑ Mais antigos'], ['prioridade', 'Prioridade'], ['valor', 'Maior valor'], ['nome', 'A-Z Nome']]
        .map(([v, r]) => `<option value="${v}" ${f.ordem === v ? 'selected' : ''}>${r}</option>`).join('')}
    </select>
    <button class="btn btn-ghost btn-sm" onclick="Views.toggleMaisFiltros()" title="Etapa, temperatura, origem, área, tag e período">
      ${ICO('filter')} ${_maisFiltros ? 'Menos filtros' : 'Mais filtros'}${!_maisFiltros && avancadosAtivos ? ' <b>•</b>' : ''}</button>
    ${filtrosAtivos ? `<button class="btn btn-ghost btn-sm" onclick="Views.limparFiltrosLeads()">${ICO('x')} Limpar filtros</button>` : ''}
    ${dups.length ? `<button class="btn btn-ghost btn-sm" onclick="Views.abrirDuplicados()">${ICO('flip-horizontal')} Duplicados (${dups.length})</button>` : ''}
    <span class="spacer"></span>
    <span class="muted">${leads.length} lead(s)${valorFiltrado ? ' · ' + fmtMoney(valorFiltrado) + ' potencial' : ''}</span>
    <button class="btn btn-ghost btn-sm" onclick="CSV.exportarLeads()">${ICO('download')} Exportar CSV</button>
  </div>
  ${visao === 'kanban' ? leadsKanbanHTML(leads, idxFus) : (visao === 'hoje' ? leadsHojeHTML(leads, idxFus) : tabela)}
  ${_leadsSel.size ? `<div class="lead-massbar">
    <b>${_leadsSel.size} selecionado(s)</b>
    <button class="btn btn-primary btn-sm" onclick="Views.abrirCadenciaMassa()">${ICO('target')} Aplicar cadência</button>
    <button class="btn btn-sm" onclick="Views.abrirTagMassa()">${ICO('tag')} Adicionar tag</button>
    <button class="btn btn-sm" onclick="Views.abrirEtapaMassa()">${ICO('trending-up')} Mudar etapa</button>
    <button class="btn btn-sm" onclick="Views.exportarSelecionados()">${ICO('download')} Exportar CSV</button>
    <button class="btn btn-ghost btn-sm" onclick="Views.limparSelLeads()">${ICO('x')} Limpar seleção</button>
  </div>` : ''}`;
}

/* ---------- kanban do funil (v6) ---------- */

function leadsKanbanHTML(leads, idx) {
  const colunas = ETAPAS_ABERTAS.map(etapa => {
    const cards = leads.filter(l => l.etapa === etapa);
    const total = cards.reduce((s, l) => s + (l.valor || 0), 0);
    return `<div class="lead-kcol" ondragover="event.preventDefault();this.classList.add('alvo')"
        ondragleave="this.classList.remove('alvo')"
        ondrop="this.classList.remove('alvo');Views.leadKanbanDrop(event,'${etapa}')">
      <div class="lead-kcol-cab">${esc(etapa)} <span class="lead-kqtd">${cards.length}</span>${total ? `<span class="lead-ktotal">${fmtMoney(total)}</span>` : ''}</div>
      <div class="lead-kcol-corpo">
        ${cards.map(l => {
          const prio = leadPrioridade(l, idx);
          const prox = (idx.get(l.id) || [])[0];
          const atrasado = prox && prox.dueDate < todayISO();
          return `<div class="lead-kcard ${prio >= 60 ? 'prior' : ''}" draggable="true"
              ondragstart="event.dataTransfer.setData('text/plain','${l.id}')"
              onclick="location.hash='#/leads/${l.id}'">
            <div class="lead-kcard-topo"><b>${esc(l.nome)}</b>${prio >= 60 ? `<span class="chip chip-red" title="Score de prioridade">${ICO('zap')} ${prio}</span>` : ''}</div>
            <div class="lead-kcard-meta">
              ${UI.chipTemp(l.temperatura)}
              ${l.valor ? `<span class="chip chip-purple">${ICO('banknote')} ${fmtMoney(l.valor)}</span>` : ''}
            </div>
            ${prox ? `<div class="lead-kcard-fu ${atrasado ? 'atrasado' : ''}">${atrasado ? ICO('alarm-clock') : ICO('calendar')} ${fmtDate(prox.dueDate)} · ${esc(prox.titulo || 'follow-up')}</div>` : ''}
          </div>`;
        }).join('') || '<div class="lead-kvazio">vazio</div>'}
      </div>
    </div>`;
  }).join('');
  const ganhos = leads.filter(l => l.etapa === 'Ganho').length;
  const perdidos = leads.filter(l => l.etapa === 'Perdido').length;
  const fechados = `<div class="lead-kcol lead-kcol-fechados">
    <div class="lead-kcol-cab">Fechados</div>
    <div class="lead-kdrop ganho" ondragover="event.preventDefault();this.classList.add('alvo')"
      ondragleave="this.classList.remove('alvo')"
      ondrop="this.classList.remove('alvo');Views.leadKanbanDrop(event,'Ganho')">
      ${ICO('circle-check')} Ganho <span class="lead-kqtd">${ganhos}</span><small>solte aqui para marcar ganho</small></div>
    <div class="lead-kdrop perdido" ondragover="event.preventDefault();this.classList.add('alvo')"
      ondragleave="this.classList.remove('alvo')"
      ondrop="this.classList.remove('alvo');Views.leadKanbanDrop(event,'Perdido')">
      ${ICO('x')} Perdido <span class="lead-kqtd">${perdidos}</span><small>solte aqui para marcar perda</small></div>
  </div>`;
  return `<div class="lead-kanban">${colunas}${fechados}</div>`;
}

let _buscaTimer = null;
Views.refiltrarLeads = (input) => {
  // debounce: digitar "financiamento" fazia 14 re-renders completos
  const pos = input.selectionStart;
  clearTimeout(_buscaTimer);
  _buscaTimer = setTimeout(() => {
    sincronizarURL();
    UI.refresh();
    const novo = document.querySelector('.toolbar input');
    if (novo) { novo.focus(); novo.setSelectionRange(pos, pos); }
  }, 180);
};

/* ---------- detalhe do lead ---------- */

/* ícone da linha do tempo por tipo de evento */
const ICONE_EVENTO = {
  criado: 'star', etapa: 'trending-up', temperatura: 'flame', contrato: 'banknote',
  nota: 'sticky-note', followup: 'target', resposta: 'message-circle', analise: 'microscope', sistema: 'zap'
};

/* chip do prazo jurídico: vermelho quando faltam ≤ 7 dias */
function prazoChipHTML(l) {
  if (!l.prazoLimite) return '';
  const dias = diasAte(l.prazoLimite);
  if (dias <= 7) {
    const rot = dias < 0 ? `vencido há ${-dias} dia(s)` : dias === 0 ? 'vence HOJE' : `faltam ${dias} dia(s)`;
    return `<span class="chip chip-red lead-prazo-urgente">${ICO('alarm-clock')} Prazo ${fmtDate(l.prazoLimite)} — ${rot}</span>`;
  }
  return `<span class="chip chip-amber">${ICO('calendar')} Prazo ${fmtDate(l.prazoLimite)} (${dias} dias)</span>`;
}

function renderLeadDetalhe(id) {
  const l = getLead(id);
  if (!l) return '<div class="card"><div class="empty"><h3>Lead não encontrado</h3><p><a href="#/leads">' + ICO('arrow-left') + ' Voltar para a lista</a></p></div></div>';
  const fus = Cadence.pendentesDoLead(id);
  const hist = Cadence.historicoDoLead(id).filter(f => f.status !== 'pendente');
  const analises = analisesDoLead(id);
  const aberto = ETAPAS_ABERTAS.includes(l.etapa);
  const conv = conversaDoLead(id);
  const msgs = conv ? mensagensDaConversa(conv.id).filter(m => m.tipo !== 'anotacao').slice(-8) : [];
  const eventos = (l.eventos || []).slice().sort((a, b) => String(b.em || '').localeCompare(String(a.em || ''))).slice(0, 60);

  return `
  <div class="flex mb"><a href="#/leads" class="muted">${ICO('arrow-left')} Todos os leads</a></div>
  <div class="card">
    <div class="flex" style="justify-content:space-between;align-items:flex-start">
      <div>
        <h2 style="font-size:1.3rem">${esc(l.nome)}</h2>
        <div class="flex" style="margin-top:8px">${UI.chipEtapa(l.etapa)} ${UI.chipTemp(l.temperatura)}
          ${l.valor ? `<span class="chip chip-purple">${ICO('banknote')} ${fmtMoney(l.valor)}</span>` : ''}
          ${l.area ? `<span class="chip chip-purple">${ICO('scale')} ${esc(l.area)}</span>` : ''}
          ${l.perfil ? `<span class="chip chip-blue">Perfil ${esc(l.perfil)}</span>` : ''}
          ${l.origem ? `<span class="chip chip-gray">${esc(l.origem)}</span>` : ''}
          ${(l.contratos || []).length ? `<span class="chip chip-green">${ICO('file-text')} ${l.contratos.length} contrato(s) · ${fmtMoney(totalContratado(l))}</span>` : ''}
        </div>
        ${(l.tags || []).length ? `<div class="flex" style="margin-top:8px">
          ${l.tags.map(t => `<span class="chip chip-cyan">${ICO('tag')} ${esc(t)}</span>`).join('')}
        </div>` : ''}
        <div class="muted mt">
          ${l.empresa ? ICO('building-2') + ' ' + esc(l.empresa) + ' · ' : ''}
          ${l.telefone ? ICO('phone') + ' ' + esc(l.telefone) + ' · ' : ''}
          ${l.email ? ICO('mail') + ' ' + esc(l.email) : ''}
        </div>
        ${(l.numeroProcesso || l.comarcaVara || l.prazoLimite) ? `<div class="flex mt">
          ${l.numeroProcesso ? `<span class="chip chip-blue">${ICO('scale')} Processo ${esc(l.numeroProcesso)}</span>` : ''}
          ${l.comarcaVara ? `<span class="chip chip-gray">${ICO('landmark')} ${esc(l.comarcaVara)}</span>` : ''}
          ${prazoChipHTML(l)}
        </div>` : ''}
        ${l.dor ? `<div class="mt"><span class="muted">Dor/Interesse:</span> ${esc(l.dor)}</div>` : ''}
        ${l.motivoPerda ? `<div class="mt"><span class="chip chip-red">Perdido: ${esc(l.motivoPerda)}</span></div>` : ''}
      </div>
    </div>
    <div class="divider"></div>

    <div class="card-title">${ICO('zap')} Edição rápida <span class="hint">salva automaticamente ao alterar</span></div>
    <div class="quick-edit">
      <div><label>Etapa do funil</label>
        <select onchange="Views.quickEditLead('${l.id}','etapa',this.value)">
          ${ETAPAS.map(e => `<option ${l.etapa === e ? 'selected' : ''}>${e}</option>`).join('')}
        </select></div>
      <div><label>Temperatura</label>
        <select onchange="Views.quickEditLead('${l.id}','temperatura',this.value)">
          ${TEMPERATURAS.map(t => `<option ${l.temperatura === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select></div>
      <div><label>Valor potencial (R$)</label>
        <input value="${l.valor || ''}" placeholder="5000" onchange="Views.quickEditLead('${l.id}','valor',this.value)"></div>
      <div><label>Origem</label>
        <select onchange="Views.quickEditLead('${l.id}','origem',this.value)">
          ${[...new Set(['', ...ORIGENS_SUGERIDAS, l.origem])].map(o => `<option ${l.origem === o ? 'selected' : ''}>${o || '—'}</option>`).join('')}
        </select></div>
      <div><label>Área do caso</label>
        <select onchange="Views.quickEditLead('${l.id}','area',this.value)">
          ${[...new Set(['', ...AREAS_CASO, l.area])].map(a => `<option ${l.area === a ? 'selected' : ''}>${a || '—'}</option>`).join('')}
        </select></div>
      <div><label>Perfil</label>
        <select onchange="Views.quickEditLead('${l.id}','perfil',this.value)">
          ${['', ...PERFIS].map(p => `<option value="${p}" ${l.perfil === p ? 'selected' : ''}>${p ? 'Perfil ' + p : '—'}</option>`).join('')}
        </select></div>
    </div>

    <div class="lead-actions">
      <button class="btn btn-primary btn-lg" onclick="Views.abrirEditarLead('${l.id}')">${ICO('pencil')} Editar dados completos</button>
      ${chatLink(l) ? `<a class="btn btn-success btn-lg" target="_blank" href="${esc(chatLink(l))}"><span data-icon="wa"></span> Abrir conversa</a>` : ''}
      <button class="btn btn-lg" onclick="Views.analisarConversaDoLead('${l.id}')">${ICO('microscope')} Analisar conversa</button>
      <button class="btn btn-lg" onclick="Views.abrirAplicarCadencia('${l.id}')">${ICO('target')} Aplicar cadência</button>
      ${fus.length ? `<button class="btn btn-ghost btn-lg" onclick="Views.leadRespondeu('${l.id}')">${ICO('message-circle')} Lead respondeu</button>` : ''}
      ${aberto ? `<button class="btn btn-success btn-lg" onclick="Views.marcarGanho('${l.id}')">${ICO('trophy')} Marcar GANHO</button>
      <button class="btn btn-danger btn-lg" onclick="Views.abrirMarcarPerdido('${l.id}')">${ICO('x')} Marcar PERDIDO</button>` : `<button class="btn btn-ghost btn-lg" onclick="Views.reabrirLead('${l.id}')">${ICO('undo-2')} Reabrir lead</button>`}
    </div>
  </div>

  ${conv ? `<div class="card mt">
    <div class="card-title">${ICO('message-circle')} Conversa no WhatsApp
      <button class="btn btn-primary btn-sm" onclick="Views.abrirConversaDoLead('${l.id}')">${ICO('send')} Abrir no ${ESCRITORIO.plataformas.chat}</button>
    </div>
    ${msgs.length ? `<div class="lead-chat-previa">
      ${msgs.map(m => `<div class="lead-chat-bolha ${m.direcao === 'saida' ? 'saida' : 'entrada'}">
        <div>${esc(m.texto) || ICO(iconeDeMidia(m)) + ' ' + esc(previaDeMidia(m))}</div>
        <div class="lead-chat-hora">${fmtDateTime(m.criadoEm)}</div>
      </div>`).join('')}
    </div>` : '<div class="muted">Conversa vinculada, mas ainda sem mensagens.</div>'}
  </div>` : ''}

  <div class="card mt">
    <div class="card-title">${ICO('file-text')} Serviços contratados
      <button class="btn btn-primary btn-sm" onclick="Views.abrirContrato('${l.id}')">+ Adicionar contrato</button>
    </div>
    ${(l.contratos || []).length ? `
      ${l.contratos.map(c => `<div class="contrato-item">
        <h4>${esc(c.servico)} <span class="valor">${fmtMoney(valorContrato(c))}</span></h4>
        <div class="contrato-meta">
          ${ICO('calendar')} ${fmtDate(c.data)}
          ${c.formaPagamento ? ' · ' + ICO('credit-card') + ' ' + esc(c.formaPagamento) : ''}
          ${c.parcelas > 1 ? ` · ${c.parcelas}x de ${fmtMoney(valorContrato(c) / c.parcelas)}` : ''}
          ${c.desconto ? ` · ${ICO('percent')} desconto de ${fmtMoney(c.desconto)} (valor cheio ${fmtMoney(c.valor)})` : ''}
          ${c.obs ? `<br>${ICO('sticky-note')} ${esc(c.obs)}` : ''}
        </div>
        <div class="flex" style="margin-top:8px">
          <button class="btn btn-ghost btn-sm" onclick="Views.abrirContrato('${l.id}','${c.id}')">${ICO('pencil')} Editar</button>
          <button class="btn btn-ghost btn-sm btn-danger" onclick="Views.excluirContrato('${l.id}','${c.id}')">Excluir</button>
        </div>
      </div>`).join('')}
      <div class="contrato-total">
        <span class="muted">${l.contratos.length} contrato(s)${l.contratos.length > 1 ? ' · cliente recorrente ' + ICO('repeat') : ''}</span>
        <b style="color:var(--green)">Total: ${fmtMoney(totalContratado(l))}</b>
      </div>`
      : `<div class="muted">Nenhum serviço contratado ainda. Quando este lead fechar, registre aqui o contrato com valor, forma de pagamento, parcelas e desconto — isso alimenta a Receita Contratada, o Ticket Médio e o histórico do cliente.</div>`}
  </div>

  <div class="grid grid-2 mt">
    <div class="card">
      <div class="card-title">${ICO('calendar')} Follow-ups agendados</div>
      ${fus.length ? fus.map(f => Views.fuItemHTML(f, { compact: true })).join('') : '<div class="muted">Nenhum follow-up pendente. Aplique uma cadência para estruturar os próximos contatos.</div>'}
      ${hist.length ? `<div class="divider"></div><div class="muted">Histórico: ${hist.filter(h => h.status === 'feito').length} feito(s), ${hist.filter(h => h.status === 'pulado').length} pulado(s), ${hist.filter(h => h.status === 'cancelado').length} cancelado(s)</div>` : ''}
    </div>
    <div class="card">
      <div class="card-title">${ICO('microscope')} Análises de atendimento</div>
      ${analises.length ? analises.map(a => `
        <div class="timeline-item${_analiseAberta === a.id ? ' lead-analise-ativa' : ''}" style="cursor:pointer" onclick="Views.verAnalise('${a.id}')">
          <div class="timeline-dot" style="background:${UI.scoreColorHex(a.scores.geral)}"></div>
          <div style="flex:1">
            <b style="color:${UI.scoreTextoHex(a.scores.geral)}">Score ${a.scores.geral}</b> — ${Analysis.labelScore(a.scores.geral).label}
            ${UI.chipTemp(a.temperatura)}
            ${a.automatica ? '<span class="chip chip-gray">automática</span>' : ''}
            <div class="muted">${fmtDateTime(a.criadoEm)} · ${a.objecoes.length} objeção(ões) · ${_analiseAberta === a.id ? 'aberta abaixo' : 'clique para abrir'}</div>
          </div>
        </div>`).join('') : '<div class="muted">Nenhuma análise deste lead ainda.</div>'}
      <div class="flex mt">
        <button class="btn btn-sm" onclick="Views.analisarConversaDoLead('${l.id}')">${ICO('microscope')} Analisar conversa</button>
        <button class="btn btn-ghost btn-sm" onclick="Views.abrirColarAnalise('${l.id}')">${ICO('clipboard-list')} Colar conversa</button>
      </div>
      <div class="divider"></div>
      <div class="card-title">${ICO('sticky-note')} Observações fixas</div>
      <textarea id="lead-notas" rows="4" placeholder="Anotações sobre este lead...">${esc(l.notas || '')}</textarea>
      <div class="flex mt"><button class="btn btn-sm" onclick="atualizarLead('${l.id}',{notas:document.getElementById('lead-notas').value});UI.toast('Notas salvas')">Salvar notas</button></div>
    </div>
  </div>

  ${analiseExpandidaHTML(id)}

  <div class="card mt">
    <div class="card-title">${ICO('hourglass')} Linha do tempo</div>
    <div class="flex lead-tl-add">
      <input id="lead-nova-nota" placeholder="Adicionar nota à linha do tempo..." onkeydown="if(event.key==='Enter')Views.addNotaTimeline('${l.id}')">
      <button class="btn btn-primary btn-sm" onclick="Views.addNotaTimeline('${l.id}')">${ICO('sticky-note')} Adicionar nota</button>
    </div>
    ${eventos.length ? `<div class="lead-timeline">
      ${eventos.map(ev => `<div class="lead-tl-item">
        <span class="lead-tl-ico">${ICO(ICONE_EVENTO[ev.tipo] || 'circle')}</span>
        <div style="flex:1">
          <div>${esc(ev.texto)}</div>
          <div class="lead-tl-meta">${fmtDateTime(ev.em)}${ev.autor ? ' · ' + esc(ev.autor) : ''}</div>
        </div>
      </div>`).join('')}
    </div>` : '<div class="muted mt">Nenhum evento registrado ainda. Mudanças de etapa, temperatura, contratos e notas aparecem aqui automaticamente.</div>'}
  </div>`;
}

/* ---------- visão "Hoje": a fila de trabalho ---------- */
/* Dos quatro jeitos de usar esta aba (fila, funil, busca, relatório), três já
   tinham casa: kanban = funil, tabela = relatório, busca = busca. Faltava a fila.
   Nada aqui é métrica nova — é o mesmo leadPrioridade/prazoLimite/follow-ups,
   agrupado por "o que fazer agora" em vez de por etapa. */
function leadsHojeHTML(leads, idx) {
  const hoje = todayISO();
  const abertos = leads.filter(l => ETAPAS_ABERTAS.includes(l.etapa));
  const usados = new Set();
  const pegar = (fn) => {
    const r = abertos.filter(l => !usados.has(l.id) && fn(l));
    r.forEach(l => usados.add(l.id));
    return r.sort((a, b) => leadPrioridade(b, idx) - leadPrioridade(a, idx));
  };
  const diasPrazo = l => l.prazoLimite ? Math.ceil((new Date(l.prazoLimite) - new Date(hoje)) / 86400000) : null;

  // ordem = urgência real; cada lead aparece uma vez só, no bloco mais urgente
  const grupos = [
    { id: 'prazo', rot: 'Prazo jurídico em até 7 dias', ico: 'alarm-clock', cor: 'chip-red',
      dica: 'Prazo processual não espera cadência.',
      leads: pegar(l => { const d = diasPrazo(l); return d !== null && d <= 7; }) },
    { id: 'atrasado', rot: 'Follow-up atrasado', ico: 'alarm-clock', cor: 'chip-red',
      dica: 'Combinado com o lead e não cumprido — é o que mais custa confiança.',
      leads: pegar(l => (idx.get(l.id) || []).some(f => f.dueDate < hoje)) },
    { id: 'hoje', rot: 'Follow-up para hoje', ico: 'calendar', cor: 'chip-amber',
      dica: 'O que você se comprometeu a fazer hoje.',
      leads: pegar(l => (idx.get(l.id) || []).some(f => f.dueDate === hoje)) },
    { id: 'quente', rot: 'Quentes sem próximo passo', ico: 'flame', cor: 'chip-amber',
      dica: 'Interesse alto e nenhum contato agendado — é aqui que se perde venda.',
      leads: pegar(l => l.temperatura === 'Quente' && !(idx.get(l.id) || []).length) },
    { id: 'sempasso', rot: 'Sem próximo passo', ico: 'clipboard-list', cor: 'chip-gray',
      dica: 'Aplique uma cadência para não depender da memória de ninguém.',
      leads: pegar(l => !(idx.get(l.id) || []).length) }
  ].filter(g => g.leads.length);

  if (!grupos.length) {
    return `<div class="card"><div class="empty"><div class="big">${ICO('circle-check')}</div>
      <h3>Fila limpa</h3><p>Nenhum lead aberto precisa de ação agora. Todo mundo tem próximo passo agendado.</p></div></div>`;
  }

  const total = grupos.reduce((n, g) => n + g.leads.length, 0);
  return `<div class="card">
    <div class="card-title">${ICO('zap')} Sua fila de hoje <span class="hint">${total} lead(s) esperando ação · cada um aparece uma vez, no bloco mais urgente</span></div>
    ${grupos.map(g => `
      <div class="hoje-grupo">
        <div class="hoje-cab">${ICO(g.ico)} <b>${g.rot}</b> <span class="chip ${g.cor}">${g.leads.length}</span>
          <span class="muted">${g.dica}</span></div>
        ${g.leads.map(l => {
          const prox = (idx.get(l.id) || [])[0];
          const d = diasPrazo(l);
          return `<div class="hoje-item" onclick="location.hash='#/leads/${l.id}'">
            <div style="flex:1">
              <b>${esc(l.nome)}</b> ${UI.chipEtapa(l.etapa)} ${UI.chipTemp(l.temperatura)}
              ${l.valor ? `<span class="chip chip-gray">${fmtMoney(l.valor)}</span>` : ''}
              ${d !== null && d <= 7 ? `<span class="chip chip-red">${ICO('alarm-clock')} prazo ${d < 0 ? 'vencido' : 'em ' + d + 'd'}</span>` : ''}
              ${prox ? `<div class="muted">${ICO('calendar')} ${esc(prox.titulo || 'Follow-up')} · ${fmtDate(prox.dueDate)}${prox.dueDate < hoje ? ' (atrasado)' : ''}</div>` : ''}
            </div>
            <div class="flex" style="gap:6px" onclick="event.stopPropagation()">
              ${chatLink(l) ? `<a class="btn btn-success btn-sm" target="_blank" href="${esc(chatLink(l))}"><span data-icon="wa"></span></a>` : ''}
              ${prox ? `<button class="btn btn-sm" title="Marcar follow-up como feito" onclick="Views.fuFeitoRapido('${prox.id}')">${ICO('check')}</button>`
                     : `<button class="btn btn-sm" title="Aplicar cadência" onclick="Views.abrirAplicarCadencia('${l.id}')">${ICO('target')}</button>`}
            </div>
          </div>`;
        }).join('')}
      </div>`).join('')}
  </div>`;
}

/* concluir o follow-up direto da fila, sem abrir o lead */
Views.fuFeitoRapido = (fuId) => {
  Cadence.concluir(fuId);
  UI.toast('Follow-up marcado como feito');
  UI.refresh();
};

/* ---------- drill-down vindo do Dashboard ---------- */

/* estado limpo do filtro — um lugar só, para chave nova não grudar invisível */
function filtroLeadsVazio() {
  return { busca: '', etapa: '', temp: '', tag: '', origem: '', area: '', de: '', ate: '',
           ordem: 'recentes', motivoPerda: '', campoData: 'criadoEm', somenteIds: null, rotulo: '',
           rapidos: [] };
}

Views.limparFiltrosLeads = () => { _filtroLeads = filtroLeadsVazio(); _maisFiltros = false; sincronizarURL(); UI.refresh(); };
Views.limparAtalhos = () => { _filtroLeads.rapidos = []; sincronizarURL(); UI.refresh(); };
Views.toggleMaisFiltros = () => { _maisFiltros = !_maisFiltros; UI.refresh(); };

/* aplica um recorte e abre a lista já filtrada.
   Chamado pelos números do Dashboard: clicar em "8 ganhos" tem de mostrar OS 8. */
Views.drill = (filtro) => {
  _filtroLeads = Object.assign(filtroLeadsVazio(), filtro || {});
  _leadsSel.clear();
  state.settings.leadsVisao = 'lista';   // kanban não serve para conferir um recorte
  const q = filtroParaQuery();
  const alvo = '#/leads' + (q ? '?' + q : '');
  if (location.hash === alvo) UI.refresh(); else location.hash = alvo;   // hash igual não dispara hashchange
};

/* ---------- análise de atendimento (mora aqui desde que a aba saiu do menu) ---------- */

/* a análise aberta é renderizada em largura total na própria ficha, logo acima da
   linha do tempo — renderResultadoAnalise vive em js/views-analysis.js */
function analiseExpandidaHTML(leadId) {
  if (!_analiseAberta) return '';
  const a = state.analyses.find(x => x.id === _analiseAberta);
  if (!a || a.leadId !== leadId) return '';
  return `<div id="lead-analise" class="mt">${renderResultadoAnalise(a, { embutido: true })}</div>`;
}

function rolarAteAnalise() {
  setTimeout(() => {
    const el = document.getElementById('lead-analise');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 80);
}

Views.verAnalise = (aId) => {
  const a = state.analyses.find(x => x.id === aId);
  if (!a) return;
  _analiseAberta = (_analiseAberta === aId) ? null : aId;   // clicar de novo fecha
  _analiseLead = a.leadId || null;
  UI.refresh();
  if (_analiseAberta) rolarAteAnalise();
};

Views.fecharAnalise = () => { _analiseAberta = null; _analiseLead = null; UI.refresh(); };

/* ponto de entrada para quem vem de fora (chat, dashboard, links antigos de #/analisar) */
Views.irParaAnalise = (leadId, aId) => {
  UI.fecharModal();
  if (!leadId || !getLead(leadId)) { location.hash = '#/leads'; UI.refresh(); return; }
  _analiseAberta = aId || null;
  _analiseLead = leadId;
  const alvo = '#/leads/' + leadId;
  if (location.hash === alvo) UI.refresh(); else location.hash = alvo;   // hash igual não dispara hashchange
  rolarAteAnalise();
};

/* analisa a conversa do WhatsApp já vinculada ao lead; sem conversa, cai no colar */
Views.analisarConversaDoLead = (leadId) => {
  const lead = getLead(leadId);
  if (!lead) return;
  const conv = conversaDoLead(leadId);
  if (!conv || typeof ChatUI === 'undefined' || !ChatUI.conversaParaAnalise) { Views.abrirColarAnalise(leadId); return; }
  const { msgs, atendente, texto } = ChatUI.conversaParaAnalise(conv);
  if (msgs.length < 2) {
    UI.toast('Esta conversa ainda não tem diálogo suficiente — cole a conversa para analisar.', 'err');
    Views.abrirColarAnalise(leadId);
    return;
  }
  registrarAnaliseNoLead(Analysis.analyze(texto, { leadId, atendente, nomeLead: lead.nome }));
};

Views.abrirColarAnalise = (leadId) => {
  const lead = getLead(leadId);
  if (!lead) return;
  UI.modal(`<h2>Analisar atendimento de ${esc(lead.nome)} <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
    <div class="field">
      <label>Cole a conversa <span class="muted" style="font-weight:400">(export do WhatsApp ou "Nome: mensagem" por linha)</span></label>
      <textarea id="an-texto" rows="12" oninput="Views.detectarParticipantes()" placeholder="Atendente: Bom dia, Maria! Tudo bem?
Maria: Oi, tudo sim! Queria saber o valor da consultoria.

ou o export do WhatsApp:
[03/07/2026 09:15] Rafael: Bom dia, Maria!"></textarea>
    </div>
    <div class="field">
      <label>Quem é o atendente na conversa?</label>
      <select id="an-atendente"><option value="">(detectar automaticamente)</option></select>
    </div>
    <div class="flex"><span class="muted" id="an-status"></span></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="Views.executarAnaliseColada('${leadId}')">${ICO('microscope')} Analisar</button>
    </div>`, { large: true });
};

Views.detectarParticipantes = () => {
  const ta = document.getElementById('an-texto');
  const sel = document.getElementById('an-atendente');
  const status = document.getElementById('an-status');
  if (!ta || !sel) return;
  const { msgs, participantes } = Analysis.parse(ta.value);
  const atual = sel.value;
  sel.innerHTML = '<option value="">(detectar automaticamente)</option>' +
    participantes.map(p => `<option ${p === atual ? 'selected' : ''}>${esc(p)}</option>`).join('');
  if (status) status.textContent = msgs.length ? `${msgs.length} mensagens · ${participantes.length} participantes` : '';
};

Views.executarAnaliseColada = (leadId) => {
  const lead = getLead(leadId);
  const ta = document.getElementById('an-texto');
  if (!lead || !ta) return;
  const texto = ta.value.trim();
  if (!texto) { UI.toast('Cole a conversa primeiro', 'err'); return; }
  const { msgs, participantes } = Analysis.parse(texto);
  if (msgs.length < 2 || participantes.length < 2) {
    UI.toast('Não identifiquei um diálogo. Use o formato "Nome: mensagem" em cada linha.', 'err');
    return;
  }
  const atendente = document.getElementById('an-atendente').value || undefined;
  UI.fecharModal();
  registrarAnaliseNoLead(Analysis.analyze(texto, { leadId, atendente, nomeLead: lead.nome }));
};

/* caminho único de gravação: garante evento na timeline e abertura na ficha */
function registrarAnaliseNoLead(a) {
  state.analyses.unshift(a);
  registrarEvento(a.leadId, 'analise', 'Análise de atendimento — score ' +
    (a.scores && a.scores.geral != null ? a.scores.geral : '—'));
  save();
  UI.toast('Análise concluída! Score: ' + a.scores.geral);
  Views.irParaAnalise(a.leadId, a.id);
}

/* ---------- ações de lead ---------- */

Views.quickEditLead = (id, campo, valor) => {
  if (campo === 'etapa' && valor === 'Perdido') { Views.abrirMarcarPerdido(id); return; }
  if (campo === 'etapa' && valor === 'Ganho') { Views.marcarGanho(id); return; }
  const patch = {};
  patch[campo] = campo === 'valor' ? parseMoney(valor) : valor;
  if (campo === 'etapa') patch.motivoPerda = '';
  atualizarLead(id, patch);
  UI.toast('Salvo.');
  UI.refresh();
};

Views.marcarGanho = (id) => {
  atualizarLead(id, { etapa: 'Ganho', ganhoEm: new Date().toISOString() });
  Cadence.cancelarPendentes(id, 'lead ganho');
  UI.toast('Lead marcado como GANHO!');
  UI.refresh();
};

Views.reabrirLead = (id) => {
  atualizarLead(id, { etapa: 'Negociação', motivoPerda: '' });
  UI.toast('Lead reaberto em Negociação');
  UI.refresh();
};

Views.abrirMarcarPerdido = (id) => {
  UI.modal(`<h2>Marcar como perdido <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
    <div class="field"><label>Motivo da perda (alimenta suas métricas)</label>
      <select id="mp-motivo">${MOTIVOS_PERDA.map(m => `<option>${m}</option>`).join('')}</select></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
      <button class="btn btn-danger" onclick="Views.confirmarPerdido('${id}')">Confirmar perda</button>
    </div>`);
};

Views.confirmarPerdido = (id) => {
  const motivo = document.getElementById('mp-motivo').value;
  atualizarLead(id, { etapa: 'Perdido', motivoPerda: motivo });
  Cadence.cancelarPendentes(id, 'lead perdido');
  UI.fecharModal();
  UI.toast('Lead marcado como perdido.');
  UI.refresh();
};

Views.leadRespondeu = (id) => {
  const n = Cadence.cancelarPendentes(id, 'lead respondeu');
  UI.toast(`${n} follow-up(s) cancelado(s). Analise a nova conversa para definir o próximo passo!`);
  UI.refresh();
};

Views.abrirAplicarCadencia = (leadId, sugerida) => {
  const cads = Cadence.all();
  const lead = getLead(leadId);
  const conv = conversaDoLead(leadId);
  UI.modal(`<h2>Aplicar cadência de follow-up <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
    <div class="field"><label>Cadência</label>
      <select id="ac-cad" onchange="document.getElementById('ac-hora-wrap').style.display = this.selectedOptions[0].dataset.ph === '1' ? '' : 'none'">${cads.map(c => `<option value="${c.id}" data-ph="${Cadence.pedeHora(c) ? 1 : 0}" ${c.id === sugerida ? 'selected' : ''}>${esc(c.nome)} (${c.passos.length} toques)</option>`).join('')}</select></div>
    <div class="field"><label>Começar em <span class="muted" style="font-weight:400">(na cadência de consulta marcada, informe o DIA da consulta)</span></label><input type="date" id="ac-data" value="${todayISO()}"></div>
    <div class="field" id="ac-hora-wrap" style="display:${Cadence.pedeHora(cads.find(c => c.id === sugerida)) ? '' : 'none'}">
      <label>Horário da consulta</label><input type="time" id="ac-hora" value="10:00"></div>
    <div class="field"><label style="display:flex;align-items:center;gap:8px;font-size:.85rem">
      <input type="checkbox" id="ac-auto" style="width:auto" ${conv ? 'checked' : 'disabled'}>
      Programar os envios automáticos no WhatsApp
      ${conv ? '' : '<span class="muted">(este lead ainda não tem conversa vinculada no ' + ESCRITORIO.plataformas.chat + ')</span>'}</label></div>
    <p class="muted">As mensagens já saem prontas e adaptadas ${lead && lead.area ? 'à área <b>' + esc(lead.area) + '</b>' : 'ao caso'} — nada a preencher. Edite qualquer envio depois na Agenda, se quiser. Os follow-ups pendentes anteriores serão substituídos.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="Views.confirmarCadencia('${leadId}')">Aplicar cadência</button>
    </div>`);
};

Views.confirmarCadencia = (leadId) => {
  const cadId = document.getElementById('ac-cad').value;
  const data = document.getElementById('ac-data').value || todayISO();
  const el = document.getElementById('ac-auto');
  const auto = !!(el && el.checked && !el.disabled);
  const cad = Cadence.get(cadId);
  const horaEl = document.getElementById('ac-hora');
  const horaRef = (Cadence.pedeHora(cad) && horaEl && horaEl.value) || '';
  const n = Cadence.aplicar(leadId, cadId, data, { autoEnviar: auto, horaRef });
  UI.fecharModal();
  UI.toast(auto
    ? `Cadência aplicada: ${n} follow-up(s) — mensagens de WhatsApp programadas automaticamente.`
    : `Cadência aplicada: ${n} follow-up(s) agendado(s).`);
  UI.refresh();
};

/* ---------- visão (lista/kanban) e drag & drop ---------- */

Views.setLeadsVisao = (v) => {
  state.settings.leadsVisao = ['kanban', 'hoje'].includes(v) ? v : 'lista';
  // o kanban já separa por etapa; manter o filtro de etapa ligado deixava TODAS
  // as colunas abertas vazias e só o contador de Ganho preenchido
  if (state.settings.leadsVisao === 'kanban') { _filtroLeads.etapa = ''; _filtroLeads.motivoPerda = ''; }
  save();
  UI.refresh();
};

Views.leadKanbanDrop = (ev, etapa) => {
  ev.preventDefault();
  const id = ev.dataTransfer.getData('text/plain');
  const l = getLead(id);
  if (!l || l.etapa === etapa) return;
  Views.quickEditLead(id, 'etapa', etapa); // Ganho/Perdido abrem os fluxos próprios
};

/* ---------- ponte com o Chat ---------- */

Views.abrirConversaDoLead = (leadId) => {
  const conv = conversaDoLead(leadId);
  if (!conv) { UI.toast('Nenhuma conversa do ' + ESCRITORIO.plataformas.chat + ' vinculada a este lead', 'err'); return; }
  location.hash = '#/atendimento';
  setTimeout(() => {
    if (typeof ChatUI !== 'undefined' && ChatUI.abrir) ChatUI.abrir(conv.id);
  }, 400);
};

/* ---------- linha do tempo ---------- */

Views.addNotaTimeline = (id) => {
  const el = document.getElementById('lead-nova-nota');
  const texto = (el && el.value || '').trim();
  if (!texto) { UI.toast('Escreva a nota antes de adicionar', 'err'); return; }
  registrarEvento(id, 'nota', texto);
  save();
  UI.toast('Nota registrada na linha do tempo.');
  UI.refresh();
};

/* ---------- seleção e ações em massa ---------- */

/* "Selecionar todos" em três estados: marcado (todos os filtrados), traço (parte) e
   vazio. O traço é a propriedade indeterminate, sem atributo HTML; o data-parcial
   desenha o mesmo estado no CSS (caixa de seleção, styles.css). */
function sincronizarSelTodosLeads() {
  const cab = document.querySelector('th.lead-check input[type=checkbox]');
  if (!cab) return;
  const n = _leadsFiltradosIds.filter(id => _leadsSel.has(id)).length;
  const todos = n > 0 && n === _leadsFiltradosIds.length;
  cab.checked = todos;
  cab.indeterminate = n > 0 && !todos;
  cab.toggleAttribute('data-parcial', n > 0 && !todos);
}

Views.toggleSelLead = (id, on) => {
  if (on) _leadsSel.add(id); else _leadsSel.delete(id);
  sincronizarSelTodosLeads();   // sem re-render: o cabeçalho acompanha a seleção
  // só re-renderiza quando a barra de ações precisa aparecer/sumir; no resto do
  // tempo basta atualizar o contador — antes, cada clique reconstruía a lista toda
  const barra = document.querySelector('.lead-massbar');
  const agora = _leadsSel.size;
  if (barra && agora) { barra.querySelector('b').textContent = agora + ' selecionado(s)'; return; }
  if (!barra && !agora) return;           // nada mudou de visível
  // daqui para baixo a barra precisa entrar ou sair: aí sim vale re-render
  const v = document.getElementById('view');
  const st = v ? v.scrollTop : 0;
  const sy = window.scrollY;
  UI.refresh();
  const v2 = document.getElementById('view');
  if (v2) v2.scrollTop = st;
  window.scrollTo(0, sy);
};

Views.selTodosLeads = (on) => {
  if (on) _leadsFiltradosIds.forEach(id => _leadsSel.add(id));
  else _leadsSel.clear();
  UI.refresh();
};

Views.limparSelLeads = () => { _leadsSel.clear(); UI.refresh(); };

Views.abrirCadenciaMassa = (sugerida) => {
  const ids = _leadsSel.size ? [..._leadsSel] : [..._leadsFiltradosIds];
  if (!ids.length) { UI.toast('Nenhum lead selecionado ou filtrado', 'err'); return; }
  _massaIds = ids;
  const cads = Cadence.all();
  const temSugerida = cads.some(c => c.id === sugerida);
  UI.modal(`<h2>Aplicar cadência em massa <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
    <p class="muted mb"><b>${ids.length}</b> lead(s) receberão a cadência. Os follow-ups pendentes anteriores de cada um serão substituídos.</p>
    <div class="field"><label>Cadência</label>
      <select id="cm-cad" onchange="document.getElementById('cm-hora-wrap').style.display = this.selectedOptions[0].dataset.ph === '1' ? '' : 'none'">${cads.map(c => `<option value="${c.id}" data-ph="${Cadence.pedeHora(c) ? 1 : 0}" ${temSugerida && c.id === sugerida ? 'selected' : ''}>${esc(c.nome)} (${c.passos.length} toques)</option>`).join('')}</select></div>
    <div class="field"><label>Começar em <span class="muted" style="font-weight:400">(na cadência de consulta marcada, informe o DIA da consulta)</span></label><input type="date" id="cm-data" value="${todayISO()}"></div>
    <div class="field" id="cm-hora-wrap" style="display:none">
      <label>Horário da consulta</label><input type="time" id="cm-hora" value="10:00"></div>
    <div class="field"><label style="display:flex;align-items:center;gap:8px;font-size:.85rem">
      <input type="checkbox" id="cm-auto" style="width:auto" checked> Programar envio automático no WhatsApp (para leads com conversa vinculada no ${ESCRITORIO.plataformas.chat})</label></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="Views.confirmarCadenciaMassa()">Aplicar em ${ids.length} lead(s)</button>
    </div>`);
};

Views.confirmarCadenciaMassa = () => {
  const cadId = document.getElementById('cm-cad').value;
  const data = document.getElementById('cm-data').value || todayISO();
  const auto = document.getElementById('cm-auto').checked;
  const cadM = Cadence.get(cadId);
  const horaElM = document.getElementById('cm-hora');
  const horaRef = (Cadence.pedeHora(cadM) && horaElM && horaElM.value) || '';
  let total = 0;
  _massaIds.forEach(id => { total += Cadence.aplicar(id, cadId, data, { autoEnviar: auto, horaRef }); });
  UI.fecharModal();
  _leadsSel.clear();
  UI.toast(`Cadência aplicada a ${_massaIds.length} lead(s) — ${total} follow-up(s) agendado(s).`);
  UI.refresh();
};

Views.abrirTagMassa = () => {
  const ids = [..._leadsSel];
  if (!ids.length) { UI.toast('Selecione ao menos um lead', 'err'); return; }
  _massaIds = ids;
  UI.modal(`<h2>Adicionar tag em massa <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
    <p class="muted mb"><b>${ids.length}</b> lead(s) receberão a(s) tag(s).</p>
    <div class="field"><label>Tags (separadas por vírgula)</label>
      <input id="tm-tags" placeholder="Ex.: Reativação, Perfil A"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="Views.confirmarTagMassa()">Adicionar</button>
    </div>`);
};

Views.confirmarTagMassa = () => {
  const novas = parseTags(document.getElementById('tm-tags').value);
  if (!novas.length) { UI.toast('Informe ao menos uma tag', 'err'); return; }
  _massaIds.forEach(id => {
    const l = getLead(id);
    if (l) atualizarLead(id, { tags: [...new Set([...(l.tags || []), ...novas])] });
  });
  UI.fecharModal();
  _leadsSel.clear();
  UI.toast(`Tag(s) adicionada(s) a ${_massaIds.length} lead(s).`);
  UI.refresh();
};

Views.abrirEtapaMassa = () => {
  const ids = [..._leadsSel];
  if (!ids.length) { UI.toast('Selecione ao menos um lead', 'err'); return; }
  _massaIds = ids;
  UI.modal(`<h2>Mudar etapa em massa <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
    <p class="muted mb"><b>${ids.length}</b> lead(s) mudarão de etapa.</p>
    <div class="field"><label>Nova etapa</label>
      <select id="em-etapa" onchange="document.getElementById('em-motivo-wrap').style.display=this.value==='Perdido'?'':'none'">
        ${ETAPAS.map(e => `<option>${e}</option>`).join('')}
      </select></div>
    <div class="field" id="em-motivo-wrap" style="display:none"><label>Motivo da perda</label>
      <select id="em-motivo">${MOTIVOS_PERDA.map(m => `<option>${m}</option>`).join('')}</select></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="Views.confirmarEtapaMassa()">Mudar etapa</button>
    </div>`);
};

Views.confirmarEtapaMassa = () => {
  const etapa = document.getElementById('em-etapa').value;
  const motivo = etapa === 'Perdido' ? document.getElementById('em-motivo').value : '';
  let n = 0;
  _massaIds.forEach(id => {
    const l = getLead(id);
    if (!l || l.etapa === etapa) return;
    const patch = { etapa, motivoPerda: etapa === 'Perdido' ? motivo : '' };
    if (etapa === 'Ganho') patch.ganhoEm = new Date().toISOString();
    atualizarLead(id, patch);
    if (etapa === 'Ganho' || etapa === 'Perdido') Cadence.cancelarPendentes(id, etapa === 'Ganho' ? 'lead ganho' : 'lead perdido');
    n++;
  });
  UI.fecharModal();
  _leadsSel.clear();
  UI.toast(`${n} lead(s) movido(s) para ${etapa}.`);
  UI.refresh();
};

Views.exportarSelecionados = () => {
  const sel = state.leads.filter(l => _leadsSel.has(l.id));
  if (!sel.length) { UI.toast('Selecione ao menos um lead', 'err'); return; }
  CSV.exportarLeads(sel);
  UI.toast(`${sel.length} lead(s) exportado(s) para CSV.`);
};

/* ---------- duplicados ---------- */

function acharLeadDuplicado(tel, email) {
  const t = normPhone(tel || '');
  const m = String(email || '').trim().toLowerCase();
  return state.leads.find(l => {
    const lt = normPhone(l.telefone || '');
    if (t && t.length >= 8 && lt && lt.slice(-8) === t.slice(-8)) return true;
    if (m && (l.email || '').trim().toLowerCase() === m) return true;
    return false;
  }) || null;
}

Views.abrirDuplicados = () => {
  const grupos = leadsDuplicados();
  if (!grupos.length) {
    UI.fecharModal();
    UI.toast('Nenhum lead duplicado encontrado.');
    UI.refresh();
    return;
  }
  UI.modal(`<h2>${ICO('flip-horizontal')} Leads duplicados (${grupos.length} grupo(s)) <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
    <p class="muted mb">Grupos com o mesmo telefone ou e-mail. Ao mesclar, o lead mais antigo é mantido e recebe contratos, eventos, follow-ups e conversas dos demais.</p>
    ${grupos.map(g => `<div class="lead-dup-grupo">
      ${g.map((l, i) => `<div class="lead-dup-item">
        <div><b>${esc(l.nome)}</b> ${i === 0 ? '<span class="chip chip-green">principal</span>' : '<span class="chip chip-gray">duplicado</span>'} ${UI.chipEtapa(l.etapa)}
          <div class="muted">${esc(l.telefone || '')}${l.email ? ' · ' + esc(l.email) : ''} · criado em ${fmtDate((l.criadoEm || '').slice(0, 10))}</div>
        </div>
        <a href="#/leads/${l.id}" onclick="UI.fecharModal()">abrir ficha</a>
      </div>`).join('')}
      <button class="btn btn-primary btn-sm" onclick="Views.mesclarGrupoDup('${g[0].id}')">${ICO('flip-horizontal')} Mesclar grupo</button>
    </div>`).join('')}`, { large: true });
};

Views.mesclarGrupoDup = (principalId) => {
  const g = leadsDuplicados().find(x => x[0].id === principalId);
  if (!g) { Views.abrirDuplicados(); return; }
  const principal = g[0];
  let n = 0;
  g.slice(1).forEach(d => { if (mesclarLeads(principal.id, d.id)) n++; });
  UI.toast(`${n} lead(s) mesclado(s) em "${principal.nome}".`);
  UI.refresh();
  Views.abrirDuplicados(); // re-renderiza o modal (fecha sozinho se acabaram os grupos)
};

/* ---------- contratos (serviços contratados) ---------- */

Views.abrirContrato = (leadId, cid) => {
  const lead = getLead(leadId);
  if (!lead) return;
  const c = cid ? (lead.contratos || []).find(x => x.id === cid) : null;
  const aberto = ETAPAS_ABERTAS.includes(lead.etapa);
  UI.modal(`<h2>${c ? 'Editar contrato' : 'Novo contrato'} — ${esc(lead.nome)} <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
    <div class="form-row">
      <div class="field"><label>Serviço contratado *</label><input id="ct-servico" value="${esc(c ? c.servico : lead.area || lead.dor || '')}" placeholder="Ex.: Ação trabalhista, Registro de marca..."></div>
      <div class="field"><label>Data do contrato</label><input type="date" id="ct-data" value="${c ? c.data : todayISO()}"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Valor do contrato (R$) *</label><input id="ct-valor" value="${c ? c.valor : (lead.valor || '')}" placeholder="5000"></div>
      <div class="field"><label>Desconto concedido (R$)</label><input id="ct-desconto" value="${c && c.desconto ? c.desconto : ''}" placeholder="0"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Forma de pagamento</label>
        <select id="ct-forma" onchange="document.getElementById('ct-parcelas-wrap').style.display=/parcelad/i.test(this.value)?'':'none'">
          ${FORMAS_PAGAMENTO.map(fp => `<option ${c && c.formaPagamento === fp ? 'selected' : ''}>${fp}</option>`).join('')}
        </select></div>
      <div class="field" id="ct-parcelas-wrap" style="${c && /parcelad/i.test(c.formaPagamento) ? '' : 'display:none'}">
        <label>Número de parcelas</label><input type="number" id="ct-parcelas" min="1" max="60" value="${c ? c.parcelas : 2}"></div>
    </div>
    <div class="field"><label>Observações</label><input id="ct-obs" value="${esc(c ? c.obs : '')}" placeholder="Ex.: entrada de R$ 1.000 + 5x no boleto"></div>
    ${!c && aberto ? `<div class="field"><label style="display:flex;align-items:center;gap:8px;font-size:.85rem"><input type="checkbox" id="ct-ganho" checked style="width:auto"> Marcar este lead como GANHO</label></div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
      <button class="btn btn-primary btn-lg" onclick="Views.salvarContrato('${leadId}',${c ? `'${c.id}'` : 'null'})">${c ? 'Salvar alterações' : 'Registrar contrato'}</button>
    </div>`, { large: true });
};

Views.salvarContrato = (leadId, cid) => {
  const dados = {
    servico: document.getElementById('ct-servico').value.trim(),
    data: document.getElementById('ct-data').value || todayISO(),
    valor: document.getElementById('ct-valor').value,
    desconto: document.getElementById('ct-desconto').value,
    formaPagamento: document.getElementById('ct-forma').value,
    parcelas: /parcelad/i.test(document.getElementById('ct-forma').value) ? document.getElementById('ct-parcelas').value : 1,
    obs: document.getElementById('ct-obs').value.trim()
  };
  if (!dados.servico) { UI.toast('Informe o serviço contratado', 'err'); return; }
  if (!parseMoney(dados.valor)) { UI.toast('Informe o valor do contrato', 'err'); return; }
  if (cid) {
    atualizarContrato(leadId, cid, { ...dados, valor: parseMoney(dados.valor), desconto: parseMoney(dados.desconto), parcelas: Math.max(1, parseInt(dados.parcelas) || 1) });
    UI.toast('Contrato atualizado.');
  } else {
    addContrato(leadId, dados);
    const chk = document.getElementById('ct-ganho');
    if (chk && chk.checked) {
      atualizarLead(leadId, { etapa: 'Ganho', ganhoEm: new Date().toISOString(), motivoPerda: '' });
      Cadence.cancelarPendentes(leadId, 'lead ganho');
      UI.toast('Contrato registrado e lead marcado como GANHO!');
    } else {
      UI.toast('Contrato registrado.');
    }
  }
  UI.fecharModal();
  UI.refresh();
};

Views.excluirContrato = (leadId, cid) => {
  if (!confirm('Excluir este contrato do histórico do cliente?')) return;
  removerContrato(leadId, cid);
  UI.toast('Contrato excluído.');
  UI.refresh();
};

/* ---------- cadastro / edição ---------- */

function formLeadHTML(l = {}) {
  return `
  <div class="form-row">
    <div class="field"><label>Nome *</label><input id="fl-nome" value="${esc(l.nome || '')}" placeholder="Nome do lead"></div>
    <div class="field"><label>Telefone / WhatsApp</label><input id="fl-telefone" value="${esc(l.telefone || '')}" placeholder="(11) 99999-9999"></div>
  </div>
  <div class="form-row">
    <div class="field"><label>E-mail</label><input id="fl-email" value="${esc(l.email || '')}"></div>
    <div class="field"><label>Empresa</label><input id="fl-empresa" value="${esc(l.empresa || '')}"></div>
  </div>
  <div class="form-row-3">
    <div class="field"><label>Origem</label>
      <select id="fl-origem">${['', ...ORIGENS_SUGERIDAS].map(o => `<option ${l.origem === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
    <div class="field"><label>Etapa</label>
      <select id="fl-etapa">${ETAPAS.map(e => `<option ${(l.etapa || 'Novo') === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
    <div class="field"><label>Temperatura</label>
      <select id="fl-temp">${TEMPERATURAS.map(t => `<option ${(l.temperatura || 'Morno') === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
  </div>
  <div class="form-row">
    <div class="field"><label>Valor potencial (R$)</label><input id="fl-valor" value="${l.valor || ''}" placeholder="5000"></div>
    <div class="field"><label>Dor / Interesse</label><input id="fl-dor" value="${esc(l.dor || '')}" placeholder="O que ele precisa resolver?"></div>
  </div>
  <div class="form-row">
    <div class="field"><label>Link da conversa (chat do CRM/WhatsApp)</label><input id="fl-link" value="${esc(l.link || '')}" placeholder="https://..."></div>
    <div class="field"><label>Tags (separadas por vírgula)</label><input id="fl-tags" value="${esc((l.tags || []).join(', '))}" placeholder="Lead, Orgânico, Perfil A"></div>
  </div>
  <div class="form-row">
    <div class="field"><label>Área do caso</label>
      <select id="fl-area">${[...new Set(['', ...AREAS_CASO, l.area])].map(a => `<option ${(l.area || '') === a ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
    <div class="field"><label>Perfil do lead</label>
      <select id="fl-perfil">${['', ...PERFIS].map(p => `<option value="${p}" ${(l.perfil || '') === p ? 'selected' : ''}>${p ? 'Perfil ' + p : '—'}</option>`).join('')}</select></div>
  </div>
  <div class="form-row-3">
    <div class="field"><label>Número do processo</label><input id="fl-processo" value="${esc(l.numeroProcesso || '')}" placeholder="0000000-00.0000.0.00.0000"></div>
    <div class="field"><label>Comarca / Vara</label><input id="fl-comarca" value="${esc(l.comarcaVara || '')}" placeholder="Ex.: 2ª Vara Cível"></div>
    <div class="field"><label>Prazo limite</label><input type="date" id="fl-prazo" value="${l.prazoLimite || ''}"></div>
  </div>
  <div class="field"><label>Notas</label><textarea id="fl-notas" rows="2">${esc(l.notas || '')}</textarea></div>`;
}

function lerFormLead() {
  return {
    nome: document.getElementById('fl-nome').value.trim(),
    telefone: document.getElementById('fl-telefone').value.trim(),
    email: document.getElementById('fl-email').value.trim(),
    empresa: document.getElementById('fl-empresa').value.trim(),
    origem: document.getElementById('fl-origem').value,
    etapa: document.getElementById('fl-etapa').value,
    temperatura: document.getElementById('fl-temp').value,
    valor: document.getElementById('fl-valor').value,
    dor: document.getElementById('fl-dor').value.trim(),
    link: document.getElementById('fl-link').value.trim(),
    tags: parseTags(document.getElementById('fl-tags').value),
    area: document.getElementById('fl-area').value,
    perfil: document.getElementById('fl-perfil').value,
    numeroProcesso: document.getElementById('fl-processo').value.trim(),
    comarcaVara: document.getElementById('fl-comarca').value.trim(),
    prazoLimite: document.getElementById('fl-prazo').value || null,
    notas: document.getElementById('fl-notas').value.trim()
  };
}

Views.abrirNovoLead = () => {
  UI.modal(`<h2>Novo lead <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
    ${formLeadHTML()}
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
      <button onclick="Views.salvarNovoLead()" class="btn btn-primary btn-lg">Salvar lead</button>
    </div>`, { large: true });
};

Views.salvarNovoLead = () => {
  const data = lerFormLead();
  if (!data.nome) { UI.toast('Informe o nome do lead', 'err'); return; }
  const dup = acharLeadDuplicado(data.telefone, data.email);
  if (dup && confirm(`Já existe "${dup.nome}" com este telefone/e-mail — abrir a ficha em vez de criar um duplicado?`)) {
    UI.fecharModal();
    location.hash = '#/leads/' + dup.id;
    return;
  }
  const lead = novoLead({ ...data, valor: parseMoney(data.valor) });
  UI.fecharModal();
  UI.toast('Lead criado! Quer já aplicar uma cadência?');
  location.hash = '#/leads/' + lead.id;
};

Views.abrirEditarLead = (id) => {
  const l = getLead(id);
  if (!l) return;
  UI.modal(`<h2>Editar lead <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
    ${formLeadHTML(l)}
    <div class="modal-actions">
      <button class="btn btn-danger" style="margin-right:auto" onclick="Views.excluirLead('${id}')">Excluir</button>
      <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
      <button class="btn btn-primary btn-lg" onclick="Views.salvarEdicaoLead('${id}')">Salvar</button>
    </div>`, { large: true });
};

Views.salvarEdicaoLead = (id) => {
  const data = lerFormLead();
  if (!data.nome) { UI.toast('Informe o nome do lead', 'err'); return; }
  atualizarLead(id, { ...data, valor: parseMoney(data.valor) });
  UI.fecharModal();
  UI.toast('Lead atualizado.');
  UI.refresh();
};

Views.excluirLead = (id) => {
  if (!confirm('Excluir este lead e todo o seu histórico (análises e follow-ups)? Esta ação não pode ser desfeita.')) return;
  removerLead(id);
  UI.fecharModal();
  UI.toast('Lead excluído.');
  location.hash = '#/leads';
};

/* ---------- importação CSV ---------- */

let _csvTemp = null;

Views.abrirImportCSV = () => {
  UI.modal(`<h2>Importar CSV do seu CRM <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
    <p class="muted mb">Exporte os leads/negócios do seu CRM em CSV (ou salve uma planilha como CSV) e selecione o arquivo abaixo. Na próxima etapa você mapeia as colunas — funciona com qualquer CRM.</p>
    <input type="file" id="csv-file" accept=".csv,.txt" onchange="Views.lerCSV(this)">
    <div id="csv-map"></div>`, { large: true });
};

Views.lerCSV = (input) => {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const { headers, rows } = CSV.parse(reader.result);
    if (!headers.length || !rows.length) {
      document.getElementById('csv-map').innerHTML = '<p class="muted mt">' + ICO('alert-triangle') + ' Não consegui ler colunas neste arquivo. Verifique se é um CSV válido.</p>';
      return;
    }
    _csvTemp = { headers, rows };
    const guess = CSV.guessMapping(headers);
    const opcoes = mapa => CSV.CAMPOS.map(c => `<option value="${c.id}" ${mapa === c.id ? 'selected' : ''}>${c.label}</option>`).join('');
    document.getElementById('csv-map').innerHTML = `
      <div class="divider"></div>
      <p class="mb"><b>${rows.length}</b> linha(s) encontrada(s). Mapeie as colunas do seu arquivo para os campos do sistema:</p>
      ${headers.map((h, i) => `<div class="map-row">
        <div class="mono" title="${esc(h)}">${esc(h) || '(coluna ' + (i + 1) + ')'}</div>
        <div class="arrow">${ICO('arrow-right')}</div>
        <select data-col="${i}">${opcoes(guess[i])}</select>
      </div>`).join('')}
      <div class="csv-preview table-wrap"><table>
        <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.slice(0, 4).map(r => `<tr>${headers.map((_, i) => `<td>${esc((r[i] || '').slice(0, 40))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <div class="flex mt"><label style="display:flex;align-items:center;gap:8px;margin:0;font-size:.85rem"><input type="checkbox" id="csv-dedupe" checked style="width:auto"> Ignorar leads que já existem (mesmo telefone ou e-mail)</label></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Views.confirmarImportCSV()">Importar ${rows.length} leads</button>
      </div>`;
  };
  reader.readAsText(file, 'utf-8');
};

Views.confirmarImportCSV = () => {
  if (!_csvTemp) return;
  const selects = [...document.querySelectorAll('#csv-map select[data-col]')];
  const mapping = selects.map(s => s.value);
  if (!mapping.includes('nome') && !mapping.includes('telefone') && !mapping.includes('email')) {
    UI.toast('Mapeie ao menos Nome, Telefone ou E-mail', 'err');
    return;
  }
  const dedupe = document.getElementById('csv-dedupe').checked;
  const { importados, ignorados } = CSV.importar(_csvTemp.rows, mapping, { dedupe });
  _csvTemp = null;
  UI.fecharModal();
  UI.toast(`${importados} lead(s) importado(s)${ignorados ? ` · ${ignorados} ignorado(s)` : ''}`);
  location.hash = '#/leads';
  UI.refresh();
};
