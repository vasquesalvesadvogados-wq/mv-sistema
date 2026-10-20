/* ============ CLOUD — Supabase: login, equipe e sincronização ============
   Estratégia "local-first": o app continua trabalhando com o `state` em
   memória (todas as telas intactas). Este módulo:
   1. Autentica o usuário (login por e-mail/senha, com renovação de token).
   2. Carrega tudo do banco para o `state` ao entrar.
   3. A cada save(), calcula a diferença e envia só o que mudou (upsert/delete).
   4. Recarrega dados do time periodicamente (a cada ~4 min, quando seguro).
========================================================================== */

const Cloud = (() => {

  const URL_BASE = window.SUPABASE_URL || '';
  const KEY = window.SUPABASE_KEY || '';
  const CHAVE_SESSAO = ESCRITORIO.chaves.sessao;
  const CHAVE_IA = ESCRITORIO.chaves.ia; // legado: instalações antigas guardavam a chave da IA aqui; hoje só se limpa (a IA do escritório fica no motor)
  const CHAVE_ATIVIDADE = ESCRITORIO.chaves.atividade; // último uso real (mouse/teclado) + limite, p/ encerrar sessão parada
  const CHAVE_MOTIVO_SAIDA = ESCRITORIO.chaves.motivoSaida; // por que a sessão foi encerrada sozinha (a tela de login mostra; some no próximo login)

  let sessao = null;      // {access_token, refresh_token, expires_at, user}
  let meuPerfil = null;   // {id, nome, email, papel, ativo}
  let _shadow = null;     // último retrato sincronizado (para diff)
  let _timerSync = null;
  let _pendente = false;
  let _sincronizando = false;
  let _localAntes = null; // dados locais pré-nuvem (oferta de importação)
  let _atendOk = false;   // módulo de atendimento ativado no banco?
  let _tagsOk = false;    // migração chat-v2 (tags/notificações/comandos) rodada?
  let _tagOrdemOk = false;   // chat-v19c: coluna tags.ordem (ordem da lista) existe?
  let _v4Ok = false;      // migração chat-v4 (citar/encaminhar) rodada?
  let _crmV1Ok = false;   // migração crm-v1 (timeline/campos jurídicos do lead) rodada?
  let _autoOk = false;    // migração chat-v5 (automações) rodada?
  let _incrOk = false;    // migração chat-v7 (sync incremental) rodada?
  let _fuMsgOk = false;   // migração crm-v2 (msg_id do follow-up) rodada?
  let _permOk = false;    // migração chat-v8 (alçadas/permissões) rodada?
  let _deptsOk = false;   // migração chat-v14a (conversas.departamento_ids — vários departamentos por conversa) rodada?
  let _camposOk = false;  // migração chat-v18a (campos personalizados: tabela + conversas.campos + função conversa_campo) rodada?
  let _msgCursor = '';    // maior atualizado_em já visto (cursor do delta)
  let _convCursor = '';   // idem para conversas (o trigger de conversas já existe desde a v2)
  let _renovando = null;  // renovação de token em curso (uma só por vez, mesmo com várias chamadas)
  let _sessaoMorta = false; // sessão revogada/expirada: pulsos param e a tela de login aparece
  let _syncDesde = 0;     // quando o sincronizar() em curso começou (vigia contra trava)
  let _recuo = 20000;     // espera até a próxima tentativa de sync após falha de rede
  let _proximaTentativa = 0;
  let _recusadas = [];    // linhas que o banco recusou (sem alçada, dado inválido) — não voltam a subir
  let _geralBanco = null; // config.geral como veio do banco: as chaves do admin sobem assim de quem não é admin
  /* chaves de config.geral que só o admin muda (o chat-v16b tranca no servidor; aqui é a
     defesa do lado de cá — e evita a aba do atendente devolver valor velho por cima do admin) */
  const CHAVES_ADMIN = ['empresa', 'metaLeads', 'metaContratos', 'metaReceita', 'investimentoMkt', 'investimentoPorMes',
    'contextoIA', 'autoCriarLead', 'analiseAutomatica', 'janelaEnvio', 'esfriandoHoras', 'inatividadeHoras',
    'modeloIA'];   // modelo da IA do escritório (v6.21.0; chat-v17b tranca no servidor)

  /* ?semnuvem abre o sistema SEM login, com tudo liberado e os dados que
     ficaram no navegador. Só vale onde se desenvolve (arquivo local ou
     localhost) — no endereço publicado, qualquer um digitaria na barra. */
  function modoLocalPermitido() {
    const h = location.hostname;
    return location.protocol === 'file:' || h === '' || h === 'localhost' || h === '127.0.0.1' ||
      h === '[::1]' || /\.(localhost|test)$/.test(h);
  }

  function configurado() {
    if (/semnuvem/.test(location.search) && modoLocalPermitido()) return false;
    return !!(URL_BASE && KEY);
  }
  function ativo() { return configurado() && !!sessao; }
  function admin() { return !!(meuPerfil && meuPerfil.papel === 'admin'); }

  /* ---------------- autenticação ---------------- */

  function setSessao(j) {
    sessao = j ? {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
      user: j.user || (sessao && sessao.user)
    } : null;
    // armazenamento cheio não pode derrubar a renovação (o token novo já foi
    // emitido; perder a gravação só significa pedir login no próximo F5)
    try {
      if (sessao) { localStorage.setItem(CHAVE_SESSAO, JSON.stringify(sessao)); localStorage.removeItem(CHAVE_MOTIVO_SAIDA); }
      else localStorage.removeItem(CHAVE_SESSAO);
    } catch (e) { console.warn('Não consegui gravar a sessão no navegador:', e.message); }
  }

  function sessaoGravada() {
    try { return JSON.parse(localStorage.getItem(CHAVE_SESSAO)); } catch (e) { return null; }
  }

  /* outra aba deste navegador renovou o token (ou saiu): adota na hora. Sem
     isto, cada aba renovava por conta própria, o Supabase invalidava o token
     das outras e elas paravam de receber mensagens sem avisar ninguém. */
  window.addEventListener('storage', ev => {
    if (ev.key !== CHAVE_SESSAO) return;
    const nova = sessaoGravada();
    if (nova && nova.access_token) { sessao = Object.assign({}, nova, { user: nova.user || (sessao && sessao.user) }); return; }
    if (sessao && !_sessaoMorta) location.reload(); // saiu em outra aba
  });

  function traduzErroAuth(j) {
    const code = (j && (j.error_code || j.code)) || '';
    const msg = (j && (j.msg || j.message || j.error_description)) || '';
    if (/invalid_credentials|Invalid login credentials/i.test(code + msg)) return 'E-mail ou senha incorretos.';
    if (/email_not_confirmed/i.test(code + msg)) return 'E-mail ainda não confirmado. Peça ao administrador para confirmar seu usuário.';
    if (/rate_limit|over_request/i.test(code + msg)) return 'Muitas tentativas. Aguarde um minuto e tente de novo.';
    if (/user_banned/i.test(code + msg)) return 'Este acesso foi bloqueado.';
    return msg || 'Não foi possível entrar. Verifique sua conexão.';
  }

  async function authFetch(caminho, corpo, comToken) {
    const headers = { 'apikey': KEY, 'content-type': 'application/json' };
    if (comToken && sessao) headers['Authorization'] = 'Bearer ' + sessao.access_token;
    const r = await fetch(URL_BASE + '/auth/v1/' + caminho, {
      method: 'POST', headers, body: corpo ? JSON.stringify(corpo) : '{}'
    });
    let j = null;
    try { j = await r.json(); } catch (e) {}
    if (!r.ok) {
      const e = new Error(traduzErroAuth(j));
      e.status = r.status;
      e.auth = r.status < 500;   // 5xx é instabilidade do servidor, não sessão inválida
      e.rede = r.status >= 500;
      throw e;
    }
    return j;
  }

  async function entrar(email, senha) {
    const j = await authFetch('token?grant_type=password', { email, password: senha });
    _sessaoMorta = false;
    setSessao(j);
  }

  /* renovação única: várias chamadas ao mesmo tempo esperam a mesma promessa,
     e antes de gastar o refresh_token confere se outra aba já renovou */
  function renovar() {
    if (_renovando) return _renovando;
    _renovando = (async () => {
      const gravada = sessaoGravada();
      if (gravada && gravada.access_token && gravada.access_token !== (sessao && sessao.access_token) &&
        gravada.expires_at - 90 > Date.now() / 1000) {
        sessao = Object.assign({}, gravada, { user: gravada.user || (sessao && sessao.user) });
        return;
      }
      if (!sessao || !sessao.refresh_token) { const e = new Error('Sessão expirada.'); e.auth = true; throw e; }
      const usado = sessao.refresh_token;
      try {
        const j = await authFetch('token?grant_type=refresh_token', { refresh_token: usado });
        setSessao(j);
      } catch (e) {
        // o token pode ter sido gasto por outra aba um instante antes: se ela
        // gravou um novo, segue com ele em vez de derrubar esta aba
        const outra = sessaoGravada();
        if (outra && outra.refresh_token && outra.refresh_token !== usado) {
          sessao = Object.assign({}, outra, { user: outra.user || (sessao && sessao.user) });
          return;
        }
        throw e;
      }
    })();
    _renovando.then(() => { _renovando = null; }, () => { _renovando = null; });
    return _renovando;
  }

  async function tokenValido() {
    if (!sessao) { const e = new Error('Sem sessão.'); e.auth = true; throw e; }
    if (sessao.expires_at - 90 < Date.now() / 1000) await renovar();
  }

  /* sessão revogada (senha trocada, usuário desligado, token gasto): para os
     pulsos e mostra a tela de login com o motivo — antes a aba ficava parada
     com "sem conexão" para sempre */
  function sessaoExpirada(motivo) {
    if (_sessaoMorta) return;
    _sessaoMorta = true;
    setSessao(null);
    meuPerfil = null;
    mostrarGate(motivo || 'Sua sessão expirou. Entre de novo para continuar.');
  }

  /* limpa o que este navegador guardou (dados e chave da IA) — o próximo a
     usar esta máquina não herda nada de quem saiu */
  function limparNavegador() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    try { localStorage.removeItem(CHAVE_IA); } catch (e) {}
    try { localStorage.removeItem(CHAVE_ATIVIDADE); } catch (e) {}
  }

  /* ---------------- sessão parada: encerra sozinha (dono, 05/10/2026) ----------------
     Quem fecha o computador sem clicar em "Sair" não pode continuar conectado no
     dia seguinte. Conta só uso REAL (mouse, teclado, rolagem, toque) — os pulsos
     automáticos não contam. O limite vem de config.geral.inatividadeHoras (admin;
     padrão 6 h; 0 desliga) e fica gravado junto com o último uso, para a conferência
     na recarga (computador que dormiu, aba fechada e reaberta) valer antes de
     baixar qualquer dado. Várias abas compartilham a gravação: uso numa vale nas outras. */
  let _ultimaAtividade = Date.now();
  let _atividadeGravadaEm = 0;
  function limiteInatividadeMs() {
    const h = (typeof state !== 'undefined' && state && state.settings) ? normHorasInatividade(state.settings.inatividadeHoras) : 6;
    return h * 3600000;
  }
  function atividadeGravada() {
    try {
      const j = JSON.parse(localStorage.getItem(CHAVE_ATIVIDADE) || 'null');
      return j && Number.isFinite(j.em) ? { em: j.em, limite: Number.isFinite(j.limite) ? j.limite : 6 * 3600000 } : null;
    } catch (e) { return null; }
  }
  /* a marca gravada nunca anda para trás: uma aba visível mas sem toque (Chat no
     segundo monitor) recarrega dados a cada 4–5 min e regravaria a marca velha dela
     por cima do uso real da aba do lado — e derrubaria quem está trabalhando */
  function gravarAtividade(forcar) {
    const g = atividadeGravada();
    const em = Math.max(_ultimaAtividade, g ? g.em : 0);
    _ultimaAtividade = em;
    if (!forcar && em - _atividadeGravadaEm < 60000) return; // no máximo 1 gravação por minuto
    _atividadeGravadaEm = em;
    try { localStorage.setItem(CHAVE_ATIVIDADE, JSON.stringify({ em, limite: limiteInatividadeMs() })); } catch (e) {}
  }
  function marcarAtividade(em) {
    // computador que dormiu com a aba visível: o laço de 60 s não rodou e visibilitychange
    // não dispara — o próprio mexer no mouse que "acorda" a aba confere o limite ANTES de zerar o relógio
    if (!em && Date.now() - _ultimaAtividade > 60000 && conferirInatividade()) return;
    _ultimaAtividade = em || Date.now();
    if (ativo() && !_sessaoMorta) gravarAtividade();
  }
  if (document.addEventListener) {
    ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'].forEach(ev =>
      document.addEventListener(ev, () => marcarAtividade(), { passive: true }));
  }
  const msgInatividade = lim => 'Você ficou mais de ' + fmtHorasInatividade(lim / 3600000) + ' sem usar o sistema, então a sessão foi encerrada por segurança. Entre de novo para continuar.';
  /* avisa o Supabase que ESTA sessão acabou (scope=local: só este aparelho). Renova o
     token antes: depois de horas parado o access token já venceu e o logout seria
     recusado, deixando a sessão viva no servidor. Nunca segura a tela: 5 s no máximo,
     e erro de rede é ignorado (o navegador esquece a sessão de qualquer jeito). */
  function encerrarNoServidor() {
    if (!sessao) return Promise.resolve();
    const pedido = (async () => { await tokenValido(); await authFetch('logout?scope=local', null, true); })().catch(() => {});
    return Promise.race([pedido, new Promise(r => setTimeout(r, 5000))]);
  }
  function lerMotivoSaida() { try { return localStorage.getItem(CHAVE_MOTIVO_SAIDA) || ''; } catch (e) { return ''; } }
  /* encerra por inatividade: tela de login na hora (nada mais clicável), servidor
     avisado, navegador limpo e a página RECARREGADA — assim nada do usuário anterior
     (dados, sombra do sync, modal aberto) sobra em memória para quem entrar em seguida
     nesta aba. O motivo fica guardado para a tela de login depois da recarga. */
  async function sairPorInatividade(lim) {
    if (_sessaoMorta) return;
    _sessaoMorta = true;
    const msg = msgInatividade(lim);
    mostrarGate(msg);
    await encerrarNoServidor();
    setSessao(null);
    meuPerfil = null;
    limparNavegador();
    try { localStorage.setItem(CHAVE_MOTIVO_SAIDA, msg); } catch (e) {}
    location.reload();
  }
  /* true = encerrou a sessão agora. Olha também a gravação (outra aba pode ter uso mais recente). */
  function conferirInatividade() {
    if (!ativo() || _sessaoMorta) return false;
    const lim = limiteInatividadeMs();
    if (!lim) return false;
    const g = atividadeGravada();
    const ultima = Math.max(_ultimaAtividade, g ? g.em : 0);
    if (Date.now() - ultima <= lim) return false;
    sairPorInatividade(lim);
    return true;
  }

  async function sair() {
    // scope=local: encerra só este aparelho (o padrão do Supabase é global e
    // derrubava a pessoa em todos os computadores e celulares)
    await encerrarNoServidor();
    setSessao(null);
    meuPerfil = null;
    limparNavegador();
    location.reload();
  }
  /* um só comportamento para o "Sair" da barra lateral, do rail e do painel do
     Chat (botão pequeno, vizinho de outros: um clique errado custaria login de novo).
     Devolve se a pessoa confirmou. */
  function sairConfirmando() {
    if (!confirm(`Sair do ${ESCRITORIO.sistema}?\n\nVocê volta para a tela de login; nada do que foi enviado se perde.`)) return false;
    sair();
    return true;
  }

  async function recuperarSenha(email) {
    // redirect_to garante que o link do e-mail volte para ESTE endereço do sistema
    await authFetch('recover?redirect_to=' + encodeURIComponent(location.origin + location.pathname), { email });
  }

  /* ---------------- redefinição de senha (link do e-mail) ----------------
     O Supabase redireciona o clique do e-mail de volta para o sistema com o
     token no fragmento da URL (#access_token=...&type=recovery). Aqui a gente
     detecta, limpa a URL e mostra a tela "Defina sua nova senha". */
  function detectarRecovery() {
    const h = location.hash || '';
    if (!h.includes('type=recovery') || !h.includes('access_token=')) return null;
    const q = new URLSearchParams(h.replace(/^#\/?/, ''));
    const at = q.get('access_token');
    if (!at) return null;
    const rec = {
      access_token: at,
      refresh_token: q.get('refresh_token') || '',
      expires_in: parseInt(q.get('expires_in') || '3600', 10)
    };
    history.replaceState(null, '', location.pathname); // tira o token da URL e do histórico
    return rec;
  }

  function mostrarGateNovaSenha(rec) {
    const gate = document.getElementById('auth-gate');
    const card = gate && gate.querySelector('.auth-card');
    if (!card) return;
    gate.hidden = false;
    const sub = card.querySelector('.auth-sub');
    if (sub) sub.textContent = 'Defina sua nova senha de acesso';
    card.querySelectorAll('.field, #auth-entrar, #auth-esqueci, #auth-error').forEach(el => el.remove());
    (sub || card).insertAdjacentHTML('afterend', `
      <div class="auth-error" id="ns-erro" hidden></div>
      <div class="field" style="text-align:left"><label>Nova senha</label>
        <input id="ns-senha" type="password" autocomplete="new-password" placeholder="mínimo 8 caracteres" style="padding:13px 14px;font-size:1rem"></div>
      <div class="field" style="text-align:left"><label>Repita a nova senha</label>
        <input id="ns-senha2" type="password" autocomplete="new-password" style="padding:13px 14px;font-size:1rem"></div>
      <button class="btn btn-primary btn-lg" id="ns-salvar" style="width:100%">Salvar nova senha e entrar</button>`);
    const erro = m => { const el = document.getElementById('ns-erro'); el.textContent = m; el.hidden = false; };
    const salvar = async () => {
      const s1 = document.getElementById('ns-senha').value;
      const s2 = document.getElementById('ns-senha2').value;
      if (s1.length < 8) { erro('A nova senha precisa ter ao menos 8 caracteres.'); return; }
      if (s1 !== s2) { erro('As duas senhas não conferem — digite igual nos dois campos.'); return; }
      const btn = document.getElementById('ns-salvar');
      btn.disabled = true; btn.textContent = 'Salvando...';
      try {
        const r = await fetch(URL_BASE + '/auth/v1/user', {
          method: 'PUT',
          headers: { apikey: KEY, Authorization: 'Bearer ' + rec.access_token, 'content-type': 'application/json' },
          body: JSON.stringify({ password: s1 })
        });
        let j = null; try { j = await r.json(); } catch (e) {}
        if (!r.ok) throw new Error(traduzErroAuth(j));
        setSessao(rec);        // o próprio link vale como sessão: já entra logado
        location.reload();     // boot normal, agora autenticado com a senha nova
      } catch (e) {
        erro((e.message || 'Não foi possível salvar. O link pode ter expirado — peça um novo em "Esqueci minha senha".'));
        btn.disabled = false; btn.textContent = 'Salvar nova senha e entrar';
      }
    };
    document.getElementById('ns-salvar').addEventListener('click', salvar);
    ['ns-senha', 'ns-senha2'].forEach(id =>
      document.getElementById(id).addEventListener('keydown', ev => { if (ev.key === 'Enter') salvar(); }));
    setTimeout(() => { const i = document.getElementById('ns-senha'); if (i) i.focus(); }, 80);
  }

  /* ---------------- REST (PostgREST) ---------------- */

  /* chamada ao PostgREST com prazo (uma requisição pendurada travava todos os
     pulsos), uma nova tentativa após renovar o token em 401, e erro com
     .status/.code/.rede para quem chama decidir entre "tentar de novo" e
     "o banco recusou esta linha". */
  async function chamar(metodo, caminho, corpo, prefer, opcoes) {
    if (_sessaoMorta) { const e = new Error('Sessão encerrada.'); e.auth = true; throw e; }
    await tokenValido();
    for (let tentativa = 0; ; tentativa++) {
      const headers = {
        'apikey': KEY,
        'Authorization': 'Bearer ' + sessao.access_token,
        'content-type': 'application/json'
      };
      if (prefer) headers['Prefer'] = prefer;
      const ctrl = new AbortController();
      const prazo = setTimeout(() => ctrl.abort(), (opcoes && opcoes.prazo) || 15000);
      let r;
      try {
        r = await fetch(URL_BASE + '/rest/v1/' + caminho, {
          method: metodo, headers, body: corpo != null ? JSON.stringify(corpo) : undefined, signal: ctrl.signal
        });
      } catch (e) {
        const err = new Error(e.name === 'AbortError' ? 'O servidor demorou para responder.' : 'Sem conexão com o servidor.');
        err.rede = true;
        throw err;
      } finally { clearTimeout(prazo); }
      if (r.status === 401 && tentativa === 0) {
        // token vencido no meio do caminho: renova uma vez e repete
        try { await renovar(); continue; }
        catch (e) {
          if (e.auth) sessaoExpirada('Sua sessão expirou. Entre de novo para continuar.');
          throw e;
        }
      }
      if (!r.ok) {
        const t = await r.text();
        let j = null; try { j = JSON.parse(t); } catch (e) {}
        const err = new Error('Banco ' + r.status + ': ' + t.slice(0, 220));
        err.status = r.status;
        err.code = j && j.code;
        err.rede = r.status >= 500 || r.status === 408 || r.status === 429;
        if (r.status === 401) { err.auth = true; sessaoExpirada('Sua sessão expirou. Entre de novo para continuar.'); }
        throw err;
      }
      const txt = await r.text();
      return { dados: txt ? JSON.parse(txt) : null, headers: r.headers };
    }
  }

  async function rest(metodo, caminho, corpo, prefer, opcoes) {
    return (await chamar(metodo, caminho, corpo, prefer, opcoes)).dados;
  }

  /* lista inteira em páginas: o Supabase corta toda resposta em "Max rows"
     (1000 por padrão) e, com mais conversas do que isso, a recarga trocava a
     lista por um pedaço arbitrário dela. O total vem do Content-Range. */
  async function restTudo(caminho, tamanho = 1000) {
    // páginas estáveis: a ordem sempre termina no id (criado_em empata em importação de CSV)
    let ordem = '';
    if (/[?&]order=/.test(caminho)) caminho = caminho.replace(/([?&]order=[^&]*)/, m => /\bid\./.test(m) ? m : m + ',id.asc');
    else ordem = '&order=id.asc';
    const sep = caminho.includes('?') ? '&' : '?';
    let offset = 0, total = null, out = [];
    for (let volta = 0; volta < 100; volta++) {
      const { dados, headers } = await chamar('GET', `${caminho}${sep}limit=${tamanho}&offset=${offset}${ordem}`, null, 'count=exact');
      const linhas = dados || [];
      const faixa = /\/(\d+)$/.exec(headers.get('content-range') || '');
      if (faixa) total = Number(faixa[1]);
      out = out.concat(linhas);
      offset += linhas.length;
      if (!linhas.length || (total != null ? offset >= total : linhas.length < tamanho)) break;
    }
    // ordenação com empate pode repetir uma linha entre páginas
    const vistos = new Set();
    return out.filter(r => r.id == null || (vistos.has(r.id) ? false : vistos.add(r.id)));
  }

  /* ---------------- mapeamento JS ↔ banco ---------------- */

  const leadParaDb = l => ({
    id: l.id, nome: l.nome || 'Sem nome', telefone: l.telefone || '', email: l.email || '',
    empresa: l.empresa || '', link: l.link || '', tags: l.tags || [], area: l.area || '',
    perfil: l.perfil || '', origem: l.origem || '', etapa: l.etapa || 'Novo',
    temperatura: l.temperatura || 'Morno', valor: Number(l.valor) || 0, dor: l.dor || '',
    notas: l.notas || '', motivo_perda: l.motivoPerda || '', dono: l.dono || null,
    ganho_em: l.ganhoEm || null, criado_em: l.criadoEm, atualizado_em: l.atualizadoEm || l.criadoEm,
    // crm-v1: timeline + campos jurídicos (só sobem depois da migração)
    ...(_crmV1Ok ? {
      eventos: l.eventos || [], etapa_historico: l.etapaHistorico || [],
      numero_processo: l.numeroProcesso || '', comarca_vara: l.comarcaVara || '',
      prazo_limite: l.prazoLimite || null
    } : {})
  });

  const leadDeDb = (r, contratos) => ({
    id: r.id, nome: r.nome, telefone: r.telefone, email: r.email, empresa: r.empresa,
    link: r.link, tags: r.tags || [], area: r.area, perfil: r.perfil, origem: r.origem,
    etapa: r.etapa, temperatura: r.temperatura, valor: Number(r.valor) || 0, dor: r.dor,
    notas: r.notas, motivoPerda: r.motivo_perda, dono: r.dono, ganhoEm: r.ganho_em,
    criadoEm: r.criado_em, atualizadoEm: r.atualizado_em, contratos: contratos || [],
    eventos: r.eventos || [], etapaHistorico: r.etapa_historico || [],
    numeroProcesso: r.numero_processo || '', comarcaVara: r.comarca_vara || '',
    prazoLimite: r.prazo_limite || null
  });

  const contratoParaDb = (c, leadId) => ({
    id: c.id, lead_id: leadId, servico: c.servico, data: c.data,
    valor: Number(c.valor) || 0, forma_pagamento: c.formaPagamento || '',
    parcelas: c.parcelas || 1, desconto: Number(c.desconto) || 0, obs: c.obs || ''
  });

  const contratoDeDb = r => ({
    id: r.id, servico: r.servico, data: r.data, valor: Number(r.valor) || 0,
    formaPagamento: r.forma_pagamento, parcelas: r.parcelas || 1,
    desconto: Number(r.desconto) || 0, obs: r.obs || ''
  });

  const fuParaDb = f => ({
    id: f.id, lead_id: f.leadId, cadencia_id: f.cadenciaId || '', cadencia_nome: f.cadenciaNome || '',
    passo_index: f.passoIndex || 0, dia: f.dia || 0, canal: f.canal || 'WhatsApp',
    titulo: f.titulo || '', objetivo: f.objetivo || '', template: f.template || '',
    due_date: f.dueDate, status: f.status || 'pendente', feito_em: f.feitoEm || null,
    motivo: f.motivo || '', criado_em: f.criadoEm,
    // crm-v2: sem isto o cancelamento não acha a mensagem para tirar da fila do motor
    ...(_fuMsgOk ? { msg_id: f.msgId || null } : {})
  });

  const fuDeDb = r => ({
    id: r.id, leadId: r.lead_id, cadenciaId: r.cadencia_id, cadenciaNome: r.cadencia_nome,
    passoIndex: r.passo_index, dia: r.dia, canal: r.canal, titulo: r.titulo,
    objetivo: r.objetivo, template: r.template, dueDate: r.due_date, status: r.status,
    feitoEm: r.feito_em, motivo: r.motivo, criadoEm: r.criado_em,
    msgId: r.msg_id || null, autoEnviar: !!r.msg_id
  });

  const anParaDb = a => ({
    id: a.id, lead_id: a.leadId || null, score: (a.scores && a.scores.geral) || null,
    temperatura: a.temperatura || '', dados: a, criado_em: a.criadoEm
  });

  const cadParaDb = c => ({ id: c.id, nome: c.nome, cenario: c.cenario || '', ref: c.ref || '', passos: c.passos || [] });

  /* --- atendimento --- */
  /* Só o que a TELA altera. nao_lidas, ultima_msg, ultima_msg_em, foto_url e
     participantes são do motor: subir a linha inteira desfazia, segundos
     depois, a mensagem nova que o motor tinha contado (e a delegação que um
     colega acabara de fazer). Abrir uma conversa zera as não lidas pela RPC
     marcar_lida, sem regravar a linha. */
  const convParaDb = c => ({
    id: c.id, telefone: c.telefone, nome: c.nome || '',
    lead_id: c.leadId || null, departamento_id: idsDeDepartamento(c)[0] || null,
    responsavel: c.responsavel || null, status: c.status || 'aberto', tags: c.tags || [],
    arquivada: !!c.arquivada, criado_em: c.criadoEm, atualizado_em: c.atualizadoEm || c.criadoEm,
    // colunas da migração chat-v2 (só envia se ela já rodou no banco)
    ...(_tagsOk ? { tipo: c.tipo || 'individual', grupo_jid: c.grupoJid || '' } : {}),
    // lista de departamentos (chat-v14a): sem a coluna no banco, o lote inteiro falharia com 400
    ...(_deptsOk ? { departamento_ids: idsDeDepartamento(c) } : {})
    // `campos` (chat-v18a) NÃO sobe aqui: os valores dos campos personalizados só são gravados pela
    // função conversa_campo, uma chave por vez — a linha inteira apagaria o que o colega acabou de preencher
  });
  /* campos personalizados (chat-v18a): a lista do escritório vai e volta inteira, como as tags */
  const campoParaDb = c => ({ id: c.id, nome: c.nome || '', tipo: c.tipo === 'link' ? 'link' : 'texto', ordem: Number(c.ordem) || 0 });
  const campoDeDb = r => ({ id: r.id, nome: r.nome || '', tipo: r.tipo === 'link' ? 'link' : 'texto', ordem: Number(r.ordem) || 0 });
  const convDeDb = r => ({
    id: r.id, telefone: r.telefone, nome: r.nome, fotoUrl: r.foto_url, leadId: r.lead_id,
    tipo: r.tipo || 'individual', grupoJid: r.grupo_jid || '', participantes: r.participantes || [],
    departamentoIds: idsDeDepartamento(r), departamentoId: idsDeDepartamento(r)[0] || null,
    responsavel: r.responsavel, status: r.status,
    tags: r.tags || [], naoLidas: r.nao_lidas || 0, ultimaMsg: r.ultima_msg,
    ultimaMsgEm: r.ultima_msg_em, arquivada: !!r.arquivada,
    campos: r.campos && typeof r.campos === 'object' ? r.campos : {},   // valores dos campos personalizados (chat-v18a)
    criadoEm: r.criado_em, atualizadoEm: r.atualizado_em
  });
  const msgParaDb = m => ({
    id: m.id, conversa_id: m.conversaId, direcao: m.direcao,
    tipo: !_tagsOk && m.tipo === 'figurinha' ? 'imagem' : (m.tipo || 'texto'),
    texto: m.texto || '', midia_url: m.midiaUrl || '', autor: m.autor || null,
    agendada_para: m.agendadaPara || null, status: m.status || 'pendente',
    erro: m.erro || '', externo_id: m.externoId || '', criado_em: m.criadoEm,
    // colunas da migração chat-v2 (só envia se ela já rodou no banco)
    ...(_tagsOk ? {
      midia_mime: m.midiaMime || '', midia_nome: m.midiaNome || '',
      midia_tamanho: m.midiaTamanho || 0, midia_ptt: !!m.midiaPtt,
      transcricao: m.transcricao || '', mencoes: m.mencoes || [], remetente: m.remetente || ''
    } : {}),
    // colunas da migração chat-v4 (citar/encaminhar)
    ...(_v4Ok ? { citado: m.citado || null, encaminhada: !!m.encaminhada } : {})
  });
  const msgDeDb = r => ({
    id: r.id, conversaId: r.conversa_id, direcao: r.direcao, tipo: r.tipo, texto: r.texto,
    midiaUrl: r.midia_url, midiaMime: r.midia_mime || '', midiaNome: r.midia_nome || '',
    midiaTamanho: r.midia_tamanho || 0, midiaPtt: !!r.midia_ptt, transcricao: r.transcricao || '',
    mencoes: r.mencoes || [], remetente: r.remetente || '', participante: r.participante || '',
    reacoes: r.reacoes || [], // gravadas só pelo motor — o front nunca as envia no sync
    citado: r.citado || null, encaminhada: !!r.encaminhada,
    enquete: r.enquete || null, // gravada só pelo motor
    apagada: !!r.apagada,
    edicoes: Array.isArray(r.edicoes) ? r.edicoes : [], // versões anteriores do texto (chat-v14b), só o motor grava
    autor: r.autor, agendadaPara: r.agendada_para, status: r.status,
    erro: r.erro, externoId: r.externo_id, criadoEm: r.criado_em
  });
  const deptParaDb = d => ({
    id: d.id, nome: d.nome, cor: d.cor || COR_PADRAO_DADO,
    ...(_permOk ? { permissoes: d.permissoes || {} } : {})
  });
  const rrParaDb = r => ({ id: r.id, atalho: r.atalho || '', titulo: r.titulo || '', texto: r.texto || '', dono: r.dono || null });
  const tagParaDb = t => Object.assign({ id: t.id, nome: t.nome, cor: t.cor || COR_PADRAO_DADO },
    _tagOrdemOk ? { ordem: t.ordem == null ? null : Number(t.ordem) } : {});   // ordem só depois de sondar a coluna (chat-v19c)
  const autoParaDb = a => ({
    id: a.id, nome: a.nome, ativa: !!a.ativa, gatilho: a.gatilho || 'mensagem_recebida',
    cooldown_horas: a.cooldownHoras == null ? 12 : a.cooldownHoras,
    condicoes: a.condicoes || [], acoes: a.acoes || [], criado_em: a.criadoEm
  });
  const autoDeDb = r => ({
    id: r.id, nome: r.nome, ativa: !!r.ativa, gatilho: r.gatilho,
    cooldownHoras: Number(r.cooldown_horas), condicoes: r.condicoes || [], acoes: r.acoes || [],
    criadoEm: r.criado_em
  });
  /* ---------------- retrato e sincronização (diff) ---------------- */

  function snapshot() {
    const s = { leads: {}, contratos: {}, followups: {}, analises: {}, cadencias: {}, config: {} };
    (state.leads || []).forEach(l => {
      s.leads[l.id] = JSON.stringify(leadParaDb(l));
      (l.contratos || []).forEach(c => { s.contratos[c.id] = JSON.stringify(contratoParaDb(c, l.id)); });
    });
    (state.followups || []).forEach(f => { s.followups[f.id] = JSON.stringify(fuParaDb(f)); });
    (state.analyses || []).forEach(a => { s.analises[a.id] = JSON.stringify(anParaDb(a)); });
    (state.cadences || []).forEach(c => { s.cadencias[c.id] = JSON.stringify(cadParaDb(c)); });
    if (_atendOk) {
      s.conversas = {}; s.mensagens = {}; s.respostas_rapidas = {};
      // departamentos só sobem pelas mãos do admin (no banco, só ele pode gravar):
      // fora do diff de quem não é admin, uma semente local nunca vira recusa
      if (admin()) {
        s.departamentos = {};
        (state.departamentos || []).forEach(d => { s.departamentos[d.id] = JSON.stringify(deptParaDb(d)); });
      }
      (state.conversas || []).forEach(c => { s.conversas[c.id] = JSON.stringify(convParaDb(c)); });
      (state.mensagens || []).forEach(m => { s.mensagens[m.id] = JSON.stringify(msgParaDb(m)); });
      (state.respostasRapidas || []).forEach(r => { s.respostas_rapidas[r.id] = JSON.stringify(rrParaDb(r)); });
      if (_tagsOk) {
        s.tags = {};
        (state.tags || []).forEach(t => { s.tags[t.id] = JSON.stringify(tagParaDb(t)); });
      }
      if (_camposOk) {
        s.campos_personalizados = {};
        (state.camposPersonalizados || []).forEach(c => { s.campos_personalizados[c.id] = JSON.stringify(campoParaDb(c)); });
      }
      if (_autoOk) {
        s.automacoes = {};
        (state.automacoes || []).forEach(a => { s.automacoes[a.id] = JSON.stringify(autoParaDb(a)); });
      }
    }
    const geralValor = {
        empresa: state.settings.empresa || '',
        investimentoMkt: Number(state.settings.investimentoMkt) || 0,
        /* v6 — configurações compartilhadas do escritório */
        investimentoPorMes: state.settings.investimentoPorMes || {},
        metaLeads: Number(state.settings.metaLeads) || 0,
        metaContratos: Number(state.settings.metaContratos) || 0,
        metaReceita: Number(state.settings.metaReceita) || 0,
        contextoIA: state.settings.contextoIA || {},
        autoCriarLead: state.settings.autoCriarLead !== false,
        analiseAutomatica: state.settings.analiseAutomatica !== false,
        janelaEnvio: state.settings.janelaEnvio || '09:00-18:00',
        esfriandoHoras: Number(state.settings.esfriandoHoras) || 6,
        inatividadeHoras: normHorasInatividade(state.settings.inatividadeHoras), // sessão parada encerra sozinha (0 desliga)
        modeloIA: state.settings.modeloIA || 'claude-opus-5-5',   // IA do escritório: modelo escolhido pelo admin, vale para todos
        cadenciasEditadas: state.settings.cadenciasEditadas || [],
        playbook: state.settings.playbook || null
    };
    if (!admin() && _geralBanco) CHAVES_ADMIN.forEach(k => { if (k in _geralBanco) geralValor[k] = _geralBanco[k]; else delete geralValor[k]; });
    s.config['geral'] = JSON.stringify({ chave: 'geral', valor: geralValor });
    return s;
  }

  function agendarSync() {
    if (!ativo()) return;
    clearTimeout(_timerSync);
    _timerSync = setTimeout(sincronizar, 600);
  }

  /* ---------------- envio das alterações (diff contra a sombra) ----------------
     Regras que mantêm o time trabalhando quando algo dá errado:
     - cada tabela e cada linha andam sozinhas: a sombra avança no que subiu;
     - linha RECUSADA pelo banco (sem alçada, dado inválido) vai para a
       quarentena e não volta a subir — antes uma única recusa travava a aba
       inteira, inclusive a RECEPÇÃO de mensagens, com o aviso falso
       "sem conexão";
     - só falha de rede deixa pendência, com novas tentativas espaçadas;
     - exclusão em massa nunca sai daqui (um estado local zerado apagaria a
       base do escritório no próximo envio). */
  const ORDEM_ENVIO = ['leads', 'departamentos', 'tags', 'campos_personalizados', 'automacoes', 'conversas', 'contratos', 'followups', 'analises', 'mensagens', 'cadencias', 'respostas_rapidas', 'config'];
  const ORDEM_EXCLUSAO = ['contratos', 'followups', 'analises', 'mensagens', 'conversas', 'respostas_rapidas', 'campos_personalizados', 'tags', 'automacoes', 'departamentos', 'cadencias', 'leads'];
  const LIMITE_EXCLUSAO = 20;      // por tabela, por envio
  const LOTE_EXCLUSAO = 50;        // ids por DELETE (URL longa demais é recusada)
  const chave = (t, id) => t + ':' + id;

  function emQuarentena(t, id) { return _recusadas.some(r => r.chave === chave(t, id)); }

  /* o banco recusou a linha: registra, avisa e evita que o diff a reenvie */
  function recusar(tabela, id, json, erro) {
    if (!emQuarentena(tabela, id)) _recusadas.push({ chave: chave(tabela, id), tabela, id, motivo: motivoRecusa(erro), erro: erro.message, em: new Date().toISOString() });
    if (_recusadas.length > 200) _recusadas = _recusadas.slice(-200);
    console.warn('[sync] recusada', tabela, id, erro.message);
    if (tabela === 'mensagens') {
      // a mensagem não chegou ao banco: aparece com erro na conversa
      const m = (state.mensagens || []).find(x => x.id === id);
      if (m) { m.status = 'erro'; m.erro = 'não foi salva: ' + motivoRecusa(erro); json = JSON.stringify(msgParaDb(m)); }
    }
    if (_shadow[tabela]) _shadow[tabela][id] = json;
  }

  function motivoRecusa(e) {
    if (e.code === '42501' || e.status === 403) return 'sem permissão';
    if (e.code === '23505' || e.status === 409) return 'conflito com um registro que já existe';
    if (e.code === '23514') return 'valor não aceito pelo banco';
    return 'recusada pelo banco';
  }

  /* sobe as linhas de uma tabela: lote primeiro; se o banco recusar o lote,
     linha a linha para isolar a culpada. Devolve false em falha de rede. */
  async function subirLinhas(tabela, ids, atual) {
    const lote = ids.map(id => JSON.parse(atual[tabela][id]));
    try {
      await rest('POST', tabela, lote, 'resolution=merge-duplicates,return=minimal');
      ids.forEach(id => { _shadow[tabela][id] = atual[tabela][id]; });
      return true;
    } catch (e) {
      if (e.rede || e.auth) return false;
      // chat-v14a recém-aplicada: a sondagem viu a coluna, mas o cache do PostgREST ainda
      // não (PGRST204 = coluna desconhecida no corpo). Não é recusa do usuário: reenvia
      // já sem a lista (a sombra guarda a forma sem a lista, igual ao próximo retrato) e a
      // recarga seguinte sonda de novo.
      if (tabela === 'conversas' && e.code === 'PGRST204' && _deptsOk) {
        _deptsOk = false;
        const tirarLista = r => { const { departamento_ids, ...resto } = r; return resto; };
        // a sombra inteira foi tirada COM a lista; sem reescrevê-la, o próximo retrato
        // (já sem a chave) marcaria todas as conversas como alteradas e subiria a tabela
        for (const k in _shadow.conversas) {
          try { _shadow.conversas[k] = JSON.stringify(tirarLista(JSON.parse(_shadow.conversas[k]))); } catch (e3) {}
        }
        const semLista = lote.map(tirarLista);
        try {
          await rest('POST', tabela, semLista, 'resolution=merge-duplicates,return=minimal');
          ids.forEach((id, i) => { _shadow[tabela][id] = JSON.stringify(semLista[i]); });
          return true;
        } catch (e2) { if (e2.rede || e2.auth) return false; }
      }
    }
    for (const id of ids) {
      // o retrato veio COM a lista; se a flag caiu neste mesmo ciclo, cada linha sobe sem ela
      // (senão todas levariam PGRST204 de novo e iriam para a quarentena no lugar da culpada)
      const linha = JSON.parse(atual[tabela][id]);
      const corpo = (tabela === 'conversas' && !_deptsOk) ? (({ departamento_ids, ...r }) => r)(linha) : linha;
      const json = JSON.stringify(corpo);
      try {
        await rest('POST', tabela, [corpo], 'resolution=merge-duplicates,return=minimal');
        _shadow[tabela][id] = json;
      } catch (e) {
        if (e.rede || e.auth) return false;
        recusar(tabela, id, json, e);
      }
    }
    return true;
  }

  async function sincronizar() {
    if (!ativo() || _sincronizando || !_shadow || _sessaoMorta) return;
    _sincronizando = true;
    _syncDesde = Date.now();
    const recusadasAntes = _recusadas.length;
    let semRede = false, bloqueou = false;
    try {
      const atual = snapshot();
      for (const tabela of ORDEM_ENVIO) {
        if (!atual[tabela]) continue;
        if (!_shadow[tabela]) _shadow[tabela] = {};
        const ids = Object.keys(atual[tabela]).filter(id =>
          atual[tabela][id] !== _shadow[tabela][id] && !emQuarentena(tabela, id));
        if (ids.length && !(await subirLinhas(tabela, ids, atual))) { semRede = true; break; }
      }
      if (!semRede) {
        for (const tabela of ORDEM_EXCLUSAO) {
          if (!atual[tabela] || !_shadow[tabela]) continue;
          const naSombra = Object.keys(_shadow[tabela]);
          const idsExcluir = naSombra.filter(id => !(id in atual[tabela]));
          if (!idsExcluir.length) continue;
          // TRAVA: muitas exclusões de uma vez, ou a tabela local inteira vazia
          // com a sombra cheia, é estado corrompido — nunca apagar a base
          if (idsExcluir.length > LIMITE_EXCLUSAO || (!Object.keys(atual[tabela]).length && naSombra.length > 1)) {
            console.error(`[sync] exclusão em massa bloqueada em ${tabela}: ${idsExcluir.length} de ${naSombra.length}`);
            bloqueou = true;
            continue;
          }
          for (let i = 0; i < idsExcluir.length; i += LOTE_EXCLUSAO) {
            const parte = idsExcluir.slice(i, i + LOTE_EXCLUSAO);
            try {
              await rest('DELETE', `${tabela}?id=in.(${parte.map(x => '"' + x + '"').join(',')})`, null, 'return=minimal');
            } catch (e) {
              if (e.rede || e.auth) { semRede = true; break; }
              // sem permissão para apagar: a linha continua no banco e volta na próxima recarga
              console.warn('[sync] exclusão recusada', tabela, e.message);
            }
            if (!semRede) parte.forEach(x => { delete _shadow[tabela][x]; });
          }
          if (semRede) break;
        }
      }
    } catch (e) {
      console.error('Falha de sincronização', e);
      semRede = true;
    } finally {
      _sincronizando = false;
    }

    if (semRede) {
      if (!_pendente) UI.toast('Sem conexão com a nuvem — suas alterações estão guardadas e serão enviadas assim que voltar.', 'err');
      _pendente = true;
      _proximaTentativa = Date.now() + _recuo;
      _recuo = Math.min(_recuo * 2, 300000);
    } else {
      if (_pendente) UI.toast('Sincronizado com a nuvem');
      _pendente = false;
      _recuo = 20000;
    }
    if (bloqueou) {
      UI.toast('Uma exclusão em massa foi bloqueada por segurança. Recarregando os dados do banco.', 'err');
      setTimeout(() => carregarTudo(true).then(() => window.ChatUI && ChatUI.aoAtualizar ? ChatUI.aoAtualizar(false) : UI.refresh()).catch(() => {}), 500);
    }
    if (_recusadas.length > recusadasAntes) {
      const r = _recusadas[_recusadas.length - 1];
      UI.toast(`O banco recusou uma alteração (${r.motivo}). Ela foi desfeita nesta tela.`, 'err');
      // devolve à tela a versão do banco (o que não for mensagem)
      if (_recusadas.slice(recusadasAntes).some(x => x.tabela !== 'mensagens')) {
        setTimeout(() => carregarTudo(true).then(() => window.ChatUI && ChatUI.aoAtualizar ? ChatUI.aoAtualizar(false) : UI.refresh()).catch(() => {}), 800);
      } else if (window.ChatUI && ChatUI.aoAtualizar) ChatUI.aoAtualizar(false);
    }
    avisoSync();
  }

  /* faixa discreta enquanto houver alteração que não chegou ao banco */
  function avisoSync() {
    let el = document.getElementById('sync-aviso');
    if (!_pendente) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'sync-aviso';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.innerHTML = `${ICO('alert-triangle')} Alterações ainda não salvas na nuvem
      <button type="button" onclick="Cloud.sincronizarAgora()">Tentar agora</button>`;
  }

  function temPendencia() {
    if (_pendente) return true;
    if (!_shadow || !ativo()) return false;
    try {
      const atual = snapshot();
      return ['mensagens', 'conversas'].some(t => atual[t] && _shadow[t] &&
        Object.keys(atual[t]).some(id => atual[t][id] !== _shadow[t][id] && !emQuarentena(t, id)));
    } catch (e) { return false; }
  }

  // novas tentativas espaçadas (20 s → 40 s → … → 5 min) enquanto houver pendência;
  // e vigia: um envio que passe de 60 s é dado como perdido (a flag não fica presa)
  setInterval(() => {
    if (_sincronizando && Date.now() - _syncDesde > 60000) { console.warn('[sync] envio travado — liberando'); _sincronizando = false; }
    if (_pendente && !_sincronizando && Date.now() >= _proximaTentativa) sincronizar();
  }, 5000);

  /* ---------------- carga completa ---------------- */

  async function ensurePerfil() {
    const uid_ = sessao.user && sessao.user.id;
    let rows = await rest('GET', 'perfis?id=eq.' + uid_ + '&select=*');
    if (!rows.length) {
      const email = (sessao.user && sessao.user.email) || '';
      try {
        await rest('POST', 'perfis', [{ id: uid_, nome: email.split('@')[0], email }], 'return=minimal');
      } catch (e) {}
      rows = await rest('GET', 'perfis?id=eq.' + uid_ + '&select=*');
    }
    if (!rows.length) throw new Error('Não foi possível carregar seu perfil. Rode o schema-ajustes.sql no Supabase.');
    meuPerfil = rows[0];
    if (!meuPerfil.ativo) {
      const e = new Error('Seu acesso ainda não foi liberado pelo administrador.');
      e.inativo = true;
      throw e;
    }
  }

  /* funde linhas do banco em state.mensagens + sombra (sem duplicar, avançando o cursor) */
  function mesclarMensagens(rows) {
    if (!rows || !rows.length) return 0;
    const porId = {};
    state.mensagens.forEach((m, i) => porId[m.id] = i);
    const chegaramAgora = []; // v6: entradas NOVAS e recentes (p/ pausar cadência)
    rows.forEach(r => {
      const carimbo = r.atualizado_em || r.criado_em || '';
      if (carimbo > _msgCursor) _msgCursor = carimbo;
      const m = msgDeDb(r);
      const i = porId[m.id];
      // mudança local ainda não enviada tem prioridade sobre a versão do banco
      if (i != null && _shadow && _shadow.mensagens && _shadow.mensagens[m.id] &&
        JSON.stringify(msgParaDb(state.mensagens[i])) !== _shadow.mensagens[m.id]) return;
      if (i == null && m.direcao === 'entrada' &&
        Date.now() - new Date(m.criadoEm).getTime() < 15 * 60000) chegaramAgora.push(m);
      if (i != null) state.mensagens[i] = m;
      else { porId[m.id] = state.mensagens.length; state.mensagens.push(m); }
      if (_shadow && _shadow.mensagens) _shadow.mensagens[m.id] = JSON.stringify(msgParaDb(m));
    });
    // PAUSA AUTOMÁTICA DE CADÊNCIA (v6): o lead respondeu no WhatsApp →
    // cancela os toques pendentes (e as mensagens automáticas ainda na fila)
    if (chegaramAgora.length && typeof Cadence !== 'undefined') {
      const leadsQueResponderam = new Set();
      chegaramAgora.forEach(m => {
        const c = (state.conversas || []).find(x => x.id === m.conversaId);
        if (c && c.leadId) leadsQueResponderam.add(c.leadId);
      });
      leadsQueResponderam.forEach(leadId => {
        const tinha = state.followups.some(f => f.leadId === leadId && f.status === 'pendente');
        if (tinha) {
          Cadence.cancelarPendentes(leadId, 'lead respondeu no WhatsApp');
          if (typeof registrarEvento === 'function') { registrarEvento(leadId, 'resposta', 'Lead respondeu no WhatsApp — cadência pausada automaticamente'); save(); }
        }
      });
    }
    return rows.length;
  }

  /* delta: só o que mudou desde o cursor (exige chat-v7.sql) */
  async function buscarDeltas() {
    if (!_incrOk) return null;
    const rows = await rest('GET', `mensagens?select=*&atualizado_em=gt.${encodeURIComponent(_msgCursor)}&order=atualizado_em.asc&limit=600`);
    mesclarMensagens(rows || []);
    return rows || [];
  }

  /* delta de conversas: alterações locais ainda não sincronizadas têm prioridade */
  function mesclarConversas(rows) {
    if (!rows || !rows.length) return 0;
    let aplicadas = 0;
    rows.forEach(r => {
      const carimbo = r.atualizado_em || '';
      if (carimbo > _convCursor) _convCursor = carimbo;
      const i = state.conversas.findIndex(c => c.id === r.id);
      if (i >= 0 && _shadow && _shadow.conversas && _shadow.conversas[r.id] &&
        JSON.stringify(convParaDb(state.conversas[i])) !== _shadow.conversas[r.id]) {
        return; // mudança local pendente de envio — não sobrescreve
      }
      const c = convDeDb(r);
      if (i >= 0) state.conversas[i] = c;
      else state.conversas.unshift(c);
      if (_shadow && _shadow.conversas) _shadow.conversas[c.id] = JSON.stringify(convParaDb(c));
      aplicadas++;
    });
    return aplicadas;
  }

  async function buscarDeltasConversas() {
    if (!_incrOk) return null;
    const rows = await rest('GET', `conversas?select=*&atualizado_em=gt.${encodeURIComponent(_convCursor)}&order=atualizado_em.asc&limit=300`);
    return mesclarConversas(rows || []);
  }

  /* agendadas canceladas por outro atendente somem do banco — espelha aqui */
  async function reconciliarAgendadas() {
    if (!_incrOk || !_shadow || !_shadow.mensagens) return;
    const rows = await rest('GET', 'mensagens?select=id&status=eq.agendada');
    const vivas = new Set((rows || []).map(r => r.id));
    state.mensagens = state.mensagens.filter(m => {
      if (m.status === 'agendada' && !vivas.has(m.id) && _shadow.mensagens[m.id]) {
        delete _shadow.mensagens[m.id];
        return false;
      }
      return true;
    });
  }

  /* histórico antigo de uma conversa, sob demanda (botão "carregar anteriores") */
  async function carregarHistorico(conversaId, antesDe) {
    const rows = await rest('GET',
      `mensagens?select=*&conversa_id=eq.${conversaId}&criado_em=lt.${encodeURIComponent(antesDe)}&order=criado_em.desc&limit=200`);
    return mesclarMensagens(rows || []);
  }

  /* ---------- alterações locais que ainda não subiram ----------
     A recarga troca as listas pelas do banco e tira uma sombra nova. Sem
     cuidado, isso "engolia" o que o usuário acabou de fazer e ainda não tinha
     subido (uma mensagem digitada 300 ms antes, uma delegação no debounce).
     Aqui a gente separa o que está sujo, recoloca depois da recarga e devolve
     à sombra a versão antiga — o próximo envio sobe normalmente. */
  const ACESSO = {
    leads: () => state.leads, followups: () => state.followups, analises: () => state.analyses,
    cadencias: () => state.cadences, conversas: () => state.conversas, mensagens: () => state.mensagens,
    departamentos: () => state.departamentos, respostas_rapidas: () => state.respostasRapidas,
    tags: () => state.tags, automacoes: () => state.automacoes, campos_personalizados: () => state.camposPersonalizados
  };

  function capturarSujos() {
    if (!_shadow) return null;
    let atual;
    try { atual = snapshot(); } catch (e) { return null; }
    const out = {};
    for (const t of Object.keys(ACESSO)) {
      if (!atual[t] || !_shadow[t]) continue;
      const porId = {};
      (ACESSO[t]() || []).forEach(o => { porId[o.id] = o; });
      const alterados = Object.keys(atual[t]).filter(id => atual[t][id] !== _shadow[t][id] && !emQuarentena(t, id));
      const apagados = Object.keys(_shadow[t]).filter(id => !(id in atual[t]));
      // exclusão em massa não é preservada: é exatamente o estado corrompido
      // que a recarga existe para desfazer
      const apagadosOk = apagados.length <= LIMITE_EXCLUSAO ? apagados : [];
      if (alterados.length || apagadosOk.length) {
        out[t] = { objetos: alterados.map(id => porId[id]).filter(Boolean), apagados: apagadosOk, sombra: _shadow[t] };
      }
    }
    // contrato alterado viaja dentro do lead: preserva o lead inteiro
    if (atual.contratos && _shadow.contratos) {
      const ctIds = Object.keys(atual.contratos).filter(id => atual.contratos[id] !== _shadow.contratos[id]);
      if (ctIds.length) {
        const set = new Set(ctIds);
        const leads = (state.leads || []).filter(l => (l.contratos || []).some(c => set.has(c.id)));
        out.leads = out.leads || { objetos: [], apagados: [], sombra: _shadow.leads || {} };
        leads.forEach(l => { if (!out.leads.objetos.includes(l)) out.leads.objetos.push(l); });
        out._contratos = { ids: ctIds, sombra: _shadow.contratos };
      }
    }
    if (atual.config && _shadow.config && atual.config.geral !== _shadow.config.geral) {
      out._config = { settings: Object.assign({}, state.settings), sombra: _shadow.config.geral };
    }
    return Object.keys(out).length ? out : null;
  }

  function reaplicarSujos(sujos) {
    if (!sujos) return;
    for (const t of Object.keys(ACESSO)) {
      const info = sujos[t];
      const lista = ACESSO[t]();
      if (!info || !Array.isArray(lista)) continue;
      info.objetos.forEach(o => {
        const i = lista.findIndex(x => x.id === o.id);
        if (i >= 0) lista[i] = o; else lista.push(o);
      });
      if (info.apagados.length) {
        const fora = new Set(info.apagados);
        for (let i = lista.length - 1; i >= 0; i--) if (fora.has(lista[i].id)) lista.splice(i, 1);
      }
    }
    if (sujos._config) {
      const ant = sujos._config.settings;
      ['empresa', 'investimentoMkt', 'investimentoPorMes', 'metaLeads', 'metaContratos', 'metaReceita', 'contextoIA',
        'autoCriarLead', 'analiseAutomatica', 'janelaEnvio', 'esfriandoHoras', 'inatividadeHoras', 'modeloIA', 'cadenciasEditadas', 'playbook']
        .forEach(k => { if (k in ant) state.settings[k] = ant[k]; });
    }
  }

  /* depois da sombra nova: o que estava sujo volta a aparecer como diferença */
  function sombraComSujos(sujos) {
    if (!sujos || !_shadow) return;
    for (const t of Object.keys(ACESSO)) {
      const info = sujos[t];
      if (!info || !_shadow[t]) continue;
      info.objetos.forEach(o => {
        if (info.sombra[o.id] != null) _shadow[t][o.id] = info.sombra[o.id]; else delete _shadow[t][o.id];
      });
      info.apagados.forEach(id => { if (info.sombra[id] != null) _shadow[t][id] = info.sombra[id]; });
    }
    if (sujos._contratos && _shadow.contratos) {
      sujos._contratos.ids.forEach(id => {
        const ant = sujos._contratos.sombra[id];
        if (ant != null) _shadow.contratos[id] = ant; else delete _shadow.contratos[id];
      });
    }
    if (sujos._config && _shadow.config) _shadow.config.geral = sujos._config.sombra;
    agendarSync();
  }

  async function carregarTudo(leve) {
    // sonda a migração do sync incremental (chat-v7.sql) — memoizada: uma vez
    // detectada, a migração não "desroda"; evita 1 request por ciclo de recarga
    if (!leve && !_incrOk) {
      try { await rest('GET', 'mensagens?select=atualizado_em&limit=1'); _incrOk = true; }
      catch (e) { _incrOk = false; }
    }

    // mensagens: janela recente (incremental), tudo (legado) ou só deltas (recarga leve)
    let msgR = null;
    if (leve && _incrOk) {
      msgR = 'manter';
      try { await buscarDeltas(); await reconciliarAgendadas(); } catch (e) {}
    } else if (_incrOk) {
      try {
        const [janela, fila] = await Promise.all([
          rest('GET', 'mensagens?select=*&order=criado_em.desc&limit=1500'),
          restTudo('mensagens?select=*&status=in.(pendente,agendada,erro)&order=criado_em.asc')
        ]);
        const vistos = new Set();
        msgR = janela.reverse().concat(fila).filter(r => vistos.has(r.id) ? false : vistos.add(r.id));
      } catch (e) { msgR = null; }
    } else {
      msgR = await restTudo('mensagens?select=*&order=criado_em.asc').catch(() => null);
    }

    const [leadsR, ctR, fusR, ansR, cadsR, cfgR, convR, deptR, rrR, timeR, tagsR, notifR, v4R, crmV1R, fuMsgR, autoR, deptsR, camposR, tagOrdemR] = await Promise.all([
      restTudo('leads?select=*&order=criado_em.desc'),
      restTudo('contratos?select=*&order=data.desc'),
      restTudo('followups?select=*'),
      // só as colunas que o mapper usa: score/temperatura/criado_em são cópias do que já vem em `dados`
      restTudo('analises?select=id,lead_id,dados&order=criado_em.desc'),
      rest('GET', 'cadencias?select=*'),
      rest('GET', 'config?select=*'),
      restTudo('conversas?select=*').catch(() => null),
      rest('GET', 'departamentos?select=*').catch(() => null),
      rest('GET', 'respostas_rapidas?select=*').catch(() => null),
      rest('GET', 'perfis?select=id,nome,email,papel,ativo,departamento_id,departamento_ids,permissoes,assinatura,exibir_assinatura,modo_espiao,espiao_zera_ao_enviar,horario_ativo,horario').catch(() =>
        rest('GET', 'perfis?select=id,nome,email,papel,ativo,departamento_id').catch(() =>
          rest('GET', 'perfis?select=id,nome,email,papel,ativo').catch(() => []))),
      rest('GET', 'tags?select=*&order=nome.asc').catch(() => null),
      rest('GET', 'notificacoes?select=*&order=criado_em.desc&limit=80').catch(() => null),
      _v4Ok ? Promise.resolve(true) : rest('GET', 'mensagens?select=citado&limit=1').then(() => true).catch(() => false),
      _crmV1Ok ? Promise.resolve(true) : rest('GET', 'leads?select=eventos&limit=1').then(() => true).catch(() => false),
      _fuMsgOk ? Promise.resolve(true) : rest('GET', 'followups?select=msg_id&limit=1').then(() => true).catch(() => false),
      rest('GET', 'automacoes?select=*&order=criado_em.asc').catch(() => null),
      // chat-v14a: a coluna existe? (sondagem própria: inferir de convR[0] falharia para quem não vê conversa nenhuma)
      _deptsOk ? Promise.resolve(true) : rest('GET', 'conversas?select=departamento_ids&limit=1').then(() => true).catch(() => false),
      // chat-v18a: lista de campos personalizados (tabela ausente → null → lista vazia, sondagem falsa)
      rest('GET', 'campos_personalizados?select=*&order=ordem.asc,nome.asc').catch(() => null),
      // chat-v19c: a coluna tags.ordem existe? (antes dela, a ordem fica só na aba)
      _tagOrdemOk ? Promise.resolve(true) : rest('GET', 'tags?select=ordem&limit=1').then(() => true).catch(() => false)
    ]);

    // o que ainda não subiu é separado AGORA (depois dos awaits: pega até o que
    // o usuário fez enquanto a recarga baixava)
    const sujos = capturarSujos();

    /* Travas das migrações: uma vez detectadas, não "desligam" por uma falha
       momentânea de rede. Antes, um soluço numa recarga desligava o chat por
       4 min e — pior — liberava todas as alçadas na tela (pode() devolvia true). */
    const atendAgora = !!(convR && msgR && deptR && rrR);
    _atendOk = _atendOk || atendAgora;
    _tagsOk = _tagsOk || !!tagsR;
    _tagOrdemOk = _tagOrdemOk || !!tagOrdemR;
    _v4Ok = _v4Ok || !!v4R;
    _crmV1Ok = _crmV1Ok || !!crmV1R;
    _fuMsgOk = _fuMsgOk || !!fuMsgR;
    _autoOk = _autoOk || !!autoR;
    if (autoR) state.automacoes = autoR.map(autoDeDb);
    _deptsOk = _deptsOk || !!deptsR;
    _camposOk = _camposOk || !!camposR;
    if (camposR) state.camposPersonalizados = camposR.map(campoDeDb);
    // migração de alçadas (chat-v8) rodada? (o select estendido de perfis funcionou)
    _permOk = _permOk || !!(timeR && timeR.length && timeR[0].permissoes !== undefined);
    // atualiza o MEU perfil com os campos de alçada (assinatura, espião, horário...)
    if (meuPerfil) {
      const eu = (timeR || []).find(p => p.id === meuPerfil.id);
      if (eu) Object.assign(meuPerfil, eu);
    }
    if (atendAgora) {
      state.conversas = convR.map(convDeDb);
      _convCursor = '';
      convR.forEach(r => { const c = r.atualizado_em || ''; if (c > _convCursor) _convCursor = c; });
      if (!_convCursor) _convCursor = new Date().toISOString();
      if (msgR !== 'manter') {
        state.mensagens = msgR.map(msgDeDb);
        _msgCursor = '';
        msgR.forEach(r => { const c = r.atualizado_em || r.criado_em || ''; if (c > _msgCursor) _msgCursor = c; });
        if (!_msgCursor) _msgCursor = new Date().toISOString();
      }
      state.departamentos = deptR.map(d => ({ id: d.id, nome: d.nome, cor: d.cor, permissoes: d.permissoes || {} }));
      state.respostasRapidas = rrR.map(r => ({ id: r.id, atalho: r.atalho, titulo: r.titulo, texto: r.texto, dono: r.dono }));
    }
    if (tagsR) state.tags = tagsR.map(t => ({ id: t.id, nome: t.nome, cor: t.cor, ordem: t.ordem == null ? null : Number(t.ordem) }));
    if (notifR) state.notificacoes = notifR;
    if (timeR && timeR.length) state.time = timeR.filter(p => p.ativo);
    const porLead = {};
    ctR.forEach(r => { (porLead[r.lead_id] = porLead[r.lead_id] || []).push(contratoDeDb(r)); });

    state.leads = leadsR.map(r => leadDeDb(r, porLead[r.id]));
    state.followups = fusR.map(fuDeDb);
    state.analyses = ansR.map(r => Object.assign({}, r.dados, { id: r.id, leadId: r.lead_id }));

    if (cadsR.length) {
      state.cadences = cadsR.map(r => ({ id: r.id, nome: r.nome, cenario: r.cenario, ref: r.ref, passos: r.passos || [] }));
    } else {
      // banco sem cadências: usa as padrão. Só o admin semeia (e uma recusa
      // aqui não pode impedir ninguém de entrar)
      state.cadences = Cadence.defaults();
      if (admin()) {
        try { await rest('POST', 'cadencias', state.cadences.map(cadParaDb), 'resolution=merge-duplicates,return=minimal'); }
        catch (e) { console.warn('Não consegui semear as cadências padrão:', e.message); }
      }
    }

    const geral = ((cfgR || []).find(x => x.chave === 'geral') || {}).valor || {};
    _geralBanco = geral;
    state.settings = {
      nomeAtendente: meuPerfil.nome || '',
      empresa: geral.empresa || '',
      investimentoMkt: Number(geral.investimentoMkt) || 0,
      modeloIA: geral.modeloIA || 'claude-opus-5-5',   // IA do escritório: modelo escolhido pelo admin, vale para todos
      /* v6 — compartilhados do escritório (config.geral) */
      investimentoPorMes: geral.investimentoPorMes || {},
      metaLeads: Number(geral.metaLeads) || 0,
      metaContratos: Number(geral.metaContratos) || 0,
      metaReceita: Number(geral.metaReceita) || 0,
      contextoIA: geral.contextoIA || { areas: '', diferenciais: '', honorarios: '' },
      autoCriarLead: geral.autoCriarLead !== false,
      analiseAutomatica: geral.analiseAutomatica !== false,
      janelaEnvio: geral.janelaEnvio || '09:00-18:00',
      esfriandoHoras: Number(geral.esfriandoHoras) || 6,
      inatividadeHoras: normHorasInatividade(geral.inatividadeHoras),
      leadsVisao: (state.settings && state.settings.leadsVisao) || 'lista', // preferência local
      cadenciasEditadas: geral.cadenciasEditadas || [],
      playbook: geral.playbook || null
    };

    reaplicarSujos(sujos);
    // a sombra é tirada da versão do BANCO; o que estava sujo volta como diferença
    _shadow = snapshot();
    sombraComSujos(sujos);
    save(); // atualiza a preferência local
    gravarAtividade(true); // guarda o limite de inatividade vindo do config (vale na próxima recarga)
  }

  /* recarrega dados do time quando é seguro (nada sendo editado).
     4 min: este é o pulso mais caro (baixa TODAS as tabelas pequenas inteiras);
     o que é urgente — mensagens e notificações — tem pulsos próprios, mais leves.
     Só roda com a aba visível (document.hidden === false, checado abaixo). */
  setInterval(async () => {
    // _pendente não bloqueia mais: a recarga preserva o que ainda não subiu
    // (antes, uma pendência travada deixava a aba sem receber nada para sempre)
    if (!ativo() || _sessaoMorta || _sincronizando || document.hidden) return;
    const ae = document.activeElement;
    if (ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) return;
    const modal = document.getElementById('modal-backdrop');
    if (modal && !modal.hidden) return;
    try {
      await carregarTudo(true); // leve: tabelas pequenas inteiras + só o DELTA das mensagens
      // no Chat a atualização é cirúrgica (não reconstrói a tela nem pausa áudios)
      if (document.body.classList.contains('modo-chat') && window.ChatUI && ChatUI.aoAtualizar) ChatUI.aoAtualizar(false);
      else UI.refresh();
    } catch (e) {}
  }, 240000 + Math.random() * 60000); // jitter: as abas do time não batem juntas

  /* pulso rápido do atendimento: deltas minúsculos a cada ~3s — mantido curto de
     propósito (latência de atendimento é prioridade). Só roda com a aba VISÍVEL
     (document.hidden) e DENTRO do Chat (#/atendimento); fora dele, nada roda. */
  let _pulsoAssinatura = '';
  let _pulsoMsgsAssinatura = '';
  let _tickPulso = 0;
  setInterval(async () => {
    // a LEITURA não depende da escrita: com pendência de envio, as mensagens
    // dos clientes continuam chegando (mesclar respeita o que ainda não subiu)
    if (!ativo() || !_atendOk || _sessaoMorta || _sincronizando || document.hidden) return;
    if (!location.hash.startsWith('#/atendimento')) return;
    const modal = document.getElementById('modal-backdrop');
    if (modal && !modal.hidden) return;
    _tickPulso++;
    try {
      let mudou = false;

      if (_incrOk) {
        // caminho incremental (3s): dois deltas minúsculos — mensagens e conversas
        const [dMsgs, dConvs] = await Promise.all([buscarDeltas(), buscarDeltasConversas()]);
        mudou = !!(dMsgs && dMsgs.length) || !!dConvs;
      } else {
        // caminho legado (antes do chat-v7.sql): puxa tudo na cadência antiga (~10s)
        if (_tickPulso % 3) return;
        const [convR, msgR] = await Promise.all([
          rest('GET', 'conversas?select=*'),
          rest('GET', 'mensagens?select=*&order=criado_em.asc')
        ]);
        const assinaturaMsgs = msgR.length + ':' + (msgR.length ? msgR[msgR.length - 1].id : '') + ':' +
          msgR.slice(-80).map(m => (m.status || '')[0] + ((m.reacoes && m.reacoes.length) || 0) + (m.transcricao ? 't' : '') + (m.enquete ? Object.keys(m.enquete.votos || {}).length : '')).join('');
        if (assinaturaMsgs !== _pulsoMsgsAssinatura) {
          _pulsoMsgsAssinatura = assinaturaMsgs;
          state.mensagens = msgR.map(msgDeDb);
          if (_shadow) _shadow.mensagens = snapshot().mensagens;
          mudou = true;
        }
        const assinaturaConv = convR.map(c => c.id + c.status + (c.nao_lidas || 0) + (c.ultima_msg_em || '') + idsDeDepartamento(c).join(',') + (c.responsavel || '')).join('|');
        if (assinaturaConv !== _pulsoAssinatura) {
          _pulsoAssinatura = assinaturaConv;
          state.conversas = convR.map(convDeDb);
          if (_shadow) _shadow.conversas = snapshot().conversas;
          mudou = true;
        }
      }
      if (!mudou) return;

      const ae = document.activeElement;
      const digitando = ae && (/INPUT|TEXTAREA/.test(ae.tagName) || ae.isContentEditable);
      if (window.ChatUI && ChatUI.aoAtualizar) ChatUI.aoAtualizar(digitando);
      else if (!digitando) UI.refresh();
      else UI.atualizarBadges();
    } catch (e) {}
  }, 3200 + Math.random() * 900); // 3s com jitter: os deltas são minúsculos

  /* ---------------- mídia (Supabase Storage) ---------------- */

  /* sobe um arquivo do navegador para o bucket `midias` e devolve os dados da mídia */
  async function uploadMidia(file, conversaId) {
    await tokenValido();
    const ext = (file.name && file.name.includes('.') ? file.name.split('.').pop() : (file.type.split('/')[1] || 'bin'))
      .toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'bin';
    const caminho = `${conversaId || 'geral'}/${Date.now()}-${uid().slice(0, 8)}.${ext}`;
    const r = await fetch(`${URL_BASE}/storage/v1/object/midias/${caminho}`, {
      method: 'POST',
      // sem x-upsert: o caminho é único (hora + id) e sobrescrever exigiria permissão de
      // leitura/listagem do bucket, que o chat-v12b retira de todos (só o motor lista)
      headers: {
        apikey: KEY,
        Authorization: 'Bearer ' + sessao.access_token,
        'content-type': file.type || 'application/octet-stream'
      },
      body: file
    });
    if (!r.ok) throw new Error('Falha ao enviar o arquivo (' + r.status + '). A migração chat-v2.sql já foi executada?');
    return {
      url: `${URL_BASE}/storage/v1/object/public/midias/${caminho}`,
      mime: file.type || 'application/octet-stream',
      nome: file.name || caminho.split('/').pop(),
      tamanho: file.size || 0
    };
  }

  /* ---------------- comandos do motor (grupos, fotos, transcrição) ---------------- */

  async function enviarComando(tipo, payload) {
    const rows = await rest('POST', 'motor_comandos', [{ tipo, payload, autor: meuPerfil ? meuPerfil.id : null }], 'return=representation');
    return rows && rows[0];
  }

  /* aguarda o motor executar (poll a cada 1,5s até `timeout` segundos) */
  async function aguardarComando(id, timeout = 25) {
    for (let i = 0; i < Math.ceil(timeout / 1.5); i++) {
      await new Promise(r => setTimeout(r, 1500));
      const rows = await rest('GET', 'motor_comandos?id=eq.' + id + '&select=*');
      const c = rows && rows[0];
      if (c && c.status === 'ok') return c;
      if (c && c.status === 'erro') throw new Error(c.erro || 'O motor não conseguiu executar.');
    }
    const e = new Error('O motor demorou para responder. Verifique se está conectado (Configurações → Motor).');
    e.prazoEsgotado = true;   // quem espera um trabalho longo (arquivo grande) pode continuar esperando
    throw e;
  }

  /* ---------------- notificações internas ---------------- */

  async function notificar(perfilIds, texto, conversaId, tipo) {
    const linhas = (perfilIds || []).filter(Boolean).map(pid => ({
      perfil_id: pid, tipo: tipo || 'mencao', conversa_id: conversaId || null, texto: (texto || '').slice(0, 300)
    }));
    if (linhas.length) await rest('POST', 'notificacoes', linhas, 'return=minimal');
  }

  async function recarregarNotificacoes() {
    const rows = await rest('GET', 'notificacoes?select=*&order=criado_em.desc&limit=80').catch(() => null);
    if (rows) state.notificacoes = rows;
    return state.notificacoes;
  }

  async function marcarNotifLida(id) {
    const n = (state.notificacoes || []).find(x => x.id === id);
    if (n) n.lida = true;
    await rest('PATCH', 'notificacoes?id=eq.' + id, { lida: true }, 'return=minimal').catch(() => {});
  }

  async function marcarNotifsLidas() {
    (state.notificacoes || []).forEach(n => n.lida = true);
    await rest('PATCH', 'notificacoes?lida=eq.false', { lida: true }, 'return=minimal').catch(() => {});
  }

  /* ---------------- horário de acesso (alçadas) ---------------- */
  /* o leitor do texto de horário é o de store.js (interpretarHorario): o
     antigo, duplicado aqui, entrava em laço infinito com "seg-sexta" e
     congelava a aba do atendente um minuto depois de cada login */
  function dentroDoHorarioAcesso(spec) { return dentroDoHorario(spec); }

  /* presença (chat-v16a): um pulso por minuto enquanto a aba está visível. O
     banco guarda entrada e último pulso de cada acesso; Configurações → Equipe
     mostra quem está online (todo o time) e os horários de acesso (admin).
     Sem a migração a RPC responde 404 e o pulso se desliga até a próxima recarga. */
  let _presencaOk = null;   // null = ainda não sondado; false = RPC ausente
  let _sessaoAcesso = null; // id do acesso em curso desta aba (a RPC prorroga ou abre outro)
  async function pulsarPresenca() {
    if (!ativo() || !meuPerfil || _sessaoMorta || document.hidden || _presencaOk === false) return;
    try {
      const id = await rest('POST', 'rpc/registrar_presenca', { sessao: _sessaoAcesso });
      _presencaOk = true;
      if (typeof id === 'string' && id) _sessaoAcesso = id;
    } catch (e) {
      if (e.status === 404 || e.code === 'PGRST202' || e.code === '42883') _presencaOk = false;
    }
  }
  // voltou para a aba (ou o computador acordou): primeiro confere se a sessão
  // parou tempo demais; se não, avisa a presença na hora, sem esperar o próximo minuto
  if (document.addEventListener) document.addEventListener('visibilitychange', () => {
    if (document.hidden || conferirInatividade()) return;
    pulsarPresenca();
  });
  /* quem está online: [{perfil_id, visto_em}] de todo o time (null sem a migração) */
  const equipePresenca = () => rest('POST', 'rpc/equipe_presenca', {})
    .catch(e => (e.status === 404 || e.code === 'PGRST202' || e.code === '42883') ? null : Promise.reject(e));
  /* horários de acesso de hoje (só o admin lê a tabela; null sem a migração) */
  function acessosDeHoje() {
    if (!admin()) return Promise.resolve(null);
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return rest('GET', 'acessos?select=perfil_id,entrou_em,visto_em&visto_em=gte.' + encodeURIComponent(d.toISOString()) + '&order=entrou_em.asc')
      .catch(e => (e.status === 404 || e.code === '42P01') ? null : Promise.reject(e));
  }

  /* a cada minuto: horário de acesso e o próprio perfil (desativado, alçadas
     ou departamentos mudados pelo admin passam a valer em até 1 min — antes
     só na recarga de 4–5 min, e a desativação nem era percebida) */
  setInterval(async () => {
    if (!ativo() || !meuPerfil || _sessaoMorta) return;
    if (conferirInatividade()) return; // sessão parada há mais de N h: encerrou agora
    if (!document.hidden) {
      pulsarPresenca();
      try {
        const rows = await rest('GET', 'perfis?id=eq.' + meuPerfil.id + '&select=ativo,papel,permissoes,departamento_id,departamento_ids,modo_espiao,espiao_zera_ao_enviar,horario_ativo,horario,assinatura,exibir_assinatura');
        const eu = rows && rows[0];
        if (eu && eu.ativo === false) { sessaoExpirada('Seu acesso foi desativado pelo administrador.'); return; }
        if (eu) {
          const antes = JSON.stringify([meuPerfil.papel, meuPerfil.permissoes, meuPerfil.departamento_ids, meuPerfil.modo_espiao]);
          Object.assign(meuPerfil, eu);
          if (antes !== JSON.stringify([eu.papel, eu.permissoes, eu.departamento_ids, eu.modo_espiao])) {
            if (window.ChatUI && ChatUI.aoAtualizar && document.body.classList.contains('modo-chat')) ChatUI.aoAtualizar(false);
            else UI.atualizarBadges();
          }
        }
      } catch (e) {}
    }
    if (meuPerfil && meuPerfil.papel !== 'admin' && meuPerfil.horario_ativo && !dentroDoHorarioAcesso(meuPerfil.horario)) {
      UI.toast('Fora do seu horário de acesso — até a próxima!', 'err');
      setTimeout(sair, 1500);
    }
  }, 60000);

  /* pulso global de notificações (45s): menções novas e mensagens do meu departamento,
     em qualquer tela do sistema. O Chat registra o ouvinte em window.ChatUI. */
  let _notifVistas = null;
  let _convAssin = null;
  setInterval(async () => {
    if (!ativo() || !_atendOk || !_tagsOk || _sincronizando || document.hidden) return;
    try {
      const [notifR, convR, motorR] = await Promise.all([
        rest('GET', 'notificacoes?select=*&order=criado_em.desc&limit=80'),
        // departamento_ids só depois da sondagem: pedir uma coluna inexistente derruba o pulso inteiro (400)
        restTudo(`conversas?select=id,nome,nao_lidas,departamento_id,${_deptsOk ? 'departamento_ids,' : ''}responsavel,ultima_msg,ultima_msg_em,arquivada`),
        rest('GET', 'motor_estado?select=situacao,atualizado_em&id=eq.principal').catch(() => null)
      ]);
      // vigia do motor: avisa o time se o WhatsApp parar de fluir
      if (window.ChatUI && ChatUI.aoMotor) ChatUI.aoMotor(motorR && motorR[0]);
      // menções novas
      const antes = _notifVistas;
      _notifVistas = new Set((notifR || []).map(n => n.id));
      state.notificacoes = notifR || [];
      const novas = antes ? (notifR || []).filter(n => !n.lida && !antes.has(n.id)) : [];
      // mensagens novas nas conversas que eu vejo — mesma regra da lista
      // (antes usava só o departamento_id antigo: quem foi criado pelo painel,
      // com departamento_ids, não era avisado das conversas do próprio departamento)
      const minhas = (convR || []).filter(c => !c.arquivada &&
        podeVerConversa({ departamentoIds: idsDeDepartamento(c), responsavel: c.responsavel }));
      const assin = {};
      minhas.forEach(c => assin[c.id] = c.nao_lidas || 0);
      const aumentaram = _convAssin ? minhas.filter(c => (c.nao_lidas || 0) > (_convAssin[c.id] || 0)) : [];
      // MENSAGEM PRIMEIRO, AVISO DEPOIS: se algo novo chegou, puxa as mensagens
      // do banco ANTES de disparar toast/som — a bolha já está na tela quando o aviso toca
      if ((novas.length || aumentaram.length) && _incrOk) {
        try { await buscarDeltas(); } catch (e) {}
        // sem tirar o foco de quem está digitando (a lista reconstruída roubava o campo de busca)
        const ae = document.activeElement;
        const digitando = ae && (/INPUT|TEXTAREA/.test(ae.tagName) || ae.isContentEditable);
        if (window.ChatUI && ChatUI.aoAtualizar) { try { ChatUI.aoAtualizar(digitando); } catch (e) {} }
      }
      if (novas.length && window.ChatUI && ChatUI.aoNotificar) novas.forEach(n => ChatUI.aoNotificar('mencao', n));
      if (aumentaram.length && window.ChatUI && ChatUI.aoNotificar) aumentaram.forEach(c => ChatUI.aoNotificar('mensagem', c));
      _convAssin = assin;
      if (window.ChatUI && ChatUI.aoAtualizarSino) ChatUI.aoAtualizarSino();
    } catch (e) {}
  }, 45000 + Math.random() * 15000); // jitter: as abas do time não batem juntas

  /* ---------------- importação de dados locais / backup ---------------- */

  const ehUuid = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id));

  function remapearIds(dados) {
    const mapa = {};
    const fix = obj => { if (obj && !ehUuid(obj.id)) { mapa[obj.id] = mapa[obj.id] || uid(); obj.id = mapa[obj.id]; } };
    (dados.leads || []).forEach(l => { fix(l); (l.contratos || []).forEach(fix); });
    (dados.analyses || []).forEach(a => { fix(a); if (a.leadId && mapa[a.leadId]) a.leadId = mapa[a.leadId]; });
    (dados.followups || []).forEach(f => { fix(f); if (f.leadId && mapa[f.leadId]) f.leadId = mapa[f.leadId]; });
    return dados;
  }

  function importarDados(dados) {
    if (!dados) return 0;
    remapearIds(dados);
    const idsLead = new Set(state.leads.map(l => l.id));
    const idsAn = new Set(state.analyses.map(a => a.id));
    const idsFu = new Set(state.followups.map(f => f.id));
    let n = 0;
    (dados.leads || []).forEach(l => { if (!idsLead.has(l.id)) { state.leads.push(l); n++; } });
    (dados.analyses || []).forEach(a => { if (!idsAn.has(a.id)) state.analyses.push(a); });
    (dados.followups || []).forEach(f => { if (!idsFu.has(f.id)) state.followups.push(f); });
    if (Array.isArray(dados.cadences) && dados.cadences.length) state.cadences = dados.cadences;
    if (dados.settings) {
      if (!state.settings.empresa && dados.settings.empresa) state.settings.empresa = dados.settings.empresa;
      if (!state.settings.investimentoMkt && dados.settings.investimentoMkt) state.settings.investimentoMkt = dados.settings.investimentoMkt;
      // a chave da IA de backups antigos é ignorada: a IA do escritório fica no motor
    }
    state.leads.sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
    save();
    return n;
  }

  function ofertarImportLocal() {
    const n = _localAntes && Array.isArray(_localAntes.leads) ? _localAntes.leads.length : 0;
    if (!n || state.leads.length) return;
    if (confirm(`Encontrei ${n} lead(s) salvos neste navegador (da versão local do sistema).\n\nEnviar tudo para a nuvem agora? (leads, análises, follow-ups e cadências)`)) {
      const criados = importarDados(_localAntes);
      UI.toast(`${criados} lead(s) enviados para a nuvem.`);
      UI.refresh();
    }
  }

  /* ---------------- equipe (admin) ---------------- */

  async function listarPerfis() {
    return rest('GET', 'perfis?select=*&order=nome.asc');
  }

  async function atualizarPerfilAdmin(id, patch) {
    await rest('PATCH', 'perfis?id=eq.' + id, patch, 'return=minimal');
  }

  /* anotação interna: apaga de vez, direto na tabela (política msg_apagar + alçada notas_apagar, chat-v19a).
     Pede as linhas apagadas de volta: 0 linhas = o banco barrou (sem alçada lá) ou um colega já apagou. */
  async function apagarAnotacao(id) {
    const linhas = await rest('DELETE', `mensagens?id=eq.${encodeURIComponent(id)}&tipo=eq.anotacao`, null, 'return=representation');
    if (Array.isArray(linhas) && !linhas.length) throw new Error('A anotação não foi apagada: ela já foi apagada por um colega, ou você não tem essa alçada.');
  }

  async function salvarMeuNome(nome) {
    await rest('PATCH', 'perfis?id=eq.' + meuPerfil.id, { nome }, 'return=minimal');
    meuPerfil.nome = nome;
  }

  /* ---------------- tela de login (gate) ---------------- */

  function mostrarGate(msg) {
    const g = document.getElementById('auth-gate');
    if (!g) return;
    g.hidden = false;
    document.querySelector('.app').style.display = 'none';
    // nenhum modal faz sentido sob a tela de login (e o formulário de quem saiu não vaza para o próximo)
    if (typeof UI !== 'undefined' && UI.fecharModal) { try { UI.fecharModal(); } catch (e) {} }
    // sem mensagem explícita: motivo guardado por uma saída automática (some no próximo login)
    if (!msg) msg = lerMotivoSaida();
    if (msg) erroGate(msg);
  }

  /* o botão "Sair" da barra lateral nasce escondido no HTML (sem login não faz
     sentido); aparece em TODA entrada — pela sessão guardada (iniciar) e pelo
     login na tela de entrada. Antes só o iniciar() mostrava: quem entrava pela
     tela ficava sem o botão até o próximo F5. */
  function mostrarBotaoSair() {
    const b = document.getElementById('btn-sair');
    if (b) b.hidden = false;
  }

  function esconderGate() {
    const g = document.getElementById('auth-gate');
    if (g) g.hidden = true;
    document.querySelector('.app').style.display = '';
    mostrarBotaoSair();
  }

  function erroGate(msg) {
    const e = document.getElementById('auth-error');
    if (e) { e.textContent = msg; e.hidden = false; }
  }

  function gateCarregando(sim, texto) {
    const b = document.getElementById('auth-entrar');
    if (b) { b.disabled = sim; b.textContent = sim ? (texto || 'Entrando...') : 'Entrar'; }
  }

  function prepararGate() {
    const em = document.getElementById('auth-email');
    if (em) em.placeholder = 'voce@' + ESCRITORIO.dominioEmail;
    const btn = document.getElementById('auth-entrar');
    if (!btn) return;
    const submit = async () => {
      const email = document.getElementById('auth-email').value.trim();
      const senha = document.getElementById('auth-senha').value;
      if (!email || !senha) { erroGate('Preencha e-mail e senha.'); return; }
      document.getElementById('auth-error').hidden = true;
      let fase = 'login';
      gateCarregando(true);
      try {
        await entrar(email, senha);
        fase = 'perfil';
        gateCarregando(true, 'Verificando seu perfil...');
        await ensurePerfil();
        fase = 'dados';
        gateCarregando(true, 'Carregando seus dados...');
        await carregarTudo();
        esconderGate();
        UI.navegar();
        UI.toast('Bem-vindo(a), ' + (primeiroNome(meuPerfil.nome) || 'time ' + ESCRITORIO.curto) + '!');
        ofertarImportLocal();
      } catch (e) {
        console.error(ESCRITORIO.log + ' Falha na fase "' + fase + '":', e);
        if (fase === 'login' || e.inativo) setSessao(null);
        let msg = e.message || 'Erro inesperado.';
        if (/failed to fetch|networkerror|load failed/i.test(msg)) msg = 'Sem conexão com o servidor. Verifique sua internet e tente de novo.';
        const rotulo = { login: '', perfil: 'Login OK, mas falhou ao verificar o perfil: ', dados: 'Login OK, mas falhou ao carregar os dados: ' }[fase];
        erroGate(rotulo + msg);
      }
      gateCarregando(false);
    };
    btn.addEventListener('click', submit);
    ['auth-email', 'auth-senha'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', ev => { if (ev.key === 'Enter') submit(); });
    });
    document.getElementById('auth-esqueci').addEventListener('click', async ev => {
      ev.preventDefault();
      const email = document.getElementById('auth-email').value.trim();
      if (!email) { erroGate('Digite seu e-mail no campo acima e clique de novo em "Esqueci minha senha".'); return; }
      try {
        await recuperarSenha(email);
        erroGate('Enviamos um link de redefinição para ' + email + '.');
      } catch (e) { erroGate(e.message); }
    });
  }

  /* tenta retomar a sessão salva; retorna true se o app pode abrir */
  async function iniciar() {
    // veio do link "redefinir senha" do e-mail? mostra a tela de nova senha e para aqui
    const rec = detectarRecovery();
    if (rec) { mostrarGateNovaSenha(rec); return true; }
    try { _localAntes = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { _localAntes = null; }
    try { sessao = JSON.parse(localStorage.getItem(CHAVE_SESSAO)); } catch (e) { sessao = null; }
    if (!sessao) return false;
    // parou de usar ontem e abriu hoje: encerra antes de baixar qualquer dado
    const parado = atividadeGravada();
    if (parado && parado.limite > 0 && Date.now() - parado.em > parado.limite) {
      mostrarGate(msgInatividade(parado.limite));
      await encerrarNoServidor(); // renova e revoga: a sessão morre no servidor também
      setSessao(null);
      meuPerfil = null;
      limparNavegador();
      return false;
    }
    // recarga não é uso (troca de versão e a espera de 15 s recarregam sozinhas)
    if (parado) _ultimaAtividade = parado.em;
    try {
      await tokenValido();
      await ensurePerfil();
      await carregarTudo();
      pulsarPresenca(); // primeiro pulso: a pessoa aparece online para o time
      mostrarBotaoSair();
      setTimeout(ofertarImportLocal, 800);
      return true;
    } catch (e) {
      // só desloga se a SESSÃO for inválida (ou o acesso desativado). Falta de
      // internet no F5 apagava a sessão e obrigava a digitar a senha de novo.
      if (e.auth || e.inativo) {
        console.warn('Sessão inválida:', e.message);
        setSessao(null);
        mostrarGate(e.inativo ? e.message : '');
        return false;
      }
      console.warn('Falha ao iniciar (sessão mantida):', e.message);
      mostrarGate('Sem conexão com o servidor. Tentando de novo em 15 segundos — não é preciso digitar a senha.');
      setTimeout(() => location.reload(), 15000);
      return false;
    }
  }

  /* zera as não lidas de uma conversa direto no banco (sem subir a linha inteira) */
  async function marcarLida(cid) {
    if (!ativo() || !cid) return;
    try { await rest('POST', 'rpc/marcar_lida', { cid }, 'return=minimal'); }
    catch (e) {
      // migração chat-v12a ainda não rodou: cai no PATCH só da coluna
      if (e.status === 404 || e.code === 'PGRST202') {
        try { await rest('PATCH', 'conversas?id=eq.' + cid, { nao_lidas: 0 }, 'return=minimal'); } catch (e2) {}
      }
    }
  }

  /* devolve a conversa à fila de não lidas do time (RPC do chat-v13a);
     sem a migração, PATCH só da coluna. Erros de alçada sobem para o toast. */
  async function marcarNaoLida(cid) {
    if (!ativo() || !cid) return;
    try { await rest('POST', 'rpc/marcar_nao_lida', { cid }, 'return=minimal'); }
    catch (e) {
      if (e.status !== 404 && e.code !== 'PGRST202') throw e;
      await rest('PATCH', 'conversas?id=eq.' + cid, { nao_lidas: 1 }, 'return=minimal');
    }
  }

  /* liga/desliga UM departamento da conversa no banco, de forma atômica
     (rpc conversa_departamento, chat-v14a): a aba nunca manda a lista inteira,
     que pode estar velha — o motor ou um colega podem ter mexido segundos antes.
     Devolve a lista como ficou. Sem a RPC (404) o chamador cai no upsert. */
  /* campos personalizados (chat-v18a): grava UMA chave de conversas.campos pela função do banco,
     que confere a visibilidade da conversa e a existência do campo. Devolve o objeto novo; null quando
     a função ainda não existe no banco. Valor vazio apaga a chave. */
  async function definirCampo(cid, campoId, valor) {
    if (!ativo() || !cid || !campoId) return null;
    try {
      return await rest('POST', 'rpc/conversa_campo', { cid, chave: campoId, valor: String(valor == null ? '' : valor) });
    } catch (e) {
      if (e.status === 404 && (e.code === 'PGRST202' || !e.code)) return null;
      throw e;
    }
  }
  /* recarrega a lista de campos do banco (ex.: um colega apagou um campo com a tela aberta) e
     ajusta a sombra do sync junto, para a recarga não virar diff nem exclusão fantasma */
  async function recarregarCampos() {
    if (!ativo()) return false;
    const rows = await rest('GET', 'campos_personalizados?select=*&order=ordem.asc,nome.asc').catch(() => null);
    if (!rows) return false;
    state.camposPersonalizados = rows.map(campoDeDb);
    if (_shadow) {
      _shadow.campos_personalizados = {};
      state.camposPersonalizados.forEach(c => { _shadow.campos_personalizados[c.id] = JSON.stringify(campoParaDb(c)); });
    }
    return true;
  }
  async function alternarDepartamento(cid, did, ligar) {
    if (!ativo() || !cid || !did) return null;
    try {
      return await rest('POST', 'rpc/conversa_departamento', { cid, did, ligar: !!ligar });
    } catch (e) {
      if (e.status === 404 || e.code === 'PGRST202') return null;
      throw e;
    }
  }
  /* a RPC gravou SÓ a lista de departamentos: remenda esses campos na sombra e
     preserva o resto como estava — status/tag/responsável alterados na mesma
     janela (debounce de 600 ms) continuam diferentes da sombra e sobem no
     próximo ciclo. Reescrever a sombra inteira engolia essas alterações. */
  function conversaSincronizada(cid) {
    const c = getConversa(cid);
    if (!c || !_shadow || !_shadow.conversas) return;
    const novo = convParaDb(c);
    let base = null;
    try { base = JSON.parse(_shadow.conversas[cid] || 'null'); } catch (e) {}
    if (!base) { _shadow.conversas[cid] = JSON.stringify(novo); return; }
    base.departamento_id = novo.departamento_id;
    if ('departamento_ids' in novo) base.departamento_ids = novo.departamento_ids; else delete base.departamento_ids;
    base.atualizado_em = novo.atualizado_em;
    _shadow.conversas[cid] = JSON.stringify(base);
  }

  /* QR do pareamento: só o admin recebe (rpc motor_qr); antes do chat-v12a,
     cai na leitura antiga da coluna */
  async function motorQr() {
    if (!admin()) return '';
    try { return (await rest('POST', 'rpc/motor_qr', {})) || ''; }
    catch (e) {
      const rows = await rest('GET', 'motor_estado?select=qr&id=eq.principal').catch(() => null);
      return (rows && rows[0] && rows[0].qr) || '';
    }
  }

  return {
    configurado, ativo, admin,
    iniciar, prepararGate, mostrarGate, sair, sairConfirmando,
    agendarSync, sincronizar, carregarTudo,
    listarPerfis, atualizarPerfilAdmin, salvarMeuNome, apagarAnotacao,
    equipePresenca, acessosDeHoje, presencaAtiva: () => _presencaOk,
    marcarAtividade, conferirInatividade, ultimaAtividade: () => _ultimaAtividade,
    importarDados,
    uploadMidia, enviarComando, aguardarComando,
    notificar, recarregarNotificacoes, marcarNotifLida, marcarNotifsLidas,
    carregarHistorico,
    incremental: () => _incrOk,
    alcadasAtivas: () => _permOk,
    perfil: () => meuPerfil,
    atendimentoAtivo: () => _atendOk,
    chatV2Ativo: () => _tagsOk,
    automacoesAtivas: () => _autoOk,
    deptsMultiplos: () => _deptsOk,
    camposAtivos: () => _camposOk, definirCampo, recarregarCampos,
    logAutomacoes: () => rest('GET', 'automacao_log?select=*,automacoes(nome),conversas(nome)&order=executado_em.desc&limit=60'),
    // sem a coluna qr: o QR do pareamento é só do admin (motorQr)
    motorEstado: () => rest('GET', 'motor_estado?select=id,situacao,numero,detalhe,recursos,atualizado_em&id=eq.principal'),
    motorQr, marcarLida, marcarNaoLida, alternarDepartamento, conversaSincronizada, temPendencia,
    sincronizarAgora: () => { _proximaTentativa = 0; return sincronizar(); },
    recusadas: () => _recusadas.slice(),
    CHAVE_IA
  };
})();
