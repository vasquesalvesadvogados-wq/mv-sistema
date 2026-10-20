/* ============ VIEW: ANALISAR ATENDIMENTO ============ */

/* A aba "Analisar atendimento" saiu do menu: a análise agora vive dentro da ficha
   do lead (js/views-leads.js). Esta rota continua registrada apenas para não
   quebrar links antigos, favoritos e o histórico do navegador. */
UI.registrar('analisar', (param) => {
  const a = param ? state.analyses.find(x => x.id === param) : null;
  if (a && a.leadId && getLead(a.leadId)) {
    setTimeout(() => Views.irParaAnalise(a.leadId, a.id), 0);
    return '<div class="card"><span class="muted">Abrindo a análise na ficha do lead...</span></div>';
  }
  setTimeout(() => { location.hash = '#/leads'; UI.refresh(); }, 0);
  return '<div class="card"><span class="muted">As análises agora ficam na ficha de cada lead. Redirecionando...</span></div>';
});

/* ---------- resultado ---------- */

function renderResultadoAnalise(a, opts) {
  const embutido = !!(opts && opts.embutido);   // renderizada dentro da ficha do lead
  const lead = a.leadId ? getLead(a.leadId) : null;
  const info = Analysis.labelScore(a.scores.geral);
  const porDim = {};
  a.findings.forEach(f => { (porDim[f.dim] = porDim[f.dim] || []).push(f); });
  const ordemDim = ['conexao', 'investigacao', 'valor', 'objecoes', 'fechamento', 'conducao'];

  return `
  <div class="flex mb">
    ${embutido
      ? `<b>${ICO('microscope')} Análise de ${esc(a.nomeLead || (lead ? lead.nome : 'atendimento'))}</b>`
      : `${lead ? `<a href="#/leads/${lead.id}" class="muted">${ICO('arrow-left')} ${esc(lead.nome)}</a>` : `<span class="chip chip-gray">${esc(a.nomeLead)}</span>`}`}
    <span class="muted right">${fmtDateTime(a.criadoEm)}</span>
    ${embutido ? `<button class="btn btn-ghost btn-sm" onclick="Views.fecharAnalise()">${ICO('x')} Fechar</button>` : ''}
  </div>

  <div class="card">
    <div class="score-hero">
      <div class="score-gauge">${UI.gaugeSVG(a.scores.geral, 190)}</div>
      <div class="score-dims">${UI.dimBarHTML(a.scores)}</div>
      <div>${UI.radarSVG(a.scores, 220)}</div>
    </div>
    <div class="divider"></div>
    <div class="flex">
      ${UI.chipTemp(a.temperatura)}
      <span class="chip chip-blue">Etapa sugerida: ${esc(a.etapaSugerida)}</span>
      <span class="chip chip-gray">${a.stats.totalMsgs} msgs · ${a.stats.perguntasAtendente} perguntas do atendente</span>
      ${a.sinais.length ? `<span class="chip chip-green">${ICO('circle-check')} ${a.sinais.length} sinal(is) de compra</span>` : ''}
      ${a.objecoes.length ? `<span class="chip chip-amber">${ICO('alert-triangle')} ${a.objecoes.length} objeção(ões)</span>` : ''}
      ${lead ? `<button class="btn btn-sm right" onclick="Views.aplicarSugestoes('${a.id}')">${ICO('check')} Aplicar etapa/temperatura ao lead</button>` : `<button class="btn btn-sm right" onclick="Views.criarLeadDaAnalise('${a.id}')">+ Criar lead desta conversa</button>`}
    </div>
  </div>

  <div class="grid grid-2 mt">
    <div>
      <div class="card">
        <div class="card-title">${ICO('compass')} Próximos passos recomendados</div>
        ${a.proximosPassos.map(p => `<div class="finding finding-alerta"><div class="finding-ico">${ICO('corner-down-right')}</div><div>${esc(p)}</div></div>`).join('')}
        <div class="flex mt">
          ${a.leadId ? `<button class="btn btn-primary btn-sm" onclick="Views.abrirAplicarCadencia('${a.leadId}','${a.cadenciaSugerida}')">${ICO('target')} Aplicar cadência sugerida: ${esc((Cadence.get(a.cadenciaSugerida) || {}).nome || '')}</button>` : `<span class="muted">Vincule/crie um lead para agendar a cadência de follow-ups sugerida (${esc((Cadence.get(a.cadenciaSugerida) || {}).nome || '')}).</span>`}
        </div>
      </div>

      ${a.objecoes.length ? `<div class="card mt">
        <div class="card-title">${ICO('shield')} Objeções detectadas</div>
        ${a.objecoes.map(o => `<div class="finding ${o.tratada ? 'finding-ok' : 'finding-erro'}">
          <div class="finding-ico">${o.tratada ? ICO('circle-check') : ICO('circle-x')}</div>
          <div><b>${esc(o.rotulo)}</b> — "${esc(o.trecho)}"<br><span class="muted">${o.tratada ? 'Foi contornada na conversa.' : 'Não foi tratada — use a resposta sugerida ao lado.'}</span></div>
        </div>`).join('')}
      </div>` : ''}

      ${a.sinais.length ? `<div class="card mt">
        <div class="card-title">${ICO('trending-up')} Sinais de compra</div>
        ${a.sinais.map(s => `<div class="finding finding-ok"><div class="finding-ico">${ICO('banknote')}</div><div>"${esc(s.trecho)}"</div></div>`).join('')}
      </div>` : ''}

      <div class="card mt">
        <div class="card-title">${ICO('clipboard-list')} Diagnóstico detalhado <span class="hint">por dimensão, com a técnica de referência</span></div>
        ${ordemDim.filter(d => porDim[d]).map(d => `
          <div style="margin-bottom:14px">
            <b style="font-size:.85rem;color:${UI.scoreTextoHex(a.scores[d])}">${Analysis.labelDim(d)} — ${a.scores[d]}</b>
            <div class="mt" style="margin-top:8px">
            ${porDim[d].map(f => `<div class="finding finding-${f.tipo}">
              <div class="finding-ico">${f.tipo === 'ok' ? ICO('circle-check') : f.tipo === 'alerta' ? ICO('alert-triangle') : ICO('circle-x')}</div>
              <div>${esc(f.texto)}${f.ref ? `<span class="ref">${ICO('book-open')} ${esc(f.ref)}</span>` : ''}</div>
            </div>`).join('')}
            </div>
          </div>`).join('')}
      </div>
    </div>

    <div>
      <div class="card">
        <div class="card-title">${ICO('message-circle')} Respostas sugeridas <span class="hint">prontas para copiar e enviar</span></div>
        ${a.respostas.map((r, i) => `<div class="resposta-card">
          <h4>${esc(r.titulo)}
            <span class="flex" style="gap:6px">
              <button class="btn btn-sm" onclick="Views.copiarResposta('${a.id}',${i})"><span data-icon="copy"></span> Copiar</button>
              ${lead && chatLink(lead) ? `<a class="btn btn-success btn-sm" title="Abrir conversa" target="_blank" href="#" onclick="this.href=chatLink(getLead('${a.leadId}'),renderTemplate(state.analyses.find(x=>x.id==='${a.id}').respostas[${i}].texto,getLead('${a.leadId}')))"><span data-icon="wa"></span></a>` : ''}
            </span>
          </h4>
          <span class="ref">${ICO('book-open')} ${esc(r.ref)}</span>
          <p>${esc(renderTemplate(r.texto, lead || { nome: a.nomeLead }))}</p>
        </div>`).join('')}
      </div>

      <div class="card mt" id="card-ia">
        <div class="card-title">${ICO('bot')} Análise Profunda com IA (Claude)
          <span class="hint">IA do escritório</span>
        </div>
        ${a.ai ? renderPainelIA(a) : AI.configurado()
          ? `<p class="muted mb">Envie a conversa para o Claude e receba uma leitura qualitativa completa: nuances de tom, oportunidades perdidas e respostas personalizadas para ESTE lead.</p>
             <button class="btn btn-primary" onclick="Views.rodarIA('${a.id}')">${ICO('sparkles')} Analisar com IA</button>`
          : `<p class="muted">A análise local acima funciona 100% offline. A análise profunda com a IA do escritório funciona só no sistema publicado.</p>`}
      </div>

      <div class="card mt">
        <div class="card-title">${ICO('message-square')} Conversa analisada <span class="hint">atendente: ${esc(a.atendente)}</span></div>
        <div class="conversa-preview">
          ${a.msgs.map(m => `<div class="msg ${m.quem === a.atendente ? 'msg-atendente' : 'msg-lead'}">
            <div class="who">${esc(m.quem)}${m.hora ? ' · ' + esc(m.hora) : ''}</div>
            <div class="bubble">${esc(m.texto)}</div>
          </div>`).join('')}
        </div>
        <div class="flex mt">
          <button class="btn btn-ghost btn-sm btn-danger" onclick="Views.excluirAnalise('${a.id}')">Excluir análise</button>
        </div>
      </div>
    </div>
  </div>`;
}

