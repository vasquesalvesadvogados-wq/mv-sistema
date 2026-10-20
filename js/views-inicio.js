/* ============ VIEW: INÍCIO — hub do sistema ============
   Área central reservada para os widgets (a definir em conjunto);
   a barra lateral dá acesso às plataformas (Chat, CRM)
   e, para o administrador, a Usuários e alçadas (#/usuarios). */

/* resumo da equipe no card do admin: o Início redesenha a cada pulso do sync,
   então a lista de perfis é guardada por 1 minuto em vez de ir ao banco toda vez */
let _hubEquipe = { em: 0, perfis: null };
async function hubResumoEquipe() {
  const el = document.getElementById('hub-equipe');
  if (!el) return;
  try {
    if (!_hubEquipe.perfis || Date.now() - _hubEquipe.em > 60000) {
      _hubEquipe = { em: Date.now(), perfis: await Cloud.listarPerfis() };
    }
  } catch (e) { el.textContent = 'Não foi possível carregar a equipe agora.'; return; }
  const perfis = _hubEquipe.perfis || [];
  const ativos = perfis.filter(p => p.ativo).length;
  const aguardando = perfis.length - ativos;
  const depts = (state.departamentos || []).length;
  // quem está online agora (chat-v16a; sem a migração a RPC devolve null)
  let online = null;
  if (Cloud.equipePresenca) {
    try {
      const pres = await Cloud.equipePresenca();
      if (pres) { const agora = Date.now(); online = pres.filter(r => presencaOnline(r.visto_em, agora)).length; }
    } catch (e) {}
  }
  el.innerHTML = `${ativos} usuário(s) ativo(s)` + (online != null ? ` · <b>${online} online</b>` : '') + ` · ${depts} departamento(s)` +
    (aguardando ? ` · <b style="color:var(--warning-600)">${aguardando} aguardando liberação</b>` : '');
}

UI.registrar('inicio', () => {
  const nome = primeiroNome(state.settings.nomeAtendente) || 'time ' + ESCRITORIO.curto;
  const h = new Date().getHours();
  const sauda = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const dataExt = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  const souAdminNuvem = typeof Cloud !== 'undefined' && Cloud.ativo() && Cloud.admin();
  if (souAdminNuvem) setTimeout(hubResumoEquipe, 50);
  const cardEquipe = !souAdminNuvem ? '' : `
    <div class="card">
      <div class="flex" style="align-items:center;margin-bottom:12px">
        <h3 style="font-size:1.02rem">${ICO('users')} Equipe</h3>
        <a href="#/usuarios" class="btn btn-ghost btn-sm" style="margin-left:auto">Usuários e alçadas</a>
      </div>
      <p class="muted" id="hub-equipe" style="line-height:1.6">${UI.carregando('Carregando equipe')}</p>
    </div>`;

  return `<div class="hub">
    <div class="hub-saudacao">
      <h2>${sauda}, ${esc(nome)}</h2>
      <div class="muted" style="text-transform:capitalize">${esc(dataExt)}</div>
    </div>

    ${cardEquipe}

    <div class="card hub-vazio">
      <div class="empty">
        <div class="big">${ICO('puzzle')}</div>
        <h3>Área central do Início</h3>
        <p>Este espaço está reservado para os widgets que vamos definir juntos — algumas ideias:
        agenda do dia, conversas aguardando resposta, follow-ups de hoje, metas do mês,
        últimos leads que chegaram, ou avisos internos do escritório.</p>
        <p class="muted">Acesse as plataformas pela barra lateral</p>
      </div>
    </div>
  </div>`;
});
