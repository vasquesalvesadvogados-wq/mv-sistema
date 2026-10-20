/* ============ VIEWS: CADÊNCIAS, PLAYBOOK e CONFIGURAÇÕES ============ */

/* ---------- CADÊNCIAS ---------- */

UI.registrar('cadencias', () => {
  const cads = Cadence.all();
  return `
  <p class="muted mb">Cadências são sequências de follow-up com dias, canais e mensagens prontas — desenhadas a partir dos estudos do Playbook (80% das vendas exigem 5+ contatos; 44% dos vendedores desistem no 1º). Você pode <b>editar o dia, o horário do disparo e a mensagem</b> de cada passo. As variáveis (<code>{{nome}}</code>, <code>{{caso}}</code>, <code>{{dica}}</code>, <code>{{documentos}}</code>...) se preenchem sozinhas conforme a área do lead.</p>
  ${cads.map(c => `
  <div class="card">
    <div class="card-title">${esc(c.nome)}
      <span class="hint">${esc(c.cenario)} · ${ICO('book-open')} ${esc(c.ref)}</span>
    </div>
    ${c.passos.map((p, i) => `
      <div class="cad-step">
        <div class="cad-day"><small>DIA</small>${p.dia}</div>
        <div class="cad-body">
          <h4>${p.canal === 'Ligação' ? ICO('phone') : ICO('message-circle')} ${esc(p.titulo)}
            <span class="chip chip-gray" title="Horário do disparo automático">${ICO('clock')} ${esc(p.hora || 'janela padrão')}</span></h4>
          <div class="obj">${ICO('target')} ${esc(p.objetivo)}</div>
          <div class="cad-tpl" id="tpl-${c.id}-${i}">${esc(p.template)}</div>
          <div class="flex" style="margin-top:8px">
            <button class="btn btn-ghost btn-sm" onclick="Views.editarPasso('${c.id}',${i})">${ICO('pencil')} Editar mensagem</button>
            <button class="btn btn-ghost btn-sm" onclick='UI.copiar(renderTemplate(Cadence.get("${c.id}").passos[${i}].template,{nome:"[nome]"}))'><span data-icon="copy"></span> Copiar</button>
          </div>
        </div>
      </div>`).join('')}
  </div>`).join('')}

  <div class="card">
    <div class="card-title">${ICO('mail')} Mensagens avulsas <span class="hint">para situações do dia a dia</span></div>
    ${Cadence.TEMPLATES_AVULSOS.map((t, i) => `<div class="resposta-card">
      <h4>${esc(t.titulo)} <button class="btn btn-sm" onclick='UI.copiar(renderTemplate(Cadence.TEMPLATES_AVULSOS[${i}].texto,{nome:"[nome]"}))'><span data-icon="copy"></span> Copiar</button></h4>
      <p>${esc(t.texto)}</p>
    </div>`).join('')}
  </div>`;
});

