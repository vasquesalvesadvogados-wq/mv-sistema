/* ============ VIEW: CONTRATOS ============
   Por que esta tela existe: "contrato fechado" não é uma entidade no sistema —
   contratos moram embutidos em lead.contratos[] e não têm campo de status. O
   "fechado" mora no LEAD (etapa 'Ganho' + ganhoEm), e os dois podem divergir,
   porque addContrato não mexe na etapa. Resultado: o dashboard mostrava "8
   contratos" (que na verdade conta leads ganhos) sem nenhuma tela que listasse
   os registros. Aqui é onde se vê QUAIS são — e onde as divergências aparecem. */

let _filtroContratos = { periodo: 'este-mes', busca: '' };

Views.contratosPeriodo = (v) => { _filtroContratos.periodo = v; UI.refresh(); };

/* achata lead.contratos[] numa lista de registros com o lead junto */
function contratosDoPeriodo() {
  const todos = [];
  state.leads.forEach(l => (l.contratos || []).forEach(c => todos.push({ c, l })));
  const p = _filtroContratos.periodo;
  let lista = todos;
  if (p !== 'tudo') {
    const r = periodoRange(p);
    lista = lista.filter(x => dashNoPer(r, x.c.data));
  }
  const b = (_filtroContratos.busca || '').trim().toLowerCase();
  if (b) lista = lista.filter(x => ((x.l.nome || '') + ' ' + (x.c.servico || '')).toLowerCase().includes(b));
  return lista.sort((a, b2) => String(b2.c.data || '').localeCompare(String(a.c.data || '')));
}

Views.exportarContratos = () => {
  const lista = contratosDoPeriodo();
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const cab = ['Data', 'Cliente', 'Telefone', 'Serviço', 'Etapa do lead', 'Forma', 'Parcelas', 'Valor cheio', 'Desconto', 'Total', 'Obs'];
  const linhas = lista.map(({ c, l }) => [
    fmtDate(c.data), l.nome, l.telefone, c.servico, l.etapa, c.formaPagamento,
    c.parcelas || 1, c.valor || 0, c.desconto || 0, valorContrato(c), c.obs
  ].map(q).join(';'));
  CSV.baixar(ESCRITORIO.arquivo + '-contratos-' + todayISO() + '.csv',
    '﻿' + cab.map(q).join(';') + '\n' + linhas.join('\n'), 'text/csv;charset=utf-8');
};

