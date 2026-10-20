/* ============ VIEW: AGENDA DE FOLLOW-UPS (lista + calendário dia/semana/mês) ============ */

let _agendaUI = { modo: 'lista', ref: todayISO() };

/* DOWS, _d e inicioDaSemana vivem em js/store.js */

function fusPorDia() {
  const mapa = {};
  state.followups.filter(f => f.status === 'pendente').forEach(f => {
    (mapa[f.dueDate] = mapa[f.dueDate] || []).push(f);
  });
  return mapa;
}

UI.registrar('agenda', () => {
  const total = state.followups.filter(f => f.status === 'pendente').length;

  if (!total) {
    return `<div class="card"><div class="empty">
      <div class="big">${ICO('calendar')}</div>
      <h3>Nenhum follow-up agendado</h3>
      <p>Aplique uma cadência a um lead (na tela do lead ou após uma análise) e sua agenda de contatos aparece aqui — em lista ou calendário, com a mensagem pronta e link direto para o WhatsApp.</p>
      <div class="flex" style="justify-content:center">
        <button class="btn btn-primary" onclick="location.hash='#/leads'">Ver meus leads</button>
        <button class="btn btn-ghost" onclick="location.hash='#/cadencias'">Conhecer as cadências</button>
      </div>
    </div></div>`;
  }

  const m = _agendaUI.modo;
  const seg = `
  <div class="flex" style="justify-content:space-between">
    <div class="seg">
      ${[['lista', `${ICO('list')} Lista`], ['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']].map(([id, rot]) =>
        `<button class="${m === id ? 'on' : ''}" onclick="Views.agendaModo('${id}')">${rot}</button>`).join('')}
    </div>
    <span class="muted">${total} follow-up(s) pendente(s)</span>
  </div>`;

  let corpo = '';
  if (m === 'lista') corpo = agendaListaHTML();
  else if (m === 'dia') corpo = agendaDiaHTML();
  else if (m === 'semana') corpo = agendaSemanaHTML();
  else corpo = agendaMesHTML();

  return seg + corpo;
});

/* ---------- navegação do calendário ---------- */

Views.agendaModo = (m) => { _agendaUI.modo = m; _agendaUI.ref = _agendaUI.modo === 'lista' ? _agendaUI.ref : (_agendaUI.ref || todayISO()); UI.refresh(); };

Views.agendaNav = (delta) => {
  const r = _agendaUI.ref;
  if (_agendaUI.modo === 'dia') _agendaUI.ref = addDaysISO(r, delta);
  else if (_agendaUI.modo === 'semana') _agendaUI.ref = addDaysISO(r, delta * 7);
  else {
    const d = _d(r.slice(0, 8) + '01');
    d.setMonth(d.getMonth() + delta);
    _agendaUI.ref = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
  }
  UI.refresh();
};

Views.agendaHoje = () => { _agendaUI.ref = todayISO(); UI.refresh(); };

Views.agendaVerDia = (iso) => { _agendaUI.modo = 'dia'; _agendaUI.ref = iso; UI.refresh(); };

function calNavHTML(rotulo) {
  return `<div class="cal-nav">
    <button class="btn btn-ghost" onclick="Views.agendaNav(-1)">${ICO('chevron-left')}</button>
    <button class="btn btn-ghost" onclick="Views.agendaHoje()">Hoje</button>
    <button class="btn btn-ghost" onclick="Views.agendaNav(1)">${ICO('chevron-right')}</button>
    <h3>${rotulo}</h3>
  </div>`;
}

/* ---------- modo LISTA (agrupado, original) ---------- */

