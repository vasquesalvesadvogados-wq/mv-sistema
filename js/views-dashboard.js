/* ============ VIEW: DASHBOARD ============ */

let _dashPeriodo = 'este-mes';

Views.dashPeriodo = (v) => { _dashPeriodo = v; UI.refresh(); };

function periodoRange(p) {
  const hoje = todayISO();
  const d = new Date(hoje + 'T12:00:00');
  const fimDoMes = (ano, mes) => { const x = new Date(ano, mes + 1, 0); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  switch (p) {
    case 'esta-semana': {
      const off = (d.getDay() + 6) % 7; // 0 = segunda
      return { ini: addDaysISO(hoje, -off), fim: hoje };
    }
    case 'semana-anterior': {
      const off = (d.getDay() + 6) % 7;
      const segAtual = addDaysISO(hoje, -off);
      return { ini: addDaysISO(segAtual, -7), fim: addDaysISO(segAtual, -1) };
    }
    case '7-dias': return { ini: addDaysISO(hoje, -6), fim: hoje };
    case '2-semanas': return { ini: addDaysISO(hoje, -13), fim: hoje };
    case '30-dias': return { ini: addDaysISO(hoje, -29), fim: hoje };
    case '90-dias': return { ini: addDaysISO(hoje, -89), fim: hoje };
    case 'mes-anterior': {
      const a = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      return { ini: a.getFullYear() + '-' + String(a.getMonth() + 1).padStart(2, '0') + '-01', fim: fimDoMes(a.getFullYear(), a.getMonth()) };
    }
    default: return { ini: hoje.slice(0, 8) + '01', fim: fimDoMes(d.getFullYear(), d.getMonth()) }; // este-mes
  }
}

/* ---------- drill-down: todo número leva à lista que o produziu ---------- */

/* conjuntos calculados pelos cards (sem predicado equivalente na lista de leads);
   preenchidos no render e lidos pelo clique */
let _dashIds = { sempasso: [], esfriando: [] };

/* ações nomeadas em vez de JSON dentro do onclick — sem inferno de escape */
Views.dashDrill = (tipo, valor) => {
  const r = periodoRange(_dashPeriodo);
  const per = { de: r.ini, ate: r.fim };
  const rot = (t) => t + ' · ' + fmtDate(r.ini) + ' a ' + fmtDate(r.fim);
  switch (tipo) {
    case 'leads':     return Views.drill(Object.assign({ campoData: 'criadoEm', rotulo: rot('Leads que entraram') }, per));
    // ganho/perda usam a data DO EVENTO, não a de entrada — senão o clique devolve outro conjunto
    case 'ganhos':    return Views.drill(Object.assign({ etapa: 'Ganho', campoData: 'ganhoEm', rotulo: rot('Leads ganhos') }, per));
    case 'perdidos':  return Views.drill(Object.assign({ etapa: 'Perdido', campoData: 'atualizadoEm', rotulo: rot('Leads perdidos') }, per));
    case 'etapa':
      if (valor === 'Ganho') return Views.dashDrill('ganhos');
      if (valor === 'Perdido') return Views.dashDrill('perdidos');
      return Views.drill(Object.assign({ etapa: valor, campoData: 'criadoEm', rotulo: rot('Etapa: ' + valor) }, per));
    case 'temp':      return Views.drill(Object.assign({ temp: valor, campoData: 'criadoEm', rotulo: rot('Temperatura: ' + valor) }, per));
    case 'origem':    return Views.drill(Object.assign({ origem: valor, campoData: 'criadoEm', rotulo: rot('Origem: ' + valor) }, per));
    case 'area':      return Views.drill(Object.assign({ area: valor, campoData: 'criadoEm', rotulo: rot('Área: ' + valor) }, per));
    // a lista só aplica motivoPerda quando a etapa também é Perdido
    case 'motivo':    return Views.drill(Object.assign({ etapa: 'Perdido', motivoPerda: valor, campoData: 'atualizadoEm', rotulo: rot('Perdidos por: ' + valor) }, per));
    case 'sempasso':  return Views.drill({ somenteIds: _dashIds.sempasso.slice(), ordem: 'prioridade', rotulo: 'Leads sem próximo passo' });
    case 'esfriando': return Views.drill({ somenteIds: _dashIds.esfriando.slice(), ordem: 'prioridade', rotulo: 'Leads quentes esfriando' });
    case 'contratos': _filtroContratos.periodo = _dashPeriodo; location.hash = '#/contratos'; UI.refresh(); return;
    default: return;
  }
};

/* ---------- helpers do dashboard gerencial (v6) ---------- */

/* a data (ISO) cai dentro do período filtrado? — TODO o dashboard obedece o filtro */
function dashNoPer(range, iso) {
  const d = iso && String(iso).slice(0, 10);
  return !!d && d >= range.ini && d <= range.fim;
}

/* duração amigável a partir de milissegundos */
function dashFmtDur(ms) {
  if (ms == null) return '—';
  const h = ms / 3600000;
  if (h < 1) return '&lt;1 h';
  if (h < 48) return Math.round(h) + ' h';
  const d = h / 24;
  return (d >= 10 ? Math.round(d) : String(Math.round(d * 10) / 10).replace('.', ',')) + ' d';
}

/* chip de variação vs período anterior (seta sobe/desce + verde/vermelho)
   opts: { fmt, sufixo, invert } — invert: métrica em que MENOR é melhor (CPL/CAC) */
function dashDeltaHTML(atual, anterior, opts) {
  opts = opts || {};
  if (atual == null || anterior == null) return '<div class="dash-delta">sem base</div>';
  const d = atual - anterior;
  if (!d) return '<div class="dash-delta">estável</div>';
  const subiu = d > 0;
  const boa = opts.invert ? !subiu : subiu;
  const txt = opts.sufixo ? Math.abs(d) + opts.sufixo : (opts.fmt ? opts.fmt(Math.abs(d)) : Math.abs(d));
  const ref = opts.fmt && !opts.sufixo ? opts.fmt(anterior) : anterior + (opts.sufixo ? opts.sufixo.replace(' pp', '%') : '');
  return `<div class="dash-delta ${boa ? 'boa' : 'ruim'}" title="Período anterior: ${ref}">
    <span class="dash-delta-ico${subiu ? '' : ' baixo'}">${ICO('trending-up')}</span> ${subiu ? '+' : '−'}${txt}</div>`;
}

/* (15) KPIs do período do seletor vs período anterior de mesmo tamanho */
function dashKpisPeriodoHTML(range) {
  const dias = Math.round((new Date(range.fim + 'T12:00:00') - new Date(range.ini + 'T12:00:00')) / 86400000) + 1;
  const antFim = addDaysISO(range.ini, -1);
  const antIni = addDaysISO(antFim, -(dias - 1));
  const extras = (ini, fim) => {
    const r = { ini, fim };
    const leadsR = state.leads.filter(l => dashNoPer(r, l.criadoEm));
    const pipeline = leadsR.reduce((s, l) => s + (l.valor || 0), 0);
    const scores = state.analyses.filter(x => dashNoPer(r, x.criadoEm))
      .map(x => x.scores && x.scores.geral).filter(n => typeof n === 'number');
    return {
      pipeline,
      score: scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : null
    };
  };
  const a = metricasPeriodo(range.ini, range.fim), ea = extras(range.ini, range.fim);
  const b = metricasPeriodo(antIni, antFim), eb = extras(antIni, antFim);
  const ticket = m => m.ganhos ? Math.round(m.receita / m.ganhos) : null;
  const itens = [
    { rot: 'Leads', v: a.leads, ant: b.leads, drill: 'leads' },
    { rot: 'Ganhos', v: a.ganhos, ant: b.ganhos, drill: 'ganhos' },
    { rot: 'Conversão', v: a.conversao, ant: b.conversao, fmt: v => v + '%', sufixo: ' pp' },
    { rot: 'Receita', v: a.receita, ant: b.receita, fmt: fmtMoney, drill: 'contratos' },
    { rot: 'Ticket médio', v: ticket(a), ant: ticket(b), fmt: fmtMoney, drill: 'contratos' },
    { rot: 'Pipeline gerado', v: ea.pipeline || null, ant: eb.pipeline || null, fmt: fmtMoney },
    { rot: 'CPL', v: a.cpl, ant: b.cpl, fmt: fmtMoney, invert: true },
    { rot: 'CAC', v: a.cac, ant: b.cac, fmt: fmtMoney, invert: true },
    { rot: 'Follow-ups feitos', v: a.followupsFeitos, ant: b.followupsFeitos },
    { rot: 'Score médio', v: ea.score, ant: eb.score }
  ];
  return `
  <div class="muted" style="margin:2px 0 8px">${ICO('chart-column')} Métricas de <b>${fmtDate(range.ini)} a ${fmtDate(range.fim)}</b> · comparadas com o período anterior (${fmtDate(antIni)} a ${fmtDate(antFim)})</div>
  <div class="dash-kpirow">
    ${itens.map(x => `<div class="dash-kpi${x.drill ? ' dash-kpi-link' : ''}"${x.drill ? ` title="Ver o que está por trás deste número" onclick="Views.dashDrill('${x.drill}')"` : ''}>
      <div class="dash-kpi-rot">${esc(x.rot)}</div>
      <div class="dash-kpi-val">${x.v == null ? '—' : (x.fmt ? x.fmt(x.v) : x.v)}</div>
      ${dashDeltaHTML(x.v, x.ant, x)}
    </div>`).join('')}
  </div>`;
}

/* (14) metas do mês: barras de progresso com projeção linear pelo dia do mês */
function dashMetasHTML(range) {
  const s = state.settings;
  const mLeads = Number(s.metaLeads) || 0, mContratos = Number(s.metaContratos) || 0, mReceita = Number(s.metaReceita) || 0;
  if (mLeads <= 0 && mContratos <= 0 && mReceita <= 0) return '';
  const hoje = todayISO();
  // metas são MENSAIS; o período filtrado recebe a fração proporcional (semana ≈ 1/4 do mês)
  const diasPer = Math.round((new Date(range.fim + 'T12:00:00') - new Date(range.ini + 'T12:00:00')) / 86400000) + 1;
  const mesRef = range.ini.slice(0, 7);
  const diasNoMes = new Date(Number(mesRef.slice(0, 4)), Number(mesRef.slice(5, 7)), 0).getDate();
  const fracao = Math.min(1, diasPer / diasNoMes);
  const prop = v => v >= 1000 ? Math.round(v * fracao / 100) * 100 : Math.max(1, Math.round(v * fracao));
  // projeção: ritmo dos dias já decorridos DENTRO do período
  const fimEfetivo = hoje < range.fim ? (hoje > range.ini ? hoje : range.ini) : range.fim;
  const diasDecorridos = Math.max(1, Math.round((new Date(fimEfetivo + 'T12:00:00') - new Date(range.ini + 'T12:00:00')) / 86400000) + 1);
  const diaAtual = diasDecorridos, diasTotais = diasPer;
  const mp = metricasPeriodo(range.ini, range.fim);
  const linhas = [
    { rot: 'Leads', meta: prop(mLeads), real: mp.leads, fmt: v => String(v) },
    { rot: 'Contratos', meta: prop(mContratos), real: mp.ganhos, fmt: v => String(v) },
    { rot: 'Receita', meta: prop(mReceita), real: mp.receita, fmt: fmtMoney }
  ].filter(x => x.meta > 0);
  const nomeMes = fracao < 1 ? 'do período (proporcional à meta mensal)' : new Date(range.ini + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long' });
  return `
  <div class="card mb">
    <div class="card-title">${ICO('target')} Metas ${esc(nomeMes)} <span class="hint">dia ${diaAtual} de ${diasTotais} · projeção linear</span></div>
    <div class="grid grid-3">
    ${linhas.map(x => {
      const pct = Math.round(x.real / x.meta * 100);
      const proj = Math.round(x.real / diaAtual * diasTotais);
      const projPct = Math.round(proj / x.meta * 100);
      const bateu = x.real >= x.meta;
      const vaiBater = proj >= x.meta;
      return `<div class="dash-meta">
        <div class="dash-meta-top">
          <span class="dash-meta-rot">${esc(x.rot)}</span>
          <span class="dash-meta-num"><b>${x.fmt(x.real)}</b> / ${x.fmt(x.meta)} · ${pct}%</span>
        </div>
        <div class="dash-meta-track">
          <div class="dash-meta-fill ${bateu ? 'ok' : ''}" style="width:${Math.min(100, Math.max(pct, x.real ? 2 : 0))}%"></div>
          <div class="dash-meta-proj" style="left:${Math.min(100, Math.max(0, projPct))}%" title="Onde o mês termina se o ritmo atual continuar"></div>
        </div>
        <div class="dash-meta-projtxt ${vaiBater ? 'boa' : 'ruim'}">${vaiBater ? ICO('circle-check') : ICO('alert-triangle')} projeção do período: ${x.fmt(proj)} (${projPct}% da meta)</div>
      </div>`;
    }).join('')}
    </div>
  </div>`;
}

/* (13) leads em etapas abertas sem nenhum follow-up pendente */
function dashSemPassoHTML(range) {
  const comFu = new Set(state.followups.filter(f => f.status === 'pendente').map(f => f.leadId));
  const sem = state.leads.filter(l => ETAPAS_ABERTAS.includes(l.etapa) && !comFu.has(l.id) && dashNoPer(range, l.criadoEm))
    .sort((a, b) => leadPrioridade(b) - leadPrioridade(a));
  _dashIds.sempasso = sem.map(l => l.id);
  const corpo = sem.length ? `
    <div class="muted" style="margin-bottom:4px"><b class="dash-num" style="color:var(--amber)" title="Ver todos" onclick="Views.dashDrill('sempasso')">${sem.length}</b> lead(s) ativo(s) sem follow-up agendado — nenhum próximo contato os espera:</div>
    ${sem.slice(0, 6).map(l => `<div class="dash-lead-item">
      ${ICO('alert-triangle')}
      <a href="#/leads/${l.id}">${esc(l.nome)}</a>
      ${UI.chipEtapa(l.etapa)}${UI.chipTemp(l.temperatura)}
    </div>`).join('')}
    ${sem.length > 6 ? `<div class="muted" style="margin-top:6px">+ ${sem.length - 6} outro(s) — <a href="javascript:void(0)" onclick="Views.dashDrill('sempasso')">ver os ${sem.length}</a></div>` : ''}
    <div class="dash-dica">${ICO('lightbulb')} Abra o lead e aplique uma <a href="#/cadencias">cadência</a>: 80% das vendas exigem 5+ contatos, e cada toque fica agendado sozinho.</div>`
    : `<div class="muted">${ICO('circle-check')} Todos os leads ativos têm um próximo passo agendado. Disciplina em dia!</div>`;
  return `<div class="card">
    <div class="card-title">${ICO('clipboard-list')} Leads sem próximo passo <span class="hint">abertos, sem follow-up pendente</span></div>
    ${corpo}
  </div>`;
}

/* (5) leads quentes cuja última mensagem é NOSSA (saída) há mais de X horas */
function dashEsfriandoHTML(range) {
  const horas = Number(state.settings.esfriandoHoras) || 6;
  const agora = Date.now();
  const itens = [];
  state.leads.forEach(l => {
    if (l.temperatura !== 'Quente' || !ETAPAS_ABERTAS.includes(l.etapa)) return;
    if (!dashNoPer(range, l.criadoEm)) return;
    const c = conversaDoLead(l.id);
    if (!c || !c.ultimaMsgEm) return;
    const h = (agora - new Date(c.ultimaMsgEm).getTime()) / 3600000;
    if (h <= horas) return;
    // direção da última mensagem: só alerta se fomos NÓS que falamos por último (saída sem resposta)
    const msgs = state.mensagens.filter(x => x.conversaId === c.id && x.tipo !== 'anotacao');
    if (msgs.length) {
      let ult = msgs[0];
      msgs.forEach(x => { if ((x.criadoEm || '') > (ult.criadoEm || '')) ult = x; });
      if (ult.direcao !== 'saida') return;
    } // sem mensagens carregadas: usa só o ultimaMsgEm da conversa
    itens.push({ l, h: Math.floor(h) });
  });
  itens.sort((a, b) => b.h - a.h);
  _dashIds.esfriando = itens.map(x => x.l.id);
  const corpo = itens.length ? `
    <div class="muted" style="margin-bottom:4px"><b class="dash-num" style="color:var(--red)" title="Ver todos" onclick="Views.dashDrill('esfriando')">${itens.length}</b> lead(s) quente(s) aguardando resposta há mais de ${horas}h — reengaje antes que esfriem:</div>
    ${itens.slice(0, 6).map(x => `<div class="dash-lead-item">
      ${ICO('hourglass')}
      <a href="#/leads/${x.l.id}">${esc(x.l.nome)}</a>
      <span class="chip chip-red">${ICO('flame')} sem resposta há ${x.h >= 48 ? Math.floor(x.h / 24) + ' d' : x.h + ' h'}</span>
    </div>`).join('')}
    ${itens.length > 6 ? `<div class="muted" style="margin-top:6px">+ ${itens.length - 6} outro(s) — <a href="javascript:void(0)" onclick="Views.dashDrill('esfriando')">ver os ${itens.length}</a></div>` : ''}`
    : `<div class="muted">${ICO('circle-check')} Nenhum lead quente esfriando agora. A janela de ${horas}h é configurável em <a href="#/config">Configurações</a>.</div>`;
  return `<div class="card">
    <div class="card-title">${ICO('timer')} Esfriando agora <span class="hint">quentes sem resposta há ${horas}h+</span></div>
    ${corpo}
  </div>`;
}

/* (16) desempenho por atendente: análises × conversas × contratos */
function dashAtendentesHTML(range) {
  const porChave = {};
  const slot = (nome) => {
    const chave = primeiroNome(nome).toLowerCase();
    if (!chave) return null;
    if (!porChave[chave]) porChave[chave] = { nome: primeiroNome(nome), scores: [], analises: 0, conversas: 0, contratos: 0, receita: 0 };
    return porChave[chave];
  };
  state.analyses.forEach(a => {
    if (!dashNoPer(range, a.criadoEm)) return;
    const s = a.atendente ? slot(a.atendente) : null;
    if (!s) return;
    s.analises++;
    if (a.scores && typeof a.scores.geral === 'number') s.scores.push(a.scores.geral);
  });
  (state.conversas || []).forEach(c => {
    if (c.arquivada || !c.responsavel) return;
    if (!dashNoPer(range, c.ultimaMsgEm)) return; // conversa com atividade no período
    const p = (state.time || []).find(x => x.id === c.responsavel);
    const s = p ? slot(p.nome) : null;
    if (s) s.conversas++;
  });
  state.leads.forEach(l => {
    const contratosP = (l.contratos || []).filter(c => dashNoPer(range, c.data));
    if (!contratosP.length) return;
    const c = conversaDoLead(l.id);
    const p = c && c.responsavel ? (state.time || []).find(x => x.id === c.responsavel) : null;
    const s = p ? slot(p.nome) : null;
    if (s) { s.contratos += contratosP.length; s.receita += contratosP.reduce((x, y) => x + (y.valor - (y.desconto || 0)), 0); }
  });
  const linhas = Object.values(porChave).map(x => {
    x.score = x.scores.length ? Math.round(x.scores.reduce((a, b) => a + b, 0) / x.scores.length) : null;
    return x;
  }).sort((a, b) => (b.contratos - a.contratos) || (b.conversas - a.conversas) || ((b.score || 0) - (a.score || 0)));
  const corpo = linhas.length ? `
    <div class="dash-tbl-wrap"><table class="dash-tbl">
      <thead><tr><th>Atendente</th><th>Análises</th><th>Score médio</th><th>Conversas</th><th>Contratos</th><th>Receita</th></tr></thead>
      <tbody>${linhas.map(x => `<tr>
        <td><b>${esc(x.nome)}</b></td>
        <td>${x.analises || '—'}</td>
        <td>${x.score != null ? `<b style="color:${UI.scoreTextoHex(x.score)}">${x.score}</b>` : '—'}</td>
        <td>${x.conversas || '—'}</td>
        <td>${x.contratos || '—'}</td>
        <td>${x.receita ? fmtMoney(x.receita) : '—'}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div class="muted" style="margin-top:8px">Análises alimentam o score; conversas contam pelo responsável no ${ESCRITORIO.plataformas.chat}; contratos, pelo responsável da conversa do lead.</div>`
    : `<div class="muted">Sem dados por atendente ainda. Analise atendimentos informando quem atendeu e defina responsáveis nas conversas do ${ESCRITORIO.plataformas.chat}.</div>`;
  return `<div class="card">
    <div class="card-title">${ICO('users')} Desempenho por atendente <span class="hint">análises · conversas · contratos</span></div>
    ${corpo}
  </div>`;
}

/* (17) eficácia por cadência: aplicações, toques concluídos e em qual toque o lead responde */
function dashCadenciasHTML(range) {
  const grupos = {};
  state.followups.forEach(f => {
    if (!f.cadenciaId) return;
    if (!dashNoPer(range, f.criadoEm)) return; // cadências aplicadas no período
    (grupos[f.cadenciaId] = grupos[f.cadenciaId] || { nome: f.cadenciaNome || f.cadenciaId, fus: [] }).fus.push(f);
  });
  const linhas = Object.values(grupos).map(g => {
    const aplicacoes = new Set(g.fus.map(f => f.leadId)).size;
    const feitos = g.fus.filter(f => f.status === 'feito').length;
    const pct = Math.round(feitos / g.fus.length * 100);
    // respostas: toques cancelados porque o lead respondeu; o menor passoIndex
    // cancelado indica APÓS qual toque a resposta veio
    const porLead = {};
    g.fus.forEach(f => {
      if (f.status === 'cancelado' && /respondeu/i.test(f.motivo || '')) {
        const idx = Number(f.passoIndex) || 0;
        if (porLead[f.leadId] == null || idx < porLead[f.leadId]) porLead[f.leadId] = idx;
      }
    });
    const respostas = Object.keys(porLead).length;
    const porToque = {};
    Object.keys(porLead).forEach(id => {
      const toque = Math.max(1, porLead[id]);
      porToque[toque] = (porToque[toque] || 0) + 1;
    });
    const toques = Object.keys(porToque).map(Number).sort((a, b) => a - b)
      .map(t => `${t}º toque ×${porToque[t]}`).join(' · ');
    return { nome: g.nome, aplicacoes, feitos, total: g.fus.length, pct, respostas, toques };
  }).sort((a, b) => b.aplicacoes - a.aplicacoes);
  const corpo = linhas.length ? `
    <div class="dash-tbl-wrap"><table class="dash-tbl">
      <thead><tr><th>Cadência</th><th>Aplicações</th><th>Toques concluídos</th><th>Respostas</th><th>Respondeu após</th></tr></thead>
      <tbody>${linhas.map(x => `<tr>
        <td><b>${esc(x.nome)}</b></td>
        <td>${x.aplicacoes} lead(s)</td>
        <td><b style="color:${x.pct >= 60 ? 'var(--green)' : x.pct >= 30 ? 'var(--amber)' : 'var(--red)'}">${x.pct}%</b> <span class="muted">(${x.feitos}/${x.total})</span></td>
        <td>${x.respostas ? `<b style="color:var(--green)">${x.respostas}</b>` : '—'}</td>
        <td>${x.toques || '—'}</td>
      </tr>`).join('')}</tbody>
    </table></div>`
    : `<div class="muted">Nenhuma cadência aplicada ainda. Aplique pela ficha do lead ou em <a href="#/cadencias">Cadências</a> — os resultados aparecem aqui conforme os leads respondem.</div>`;
  return `<div class="card">
    <div class="card-title">${ICO('megaphone')} Eficácia por cadência <span class="hint">qual sequência gera resposta</span></div>
    ${corpo}
  </div>`;
}

/* (18) funil avançado: conversão entre etapas adjacentes + tempo médio + parado há */
function dashFunilExtraHTML(range) {
  const passaram = {}, tempos = {}, paradoAtual = {};
  ETAPAS.forEach(e => { passaram[e] = new Set(); tempos[e] = []; });
  let comHist = 0;
  const agora = Date.now();
  state.leads.forEach(l => {
    if (!dashNoPer(range, l.criadoEm)) return; // coorte do período filtrado
    const h = Array.isArray(l.etapaHistorico) && l.etapaHistorico.length ? l.etapaHistorico : [{ etapa: l.etapa, em: l.criadoEm }];
    if (h.length > 1) comHist++;
    h.forEach((p, i) => {
      if (passaram[p.etapa]) passaram[p.etapa].add(l.id);
      if (i < h.length - 1 && tempos[p.etapa]) {
        const ms = new Date(h[i + 1].em) - new Date(p.em);
        if (ms > 0) tempos[p.etapa].push(ms);
      }
    });
    if (ETAPAS_ABERTAS.includes(l.etapa)) {
      const ms = agora - new Date(h[h.length - 1].em || l.criadoEm).getTime();
      (paradoAtual[l.etapa] = paradoAtual[l.etapa] || []).push(Math.max(0, ms));
    }
  });
  const media = arr => arr && arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const seq = ETAPAS_ABERTAS.concat(['Ganho']);
  const linhas = ETAPAS_ABERTAS.map((e, i) => {
    const prox = seq[i + 1];
    const nA = passaram[e].size;
    let conv = null;
    if (nA && prox) {
      let chegaram = 0;
      passaram[e].forEach(id => { if (passaram[prox].has(id)) chegaram++; });
      conv = Math.round(chegaram / nA * 100);
    }
    return { etapa: e, nA, conv, tMedio: media(tempos[e]), parado: media(paradoAtual[e]), atuais: (paradoAtual[e] || []).length };
  });
  if (!linhas.some(x => x.nA)) return '';
  return `<div class="divider"></div>
  <div class="dash-tbl-wrap"><table class="dash-tbl">
    <thead><tr><th>Etapa</th><th>Conversão p/ próxima</th><th>Tempo médio na etapa</th><th>Parado há (atuais)</th></tr></thead>
    <tbody>${linhas.map(x => `<tr>
      <td>${esc(x.etapa)} <span class="muted">(${x.nA})</span></td>
      <td>${x.conv == null ? '—' : `<b style="color:${x.conv >= 50 ? 'var(--green)' : x.conv >= 25 ? 'var(--amber)' : 'var(--red)'}">${x.conv}%</b>`}</td>
      <td>${dashFmtDur(x.tMedio)}</td>
      <td>${x.parado == null ? '—' : dashFmtDur(x.parado) + ` <span class="muted">· ${x.atuais} lead(s)</span>`}</td>
    </tr>`).join('')}</tbody>
  </table></div>
  ${comHist < 3 ? `<div class="muted" style="margin-top:8px">${ICO('hourglass')} Métrica melhora com o uso — poucos leads têm histórico de etapas por enquanto.</div>` : ''}`;
}

UI.registrar('dashboard', () => {
  const m = metricas();

  if (!state.leads.length && !state.analyses.length) {
    return `
    <div class="card">
      <div class="empty">
        <div class="big">${ICO('zap')}</div>
        <h3>Bem-vindo ao sistema</h3>
        <p>Sua central de <b>atendimento e vendas</b>: importe os leads do seu CRM, cole conversas para análise profunda baseada nos melhores livros de vendas, e nunca mais perca um follow-up.</p>
        <div class="flex" style="justify-content:center">
          <button class="btn btn-primary" onclick="Views.abrirImportCSV()">${ICO('upload')} Importar CSV do meu CRM</button>
          <button class="btn" onclick="location.hash='#/leads'">${ICO('search')} Ver meus leads</button>
          ${typeof Cloud !== 'undefined' && Cloud.ativo() ? '' : `<button class="btn btn-ghost" onclick="Views.carregarExemplo()">${ICO('sparkles')} Carregar dados de exemplo</button>`}
        </div>
      </div>
    </div>
    ${blocoPrimeirosPassos()}`;
  }

  const range = periodoRange(_dashPeriodo);
  const noPer = iso => dashNoPer(range, iso);
  // TUDO abaixo obedece ao filtro de período do topo
  const leadsP = state.leads.filter(l => noPer(l.criadoEm));

  // follow-ups com vencimento no período (pendentes; atrasados destacados)
  const fusPend = state.followups.filter(f => f.status === 'pendente' && noPer(f.dueDate));
  const hj = todayISO();
  const proximos = [...fusPend.filter(f => f.dueDate < hj), ...fusPend.filter(f => f.dueDate >= hj)].slice(0, 5);

  const ultimasAnalises = state.analyses.filter(a => noPer(a.criadoEm)).slice(0, 5);

  const contar = (lista, chave) => {
    const acc = {};
    lista.forEach(l => { const k = chave(l); if (k) acc[k] = (acc[k] || 0) + 1; });
    return acc;
  };
  const porEtapaP = {};
  ETAPAS.forEach(e => porEtapaP[e] = leadsP.filter(l => l.etapa === e).length);
  const origens = Object.entries(contar(leadsP, l => l.origem || 'Sem origem')).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([label, value]) => ({ label, value }));
  const motivos = Object.entries(contar(state.leads.filter(l => l.etapa === 'Perdido' && noPer(l.atualizadoEm)), l => l.motivoPerda || 'Não informado'))
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([label, value]) => ({ label, value, color: 'var(--danger-400)' }));
  const abertosP = leadsP.filter(l => ETAPAS_ABERTAS.includes(l.etapa));
  const temps = TEMPERATURAS.map(t => ({
    label: t, value: abertosP.filter(l => l.temperatura === t).length,
    color: t === 'Quente' ? 'var(--danger-400)' : t === 'Frio' ? 'var(--chart-2)' : 'var(--ambar-400)'
  }));
  const areas = Object.entries(contar(leadsP.filter(l => l.area), l => l.area)).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([label, value]) => ({ label, value, color: 'var(--chart-4)' }));

  const serie = leadsPorDia(range.ini, range.fim);
  const totalPeriodo = serie.reduce((s, x) => s + x.value, 0);
  // contratos assinados dentro do período, agrupados por mês
  const porMesContrato = {};
  state.leads.forEach(l => (l.contratos || []).forEach(c => {
    if (!noPer(c.data)) return;
    const mes = String(c.data).slice(0, 7);
    porMesContrato[mes] = (porMesContrato[mes] || 0) + (c.valor - (c.desconto || 0));
  }));
  const receitaMeses = Object.keys(porMesContrato).sort().map(mes => ({
    label: new Date(mes + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
    value: porMesContrato[mes]
  }));
  const temReceitaMensal = receitaMeses.length > 1; // 1 mês só já aparece na Receita do KPI

  return `
  <div class="flex" style="justify-content:space-between;margin-bottom:14px;align-items:center">
    <div class="seg">
      ${[['esta-semana', 'Esta semana'], ['semana-anterior', 'Semana anterior'], ['este-mes', 'Este mês'], ['mes-anterior', 'Mês anterior'], ['30-dias', '30 dias'], ['90-dias', '90 dias']]
        .map(([v, r]) => `<button class="${_dashPeriodo === v ? 'on' : ''}" onclick="Views.dashPeriodo('${v}')">${r}</button>`).join('')}
    </div>
    <span class="muted">${totalPeriodo} lead(s) no período</span>
  </div>
  ${dashKpisPeriodoHTML(range)}

  ${dashMetasHTML(range)}

  <div class="card mb">
    <div class="card-title">${ICO('trending-up')} Leads cadastrados por dia
      <span class="hint">${fmtDate(range.ini)} a ${fmtDate(range.fim)} · filtro no topo da página</span>
    </div>
    ${UI.barChartSVG(serie, { titulo: 'Leads cadastrados por dia', unidade: ['lead', 'leads'], vazio: 'Nenhum lead cadastrado no período.' })}
  </div>

  <div class="grid grid-2">
    <div class="card">
      <div class="card-title">Funil de Vendas <span class="hint">leads do período, por etapa atual</span></div>
      ${UI.funnelHTML(porEtapaP, { drill: e => `Views.dashDrill('etapa','${e.replace(/'/g, "\\'")}')` })}
      ${dashFunilExtraHTML(range)}
    </div>
    <div class="card">
      <div class="card-title">${ICO('zap')} Ação Imediata <span class="hint">follow-ups atrasados e de hoje</span></div>
      ${proximos.length ? proximos.map(f => {
        const lead = getLead(f.leadId);
        const atrasado = f.dueDate < todayISO();
        return `<div class="fu-item ${atrasado ? 'atrasado' : 'hoje'}" style="margin-bottom:8px">
          <div class="fu-body">
            <div class="fu-head">
              <span class="fu-lead">${esc(lead ? lead.nome : 'Lead removido')}</span>
              <span class="chip ${atrasado ? 'chip-red' : 'chip-amber'}">${atrasado ? `${ICO('alarm-clock')} atrasado` : `${ICO('calendar')} hoje`}</span>
              <span class="chip chip-gray">${esc(f.canal)}</span>
            </div>
            <div class="muted">${esc(f.titulo)} — ${esc(f.cadenciaNome)}</div>
          </div>
          <div class="fu-actions"><button class="btn btn-sm" onclick="location.hash='#/agenda'">Abrir</button></div>
        </div>`;
      }).join('') : '<div class="muted">Nenhum follow-up pendente para hoje. ' + (m.fusPendentes ? 'Próximos já agendados.' : 'Aplique uma cadência aos seus leads para nunca esquecer um contato.') + '</div>'}
      ${m.disciplinaFollowup != null ? `<div class="divider"></div><div class="muted">Disciplina de follow-up: <b style="color:${UI.scoreTextoHex(m.disciplinaFollowup)}">${m.disciplinaFollowup}%</b> concluídos no prazo (${m.fusFeitos} feitos)</div>` : ''}
    </div>
    ${dashSemPassoHTML(range)}
    ${dashEsfriandoHTML(range)}
    <div class="card">
      <div class="card-title">Temperatura dos Leads Ativos</div>
      ${UI.hbarHTML(temps, { drill: v => `Views.dashDrill('temp','${v}')` })}
      <div class="divider"></div>
      <div class="card-title">Leads por Origem</div>
      ${UI.hbarHTML(origens, { drill: v => `Views.dashDrill('origem','${String(v).replace(/'/g, "\\'")}')` })}
      ${areas.length ? `<div class="divider"></div><div class="card-title">${ICO('scale')} Áreas dos Casos</div>${UI.hbarHTML(areas, { drill: v => `Views.dashDrill('area','${String(v).replace(/'/g, "\\'")}')` })}` : ''}
      ${temReceitaMensal ? `<div class="divider"></div><div class="card-title">${ICO('banknote')} Receita Contratada por Mês</div>${UI.hbarHTML(receitaMeses.map(x => ({ label: x.label, value: x.value, color: 'var(--chart-5)' })), { fmt: v => fmtMoney(v), drill: () => `Views.dashDrill('contratos')` })}` : ''}
    </div>
    <div class="card">
      <div class="card-title">Últimos Atendimentos Analisados</div>
      ${ultimasAnalises.length ? ultimasAnalises.map(a => {
        const lead = a.leadId ? getLead(a.leadId) : null;
        return `<div class="timeline-item" style="cursor:pointer" onclick="Views.irParaAnalise('${a.leadId || ''}','${a.id}')">
          <div class="timeline-dot" style="background:${UI.scoreColorHex(a.scores.geral)}"></div>
          <div style="flex:1">
            <b>${esc(lead ? lead.nome : a.nomeLead)}</b>
            <span class="chip chip-gray" style="margin-left:6px">score <b style="color:${UI.scoreTextoHex(a.scores.geral)}">${a.scores.geral}</b></span>
            ${UI.chipTemp(a.temperatura)}
            <div class="muted">${fmtDateTime(a.criadoEm)} · ${a.objecoes.length} objeção(ões) · ${a.sinais.length} sinal(is) de compra</div>
          </div>
        </div>`;
      }).join('') : '<div class="muted">Nenhuma análise ainda. Abra um lead e use <b>Analisar conversa</b> na ficha dele.</div>'}
      ${motivos.length ? `<div class="divider"></div><div class="card-title">Motivos de Perda</div>${UI.hbarHTML(motivos, { drill: v => `Views.dashDrill('motivo','${String(v).replace(/'/g, "\\'")}')` })}` : ''}
    </div>
    ${dashAtendentesHTML(range)}
    ${dashCadenciasHTML(range)}
  </div>`;
});

function blocoPrimeirosPassos() {
  return `
  <div class="card mt">
    <div class="card-title">Como funciona</div>
    <div class="grid grid-3">
      <div><b>1. Alimente com leads</b><p class="muted mt" style="margin-top:6px">Importe o CSV exportado do seu CRM (qualquer formato — você mapeia as colunas) ou cadastre manualmente.</p></div>
      <div><b>2. Analise atendimentos</b><p class="muted" style="margin-top:6px">Cole a conversa do WhatsApp e receba diagnóstico por 6 dimensões (SPIN, rapport, objeções, fechamento...), com respostas prontas para enviar.</p></div>
      <div><b>3. Siga o funil de follow-ups</b><p class="muted" style="margin-top:6px">Aplique cadências comprovadas (80% das vendas exigem 5+ contatos) e trabalhe pela agenda diária — com mensagem pronta e link direto pro WhatsApp.</p></div>
    </div>
  </div>`;
}

Views.carregarExemplo = () => {
  const n = seedDemo();
  UI.toast(`${n} leads de exemplo criados, com cadências e uma análise pronta.`);
  UI.refresh();
};
