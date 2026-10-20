/* ============ UI CORE — roteador, modal, toast, gráficos ============ */

const Views = {}; // namespace global das telas (preenchido pelos arquivos views-*)

const UI = (() => {

  /* ---------- ícones (SVG inline) ---------- */
  const ICONS = {
    inicio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/></svg>',
    crm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 20h18"/><path d="M6 20v-7l4 3 4-8 4 5v7"/></svg>',
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    leads: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5"/><circle cx="17.5" cy="9.5" r="2.5"/><path d="M16 15.5c2.6.2 4.6 1.5 5.5 4.5"/></svg>',
    atendimento: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-2.9-.4-4.1-1L3 20l1.1-5A8.5 8.5 0 1 1 21 11.5z"/><path d="M8 10h8M8 13.5h5"/></svg>',
    analisar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/><path d="M8 10.5h5M10.5 8v5"/></svg>',
    agenda: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="m9 15 2 2 4-4"/></svg>',
    cadencias: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16M7 12h13M10 19h10"/><circle cx="4" cy="12" r="1.4" fill="currentColor"/><circle cx="7" cy="19" r="1.4" fill="currentColor"/></svg>',
    playbook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>',
    contratos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>',
    equipe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5"/><circle cx="17.5" cy="9.5" r="2.5"/><path d="M16 15.5c2.6.2 4.6 1.5 5.5 4.5"/></svg>',
    config: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.2"/><path d="M19 12a7 7 0 0 0-.15-1.4l2.05-1.6-2-3.46-2.42 1a7 7 0 0 0-2.42-1.4L13.7 2.6h-4l-.36 2.54a7 7 0 0 0-2.42 1.4l-2.42-1-2 3.46 2.05 1.6A7 7 0 0 0 4.4 12c0 .48.05.94.15 1.4L2.5 15l2 3.46 2.42-1a7 7 0 0 0 2.42 1.4l.36 2.54h4l.36-2.54a7 7 0 0 0 2.42-1.4l2.42 1 2-3.46-2.05-1.6c.1-.46.15-.92.15-1.4z"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    wa: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.4 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.4-.7-2.9-1.1-4.7-4-4.9-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5s.8 1.9.8 2c.1.1.1.3 0 .5-.3.6-.6.8-.5 1.1.6 1 1.3 1.7 2.2 2.3.3.2.5.2.7 0 .2-.2.8-.9 1-1.2.2-.3.4-.2.7-.1s1.7.8 2 1c.3.2.5.3.5.4.1.1.1.7-.1 1.3z"/></svg>'
  };

  /* preenche os pontos [data-marca] do index.html com os nomes de ESCRITORIO (js/escritorio.js) */
  function aplicarMarca() {
    document.querySelectorAll('[data-marca]').forEach(el => {
      const k = el.getAttribute('data-marca');
      if (k === 'logo') el.innerHTML = ESCRITORIO.logoSVG;
      else if (k === 'versao') el.textContent = ESCRITORIO.curto + ' · v' + APP_VERSAO.replace(/\.\d+$/, '');
      else el.textContent = ESCRITORIO[k] || '';
    });
  }

  function hydrateIcons(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(el => {
      const ic = ICONS[el.getAttribute('data-icon')];
      if (ic) el.innerHTML = ic;
    });
  }

  /* ---------- toast ---------- */
  function toast(msg, tipo = 'ok') {
    const el = document.createElement('div');
    el.className = 'toast toast-' + tipo;
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = '.3s'; setTimeout(() => el.remove(), 350); }, 3200);
  }

  /* ---------- modal ---------- */
  function modal(html, opts = {}) {
    const bd = document.getElementById('modal-backdrop');
    const m = document.getElementById('modal');
    m.className = 'modal' + (opts.large ? ' modal-lg' : '');
    m.innerHTML = html;
    bd.hidden = false;
    hydrateIcons(m);
    return m;
  }
  function fecharModal() {
    document.getElementById('modal-backdrop').hidden = true;
    document.getElementById('modal').innerHTML = '';
  }
  document.addEventListener('click', e => {
    if (e.target.id === 'modal-backdrop') fecharModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    // o Esc que fecha uma janela sai marcado: os demais handlers de Esc ignoram tecla já tratada
    if (!document.getElementById('modal-backdrop').hidden) e.preventDefault();
    fecharModal();
  });

  /* ---------- copiar para área de transferência ---------- */
  /* `botao` é opcional: sem ele, vale o botão do clique em andamento (window.event).
     O retorno visual — check no botão, alerta, aviso ao leitor de tela — mora em
     js/ui-copiar.js e é preparado ANTES do primeiro await: depois dele o clique já
     passou e window.event não aponta mais para o botão. Sem ui-copiar.js, fica o
     toast de sempre. Devolve true/false (as chamadas atuais ignoram).
     `botao === null` (explícito) diz que NÃO há botão para responder — ex.: item de
     menu que fecha ao clicar e some da tela; o retorno é só o toast, com `aviso`
     no lugar do texto padrão. */
  async function copiar(texto, botao, aviso) {
    const concluir = botao !== null && UI.retornoCopia ? UI.retornoCopia(botao || window.event) : null;
    let ok = true;
    try {
      await navigator.clipboard.writeText(texto);
    } catch (e) {
      // contexto não seguro ou permissão negada: seleção + execCommand, como antes
      const foco = document.activeElement;
      const ta = document.createElement('textarea');
      ta.value = texto; ta.readOnly = true; ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
      // select() levou o foco para o textarea: devolve a quem tinha (o botão)
      if (foco && foco !== document.activeElement && foco.focus) foco.focus({ preventScroll: true });
    }
    if (concluir) concluir(ok);
    else toast(ok ? (aviso || 'Mensagem copiada.') : 'Não foi possível copiar.', ok ? 'ok' : 'err');
    return ok;
  }

  /* ---------- gráficos ---------- */

  /* Duas escalas para o mesmo score: PREENCHIMENTO (barras, arcos, pontos) usa o
     nível 400, vivo; TEXTO usa o nível 600, porque o 400 fica em ~3,4:1 sobre
     branco e não passa no AA. Nunca troque um pelo outro. */
  function scoreColorHex(n) {
    if (n >= 80) return 'var(--success-400)';
    if (n >= 60) return 'var(--chart-2)';
    if (n >= 40) return 'var(--ambar-500)';
    return 'var(--danger-400)';
  }

  /* tokens de estado: no modo noturno o CSS troca o valor, o JS não precisa saber do tema */
  function scoreTextoHex(n) {
    if (n >= 80) return 'var(--state-success-fg)';
    if (n >= 60) return 'var(--state-info-fg)';
    if (n >= 40) return 'var(--state-warning-fg)';
    return 'var(--state-danger-fg)';
  }

  /* funil por etapa */
  function funnelHTML(porEtapa, opts = {}) {
    const etapas = ETAPAS_ABERTAS;
    const valores = etapas.map(e => porEtapa[e] || 0);
    const max = Math.max(...valores, 1);
    let html = '';
    etapas.forEach((e, i) => {
      const v = valores[i];
      const pct = Math.round(v / max * 100);
      let conv = '';
      if (i > 0 && valores[i - 1] > 0) conv = Math.round(v / valores[i - 1] * 100) + '% ▾';
      const acao = opts.drill ? opts.drill(e) : '';
      html += `<div class="funnel-row"${acao ? ` style="cursor:pointer" title="Ver estes leads" onclick="${esc(acao)}"` : ''}>
        <div class="funnel-label">${esc(e)}</div>
        <div class="funnel-bar-wrap"><div class="funnel-bar" style="width:${Math.max(pct, v ? 8 : 0)}%">${v || ''}</div></div>
        <div class="funnel-conv">${conv}</div>
      </div>`;
    });
    const ganho = porEtapa['Ganho'] || 0, perdido = porEtapa['Perdido'] || 0;
    const aG = opts.drill ? opts.drill('Ganho') : '', aP = opts.drill ? opts.drill('Perdido') : '';
    html += `<div class="flex mt">` +
      `<span class="chip chip-green"${aG ? ` style="cursor:pointer" title="Ver os ganhos" onclick="${esc(aG)}"` : ''}>${ICO('check')} Ganhos: ${ganho}</span>` +
      `<span class="chip chip-red"${aP ? ` style="cursor:pointer" title="Ver as perdas" onclick="${esc(aP)}"` : ''}>${ICO('x')} Perdidos: ${perdido}</span></div>`;
    return html;
  }

  /* barras horizontais genéricas: items = [{label, value, color?}] */
  function hbarHTML(items, opts = {}) {
    if (!items.length) return '<div class="muted">Sem dados ainda.</div>';
    const max = Math.max(...items.map(i => i.value), 1);
    return items.map(i => {
      const acao = opts.drill ? opts.drill(i.label) : '';
      return `<div class="hbar-row"${acao ? ` style="cursor:pointer" title="Ver estes leads" onclick="${esc(acao)}"` : ''}>
      <div class="hbar-label" title="${esc(i.label)}">${esc(i.label)}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(i.value / max * 100)}%;background:${i.color || 'var(--grad)'}"></div></div>
      <div class="hbar-val">${opts.fmt ? opts.fmt(i.value) : i.value}</div>
    </div>`;
    }).join('');
  }

  /* gauge semicircular de score */
  function gaugeSVG(score, size = 150) {
    const r = 60, cx = 75, cy = 72;
    const ang = Math.PI * (1 - score / 100);
    const x = cx + r * Math.cos(ang), y = cy - r * Math.sin(ang);
    const large = score > 50 ? 1 : 0;
    const color = scoreColorHex(score);
    const corTexto = scoreTextoHex(score);
    const info = Analysis.labelScore(score);
    return `<svg width="${size}" height="${size * 0.73}" viewBox="0 0 150 110">
      <path d="M 15 72 A 60 60 0 0 1 135 72" fill="none" stroke="var(--border-subtle)" stroke-width="13" stroke-linecap="round"/>
      <path d="M 15 72 A 60 60 0 ${large} 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${color}" stroke-width="13" stroke-linecap="round"/>
      <text x="75" y="66" text-anchor="middle" font-size="30" font-weight="500" font-family="var(--font-mono)" fill="${corTexto}">${score}</text>
      <text x="75" y="86" text-anchor="middle" font-size="11" font-family="var(--font-mono)" letter-spacing="1.3" fill="var(--text-body)">${info.label.toUpperCase()}</text>
      <text x="75" y="103" text-anchor="middle" font-size="9" font-family="var(--font-mono)" letter-spacing="1.2" fill="var(--text-subtle)">SCORE DO ATENDIMENTO</text>
    </svg>`;
  }

  /* radar de 6 dimensões */
  function radarSVG(scores, size = 230) {
    const dims = ['conexao', 'investigacao', 'valor', 'objecoes', 'fechamento', 'conducao'];
    const labels = ['Rapport', 'SPIN', 'Valor', 'Objeções', 'Fechamento', 'Condução'];
    const cx = size / 2, cy = size / 2, R = size / 2 - 34;
    const pt = (i, frac) => {
      const a = -Math.PI / 2 + i * (2 * Math.PI / dims.length);
      return [(cx + R * frac * Math.cos(a)).toFixed(1), (cy + R * frac * Math.sin(a)).toFixed(1)];
    };
    let grid = '';
    [0.33, 0.66, 1].forEach(f => {
      const pts = dims.map((_, i) => pt(i, f).join(',')).join(' ');
      grid += `<polygon points="${pts}" fill="none" stroke="var(--chart-grid)"/>`;
    });
    let eixos = '', rotulos = '';
    dims.forEach((d, i) => {
      const [x, y] = pt(i, 1);
      eixos += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--chart-grid)"/>`;
      const [lx, ly] = pt(i, 1.22);
      rotulos += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="9.5" font-weight="500" fill="var(--text-muted)">${labels[i]}</text>`;
    });
    const dados = dims.map((d, i) => pt(i, Math.max(scores[d] || 0, 4) / 100).join(',')).join(' ');
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      ${grid}${eixos}
      <polygon points="${dados}" fill="var(--chart-2)" fill-opacity=".2" stroke="var(--chart-2)" stroke-width="2"/>
      ${rotulos}
    </svg>`;
  }

  /* gráfico de colunas (série temporal): items = [{label, value, hoje?}] */
  function barChartSVG(items) {
    if (!items.length) return '<div class="muted">Sem dados no período.</div>';
    const bw = 16, gap = 5, padX = 8, h = 165, base = h - 22;
    const w = padX * 2 + items.length * (bw + gap) - gap;
    const max = Math.max(...items.map(i => i.value), 1);
    const step = Math.ceil(items.length / 16);
    let out = '';
    items.forEach((it, i) => {
      const x = padX + i * (bw + gap);
      const bh = it.value ? Math.max(4, Math.round((base - 30) * it.value / max)) : 2;
      const y = base - bh;
      const cor = it.hoje ? 'var(--chart-1)' : 'var(--chart-2)';
      out += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="3" fill="${cor}" opacity="${it.value ? 1 : .22}"><title>${esc(it.data ? fmtDate(it.data) : it.label)}: ${it.value}</title></rect>`;
      if (it.value) out += `<text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" font-size="9.5" font-family="var(--font-mono)" fill="var(--text-muted)">${it.value}</text>`;
      if (i % step === 0 || it.hoje) out += `<text x="${x + bw / 2}" y="${h - 7}" text-anchor="middle" font-size="9" font-family="var(--font-mono)" fill="${it.hoje ? 'var(--text-heading)' : 'var(--text-subtle)'}" font-weight="${it.hoje ? 500 : 400}">${esc(it.label)}</text>`;
    });
    out += `<line x1="0" y1="${base}" x2="${w}" y2="${base}" stroke="var(--chart-grid)"/>`;
    return `<div style="overflow-x:auto"><svg viewBox="0 0 ${w} ${h}" width="100%" style="min-width:${Math.min(w, 900)}px;display:block" preserveAspectRatio="xMidYMid meet">${out}</svg></div>`;
  }

  /* barra de dimensão com score */
  function dimBarHTML(scores) {
    return Object.keys(scores).filter(k => k !== 'geral').map(k => {
      const v = scores[k];
      return `<div class="dim-row">
        <div class="dim-name">${Analysis.labelDim(k)}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${v}%;background:${scoreColorHex(v)}"></div></div>
        <div class="hbar-val" style="color:${scoreTextoHex(v)}">${v}</div>
      </div>`;
    }).join('');
  }

  function chipTemp(t) {
    const cls = t === 'Quente' ? 'chip-red' : t === 'Frio' ? 'chip-cyan' : 'chip-amber';
    const ico = t === 'Quente' ? ICO('flame') : t === 'Frio' ? ICO('snowflake') : ICO('cloud-sun');
    return `<span class="chip ${cls}">${ico} ${esc(t)}</span>`;
  }

  function chipEtapa(e) {
    const cls = e === 'Ganho' ? 'chip-green' : e === 'Perdido' ? 'chip-red' : e === 'Novo' ? 'chip-gray' : 'chip-blue';
    return `<span class="chip ${cls}">${esc(e)}</span>`;
  }

  /* ---------- Sistema: plataformas e roteador ---------- */
  const ROUTES = {};
  const TITLES = {
    inicio: 'Início', dashboard: 'Dashboard', atendimento: 'Atendimento', leads: 'Leads',
    analisar: 'Analisar Atendimento', contratos: 'Contratos fechados',
    agenda: 'Agenda de Follow-ups', cadencias: 'Cadências de Follow-up',
    playbook: 'Playbook de Vendas', config: 'Configurações',
    usuarios: 'Usuários e alçadas'
  };

  /* cada plataforma do sistema tem sua própria navegação;
     para adicionar uma nova plataforma, basta registrar aqui */
  const PLATAFORMAS = {
    chat: {
      nome: ESCRITORIO.plataformas.chat, icone: 'atendimento', home: 'atendimento',
      rotas: [['atendimento', 'Conversas', 'atendimento']]
    },
    crm: {
      nome: ESCRITORIO.plataformas.crm, icone: 'crm', home: 'dashboard',
      // 4º item = oculta no menu. 'analisar' virou só redirecionamento para a ficha
      // do lead, mas continua listada aqui para o redirect não piscar o hub.
      rotas: [
        ['dashboard', 'Dashboard', 'dashboard'],
        ['leads', 'Leads', 'leads'],
        ['analisar', 'Analisar Atendimento', 'analisar', true],
        ['contratos', 'Contratos', 'contratos'],
        ['agenda', 'Follow-ups', 'agenda'],
        ['cadencias', 'Cadências', 'cadencias'],
        ['playbook', 'Playbook', 'playbook']
      ]
    }
  };

  function plataformaDaRota(rota) {
    for (const id in PLATAFORMAS) {
      if (PLATAFORMAS[id].rotas.some(r => r[0] === rota)) return id;
    }
    return 'inicio'; // inicio, usuarios e config vivem no hub
  }

  let _rotaAtual = 'inicio';
  let _paramAtual;            // p/ saber se é re-render da mesma tela ou navegação
  let _platAtual = null;       // plataforma renderizada por último (null = nada renderizado ainda)
  let _platAnimLimpar = null;  // desfaz a transição de plataforma em andamento, se houver

  /* transição sutil de entrada quando o usuário TROCA de plataforma
     (Início <-> Chat <-> CRM); nunca roda em navegações dentro
     da mesma plataforma nem nos re-renders disparados pelo sync */
  function animarTrocaPlataforma(view) {
    if (_platAnimLimpar) _platAnimLimpar(); // interrompe animação anterior
    void view.offsetWidth; // força reflow p/ a animação reiniciar do zero
    const aoTerminar = (e) => { if (e.target === view && e.animationName === 'platEnter') limpar(); };
    const timer = setTimeout(() => limpar(), 320); // segurança (reduced-motion não dispara animationend)
    function limpar() {
      clearTimeout(timer);
      view.removeEventListener('animationend', aoTerminar);
      view.classList.remove('plat-enter');
      _platAnimLimpar = null;
    }
    _platAnimLimpar = limpar;
    view.addEventListener('animationend', aoTerminar);
    view.classList.add('plat-enter');
  }

  function contagens() {
    const hoje = todayISO();
    return {
      followups: state.followups.filter(f => f.status === 'pendente' && f.dueDate <= hoje).length,
      atendimento: (state.conversas || []).filter(c => !c.arquivada && (c.status === 'aberto' || c.naoLidas > 0)).length
    };
  }

  function renderNav(rota) {
    const nav = document.getElementById('nav');
    if (!nav) return;
    const plat = plataformaDaRota(rota);
    const n = contagens();
    const badgeDe = { atendimento: n.atendimento, agenda: n.followups, dashboard: 0 };
    const item = (href, r, rotulo, icone, badge) =>
      `<a href="#/${href}" class="nav-item ${rota === r ? 'active' : ''}">` +
      `<span class="nav-ico" data-icon="${icone}"></span>${rotulo}` +
      (badge ? `<span class="nav-badge show">${badge}</span>` : '') + '</a>';

    // alçadas: usuário sem a permissão não vê a plataforma
    // Cloud é const: NÃO existe como window.Cloud — testar por window.Cloud
    // fazia a alçada passar batido e todo mundo enxergava todas as plataformas
    const liberado = chave => typeof ChatUI === 'undefined' || typeof Cloud === 'undefined' ||
      !Cloud.ativo() || !ChatUI.pode || (chave === '__admin' ? Cloud.admin() : ChatUI.pode(chave));
    let html = item('inicio', 'inicio', 'Início', 'inicio');
    if (plat === 'inicio') {
      html += `<div class="nav-secao">Plataformas</div>`;
      html += item('atendimento', '__chat', ESCRITORIO.plataformas.chat, 'atendimento', n.atendimento);
      if (liberado('acesso_crm')) html += item('dashboard', '__crm', ESCRITORIO.plataformas.crm, 'crm', n.followups);
      // usuários e alçadas: só o admin vê
      if (liberado('__admin')) {
        html += `<div class="nav-secao">Administração</div>`;
        html += item('usuarios', 'usuarios', 'Usuários e alçadas', 'equipe');
      }
    } else {
      const p = PLATAFORMAS[plat];
      html += `<div class="nav-secao">${p.nome}</div>`;
      p.rotas.forEach(([r, rotulo, icone, oculta]) => { if (!oculta) html += item(r, r, rotulo, icone, badgeDe[r] || 0); });
    }
    html += `<div class="nav-secao"></div>`;
    html += item('config', 'config', 'Configurações', 'config');
    nav.innerHTML = html;
    hydrateIcons(nav);

    const sub = document.getElementById('brand-sub');
    if (sub) sub.textContent = plat === 'inicio' ? ESCRITORIO.subtitulo : PLATAFORMAS[plat].nome;
  }

  function renderTopbarAcoes(rota) {
    const el = document.getElementById('topbar-acoes');
    if (!el) return;
    const plat = plataformaDaRota(rota);
    if (plat === 'crm') {
      el.innerHTML = `
        <button class="btn btn-ghost" onclick="Views.abrirImportCSV()"><span data-icon="upload"></span> Importar CSV</button>
        <button class="btn btn-primary" onclick="Views.abrirNovoLead()">+ Novo Lead</button>`;
    } else if (plat === 'chat') {
      el.innerHTML = `<button class="btn btn-primary" onclick="Views.atNovaConversa()">+ Nova conversa</button>`;
    } else {
      el.innerHTML = '';
    }
    hydrateIcons(el);
  }

  function registrar(rota, fn) { ROUTES[rota] = fn; }

  function navegar() {
    const hash = location.hash.replace(/^#\//, '') || 'inicio';
    // `#/leads?etapa=Ganho` quebrava a rota: sem separar a query, `rota` virava
    // 'leads?etapa=Ganho', não batia em ROUTES e caía no hub
    const [caminho, consulta] = hash.split('?');
    const [rota, param] = caminho.split('/');
    const query = new URLSearchParams(consulta || '');
    // rota desconhecida ou podada (módulo removido): volta ao Início reescrevendo o hash
    if (!ROUTES[rota] && rota !== 'inicio') { location.replace('#/inicio'); return; }
    // alçadas: bloqueia a plataforma inteira p/ quem não tem a permissão
    const comAlcadas = typeof ChatUI !== 'undefined' && typeof Cloud !== 'undefined' && Cloud.ativo() && ChatUI.pode;
    const exigido = { crm: 'acesso_crm' }[plataformaDaRota(rota)];
    const liberado = exigido ? ChatUI.pode(exigido) : true;
    // #/usuarios é do hub, mas só o admin entra
    if (comAlcadas && ((exigido && !liberado) || (rota === 'usuarios' && !Cloud.admin()))) {
      location.replace('#/inicio');
      return;
    }
    const mesmaTela = _rotaAtual === rota && _paramAtual === param;
    _rotaAtual = rota;
    _paramAtual = param;
    // transição só quando MUDA de plataforma (refresh/sync na mesma rota não anima)
    const plat = plataformaDaRota(rota);
    const trocouPlataforma = plat !== _platAtual;
    _platAtual = plat;
    const fn = ROUTES[rota] || ROUTES.inicio;
    // Chat ocupa a tela inteira, no padrão WhatsApp Web
    document.body.classList.toggle('modo-chat', rota === 'atendimento');
    document.getElementById('page-title').textContent = TITLES[rota] || ESCRITORIO.curto;
    renderNav(rota);
    renderTopbarAcoes(rota);
    const view = document.getElementById('view');
    const rolagemView = mesmaTela ? view.scrollTop : 0;
    const rolagemPagina = mesmaTela ? window.scrollY : 0;
    view.innerHTML = fn(param, query) || '';
    hydrateIcons(view);
    if (trocouPlataforma) animarTrocaPlataforma(view);
    view.scrollTop = rolagemView;
    window.scrollTo(0, rolagemPagina);
    atualizarBadges();
  }

  function refresh() { navegar(); }

  function atualizarBadges() {
    renderNav(_rotaAtual);
    const u = document.getElementById('sidebar-user');
    if (u) u.innerHTML = ICO('user') + ' ' + esc(state.settings.nomeAtendente || 'Configure seu nome');
  }

  return {
    ICONS, hydrateIcons, aplicarMarca, toast, modal, fecharModal, copiar,
    funnelHTML, hbarHTML, gaugeSVG, radarSVG, dimBarHTML, barChartSVG, scoreColorHex, scoreTextoHex,
    chipTemp, chipEtapa, registrar, navegar, refresh, atualizarBadges,
    PLATAFORMAS, TITLES, rotas: () => Object.keys(ROUTES)
  };
})();