function agendaListaHTML() {
  const g = Cadence.agenda();
  const grupo = (titulo, ico, lista, cls) => lista.length ? `
    <div class="agenda-group-title">${ico} ${titulo} <span class="chip chip-gray">${lista.length}</span></div>
    ${lista.map(f => Views.fuItemHTML(f, { cls })).join('')}` : '';
  return `
  <p class="muted" style="margin:14px 0">${ICO('lightbulb')} Trabalhe de cima para baixo: <b>copie a mensagem</b> (ou abra direto no WhatsApp), envie, e marque como <b>Feito</b>. Se o lead responder, abra o lead e clique em "Lead respondeu".</p>
  ${grupo('Atrasados', ICO('alarm-clock'), g.atrasados, 'atrasado')}
  ${grupo('Hoje', ICO('flame'), g.hoje, 'hoje')}
  ${grupo('Amanhã', ICO('pin'), g.amanha, 'futuro')}
  ${grupo('Próximos 7 dias', ICO('calendar-days'), g.semana, 'futuro')}
  ${grupo('Mais adiante', ICO('moon'), g.depois, 'futuro')}`;
}

/* ---------- modo DIA ---------- */

function agendaDiaHTML() {
  const ref = _agendaUI.ref;
  const hoje = todayISO();
  const rotulo = _d(ref).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const doDia = state.followups.filter(f => f.status === 'pendente' && f.dueDate === ref);
  const atrasados = ref === hoje ? state.followups.filter(f => f.status === 'pendente' && f.dueDate < hoje).sort((a, b) => a.dueDate.localeCompare(b.dueDate)) : [];

  return calNavHTML(rotulo + (ref === hoje ? ' · hoje' : '')) +
    (atrasados.length ? `<div class="agenda-group-title">${ICO('alarm-clock')} Atrasados (resolver primeiro) <span class="chip chip-red">${atrasados.length}</span></div>
      ${atrasados.map(f => Views.fuItemHTML(f, { cls: 'atrasado' })).join('')}` : '') +
    (doDia.length ? `<div class="agenda-group-title">${ICO('clipboard-list')} Mensagens deste dia <span class="chip chip-gray">${doDia.length}</span></div>
      ${doDia.map(f => Views.fuItemHTML(f)).join('')}`
      : `<div class="card"><div class="muted" style="text-align:center;padding:20px">Nenhum follow-up para este dia.</div></div>`);
}

/* ---------- modo SEMANA ---------- */

function agendaSemanaHTML() {
  const ini = inicioDaSemana(_agendaUI.ref);
  const fim = addDaysISO(ini, 6);
  const hoje = todayISO();
  const mapa = fusPorDia();
  const rotulo = `${fmtDate(ini).slice(0, 5)} a ${fmtDate(fim)}`;

  const cols = [];
  for (let i = 0; i < 7; i++) {
    const dia = addDaysISO(ini, i);
    const itens = (mapa[dia] || []);
    cols.push(`<div class="week-col ${dia === hoje ? 'hoje' : ''}">
      <div class="week-col-head" onclick="Views.agendaVerDia('${dia}')" title="Abrir o dia">
        <div class="dow">${DOWS[i]}</div>
        <div class="num">${dia.slice(8, 10)}</div>
      </div>
      ${itens.map(f => {
        const lead = getLead(f.leadId);
        return `<div class="week-item ${dia < hoje ? 'atrasado' : ''}" onclick="Views.agendaVerDia('${dia}')">
          <b>${esc(lead ? lead.nome : '—')}</b>
          <span>${f.canal === 'Ligação' ? ICO('phone') : ICO('message-circle')} ${esc(f.titulo)}</span>
        </div>`;
      }).join('') || '<div class="muted" style="text-align:center;font-size:.7rem;padding:8px 0">—</div>'}
    </div>`);
  }
  return calNavHTML('Semana · ' + rotulo) + `<div class="week-grid">${cols.join('')}</div>
  <p class="muted mt">Clique em um dia para abrir a visão diária com as mensagens prontas e os botões de ação.</p>`;
}

/* ---------- modo MÊS ---------- */