UI.registrar('contratos', () => {
  const lista = contratosDoPeriodo();
  const total = lista.reduce((s, x) => s + valorContrato(x.c), 0);
  const clientes = new Set(lista.map(x => x.l.id)).size;
  const p = _filtroContratos.periodo;
  const periodos = [['esta-semana', 'Esta semana'], ['este-mes', 'Este mês'], ['mes-anterior', 'Mês anterior'],
                    ['30-dias', '30 dias'], ['90-dias', '90 dias'], ['tudo', 'Tudo']];

  /* as duas divergências que só esta tela consegue mostrar */
  const semGanho = lista.filter(x => x.l.etapa !== 'Ganho');
  const rangeG = p === 'tudo' ? null : periodoRange(p);
  const ganhosSemContrato = state.leads.filter(l => l.etapa === 'Ganho' &&
    (!rangeG || dashNoPer(rangeG, l.ganhoEm)) && !(l.contratos || []).length);

  return `
  <div class="toolbar">
    <span class="seg">
      ${periodos.map(([v, r]) => `<button class="${p === v ? 'active' : ''}" onclick="Views.contratosPeriodo('${v}')">${r}</button>`).join('')}
    </span>
    <input placeholder="Buscar por cliente ou serviço..." value="${esc(_filtroContratos.busca)}"
      oninput="_filtroContratos.busca=this.value;Views.refiltrarContratos(this)">
    <span class="muted right">${lista.length} contrato(s) · ${clientes} cliente(s) · <b style="color:var(--green)">${fmtMoney(total)}</b></span>
    <button class="btn btn-ghost btn-sm" onclick="Views.exportarContratos()">${ICO('download')} Exportar CSV</button>
  </div>

  ${lista.length ? `<div class="card">
    <div class="table-wrap"><table class="dash-tbl">
      <thead><tr><th>Data</th><th>Cliente</th><th>Serviço</th><th>Etapa</th><th>Pagamento</th><th class="right">Valor</th></tr></thead>
      <tbody>
        ${lista.map(({ c, l }) => `<tr style="cursor:pointer" onclick="location.hash='#/leads/${l.id}'">
          <td class="td-dim">${fmtDate(c.data)}</td>
          <td class="td-strong">${esc(l.nome)}${l.empresa ? `<div class="muted">${esc(l.empresa)}</div>` : ''}</td>
          <td>${esc(c.servico)}${c.obs ? `<div class="muted">${esc(String(c.obs).slice(0, 60))}</div>` : ''}</td>
          <td>${UI.chipEtapa(l.etapa)}</td>
          <td class="td-dim">${esc(c.formaPagamento || '—')}${c.parcelas > 1 ? ` · ${c.parcelas}x` : ''}</td>
          <td class="right"><b>${fmtMoney(valorContrato(c))}</b>${c.desconto ? `<div class="muted">de ${fmtMoney(c.valor)}</div>` : ''}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr><td colspan="5"><b>Total do período</b></td><td class="right"><b style="color:var(--green)">${fmtMoney(total)}</b></td></tr></tfoot>
    </table></div>
  </div>` : `<div class="card"><div class="empty"><div class="big">${ICO('file-text')}</div>
    <h3>Nenhum contrato neste período</h3>
    <p>Contratos são registrados na ficha do lead, em <b>Serviços contratados</b>. Experimente ampliar o período.</p></div></div>`}

  ${semGanho.length || ganhosSemContrato.length ? `<div class="card mt">
    <div class="card-title">${ICO('alert-triangle')} Conferir</div>
    <p class="muted">Registrar o contrato e marcar o lead como Ganho são ações separadas — por isso os dois números podem discordar. Estes são os casos a revisar.</p>
    ${semGanho.length ? `<div class="divider"></div>
      <b>${semGanho.length} contrato(s) em lead que não está como Ganho</b>
      <div class="muted">A receita entra, mas a conversão do funil não conta este lead.</div>
      ${semGanho.slice(0, 8).map(({ c, l }) => `<div class="dash-lead-item" onclick="location.hash='#/leads/${l.id}'">
        ${esc(l.nome)} — ${esc(c.servico)} ${fmtMoney(valorContrato(c))} ${UI.chipEtapa(l.etapa)}</div>`).join('')}
      ${semGanho.length > 8 ? `<div class="muted">+ ${semGanho.length - 8} outro(s)</div>` : ''}` : ''}
    ${ganhosSemContrato.length ? `<div class="divider"></div>
      <b>${ganhosSemContrato.length} lead(s) marcado(s) como Ganho sem contrato registrado</b>
      <div class="muted">Contam na conversão, mas não na Receita Contratada nem no Ticket Médio.</div>
      ${ganhosSemContrato.slice(0, 8).map(l => `<div class="dash-lead-item" onclick="location.hash='#/leads/${l.id}'">
        ${esc(l.nome)}${l.ganhoEm ? ' — ganho em ' + fmtDate(l.ganhoEm.slice(0, 10)) : ''}</div>`).join('')}
      ${ganhosSemContrato.length > 8 ? `<div class="muted">+ ${ganhosSemContrato.length - 8} outro(s)</div>` : ''}` : ''}
  </div>` : ''}`;
});

/* mesma manobra do filtro de leads: devolve o cursor à busca depois do re-render */
Views.refiltrarContratos = (input) => {
  const pos = input.selectionStart;
  UI.refresh();
  const novo = document.querySelector('.toolbar input');
  if (novo) { novo.focus(); novo.setSelectionRange(pos, pos); }
};