function renderPainelIA(a) {
  const ai = a.ai;
  const lead = a.leadId ? getLead(a.leadId) : null;
  return `
    <div class="flex mb">
      <span class="chip" style="background:rgba(167,139,250,.15);color:var(--purple)">Score IA: <b>${ai.scoreGeral}</b></span>
      ${UI.chipTemp(ai.temperatura)}
    </div>
    <p style="font-size:.9rem;line-height:1.55">${esc(ai.resumo)}</p>
    <div class="divider"></div>
    ${ai.pontosFortes.length ? `<b style="font-size:.82rem;color:var(--green)">Pontos fortes</b>
      ${ai.pontosFortes.map(p => `<div class="finding finding-ok"><div class="finding-ico">${ICO('circle-check')}</div><div>${esc(p)}</div></div>`).join('')}` : ''}
    ${ai.pontosFracos.length ? `<b style="font-size:.82rem;color:var(--red)">Pontos a melhorar</b>
      ${ai.pontosFracos.map(p => `<div class="finding finding-erro"><div class="finding-ico">${ICO('circle-x')}</div><div>${esc(p)}</div></div>`).join('')}` : ''}
    ${ai.objecoes.length ? `<b style="font-size:.82rem;color:var(--amber)">Objeções</b>
      ${ai.objecoes.map(p => `<div class="finding finding-alerta"><div class="finding-ico">${ICO('shield')}</div><div>${esc(p)}</div></div>`).join('')}` : ''}
    <div class="finding finding-alerta"><div class="finding-ico">${ICO('compass')}</div><div><b>Próximo passo:</b> ${esc(ai.proximoPasso)}</div></div>
    ${(ai.respostasSugeridas || []).map((r, i) => `<div class="resposta-card">
      <h4>${esc(r.titulo)}
        <span class="flex" style="gap:6px">
          <button class="btn btn-sm" onclick="UI.copiar(state.analyses.find(x=>x.id==='${a.id}').ai.respostasSugeridas[${i}].mensagem)"><span data-icon="copy"></span> Copiar</button>
          ${lead && chatLink(lead) ? `<a class="btn btn-success btn-sm" title="Abrir conversa" target="_blank" href="#" onclick="this.href=chatLink(getLead('${a.leadId}'),state.analyses.find(x=>x.id==='${a.id}').ai.respostasSugeridas[${i}].mensagem)"><span data-icon="wa"></span></a>` : ''}
        </span>
      </h4>
      <p>${esc(r.mensagem)}</p>
    </div>`).join('')}
    <button class="btn btn-ghost btn-sm mt" onclick="Views.rodarIA('${a.id}')">${ICO('refresh-cw')} Rodar novamente</button>`;
}