function agendaMesHTML() {
  const ref = _agendaUI.ref;
  const hoje = todayISO();
  const mapa = fusPorDia();
  const primeiroDia = ref.slice(0, 8) + '01';
  const rotulo = _d(primeiroDia).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const inicioGrade = inicioDaSemana(primeiroDia);
  const mesRef = ref.slice(0, 7);

  let celulas = '';
  for (let i = 0; i < 42; i++) {
    const dia = addDaysISO(inicioGrade, i);
    if (i >= 35 && dia.slice(0, 7) !== mesRef) break; // 6ª linha só se necessária
    const itens = mapa[dia] || [];
    const fora = dia.slice(0, 7) !== mesRef;
    const temAtraso = itens.length && dia < hoje;
    const minis = itens.slice(0, 2).map(f => {
      const lead = getLead(f.leadId);
      return `<div class="cal-mini">${f.canal === 'Ligação' ? ICO('phone') : ICO('message-circle')} ${esc(primeiroNome(lead ? lead.nome : '—'))} · ${esc(f.titulo)}</div>`;
    }).join('');
    celulas += `<div class="cal-cell ${fora ? 'fora' : ''} ${dia === hoje ? 'hoje' : ''} ${temAtraso ? 'tem-atraso' : ''}"
      onclick="Views.agendaVerDia('${dia}')" title="${itens.length} follow-up(s)">
      <div class="cal-num">${dia.slice(8, 10)}</div>
      ${itens.length ? `<div class="cal-count">${itens.length}</div>` : ''}
      ${minis}
      ${itens.length > 2 ? `<div class="cal-mini" style="background:none">+ ${itens.length - 2} mais…</div>` : ''}
    </div>`;
  }

  return calNavHTML(rotulo) + `
  <div class="cal-dows">${DOWS.map(d => `<div class="cal-dow">${d}</div>`).join('')}</div>
  <div class="cal-grid">${celulas}</div>
  <p class="muted mt">${ICO('circle')} dias com follow-ups atrasados · clique em qualquer dia para ver as mensagens e agir.</p>`;
}

/* ---------- item de follow-up (usado na agenda e no detalhe do lead) ---------- */