Views.editarPasso = (cadId, i) => {
  const cad = Cadence.get(cadId);
  const p = cad.passos[i];
  UI.modal(`<h2>Editar: ${esc(p.titulo)} <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
    <div class="form-row-3">
      <div class="field"><label>Dia do disparo</label><input type="number" id="ep-dia" value="${p.dia}">
        <small class="muted">Relativo ao início da cadência. Negativo = antes (ex.: -1 é a véspera da consulta).</small></div>
      <div class="field"><label>Horário do disparo</label>
        <input id="ep-hora" list="ep-horas" value="${esc(p.hora || '')}" placeholder="janela padrão">
        <datalist id="ep-horas">
          <option value="">janela padrão</option>
          <option value="08:00"></option><option value="09:30"></option><option value="12:00"></option>
          <option value="14:00"></option><option value="16:00"></option><option value="18:00"></option>
          <option value="agora+1h"></option><option value="agora+2h"></option><option value="agora+3h"></option>
          <option value="ref"></option><option value="ref-1h"></option><option value="ref-2h"></option>
        </datalist>
        <small class="muted">Vazio = início da janela comercial. Aceita hora fixa (16:00), "agora+2h" (relativo à aplicação) ou "ref-1h" (relativo ao horário da consulta).</small></div>
      <div class="field"><label>Canal</label><select id="ep-canal">${['WhatsApp', 'Ligação', 'E-mail'].map(c => `<option ${p.canal === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>Mensagem (variáveis automáticas: {{nome}}, {{atendente}}, {{empresa}}, {{caso}}, {{pergunta}}, {{dica}}, {{urgencia}}, {{beneficio}}, {{documentos}}, {{hora_consulta}}, {{data_consulta}})</label>
      <textarea id="ep-tpl" rows="8">${esc(p.template)}</textarea></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="Views.salvarPasso('${cadId}',${i})">Salvar</button>
    </div>`, { large: true });
};

Views.salvarPasso = (cadId, i) => {
  const cad = Cadence.get(cadId);
  const hora = (document.getElementById('ep-hora').value || '').trim();
  if (hora && !/^(\d{2}:\d{2}|agora\+\d+(h|m)|ref(-\d+h)?)$/.test(hora)) {
    UI.toast('Horário inválido. Use HH:MM (ex.: 16:00), "agora+2h" ou "ref-1h" — ou deixe vazio para a janela padrão.', 'err');
    return;
  }
  cad.passos[i].dia = parseInt(document.getElementById('ep-dia').value, 10) || 0;
  cad.passos[i].hora = hora || undefined;
  cad.passos[i].canal = document.getElementById('ep-canal').value;
  cad.passos[i].template = document.getElementById('ep-tpl').value;
  // protege a edição do escritório contra futuras atualizações de cadência padrão
  if (!Array.isArray(state.settings.cadenciasEditadas)) state.settings.cadenciasEditadas = [];
  if (!state.settings.cadenciasEditadas.includes(cadId)) state.settings.cadenciasEditadas.push(cadId);
  save();
  UI.fecharModal();
  UI.toast('Passo da cadência atualizado (vale para novas aplicações).');
  UI.refresh();
};

/* ---------- PLAYBOOK (editável — settings.playbook; null = padrão) ---------- */

const PLAYBOOK_PADRAO = {
  secoes: [
    {
      titulo: 'Os números que mudam o jogo',
      itens: [
        { titulo: '21x', texto: 'mais chance de qualificar um lead respondendo em até 5 minutos vs. 30 minutos. (Lead Response Management Study — InsideSales.com/MIT)' },
        { titulo: '80%', texto: 'das vendas exigem 5 ou mais follow-ups após o primeiro contato. (IRC Sales Solutions)' },
        { titulo: '44%', texto: 'dos vendedores desistem após apenas 1 follow-up. A persistência estruturada é uma vantagem competitiva gigante. (Scripted / IRC Sales Solutions)' },
        { titulo: '35-50%', texto: 'das vendas vão para o fornecedor que responde primeiro. (InsideSales.com)' },
        { titulo: '7x', texto: 'mais conversão falando com o lead na 1ª hora vs. depois dela. (Harvard Business Review — Lead Response Study)' }
      ]
    },
    {
      titulo: 'SPIN Selling — Neil Rackham',
      itens: [
        { titulo: 'Situação', texto: 'entender o contexto: "Como vocês fazem isso hoje?" (A maior pesquisa de vendas já feita — 35.000 visitas — mostra: alta performance pergunta antes de apresentar.)' },
        { titulo: 'Problema', texto: 'encontrar a dor: "O que mais te incomoda nisso?"' },
        { titulo: 'Implicação', texto: 'ampliar o custo da dor: "O que acontece se continuar assim?"' },
        { titulo: 'Necessidade', texto: 'o lead verbaliza o valor: "Isso resolveria seu problema?"' },
        { titulo: 'Regra de ouro', texto: 'quem pergunta, conduz. Preço só depois do diagnóstico.' }
      ]
    },
    {
      titulo: 'Chris Voss — Negociação do FBI',
      itens: [
        { titulo: 'Rotulação', texto: 'nomeie a emoção: "Parece que isso te preocupa bastante..." Desarma a resistência.' },
        { titulo: 'Perguntas calibradas', texto: '"Como...?" e "O que...?": "O que exatamente ainda não ficou claro pra você?" Fazem o lead resolver a objeção junto com você.' },
        { titulo: 'Pergunta orientada ao "não"', texto: '"Você desistiu de resolver isso?" reativa leads sumidos, porque dizer "não" dá sensação de controle.' },
        { titulo: 'Espelhamento', texto: 'repita as 2-3 últimas palavras do lead como pergunta. Ele elabora e revela mais.' }
      ]
    },
    {
      titulo: 'Cialdini — As Armas da Persuasão',
      itens: [
        { titulo: 'Prova social', texto: 'casos e resultados de clientes parecidos valem mais que qualquer promessa.' },
        { titulo: 'Reciprocidade', texto: 'entregue valor antes de pedir (conteúdo, dica, diagnóstico gratuito).' },
        { titulo: 'Escassez honesta', texto: 'condições e agenda com prazo real geram decisão. Nunca invente.' },
        { titulo: 'Autoridade', texto: 'mostre credenciais e especialização no momento certo.' },
        { titulo: 'Compromisso e coerência', texto: 'micro-compromissos ("faz sentido?") levam ao grande sim.' }
      ]
    },
    {
      titulo: 'Jeb Blount — Objeções e Prospecção Fanática',
      itens: [
        { titulo: 'Nunca aceite a 1ª objeção', texto: 'ela raramente é a real. Isole: "Além disso, algo mais te impede?"' },
        { titulo: 'Responda com pergunta', texto: 'não com defesa. Defensividade confirma a dúvida do lead.' },
        { titulo: 'Follow-up com valor', texto: 'cada contato deve entregar algo (novidade, caso, conteúdo), nunca só "e aí, pensou?"' },
        { titulo: 'Breakup message', texto: 'a mensagem de encerramento educada gera resposta por aversão à perda. Está no final de todas as cadências.' },
        { titulo: 'Fechamento passivo é veneno', texto: '"fico à disposição" transfere a iniciativa pro lead. Sempre termine com pergunta ou compromisso com data.' }
      ]
    },
    {
      titulo: 'Regras de ouro no WhatsApp',
      itens: [
        { titulo: 'Mensagens curtas', texto: 'até ~60 palavras + 1 pergunta por mensagem. Blocos gigantes não são lidos.' },
        { titulo: 'Use o nome do lead', texto: 'atenção e conexão imediatas (Dale Carnegie).' },
        { titulo: 'Termine com pergunta ou CTA', texto: 'mensagem sem pergunta = conversa morta.' },
        { titulo: 'Não metralhe', texto: 'máximo 2 mensagens seguidas sem resposta. Depois disso, é a cadência que trabalha.' },
        { titulo: 'Responda em minutos', texto: 'não em horas — é o fator isolado de maior impacto na conversão.' }
      ]
    }
  ]
};

/* playbook em uso (padrão ou personalizado) */
function pbDados() {
  const p = state.settings.playbook;
  return (p && Array.isArray(p.secoes)) ? p : PLAYBOOK_PADRAO;
}

/* garante uma cópia editável em settings.playbook antes de alterar */
function pbEditavel() {
  const p = state.settings.playbook;
  if (!p || !Array.isArray(p.secoes)) state.settings.playbook = JSON.parse(JSON.stringify(PLAYBOOK_PADRAO));
  return state.settings.playbook;
}

function pbPodeEditar() {
  return (typeof Cloud === 'undefined' || !Cloud.ativo()) ? true : Cloud.admin();
}

UI.registrar('playbook', () => {
  const pb = pbDados();
  const edit = pbPodeEditar();
  const custom = !!(state.settings.playbook && Array.isArray(state.settings.playbook.secoes));
  return `
  <p class="muted mb">O sistema aplica automaticamente estes princípios nas análises e cadências. Use esta página como treinamento rápido da equipe.${custom ? ' <span class="chip chip-blue">personalizado</span>' : ''}</p>

  <div class="grid grid-2">
    ${pb.secoes.map((sec, si) => `
    <div class="card pb-section">
      <div class="card-title">${ICO('book-open')} ${esc(sec.titulo)}
        ${edit ? `<span class="pb-acoes">
          <button class="btn btn-ghost btn-sm" title="Renomear seção" onclick="Views.pbEditarSecao(${si})">${ICO('pencil')}</button>
          <button class="btn btn-ghost btn-sm" title="Remover seção" onclick="Views.pbRemoverSecao(${si})">${ICO('trash-2')}</button>
        </span>` : ''}
      </div>
      ${(sec.itens || []).map((it, ii) => `
        <div class="finding">
          <div class="finding-ico">${ii + 1}</div>
          <div style="flex:1;min-width:0"><b>${esc(it.titulo)}</b>${it.texto ? ' — ' + esc(it.texto) : ''}</div>
          ${edit ? `<span class="pb-acoes">
            <button class="btn btn-ghost btn-sm" title="Editar item" onclick="Views.pbEditarItem(${si},${ii})">${ICO('pencil')}</button>
            <button class="btn btn-ghost btn-sm" title="Remover item" onclick="Views.pbRemoverItem(${si},${ii})">${ICO('trash-2')}</button>
          </span>` : ''}
        </div>`).join('')}
      ${edit ? `<button class="btn btn-ghost btn-sm" onclick="Views.pbEditarItem(${si},-1)">${ICO('plus')} Adicionar item</button>` : ''}
    </div>`).join('')}
  </div>

  ${edit ? `<div class="flex mt">
    <button class="btn" onclick="Views.pbEditarSecao(-1)">${ICO('plus')} Adicionar seção</button>
    ${custom ? `<button class="btn btn-ghost btn-sm" onclick="Views.pbRestaurar()">${ICO('undo-2')} Restaurar padrão</button>` : ''}
  </div>` : ''}`;
});

Views.pbEditarSecao = (si) => {
  const sec = si >= 0 ? pbDados().secoes[si] : null;
  UI.modal(`<h2>${sec ? 'Renomear seção' : 'Nova seção'} <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
    <div class="field"><label>Título da seção</label><input id="pb-sec-titulo" value="${sec ? esc(sec.titulo) : ''}" placeholder="Ex.: Técnicas de fechamento"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="Views.pbSalvarSecao(${si})">Salvar</button>
    </div>`);
};

Views.pbSalvarSecao = (si) => {
  const titulo = document.getElementById('pb-sec-titulo').value.trim();
  if (!titulo) { UI.toast('Informe o título da seção', 'err'); return; }
  const pb = pbEditavel();
  if (si >= 0 && pb.secoes[si]) pb.secoes[si].titulo = titulo;
  else pb.secoes.push({ titulo, itens: [] });
  save();
  UI.fecharModal();
  UI.toast('Playbook atualizado.');
  UI.refresh();
};

Views.pbRemoverSecao = (si) => {
  const sec = pbDados().secoes[si];
  if (!sec) return;
  if (!confirm(`Remover a seção "${sec.titulo}" com ${(sec.itens || []).length} item(ns)?`)) return;
  pbEditavel().secoes.splice(si, 1);
  save();
  UI.toast('Seção removida.');
  UI.refresh();
};

Views.pbEditarItem = (si, ii) => {
  const sec = pbDados().secoes[si];
  if (!sec) return;
  const it = ii >= 0 ? sec.itens[ii] : null;
  UI.modal(`<h2>${it ? 'Editar item' : 'Novo item'} <span class="hint">${esc(sec.titulo)}</span> <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
    <div class="field"><label>Título (destaque)</label><input id="pb-it-titulo" value="${it ? esc(it.titulo) : ''}" placeholder="Ex.: Prova social"></div>
    <div class="field"><label>Texto</label><textarea id="pb-it-texto" rows="4" placeholder="Explicação curta do princípio ou técnica">${it ? esc(it.texto) : ''}</textarea></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="Views.pbSalvarItem(${si},${ii})">Salvar</button>
    </div>`);
};

Views.pbSalvarItem = (si, ii) => {
  const titulo = document.getElementById('pb-it-titulo').value.trim();
  const texto = document.getElementById('pb-it-texto').value.trim();
  if (!titulo) { UI.toast('Informe o título do item', 'err'); return; }
  const pb = pbEditavel();
  const sec = pb.secoes[si];
  if (!sec) return;
  if (ii >= 0 && sec.itens[ii]) { sec.itens[ii].titulo = titulo; sec.itens[ii].texto = texto; }
  else sec.itens.push({ titulo, texto });
  save();
  UI.fecharModal();
  UI.toast('Playbook atualizado.');
  UI.refresh();
};

Views.pbRemoverItem = (si, ii) => {
  const sec = pbDados().secoes[si];
  if (!sec || !sec.itens[ii]) return;
  if (!confirm(`Remover o item "${sec.itens[ii].titulo}"?`)) return;
  pbEditavel().secoes[si].itens.splice(ii, 1);
  save();
  UI.toast('Item removido.');
  UI.refresh();
};

Views.pbRestaurar = () => {
  if (!confirm('Descartar as edições da equipe e voltar ao playbook padrão do sistema?')) return;
  state.settings.playbook = null;
  save();
  UI.toast('Playbook padrão restaurado.');
  UI.refresh();
};

/* ---------- CONFIGURAÇÕES ---------- */

UI.registrar('config', () => {
  const s = state.settings;
  const nuvem = typeof Cloud !== 'undefined' && Cloud.ativo();
  /* quem não é admin (dono, 05/10/2026): vê o motor, a equipe (quem está online),
     o próprio perfil só para leitura e a aparência. Metas, investimento, automações
     do CRM, contexto e IA do escritório, dados/backup e "Sobre" são só do admin.
     Fora da nuvem (uso local) continua tudo visível. */
  const gestor = !nuvem || Cloud.admin();
  if (nuvem) setTimeout(Views.renderEquipe, 50);
  if (nuvem && Cloud.atendimentoAtivo()) setTimeout(Views.renderMotor, 50);
  return `
  <div class="grid grid-2">
    ${nuvem && Cloud.atendimentoAtivo() ? `<div class="card">
      <div class="card-title">${ICO('radio-tower')} Motor WhatsApp <span class="hint">conexão do Atendimento</span></div>
      <div id="motor-painel"><span class="muted">${UI.carregando('Consultando o motor')}</span></div>
    </div>` : ''}
    ${nuvem ? `<div class="card">
      <div class="card-title">${ICO('users')} Equipe <span class="hint">${Cloud.admin() ? 'quem está online e os horários de acesso de hoje' : 'quem está online agora'}</span></div>
      <div id="equipe-lista"><span class="muted">${UI.carregando('Carregando equipe')}</span></div>
      ${Cloud.admin() ? `<div class="divider"></div>
      <p class="muted" style="font-size:.78rem;line-height:1.5"><b>Para adicionar alguém, mudar o nome ou as alçadas:</b> abra <a href="#/usuarios">Início → Usuários e alçadas</a>. O acesso é criado sozinho e a pessoa aparece aqui em até 1 minuto.</p>` : ''}
    </div>` : ''}
    ${gestor ? `<div class="card">
      <div class="card-title">${ICO('user')} Seu perfil <span class="hint">usado nas mensagens automáticas</span></div>
      <div class="field"><label>Seu nome (atendente)</label><input id="cf-nome" value="${esc(s.nomeAtendente)}" placeholder="Ex.: Maria"></div>
      <div class="field"><label>Nome da empresa</label><input id="cf-empresa" value="${esc(s.empresa)}" placeholder="Ex.: ${ESCRITORIO.nome}"></div>
      <button class="btn btn-primary" onclick="Views.salvarPerfil()">Salvar perfil</button>
    </div>` : `<div class="card">
      <div class="card-title">${ICO('user')} Seu perfil <span class="hint">só o administrador altera</span></div>
      <div class="field"><label>Seu nome</label><input value="${esc((Cloud.perfil() || {}).nome || s.nomeAtendente)}" disabled></div>
      <div class="field"><label>Nome da empresa</label><input value="${esc(s.empresa)}" disabled></div>
      <p class="muted" style="font-size:.78rem;line-height:1.5">Precisa mudar o nome? Peça a um administrador — ele altera em Usuários e alçadas.</p>
    </div>`}

    ${gestor ? `<div class="card">
      <div class="card-title">${ICO('clock')} Sessão <span class="hint">vale para todo o time</span></div>
      <p class="muted mb" style="font-size:.78rem;line-height:1.5">Quem fecha o computador sem clicar em <b>Sair</b> não continua conectado no dia seguinte: a sessão encerra sozinha depois de um tempo sem uso real — mouse, teclado ou rolagem. Mensagens chegando não contam.</p>
      <div class="field"><label>Encerrar a sessão após (horas sem uso) — 0 desliga</label>
        <input id="cf-inatividade" type="number" min="0" max="24" step="0.5" value="${normHorasInatividade(s.inatividadeHoras)}"></div>
      <button class="btn btn-primary" onclick="Views.salvarSessao()">Salvar</button>
    </div>

    <div class="card">
      <div class="card-title">${ICO('target')} Metas do mês <span class="hint">acompanhadas no dashboard</span></div>
      <div class="form-row-3">
        <div class="field"><label>Leads novos</label><input id="cf-meta-leads" type="number" min="0" value="${Number(s.metaLeads) || ''}" placeholder="Ex.: 60"></div>
        <div class="field"><label>Contratos</label><input id="cf-meta-contratos" type="number" min="0" value="${Number(s.metaContratos) || ''}" placeholder="Ex.: 10"></div>
        <div class="field"><label>Receita (R$)</label><input id="cf-meta-receita" value="${Number(s.metaReceita) || ''}" placeholder="Ex.: 30000"></div>
      </div>
      <button class="btn btn-primary" onclick="Views.salvarMetas()">Salvar metas</button>
    </div>

    <div class="card">
      <div class="card-title">${ICO('banknote')} Investimento em marketing por mês <span class="hint">habilita CPL e CAC</span></div>
      <div class="field"><label>Padrão mensal (R$) — usado nos meses sem registro específico</label>
        <input id="cf-invest" value="${s.investimentoMkt || ''}" placeholder="Ex.: 3000" onchange="Views.invSalvarPadrao(this.value)"></div>
      <div class="form-row-3" style="align-items:end">
        <div class="field"><label>Mês</label><input id="cf-inv-mes" type="month" value="${todayISO().slice(0, 7)}"></div>
        <div class="field"><label>Valor (R$)</label><input id="cf-inv-valor" placeholder="Ex.: 3500"></div>
        <div class="field"><button class="btn btn-primary" style="width:100%" onclick="Views.invRegistrar()">Registrar mês</button></div>
      </div>
      ${(() => {
        const meses = Object.keys(s.investimentoPorMes || {}).filter(m => /^\d{4}-\d{2}$/.test(m)).sort().reverse().slice(0, 6);
        if (!meses.length) return '<p class="muted" style="font-size:.78rem">Nenhum mês registrado ainda — o padrão mensal acima vale para todos.</p>';
        return meses.map(m => `
        <div class="cfg-inv-row">
          <b>${esc(m.split('-').reverse().join('/'))}</b>
          <span class="cfg-inv-valor">${fmtMoney(s.investimentoPorMes[m])}</span>
          <button class="btn btn-ghost btn-sm" title="Editar" onclick="Views.invEditar('${m}')">${ICO('pencil')}</button>
          <button class="btn btn-ghost btn-sm" title="Remover" onclick="Views.invRemover('${m}')">${ICO('trash-2')}</button>
        </div>`).join('');
      })()}
    </div>

    <div class="card">
      <div class="card-title">${ICO('zap')} Automações do CRM <span class="hint">valem para todo o escritório</span></div>
      <label class="cfg-switch"><input type="checkbox" id="cf-auto-lead" ${s.autoCriarLead !== false ? 'checked' : ''}><span class="cfg-track"></span>
        <span class="cfg-rotulo">Conversa nova no WhatsApp vira lead automaticamente</span></label>
      <label class="cfg-switch"><input type="checkbox" id="cf-auto-analise" ${s.analiseAutomatica !== false ? 'checked' : ''}><span class="cfg-track"></span>
        <span class="cfg-rotulo">Analisar conversa ao marcar como resolvida</span></label>
      <div class="form-row" style="margin-top:10px">
        <div class="field"><label>Janela de envio automático (HH:MM-HH:MM)</label>
          <input id="cf-janela" value="${esc(s.janelaEnvio || '09:00-18:00')}" placeholder="09:00-18:00"></div>
        <div class="field"><label>Lead quente esfriando após (horas sem resposta)</label>
          <input id="cf-esfriando" type="number" min="1" value="${Number(s.esfriandoHoras) || 6}"></div>
      </div>
      <button class="btn btn-primary" onclick="Views.salvarAutomacoes()">Salvar automações</button>
    </div>

    <div class="card">
      <div class="card-title">${ICO('building-2')} Contexto do escritório para a IA <span class="hint">melhora análises e mensagens</span></div>
      <p class="muted mb" style="font-size:.78rem">A IA usa estas informações ao analisar conversas, resumir atendimentos e sugerir respostas — sem inventar nada além do que você escrever aqui.</p>
      <div class="field"><label>Áreas de atuação</label>
        <textarea id="cf-ctx-areas" rows="2" placeholder="Ex.: Direito trabalhista, previdenciário e bancário">${esc((s.contextoIA && s.contextoIA.areas) || '')}</textarea></div>
      <div class="field"><label>Diferenciais do escritório</label>
        <textarea id="cf-ctx-dif" rows="2" placeholder="Ex.: 15 anos de experiência, atendimento 100% digital, nota 4,9 no Google">${esc((s.contextoIA && s.contextoIA.diferenciais) || '')}</textarea></div>
      <div class="field"><label>Honorários (faixa ou política)</label>
        <textarea id="cf-ctx-hon" rows="2" placeholder="Ex.: consulta a partir de R$ 300; êxito de 20-30% conforme o caso; parcelamento em até 6x">${esc((s.contextoIA && s.contextoIA.honorarios) || '')}</textarea></div>
      <button class="btn btn-primary" onclick="Views.salvarContextoIA()">Salvar contexto</button>
    </div>

    ${nuvem ? `<div class="card" id="card-ia-escritorio">
      <div class="card-title">${ICO('bot')} IA do escritório <span class="hint">uma chave para todo o time, no motor</span></div>
      <p class="muted mb">Resumo, busca na conversa, análise profunda e gerador de automações usam a chave da Anthropic guardada no servidor do motor. Quem tem a alçada de IA usa; ninguém precisa configurar nada no navegador.</p>
      <div id="ia-status" class="mb"><span class="muted">${UI.carregando('Consultando o motor')}</span></div>
      <div class="field"><label>Modelo (vale para todos)</label>
        <select id="cf-modelo-ia" onchange="Views.salvarModeloIA()">${AI.MODELOS.map(m => `<option value="${m.id}" ${s.modeloIA === m.id ? 'selected' : ''}>${m.label}</option>`).join('')}</select></div>
      <button class="btn btn-ghost" onclick="Views.testarIA()" id="btn-testar">Testar</button>
    </div>` : ''}` : ''}

    <div class="card">
      <div class="card-title">${ICO('moon')} Aparência <span class="hint">só neste navegador</span></div>
      <div class="seg" role="radiogroup" aria-label="Tema">
        ${[['claro', 'Claro'], ['escuro', 'Escuro'], ['auto', 'Seguir o sistema']].map(([v, r]) =>
          `<button class="${UI.tema.preferencia() === v ? 'on' : ''}" role="radio" aria-checked="${UI.tema.preferencia() === v}" onclick="UI.tema.definir('${v}');UI.refresh()">${r}</button>`).join('')}
      </div>
      <p class="muted" style="margin-top:8px">O modo noturno vale para o sistema inteiro — Início, Chat e CRM. A chave rápida fica no rodapé da barra lateral.</p>
    </div>

    ${gestor ? `<div class="card">
      <div class="card-title">${ICO('hard-drive')} Dados e backup</div>
      ${nuvem
        ? `<p class="muted mb">Os dados do escritório vivem no banco da nuvem (com backup diário do Supabase). Neste navegador fica só a sua preferência de tela.</p>`
        : `<p class="muted mb">Seus dados vivem no armazenamento local deste navegador. Faça backup periodicamente — especialmente antes de limpar o navegador ou trocar de máquina.</p>`}
      ${/* backup completo e restauração: só o admin (o arquivo leva conversas e perfis do time) */ ''}
      ${!nuvem || Cloud.admin() ? `<div class="flex">
        <button class="btn" onclick="CSV.exportarBackup()">${ICO('download')} Baixar backup completo (.json)</button>
        <button class="btn btn-ghost" onclick="document.getElementById('cf-restore').click()">${ICO('upload')} Restaurar backup</button>
        <input type="file" id="cf-restore" accept=".json" style="display:none" onchange="Views.restaurarBackup(this)">
      </div>
      <div class="divider"></div>` : ''}
      <div class="flex">
        <button class="btn" onclick="CSV.exportarLeads()">${ICO('download')} Exportar leads (.csv)</button>
        <button class="btn btn-ghost" onclick="Views.reprocessarTags()" title="Preenche origem, área do caso e perfil dos leads existentes a partir das tags importadas">${ICO('tag')} Reprocessar tags dos leads</button>
        ${typeof Cloud !== 'undefined' && Cloud.ativo() ? '' : `<button class="btn btn-ghost" onclick="Views.carregarExemplo()">${ICO('sparkles')} Carregar dados de exemplo</button>`}
      </div>
      <div class="divider"></div>
      ${nuvem
        ? `<button class="btn btn-ghost" onclick="Views.limparCacheLocal()" title="Apaga só o que este navegador guardou; os dados do escritório continuam no banco">${ICO('refresh-cw')} Limpar cache deste navegador</button>`
        : `<button class="btn btn-danger" onclick="Views.zerarTudo()">${ICO('trash-2')} Apagar todos os dados</button>`}
    </div>

    <div class="card">
      <div class="card-title">${ICO('info')} Sobre o sistema</div>
      <p class="muted" style="line-height:1.6">Plataforma de análise de atendimentos comerciais e gestão de follow-ups.<br><br>
      <b>Análises</b> baseadas em: SPIN Selling (Neil Rackham), Never Split the Difference (Chris Voss), As Armas da Persuasão (Cialdini), Prospecção Fanática e Objections (Jeb Blount), The Challenger Sale, Receita Previsível (Aaron Ross) e estudos de speed-to-lead (InsideSales/MIT, HBR).<br><br>
      Os dados ficam no banco do escritório (Supabase), protegidos por login e por regras de acesso por usuário e departamento. No modo local (sem login), o que você vê fica apenas neste navegador.</p>
    </div>` : ''}
  </div>`;
});

Views.salvarPerfil = async () => {
  state.settings.nomeAtendente = document.getElementById('cf-nome').value.trim();
  state.settings.empresa = document.getElementById('cf-empresa').value.trim();
  save();
  if (typeof Cloud !== 'undefined' && Cloud.ativo()) {
    try { await Cloud.salvarMeuNome(state.settings.nomeAtendente); } catch (e) { console.warn(e); }
  }
  UI.toast('Perfil salvo.');
  UI.atualizarBadges();
};

/* ---------- metas do mês ---------- */
Views.salvarMetas = () => {
  state.settings.metaLeads = Math.max(0, parseInt(document.getElementById('cf-meta-leads').value) || 0);
  state.settings.metaContratos = Math.max(0, parseInt(document.getElementById('cf-meta-contratos').value) || 0);
  state.settings.metaReceita = parseMoney(document.getElementById('cf-meta-receita').value);
  save();
  UI.toast('Metas salvas.');
};

/* ---------- investimento em marketing por mês ---------- */
Views.invSalvarPadrao = (v) => {
  state.settings.investimentoMkt = parseMoney(v);
  save();
  UI.toast('Investimento padrão salvo.');
};

Views.invRegistrar = () => {
  const mes = (document.getElementById('cf-inv-mes').value || '').trim();
  const valor = parseMoney(document.getElementById('cf-inv-valor').value);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) { UI.toast('Informe o mês no formato AAAA-MM (ex.: 2026-08).', 'err'); return; }
  if (!valor) { UI.toast('Informe o valor investido no mês.', 'err'); return; }
  if (!state.settings.investimentoPorMes) state.settings.investimentoPorMes = {};
  state.settings.investimentoPorMes[mes] = valor;
  save();
  UI.toast(`Investimento de ${mes.split('-').reverse().join('/')} registrado.`);
  UI.refresh();
};

Views.invEditar = (mes) => {
  const elM = document.getElementById('cf-inv-mes');
  const elV = document.getElementById('cf-inv-valor');
  if (elM) elM.value = mes;
  if (elV) { elV.value = (state.settings.investimentoPorMes || {})[mes] || ''; elV.focus(); }
};

Views.invRemover = (mes) => {
  if (!confirm(`Remover o investimento registrado de ${mes.split('-').reverse().join('/')}? O padrão mensal passa a valer para esse mês.`)) return;
  delete (state.settings.investimentoPorMes || {})[mes];
  save();
  UI.toast('Registro removido.');
  UI.refresh();
};

/* ---------- automações do CRM ---------- */
/* sessão parada encerra sozinha: horas sem uso (config.geral, só o admin grava) */
Views.salvarSessao = () => {
  const v = document.getElementById('cf-inatividade').value.trim();
  state.settings.inatividadeHoras = normHorasInatividade(v === '' ? 6 : v);
  save();
  const h = state.settings.inatividadeHoras;
  UI.toast(h ? `A sessão passa a encerrar após ${fmtHorasInatividade(h)} sem uso. Vale para todo o time: nas telas já abertas em alguns minutos e no próximo login.` : 'Encerramento automático desligado.');
};

Views.salvarAutomacoes = () => {
  const jan = document.getElementById('cf-janela').value.trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(jan)) {
    UI.toast('Janela de envio inválida — use o formato HH:MM-HH:MM, ex.: 09:00-18:00', 'err');
    return;
  }
  state.settings.autoCriarLead = document.getElementById('cf-auto-lead').checked;
  state.settings.analiseAutomatica = document.getElementById('cf-auto-analise').checked;
  state.settings.janelaEnvio = jan;
  state.settings.esfriandoHoras = Math.max(1, parseInt(document.getElementById('cf-esfriando').value) || 6);
  save();
  UI.toast('Automações salvas.');
};

/* ---------- contexto do escritório para a IA ---------- */
Views.salvarContextoIA = () => {
  state.settings.contextoIA = {
    areas: document.getElementById('cf-ctx-areas').value.trim(),
    diferenciais: document.getElementById('cf-ctx-dif').value.trim(),
    honorarios: document.getElementById('cf-ctx-hon').value.trim()
  };
  save();
  UI.toast('Contexto salvo — a IA passa a usá-lo nas próximas análises.');
};

/* lista e gerencia a equipe (modo nuvem) */
/* Equipe com presença (chat-v16a): todo o time vê quem está online; o admin vê
   também o último acesso e os períodos de hoje (entrada–saída, juntando abas).
   Redesenha a cada minuto enquanto o card estiver na tela. */
let _equipeTimer = null;
Views.renderEquipe = async () => {
  clearTimeout(_equipeTimer);
  const el = document.getElementById('equipe-lista');
  if (!el || typeof Cloud === 'undefined' || !Cloud.ativo()) return;
  try {
    const admin = Cloud.admin();
    const [perfis, presenca, acessos] = await Promise.all([
      Cloud.listarPerfis(),
      Cloud.equipePresenca().catch(() => null),
      admin ? Cloud.acessosDeHoje().catch(() => null) : null
    ]);
    const eu = Cloud.perfil();
    const agora = Date.now();
    const inicioHoje = new Date(); inicioHoje.setHours(0, 0, 0, 0);
    const visto = {};
    (presenca || []).forEach(r => { visto[r.perfil_id] = r.visto_em; });
    const porPessoa = {};
    (acessos || []).forEach(a => { (porPessoa[a.perfil_id] = porPessoa[a.perfil_id] || []).push(a); });
    const online = p => presencaOnline(visto[p.id], agora);
    // quem não é admin não precisa ver quem ainda aguarda liberação
    const lista = perfis.filter(p => p.ativo || admin)
      .sort((a, b) => (online(b) - online(a)) || (a.nome || '').localeCompare(b.nome || ''));
    const nOnline = lista.filter(online).length;
    const resumo = presenca === null
      ? (admin ? `<p class="muted eq-resumo">${ICO('info')} Presença disponível depois da migração <code>chat-v16a.sql</code>.</p>` : '')
      : `<p class="muted eq-resumo"><b>${nOnline}</b> online de ${lista.length}</p>`;
    el.innerHTML = resumo + lista.map(p => {
      const on = online(p);
      const periodos = admin ? periodosDeAcesso(porPessoa[p.id], agora, inicioHoje.getTime()) : [];
      const situacao = on ? 'Online agora' : (admin ? 'Último acesso: ' + rotuloUltimoAcesso(visto[p.id], agora) : 'Offline');
      return `
      <div class="eq-item">
        <span class="eq-dot ${on ? 'on' : ''}" title="${on ? 'Online' : 'Offline'}"></span>
        <div class="eq-info">
          <div class="eq-nome"><b>${esc(p.nome || '—')}</b> ${p.id === eu.id ? '<span class="chip chip-blue">você</span>' : ''}
            <span class="chip ${p.papel === 'admin' ? 'chip-purple' : 'chip-gray'}">${p.papel === 'admin' ? `${ICO('crown')} admin` : 'atendente'}</span>
            ${p.ativo ? '' : '<span class="chip chip-red">aguardando liberação</span>'}</div>
          <div class="eq-meta ${on ? 'on' : ''}">${esc(situacao)}</div>
          ${admin && periodos.length ? `<div class="eq-meta">Hoje: ${esc(periodos.join(' · '))}</div>` : ''}
          ${admin ? `<div class="eq-email">${esc(p.email || '')}</div>` : ''}
          ${admin && p.id !== eu.id ? `<div class="flex eq-acoes">
            <button class="btn btn-sm ${p.ativo ? 'btn-ghost' : 'btn-success'}" onclick="Views.equipeAtivo('${p.id}',${!p.ativo})">${p.ativo ? 'Desativar' : `${ICO('check')} Ativar`}</button>
            <button class="btn btn-ghost btn-sm" onclick="Views.equipePapel('${p.id}','${p.papel === 'admin' ? 'atendente' : 'admin'}')">${p.papel === 'admin' ? 'Tornar atendente' : 'Tornar admin'}</button>
          </div>` : ''}
        </div>
      </div>`;
    }).join('') || '<span class="muted">Só você por enquanto. Adicione o time em Usuários e alçadas.</span>';
  } catch (e) {
    el.innerHTML = '<span class="muted">Não consegui carregar a equipe: ' + esc(e.message) + '</span>';
  }
  if (document.getElementById('equipe-lista')) _equipeTimer = setTimeout(Views.renderEquipe, 60000);
};

Views.equipeAtivo = async (id, ativo) => {
  if (!Cloud.admin()) return;
  if (id === Cloud.perfil().id && !ativo) { UI.toast('Você não pode desativar o seu próprio acesso.', 'err'); return; }
  try {
    await Cloud.atualizarPerfilAdmin(id, { ativo });
    UI.toast(ativo ? 'Acesso liberado.' : 'Acesso desativado.');
  } catch (e) { UI.toast('Erro: ' + e.message, 'err'); }
  Views.renderEquipe();
};

/* painel do Motor WhatsApp (status + QR), atualiza sozinho enquanto a tela está aberta.
   O QR do pareamento é só do admin: com ele, qualquer pessoa ligaria o WhatsApp
   do escritório ao próprio celular. Um único temporizador (cada redesenho da
   tela criava mais uma repetição a cada 5 s). */
let _motorTimer = null;
Views.renderMotor = async () => {
  clearTimeout(_motorTimer);
  const el = document.getElementById('motor-painel');
  if (!el || typeof Cloud === 'undefined' || !Cloud.ativo()) return;
  try {
    const rows = await Cloud.motorEstado();
    const m = rows && rows[0];
    statusIA(m);
    if (!m) {
      el.innerHTML = '<p class="muted">O Motor ainda não se conectou ao banco. Assim que estiver rodando no Railway, o status aparece aqui.</p>';
    } else {
      const mapa = {
        conectado: ['chip-green', ICO('circle') + ' Conectado' + (m.numero ? ' · ' + esc(m.numero) : '')],
        aguardando_qr: ['chip-amber', ICO('qr-code') + ' Aguardando leitura do QR Code'],
        desconectado: ['chip-red', ICO('circle') + ' Desconectado'],
        erro: ['chip-red', ICO('alert-triangle') + ' Erro']
      };
      const [cls, rot] = mapa[m.situacao] || mapa.desconectado;
      let qr = '';
      if (m.situacao === 'aguardando_qr' && Cloud.admin()) {
        const img = await Cloud.motorQr().catch(() => '');
        qr = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(img || '') ? img : '';
      }
      el.innerHTML = `
        <div class="flex mb"><span class="chip ${cls}">${rot}</span>
          <span class="muted" style="font-size:.72rem">${esc(fmtDateTime(m.atualizado_em))}</span></div>
        ${m.detalhe ? `<p class="muted" style="font-size:.8rem">${esc(m.detalhe)}</p>` : ''}
        ${qr ? `
          <div style="text-align:center;margin-top:10px">
            <img src="${qr}" alt="QR Code" style="width:240px;max-width:100%;border-radius:12px;background:#fff;padding:8px">
            <p class="muted" style="font-size:.78rem;margin-top:8px">No celular do escritório: WhatsApp → Configurações →<br>Aparelhos conectados → Conectar aparelho → escaneie acima</p>
          </div>` : ''}
        ${m.situacao === 'aguardando_qr' && !Cloud.admin() ? '<p class="muted" style="font-size:.8rem">O WhatsApp do escritório precisa ser reconectado. Avise um administrador.</p>' : ''}
        ${m.situacao === 'conectado' ? '<p class="muted" style="font-size:.8rem">Mensagens dos clientes entram na aba Atendimento em tempo real, e a fila de envio/agendadas dispara automaticamente.</p>' : ''}`;
    }
  } catch (e) {
    el.innerHTML = '<p class="muted">Não consegui consultar o motor: ' + esc(e.message) + '</p>';
    statusIA(null);
  }
  // atualiza a cada 5s enquanto o painel existir na tela
  if (document.getElementById('motor-painel')) _motorTimer = setTimeout(Views.renderMotor, 5000);
};

Views.equipePapel = async (id, papel) => {
  if (!Cloud.admin()) return;
  if (id === Cloud.perfil().id && papel !== 'admin') { UI.toast('Você não pode remover o seu próprio acesso de administrador.', 'err'); return; }
  try {
    await Cloud.atualizarPerfilAdmin(id, { papel });
    UI.toast('Papel atualizado.');
  } catch (e) { UI.toast('Erro: ' + e.message, 'err'); }
  Views.renderEquipe();
};

/* preenche origem/área/perfil dos leads existentes a partir das tags (só campos vazios) */
Views.reprocessarTags = () => {
  let n = 0;
  state.leads.forEach(l => {
    const der = derivarDosTags(l.tags || []);
    let mudou = false;
    if (!l.origem && der.origem) { l.origem = der.origem; mudou = true; }
    if (!l.area && der.area) { l.area = der.area; mudou = true; }
    if (!l.perfil && der.perfil) { l.perfil = der.perfil; mudou = true; }
    if (mudou) n++;
  });
  save();
  UI.toast(n ? `${n} lead(s) enriquecido(s) com origem/área/perfil das tags.` : 'Nenhum lead para enriquecer — tudo já preenchido.');
  UI.refresh();
};

/* ---------- IA do escritório (a chave fica no motor; aqui só o modelo e o teste) ---------- */
const rotuloModeloIA = id => (AI.MODELOS.find(x => x.id === id) || {}).label || id || '';

Views.salvarModeloIA = () => {
  const sel = document.getElementById('cf-modelo-ia');
  if (!sel) return;
  state.settings.modeloIA = sel.value;
  save();
  UI.toast('Modelo da IA do escritório salvo para todo o time.');
};

Views.testarIA = async () => {
  const btn = document.getElementById('btn-testar');
  UI.ocupado(btn, 'Testando');
  try {
    const r = await AI.testar();
    const mod = rotuloModeloIA(r.modelo);
    UI.toast('IA do escritório respondendo' + (mod ? ' com ' + mod : '') + '.');
  } catch (e) {
    UI.toast(e.message, 'err');
  }
  UI.livre(btn);
};

/* status da IA: `recursos.ia` vem do motor (motor_estado, gravado quando a conexão muda); o MODELO
   vem da escolha do admin (state.settings.modeloIA), que o motor lê na hora de cada pedido — o valor
   gravado em recursos.modelo pode ficar velho por horas e mentiria logo após uma troca. */
function statusIA(m) {
  const el = document.getElementById('ia-status');
  if (!el) return;
  if (!m) { el.innerHTML = '<span class="chip chip-gray">Motor sem resposta</span>'; return; }
  const r = m.recursos || {};
  if (r.ia === true) {
    const mod = rotuloModeloIA(state.settings.modeloIA);
    el.innerHTML = `<span class="chip chip-green">${ICO('circle-check')} Ativa${mod ? ' · ' + esc(mod) : ''}</span>`;
  } else if (r.ia === false) {
    el.innerHTML = `<span class="chip chip-red">${ICO('alert-triangle')} Não configurada: defina ANTHROPIC_API_KEY no Railway</span>`;
  } else {
    // sem a chave `ia` em recursos: motor anterior à IA do escritório (ou coluna recém-criada, ainda vazia)
    el.innerHTML = '<span class="chip chip-gray">Motor ainda sem a atualização da IA</span>';
  }
}

Views.restaurarBackup = (input) => {
  const file = input.files[0];
  if (!file) return;
  const nuvem = typeof Cloud !== 'undefined' && Cloud.ativo();
  if (nuvem && !Cloud.admin()) { UI.toast('Só o administrador restaura backup.', 'err'); input.value = ''; return; }
  const aviso = nuvem
    ? 'Os dados deste backup serão ADICIONADOS à base da equipe na nuvem (sem apagar nada). Continuar?'
    : 'Restaurar este backup vai SUBSTITUIR todos os dados atuais. Continuar?';
  if (!confirm(aviso)) { input.value = ''; return; }
  if (nuvem) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const dados = JSON.parse(reader.result);
        const n = Cloud.importarDados(dados);
        UI.toast(`Backup mesclado: ${n} lead(s) novo(s) enviados para a nuvem.`);
        location.hash = '#/dashboard';
        UI.refresh();
      } catch (e) { UI.toast('Arquivo de backup inválido', 'err'); }
    };
    reader.readAsText(file);
    return;
  }
  CSV.importarBackup(file, (err) => {
    if (err) { UI.toast('Arquivo de backup inválido', 'err'); return; }
    UI.toast('Backup restaurado.');
    location.hash = '#/dashboard';
    UI.refresh();
  });
};

/* modo nuvem: limpa só o que ficou neste navegador e recarrega do banco */
Views.limparCacheLocal = () => {
  if (!confirm('Limpar o cache deste navegador e recarregar os dados do banco?\n\nNada do escritório é apagado.')) return;
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  location.reload();
};

Views.zerarTudo = () => {
  // na nuvem isto zerava o estado e o sync seguinte APAGAVA a base do escritório
  if (typeof Cloud !== 'undefined' && Cloud.ativo()) { Views.limparCacheLocal(); return; }
  if (!confirm('Apagar TODOS os leads, análises e follow-ups? Essa ação não pode ser desfeita.')) return;
  if (!confirm('Tem certeza absoluta? Considere baixar um backup antes.')) return;
  const settings = state.settings;
  state = defaultState();
  state.settings = settings; // preserva perfil e chave
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  UI.toast('Dados apagados.');
  location.hash = '#/dashboard';
  UI.refresh();
};