Views.rodarIA = async (aId) => {
  const a = state.analyses.find(x => x.id === aId);
  if (!a) return;
  const card = document.getElementById('card-ia');
  card.innerHTML = `<div class="card-title">${ICO('bot')} Análise Profunda com IA</div><p class="muted">${UI.carregando('Analisando a conversa com o Claude. Isso pode levar até um minuto.')}</p>`;
  try {
    const lead = a.leadId ? getLead(a.leadId) : null;
    a.ai = await AI.analisarConversa(a, lead);
    save();
    UI.toast('Análise com IA concluída.');
    UI.refresh();
  } catch (e) {
    console.error(e);
    card.innerHTML = `<div class="card-title">${ICO('bot')} Análise Profunda com IA</div>
      <p class="muted">${ICO('alert-circle')} Erro: ${esc(e.message)}</p>
      <p class="muted mt">Se o problema continuar, avise um administrador.</p>
      <button class="btn btn-sm mt" onclick="Views.rodarIA('${aId}')">Tentar novamente</button>`;
  }
};

Views.copiarResposta = (aId, idx) => {
  const a = state.analyses.find(x => x.id === aId);
  if (!a) return;
  const lead = a.leadId ? getLead(a.leadId) : null;
  UI.copiar(renderTemplate(a.respostas[idx].texto, lead || { nome: a.nomeLead }));
};

Views.aplicarSugestoes = (aId) => {
  const a = state.analyses.find(x => x.id === aId);
  if (!a || !a.leadId) return;
  atualizarLead(a.leadId, { etapa: a.etapaSugerida, temperatura: a.temperatura });
  UI.toast(`Lead atualizado: ${a.etapaSugerida} · ${a.temperatura}`);
  UI.refresh();
};

Views.criarLeadDaAnalise = (aId) => {
  const a = state.analyses.find(x => x.id === aId);
  if (!a) return;
  const lead = novoLead({ nome: a.nomeLead, etapa: a.etapaSugerida, temperatura: a.temperatura, origem: 'WhatsApp' });
  a.leadId = lead.id;
  save();
  UI.toast('Lead criado e vinculado à análise! Complete os dados dele.');
  Views.irParaAnalise(lead.id, a.id);
};

Views.excluirAnalise = (aId) => {
  const a = state.analyses.find(x => x.id === aId);
  if (!confirm('Excluir esta análise?')) return;
  const leadId = a && a.leadId;
  state.analyses = state.analyses.filter(x => x.id !== aId);
  save();
  Views.fecharAnalise();
  if (leadId && getLead(leadId)) { location.hash = '#/leads/' + leadId; }
  UI.refresh();
};