Views.fuItemHTML = (f, opts = {}) => {
  const lead = getLead(f.leadId);
  const msg = renderTemplate(f.template, lead);
  const dias = diasAte(f.dueDate);
  const cls = opts.cls || (dias < 0 ? 'atrasado' : dias === 0 ? 'hoje' : 'futuro');
  const quando = dias < 0 ? `atrasado ${-dias}d` : dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : fmtDate(f.dueDate);
  // v6: envio automático pela fila do Chat
  const conversa = lead ? conversaDoLead(lead.id) : null;
  const msgAgendada = f.msgId ? state.mensagens.find(m => m.id === f.msgId) : null;
  return `<div class="fu-item ${cls}">
    <div class="fu-body">
      <div class="fu-head">
        ${lead ? `<a class="fu-lead" href="#/leads/${lead.id}">${esc(lead.nome)}</a>` : '<span class="fu-lead">Lead removido</span>'}
        <span class="chip ${dias < 0 ? 'chip-red' : dias === 0 ? 'chip-amber' : 'chip-gray'}">${quando}</span>
        <span class="chip chip-gray">${f.canal === 'Ligação' ? ICO('phone') : ICO('message-circle')} ${esc(f.canal)}</span>
        <span class="chip chip-blue">toque ${f.passoIndex + 1}</span>
        ${f.msgId ? `<span class="chip ag-selo-envio" title="${msgAgendada && msgAgendada.agendadaPara ? esc('Envio programado para ' + fmtDateTime(msgAgendada.agendadaPara)) : 'Mensagem na fila de envio do ' + ESCRITORIO.plataformas.chat}">${ICO('send')} programado no WhatsApp</span>` : ''}
      </div>
      <div><b style="font-size:.86rem">${esc(f.titulo)}</b> <span class="muted">· ${esc(f.cadenciaNome)}</span></div>
      <div class="muted" style="font-size:.76rem">${ICO('target')} ${esc(f.objetivo)}</div>
      ${opts.compact ? '' : `<div class="fu-msg">${esc(msg)}</div>`}
    </div>
    <div class="fu-actions" style="flex-direction:column">
      <div class="flex" style="gap:6px">
        <button class="btn btn-sm" title="Copiar mensagem" onclick='UI.copiar(${JSON.stringify(msg)})'><span data-icon="copy"></span></button>
        ${chatLink(lead, msg) ? `<a class="btn btn-success btn-sm" title="Abrir conversa" target="_blank" href='${esc(chatLink(lead, msg))}'><span data-icon="wa"></span></a>` : ''}
        <button class="btn btn-success btn-sm" onclick="Views.fuConcluir('${f.id}')">${ICO('check')} Feito</button>
      </div>
      <div class="flex" style="gap:6px">
        <button class="btn btn-ghost btn-sm" onclick="Cadence.adiar('${f.id}',1);UI.toast('Adiado 1 dia');UI.refresh()">+1d</button>
        <button class="btn btn-ghost btn-sm" onclick="Cadence.adiar('${f.id}',3);UI.toast('Adiado 3 dias');UI.refresh()">+3d</button>
        <button class="btn btn-ghost btn-sm" title="Pular este toque" onclick="Views.fuPular('${f.id}')">Pular</button>
      </div>
      ${!f.msgId && conversa && f.template ? `<div class="flex" style="gap:6px">
        <button class="btn btn-sm fu-prog-btn" title="Programar o envio automático pela fila do ${ESCRITORIO.plataformas.chat}" onclick="Views.fuProgramar('${f.id}')">${ICO('send')} Programar envio</button>
      </div>` : ''}
      ${f.msgId ? `<div class="flex" style="gap:6px">
        <button class="btn btn-ghost btn-sm fu-prog-cancel" title="Remover a mensagem da fila de envio" onclick="Views.fuCancelarEnvio('${f.id}')">${ICO('x')} Cancelar envio</button>
      </div>` : ''}
    </div>
  </div>`;
};

/* ---------- v6: programar envio real no WhatsApp (fila do Chat) ---------- */

function _fuHoraJanela() {
  const m = /^(\d{2}):(\d{2})/.exec(String(state.settings.janelaEnvio || '09:00-18:00'));
  return m ? m[1] + ':' + m[2] : '09:00';
}

Views.fuProgramar = (fid) => {
  const f = state.followups.find(x => x.id === fid);
  const lead = f && getLead(f.leadId);
  const conversa = lead ? conversaDoLead(lead.id) : null;
  if (!f || !lead) return;
  if (!conversa) { UI.toast('Este lead não tem conversa vinculada no ' + ESCRITORIO.plataformas.chat + '.', 'err'); return; }
  const texto = renderTemplate(f.template, lead);
  const base = f.dueDate < todayISO() ? todayISO() : f.dueDate;
  UI.modal(`
    <h2>${ICO('send')} Programar envio no WhatsApp <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
    <p class="muted" style="margin-bottom:12px">Revise a mensagem — ela entra na fila do ${ESCRITORIO.plataformas.chat} e o motor envia sozinho para <b>${esc(lead.nome)}</b> no horário escolhido.</p>
    <div class="field"><label>Mensagem (edite à vontade)</label>
      <textarea id="fu-prog-texto" rows="7">${esc(texto)}</textarea></div>
    <div class="field"><label>Enviar em</label>
      <input type="datetime-local" id="fu-prog-quando" value="${base}T${_fuHoraJanela()}"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="Views.fuProgramarConfirmar('${f.id}')">${ICO('send')} Programar envio</button>
    </div>`);
  setTimeout(() => { const t = document.getElementById('fu-prog-texto'); if (t) t.focus(); }, 60);
};

Views.fuProgramarConfirmar = (fid) => {
  const f = state.followups.find(x => x.id === fid);
  const lead = f && getLead(f.leadId);
  const conversa = lead ? conversaDoLead(lead.id) : null;
  if (!f || !lead || !conversa) { UI.fecharModal(); UI.toast('Conversa do lead não encontrada.', 'err'); return; }
  const elT = document.getElementById('fu-prog-texto');
  const elQ = document.getElementById('fu-prog-quando');
  const texto = elT ? elT.value.trim() : '';
  const quando = elQ ? elQ.value : '';
  if (!texto || !quando) { UI.toast('Preencha a mensagem e o horário.', 'err'); return; }
  const quandoISO = new Date(quando).toISOString();
  const msg = registrarMensagem(conversa.id, {
    direcao: 'saida', tipo: 'texto', texto,
    agendadaPara: quandoISO, status: 'agendada'
  });
  if (!msg) { UI.toast('Não foi possível programar o envio.', 'err'); return; }
  f.msgId = msg.id;
  f.autoEnviar = true;
  registrarEvento(lead, 'followup', 'Envio programado no WhatsApp: ' + f.titulo + ' — ' + fmtDateTime(quandoISO));
  save();
  UI.fecharModal();
  UI.toast('Mensagem programada no WhatsApp.');
  UI.refresh();
};

Views.fuCancelarEnvio = (fid) => {
  const f = state.followups.find(x => x.id === fid);
  if (!f || !f.msgId) return;
  const m = state.mensagens.find(x => x.id === f.msgId);
  const aindaNaFila = cancelarAgendadaLocal(m); // vira 'cancelada'; não apaga a linha
  f.msgId = null;
  f.autoEnviar = false;
  save();
  UI.toast(m && !aindaNaFila ? 'A mensagem já havia saído da fila — apenas desvinculada do follow-up.' : 'Envio programado cancelado.');
  UI.refresh();
};

/* concluir/pular com checagem do envio programado ainda pendente */

Views.fuConcluir = (fid) => _fuFinalizar(fid, 'concluir');
Views.fuPular = (fid) => _fuFinalizar(fid, 'pular');

function _fuExecutarFim(fid, acao) {
  if (acao === 'concluir') { Cadence.concluir(fid); UI.toast('Follow-up concluído.'); }
  else { Cadence.pular(fid); UI.toast('Follow-up pulado.'); }
  UI.refresh();
}

function _fuFinalizar(fid, acao) {
  const f = state.followups.find(x => x.id === fid);
  if (!f) return;
  const m = f.msgId ? state.mensagens.find(x => x.id === f.msgId) : null;
  if (m && m.status === 'agendada') {
    UI.modal(`
      <h2>${ICO('alert-triangle')} Envio programado pendente <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
      <p style="margin-bottom:14px">Este follow-up tem uma mensagem <b>programada no WhatsApp</b> para <b>${esc(fmtDateTime(m.agendadaPara))}</b> que ainda não foi enviada. O que fazer com o envio?</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="UI.fecharModal();Views.fuFinalizarMantendo('${fid}','${acao}')">Manter envio</button>
        <button class="btn btn-primary" onclick="UI.fecharModal();Views.fuFinalizarCancelando('${fid}','${acao}')">Cancelar envio</button>
      </div>`);
    return;
  }
  _fuExecutarFim(fid, acao);
}

Views.fuFinalizarMantendo = (fid, acao) => _fuExecutarFim(fid, acao);

Views.fuFinalizarCancelando = (fid, acao) => {
  const f = state.followups.find(x => x.id === fid);
  if (f && f.msgId) {
    cancelarAgendadaLocal(state.mensagens.find(x => x.id === f.msgId));
    f.msgId = null;
    f.autoEnviar = false;
  }
  _fuExecutarFim(fid, acao);
};
