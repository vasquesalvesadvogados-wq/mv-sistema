/* ============================================================
   CHAT — atendimento WhatsApp no padrão WhatsApp Web
   Rail de ícones · lista de conversas · chat · painel de detalhes
============================================================ */

const ChatUI = (() => {

  /* ações públicas (ChatUI.*) — declarado no topo para poder ser
     preenchido em qualquer ponto do módulo sem erro de inicialização */
  const A = {};

  /* ---------------- estado da interface ---------------- */
  const _c = {
    sel: null, busca: '', filtro: 'tudo', status: '', tag: '',
    depts: new Set(), menuDepto: false,   // filtro de departamentos da lista: ids marcados ('nenhum' = sem departamento); vale qualquer um deles
    rascunho: null,               // conversa ainda não salva (só vira registro quando a 1ª mensagem sai)
    painel: 'conversas',          // conversas | notificacoes | agendadas | rapidas | tags | dashboard | relatorios | config
    drawer: false, drawerTab: 'dados',
    nota: false,                  // composer em modo anotação interna
    emoji: false, emojiCat: 0, menuAnexo: false, menuMais: false,
    formatar: false,              // barra de formatação do WhatsApp + prévia aberta no composer
    emojiBusca: '',               // texto digitado na busca do seletor de emoji
    agPop: false,                 // popup de mensagens agendadas (sobre o composer)
    anexos: [],                   // até MAX_ANEXOS {file, previewUrl, tipo, figurinha}: saem em sequência, nesta ordem
    rec: null,                    // {recorder, chunks, inicio, timer}
    sugestoes: null,              // {tipo:'rr'|'mencao', itens:[], filtro}
    relDias: 30, relDept: '',
    dashDias: 7,
    scrollConv: null,
    histFim: {},              // conversas cujo histórico antigo já foi todo carregado
    hidratada: {},            // conversas cujo histórico recente já foi buscado do banco
    hidratando: {}            // conversas com essa busca em andamento (pílula "Carregando mensagens")
  };

  const prefs = (() => {
    try { return Object.assign({ som: true, desktop: false }, JSON.parse(localStorage.getItem(ESCRITORIO.chaves.chatPrefs) || '{}')); }
    catch (e) { return { som: true, desktop: false }; }
  })();
  function salvarPrefs() { try { localStorage.setItem(ESCRITORIO.chaves.chatPrefs, JSON.stringify(prefs)); } catch (e) {} }

  const nuvem = () => typeof Cloud !== 'undefined' && Cloud.ativo();
  const eu = () => (nuvem() && Cloud.perfil()) || { id: null, nome: state.settings.nomeAtendente || 'Você', papel: 'admin' };
  const souAdmin = () => !nuvem() || Cloud.admin();

  /* ---------------- alçadas (matriz de permissões) ----------------
     Permissão efetiva = individuais do usuário ∪ dos departamentos dele.
     Admin tem tudo. Quem nunca foi configurado usa o padrão de atendente. */
  const PERMISSOES = [
    [`${ICO('message-circle')} Conversas`, [
      ['conversas_todas', 'Ver conversas de TODOS os departamentos'],
      ['conversas_criar', 'Criar conversa nova'],
      ['conversas_delegar', 'Delegar (departamento/responsável)'],
      ['conversas_renomear', 'Renomear contato'],
      ['conversas_arquivar', 'Arquivar/desarquivar']
    ]],
    [`${ICO('mail')} Mensagens`, [
      ['msg_enviar', 'Enviar mensagens'],
      ['msg_midia', 'Enviar mídias e gravar áudios'],
      ['msg_agendar', 'Agendar mensagens'],
      ['msg_encaminhar', 'Encaminhar mensagens'],
      ['msg_apagar', 'Apagar mensagens enviadas (para todos)']
    ]],
    [`${ICO('sticky-note')} Anotações internas`, [
      ['notas_criar', 'Criar anotações e marcar colegas'],
      ['notas_apagar', 'Apagar anotações internas (as suas e as dos colegas)']
    ]],
    [`${ICO('tag')} Tags`, [
      ['tags_aplicar', 'Aplicar/retirar tag no chat'],
      ['tags_gerir', 'Criar, renomear e apagar tags']
    ]],
    [`${ICO('clipboard-list')} Campos personalizados`, [
      ['campos_gerir', 'Criar, renomear, reordenar e apagar campos personalizados']
    ]],
    [`${ICO('users')} Grupos de WhatsApp`, [
      ['grupos_criar', 'Criar grupos'],
      ['grupos_membros', 'Adicionar/remover participantes']
    ]],
    [`${ICO('sparkles')} Inteligência artificial`, [
      ['ia_analise', 'Resumo, busca e análise da conversa'],
      ['ia_transcrever', 'Transcrever áudios']
    ]],
    [`${ICO('zap')} Respostas rápidas`, [
      ['rr_usar', 'Usar no chat'],
      ['rr_editar', 'Criar, editar e apagar']
    ]],
    [`${ICO('chart-column')} Painéis`, [
      ['ver_kanban', 'Kanban'],
      ['ver_dashboard', 'Dashboard'],
      ['ver_relatorios', 'Relatórios (exportações)'],
      ['ver_automacoes', 'Automações (ver)'],
      ['automacoes_editar', 'Automações (criar/editar/apagar)']
    ]],
    [`${ICO('landmark')} Plataformas`, [
      ['acesso_crm', 'Acesso ao ' + ESCRITORIO.plataformas.crm + ' (leads e vendas)'],
      ['cadencias_aplicar', 'Registrar cadências de follow-up no contato, pelo ' + ESCRITORIO.plataformas.chat + ' (departamentos Comercial)'],
    ]]
  ];
  const TODAS_CHAVES = PERMISSOES.flatMap(g => g[1].map(i => i[0]));
  const PERM_PADRAO = new Set(['conversas_criar', 'conversas_delegar', 'msg_enviar', 'msg_midia', 'msg_agendar',
    'msg_encaminhar', 'notas_criar', 'notas_apagar', 'tags_aplicar', 'rr_usar', 'ia_analise', 'ia_transcrever',
    'ver_kanban', 'ver_dashboard', 'acesso_crm']);

  function deptosDe(p) {
    if (!p) return [];
    const ids = (p.departamento_ids && p.departamento_ids.length) ? p.departamento_ids
      : (p.departamento_id ? [p.departamento_id] : []);
    return (state.departamentos || []).filter(d => ids.includes(d.id));
  }

  function pode(chave) {
    if (!nuvem()) return true; // modo local
    const p = Cloud.perfil();
    if (!p) return false;
    if (p.papel === 'admin') return true;
    // alçadas ainda não carregadas (falha momentânea): padrão de atendente,
    // nunca "tudo liberado" — antes um soluço de rede abria todos os botões
    if (!Cloud.alcadasAtivas || !Cloud.alcadasAtivas()) return PERM_PADRAO.has(chave);
    const proprias = p.permissoes || {};
    if (proprias[chave]) return true;
    const depts = deptosDe(p);
    if (depts.some(d => d.permissoes && d.permissoes[chave])) return true;
    const nadaConfigurado = !Object.keys(proprias).length &&
      !depts.some(d => d.permissoes && Object.keys(d.permissoes).length);
    return nadaConfigurado && PERM_PADRAO.has(chave);
  }
  A.pode = pode;

  /* ---------------- ícones ---------------- */
  const I = {
    chats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-2.9-.4-4.1-1L3 20l1.1-5A8.5 8.5 0 1 1 21 11.5z"/></svg>',
    sino: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9z"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/></svg>',
    relogio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
    raio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2z"/></svg>',
    grafico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 20h18"/><path d="M6 20v-6M11 20V9M16 20v-9M21 20V5"/></svg>',
    kanban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="5.2" height="18" rx="1.5"/><rect x="9.4" y="3" width="5.2" height="12" rx="1.5"/><rect x="15.8" y="3" width="5.2" height="8" rx="1.5"/></svg>',
    robo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V4.5M12 4.5h.01"/><circle cx="12" cy="3.5" r="1.2"/><circle cx="9" cy="13" r="1.2" fill="currentColor"/><circle cx="15" cy="13" r="1.2" fill="currentColor"/><path d="M9.5 16.5h5"/><path d="M4 12H2.5M21.5 12H20"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.6 13.4 12 22 2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.6" fill="currentColor"/></svg>',
    pessoas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5"/><circle cx="17.5" cy="9.5" r="2.5"/><path d="M16 15.5c2.6.2 4.6 1.5 5.5 4.5"/></svg>',
    sair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>',
    fmt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h6a4 4 0 0 1 0 8H7z"/><path d="M7 12h7a4 4 0 0 1 0 8H7z"/></svg>',
    engrenagem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3.2"/><path d="M19 12a7 7 0 0 0-.15-1.4l2.05-1.6-2-3.46-2.42 1a7 7 0 0 0-2.42-1.4L13.7 2.6h-4l-.36 2.54a7 7 0 0 0-2.42 1.4l-2.42-1-2 3.46 2.05 1.6A7 7 0 0 0 4.4 12c0 .48.05.94.15 1.4L2.5 15l2 3.46 2.42-1a7 7 0 0 0 2.42 1.4l.36 2.54h4l.36-2.54a7 7 0 0 0 2.42-1.4l2.42 1 2-3.46-2.05-1.6c.1-.46.15-.92.15-1.4z"/></svg>',
    clipe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m21 11.5-8.5 8.5a6 6 0 0 1-8.5-8.5l8.5-8.5a4 4 0 0 1 5.7 5.7L9.7 17.2a2 2 0 0 1-2.9-2.9l7.8-7.8"/></svg>',
    emoji: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M8 14.5c1 1.2 2.3 1.9 4 1.9s3-.7 4-1.9"/><circle cx="9" cy="9.6" r="1.2" fill="currentColor"/><circle cx="15" cy="9.6" r="1.2" fill="currentColor"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/></svg>',
    enviar: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 22 12 3.4 3.6 3.4 10l13 2-13 2z"/></svg>',
    nota: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>',
    baixar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
    voltar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5m0 0 6-6m-6 6 6 6"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    lixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m4 12.5 5 5L20 6.5"/></svg>',
    maisCirc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    responder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v4"/></svg>',
    encaminhar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0-6 6v4"/></svg>',
    lupa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
    pausa: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>'
  };

  /* arquivo grande sob demanda: o motor guarda a referência por 90 dias (espelha motor/index.js) */
  const DIAS_REFERENCIA_GRANDE = 90;

  /* ---------------- emojis ---------------- */
  const EMOJIS = [
    ['😀', '😀 😃 😄 😁 😆 😅 😂 🤣 🥲 😊 😇 🙂 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫡 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😴 🤤 😪 😮 😲 🥱 😷 🤒 🤕 🤢 🤮 🤧 😈 👿 💀 🤡 💩 👻 👽'],
    ['👋', '👋 🤚 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🫶 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 💪 🦾 🖕 ✍️ 💅 🤳 👂 👀 👁 🧠 🦴 👄 🫀'],
    ['🧑', '👶 🧒 👦 👧 🧑 👨 👩 🧔 👱 🧓 👴 👵 🙍 🙎 🙅 🙆 💁 🙋 🧏 🙇 🤦 🤷 👮 🕵️ 💂 👷 🤴 👸 👳 🧕 🤵 👰 🤰 🤱 👼 🎅 🦸 🦹 🧙 🧚 🧛 🧜 🧝 💆 💇 🚶 🏃 💃 🕺 👯 🧖 🧗 👪 👫 👬 👭'],
    ['🐶', '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🕷 🦂 🐢 🐍 🦎 🐙 🦑 🦐 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🐘 🦛 🦏 🐪 🦒 🦘 🐃 🐂 🐄 🐎 🐖 🐑 🦙 🐐 🦌 🐕 🐩 🐈 🐓 🦃 🕊 🐇 🦝 🦨 🦡 🦦 🦥 🐁 🐿 🦔'],
    ['🍎', '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶 🌽 🥕 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🥙 🧆 🌮 🌯 🥗 🥘 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🦪 🍤 🍙 🍚 🍘 🍥 🥠 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 ☕ 🍵 🧃 🥤 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🍾 🧊'],
    ['⚽', '⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🏒 🏑 🥍 🏏 🥅 ⛳ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸ 🥌 🎿 ⛷ 🏂 🏋️ 🤼 🤸 ⛹️ 🤺 🤾 🏌️ 🏇 🧘 🏄 🏊 🤽 🚣 🧗 🚴 🚵 🎪 🎭 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🪕 🎻 🎲 ♟ 🎯 🎳 🎮 🎰 🧩'],
    ['🚗', '🚗 🚕 🚙 🚌 🚎 🏎 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🦯 🦽 🦼 🛴 🚲 🛵 🏍 🛺 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🛩 💺 🛰 🚀 🛸 🚁 🛶 ⛵ 🚤 🛥 🛳 ⛴ 🚢 ⚓ 🚧 ⛽ 🚏 🗺 🗿 🗽 🗼 🏰 🏯 🏟 🎡 🎢 🎠 ⛲ ⛱ 🏖 🏝 🏜 🌋 ⛰ 🏔 🗻 🏕 ⛺ 🏠 🏡 🏘 🏚 🏗 🏭 🏢 🏬 🏣 🏤 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛 ⛪ 🕌 🕍 🛕 🕋 ⛩'],
    ['💡', '⌚ 📱 📲 💻 ⌨️ 🖥 🖨 🖱 🖲 🕹 🗜 💽 💾 💿 📀 📼 📷 📸 📹 🎥 📽 🎞 📞 ☎️ 📟 📠 📺 📻 🎙 🎚 🎛 🧭 ⏱ ⏲ ⏰ 🕰 ⌛ ⏳ 📡 🔋 🔌 💡 🔦 🕯 🪔 🧯 🛢 💸 💵 💴 💶 💷 🪙 💰 💳 💎 ⚖️ 🪜 🧰 🔧 🔨 ⚒ 🛠 ⛏ 🪛 🔩 ⚙️ 🪤 🧱 ⛓ 🧲 🔫 💣 🧨 🪓 🔪 🗡 ⚔️ 🛡 🚬 ⚰️ 🪦 ⚱️ 🏺 🔮 📿 🧿 💈 ⚗️ 🔭 🔬 🕳 🩹 🩺 💊 💉 🩸 🧬 🦠 🧫 🧪 🌡 🧹 🪠 🧺 🧻 🚽 🚰 🚿 🛁 🛀 🧼 🪥 🪒 🧽 🪣 🧴 🛎 🔑 🗝 🚪 🪑 🛋 🛏 🛌 🧸 🪆 🖼 🪞 🪟 🛍 🛒 🎁 🎈 🎏 🎀 🪄 🪅 🎊 🎉 🎎 🏮 🎐 🧧 ✉️ 📩 📨 📧 💌 📥 📤 📦 🏷 🪧 📪 📫 📬 📭 📮 📯 📜 📃 📄 📑 🧾 📊 📈 📉 🗒 🗓 📆 📅 🗑 📇 🗃 🗳 🗄 📋 📁 📂 🗂 🗞 📰 📓 📔 📒 📕 📗 📘 📙 📚 📖 🔖 🧷 🔗 📎 🖇 📐 📏 🧮 📌 📍 ✂️ 🖊 🖋 ✒️ 🖌 🖍 📝 ✏️ 🔍 🔎 🔏 🔐 🔒 🔓'],
    ['❤️', '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉 ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ 🆔 ⚛️ ✅ ❌ ❎ ➕ ➖ ➗ ✖️ 💯 🔞 📵 🚭 ❗ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ 🈯 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿ 🅿️ 🛗 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 ⚧ 🚻 🚮 🎦 📶 🈁 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 #️⃣ *️⃣ ▶️ ⏸ ⏯ ⏹ ⏺ ⏭ ⏮ ⏩ ⏪ 🔀 🔁 🔂 ◀️ 🔼 🔽 ⏫ ⏬ ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ 🔄 🔃 🎵 🎶 ➰ ➿ ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◾ ◽ ◼️ ◻️ 🟥 🟧 🟨 🟩 🟦 🟪 ⬛ ⬜ 🟫 🔈 🔇 🔉 🔊 🔔 🔕 📣 📢 👁‍🗨 💬 💭 🗯 ♠️ ♣️ ♥️ ♦️ 🃏 🎴 🀄 🕐']
  ].map(([ico, lista]) => ({ ico, lista: lista.split(/\s+/).filter(Boolean) }));

  /* ---------------- utilidades ---------------- */
  function horaCurta(iso) {
    return iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  }
  function horaOuData(iso) {
    if (!iso) return '';
    return iso.slice(0, 10) === todayISO() ? horaCurta(iso) : fmtDate(iso.slice(0, 10));
  }
  /* URLs no texto viram links clicáveis — SEMPRE por cima do texto já escapado
     (esc primeiro = nenhum HTML do cliente executa; só a URL vira <a>) */
  /* corpo da bolha: links + formatação do WhatsApp (js/texto-wa.js) */
  const linkificar = texto => formatarWa(texto);
  /* contato compartilhado pelo WhatsApp: o motor grava "Contato(s) compartilhado(s): Nome\nBEGIN:VCARD…";
     aqui vira um cartão com nome, telefone e ações (abrir conversa, copiar o número, salvar no CRM) */
  const ehContatoCompartilhado = t => /^Contatos? compartilhados?: /.test(String(t || '')) && /BEGIN:VCARD/i.test(String(t || ''));
  function contatosDe(texto) {
    const out = [];
    String(texto || '').split(/BEGIN:VCARD/i).slice(1).forEach(b => {
      const fn = (b.match(/^FN:(.+)$/mi) || [])[1] || ((b.match(/^N:([^\n]+)$/mi) || [''])[1] || '').split(';').filter(Boolean).reverse().join(' ');
      const tels = [];
      b.split(/\r?\n/).forEach(linha => {
        if (!/^TEL/i.test(linha)) return;
        const waid = (linha.match(/waid=(\d+)/i) || [])[1];
        const valor = linha.slice(linha.lastIndexOf(':') + 1).trim();
        const num = waid || normPhone(valor);
        if (num && !tels.some(t => t.num === num)) tels.push({ num, exib: valor || num });
      });
      out.push({ nome: String(fn || '').trim(), tels });
    });
    return out;
  }
  const previaTexto = m => ehContatoCompartilhado(m.texto) ? 'Contato: ' + contatosDe(m.texto).map(c => c.nome || (c.tels[0] && c.tels[0].exib) || '').filter(Boolean).join(', ') : m.texto;
  // última mensagem da conversa (lista, kanban, dashboard): o vCard cru vira "Contato: Nome"
  const previaConversa = c => previaTexto({ texto: c.ultimaMsg || '' });
  function contatoHTML(texto) {
    const itens = contatosDe(texto);
    if (!itens.length) return `<div class="wa-bolha-txt">${linkificar(texto)}</div>`;
    return itens.map(ct => {
      const tel = ct.tels[0];
      return `<div class="wa-contato">
      <div class="wa-contato-ico">${ICO('user')}</div>
      <div class="wa-contato-info"><b>${esc(ct.nome || 'Contato')}</b>${ct.tels.length ? ct.tels.map(t => `<small>${esc(t.exib)}</small>`).join('') : '<small>sem telefone no cartão</small>'}</div>
      ${tel ? `<div class="wa-contato-acoes">
        <button class="wa-btn" title="Abrir (ou criar) a conversa com este número" onclick="event.stopPropagation();ChatUI.participanteConversar('${esc(tel.num)}','${esc(ct.nome)}')">${ICO('message-circle')} Conversar</button>
        <button class="wa-btn" title="Copiar o número" onclick="event.stopPropagation();UI.copiar('${esc(tel.num)}', this)">${ICO('copy')} Copiar</button>
        ${pode('acesso_crm') ? `<button class="wa-btn" title="Criar um lead no ${ESCRITORIO.plataformas.crm} com este nome e telefone" onclick="event.stopPropagation();ChatUI.contatoParaLead('${esc(ct.nome)}','${esc(tel.num)}')">${ICO('user-plus')} Salvar no CRM</button>` : ''}
      </div>` : ''}
    </div>`;
    }).join('');
  }
  A.contatoParaLead = (nome, tel) => {
    const dup = typeof acharLeadDuplicado === 'function' ? acharLeadDuplicado(tel, '') : null;
    if (dup) { UI.toast(`Já existe o lead "${dup.nome}" com este telefone — abrindo a ficha.`); location.hash = '#/leads/' + dup.id; return; }
    const lead = novoLead({ nome: nome || tel, telefone: tel, origem: 'WhatsApp' });
    if (!state.leads.includes(lead)) state.leads.push(lead);
    save();
    if (typeof empurrarNuvem === 'function') empurrarNuvem();
    UI.toast(`Lead "${lead.nome}" criado no ${ESCRITORIO.plataformas.crm}.`);
  };

  /* anotação interna: quebras de linha e espaços como foram digitados (CSS pre-wrap),
     formatação do WhatsApp e menções @Nome destacadas */
  function notaHTML(texto) {
    const html = formatarWa(texto || '');
    const nomes = (state.time || []).map(p => primeiroNome(p.nome)).filter(Boolean);
    if (!nomes.length) return html;
    const re = new RegExp('@(?:' + nomes.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
    // só nos pedaços de texto, nunca dentro das tags (um @Nome dentro de um link quebraria o href);
    // esc() já virou < e > do usuário em entidades, então todo '<…>' aqui é tag do próprio formatador
    return html.split(/(<[^>]+>)/).map(p => p.startsWith('<') ? p : p.replace(re, s => `<span class="mencao">${s}</span>`)).join('');
  }

  function avatarHTML(c, extra, lazy) {
    const grupo = c.tipo === 'grupo';
    const letra = esc((c.nome || '?').trim()[0] || '?').toUpperCase();
    const dentro = c.fotoUrl
      ? `<img src="${esc(c.fotoUrl)}" ${lazy ? 'loading="lazy" decoding="async" ' : ''}onerror="this.outerHTML='${letra}'" alt="">`
      : (grupo ? ICO('users') : letra);
    return `<div class="wa-avatar ${grupo ? 'grupo' : ''}" ${extra || ''}>${dentro}</div>`;
  }
  function urlBaixar(m) {
    const u = m.midiaUrl || '';
    if (u.includes('/storage/v1/object/public/')) {
      return u + (u.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(m.midiaNome || 'arquivo');
    }
    return u;
  }
  function baixarArquivo(nome, conteudo, mime) {
    const blob = new Blob(['﻿' + conteudo], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  function render() { if (document.body.classList.contains('modo-chat')) UI.refresh(); }

  /* empurra o envio para a nuvem NA HORA (sem esperar o debounce do sync) */
  function empurrarNuvem() {
    if (nuvem() && Cloud.sincronizar) setTimeout(() => Cloud.sincronizar().catch(() => {}), 50);
  }

  function som() {
    if (!prefs.som) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [[880, 0], [660, .12]].forEach(([f, t]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = f; o.type = 'sine';
        g.gain.setValueAtTime(.12, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + t + .22);
        o.connect(g); g.connect(ctx.destination);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + .25);
      });
    } catch (e) {}
  }
  function desktopNotif(titulo, corpo) {
    if (!prefs.desktop || !('Notification' in window) || Notification.permission !== 'granted') return;
    try { new Notification(titulo, { body: corpo, icon: location.origin + '/favicon.ico' }); } catch (e) {}
  }

  /* =============================================================
     VIEW PRINCIPAL
  ============================================================= */
  UI.registrar('atendimento', param => {
    if (nuvem() && !Cloud.atendimentoAtivo()) {
      return `<div class="wa"><div class="wa-vazio-main" style="margin:auto">
        <div class="big">${ICO('message-circle')}</div><h3>${ESCRITORIO.plataformas.chat} ainda não ativado na nuvem</h3>
        <p>Rode os arquivos <code>nuvem/atendimento.sql</code> e <code>nuvem/chat-v2.sql</code> no SQL Editor do Supabase e recarregue (F5).</p>
      </div></div>`;
    }
    departamentosAtend();
    if (param) abrirPorLink(param);   // #/atendimento/<id>: link copiado pelo menu ⋯
    const conv = convAtual();
    setTimeout(posRender, 25);
    return `<div class="wa">
      <div style="display:contents" id="wrap-rail">${renderRail()}</div>
      <div style="display:contents" id="wrap-left">${renderEsquerda()}</div>
      <div style="display:contents" id="wrap-main">${renderMain(conv)}</div>
      <div style="display:contents" id="wrap-drawer">${_c.drawer && conv && _c.painel === 'conversas' ? renderDrawer(conv) : ''}</div>
    </div>`;
  });

  /* =============================================================
     ATUALIZAÇÃO CIRÚRGICA — re-renderiza só a seção que mudou.
     Nunca reconstrói uma bolha com áudio/vídeo tocando à toa.
  ============================================================= */
  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return String(h);
  }
  // externoId e "pendente/enviada" entram no núcleo: a barra de ações (responder, reagir,
  // encaminhar, apagar) só existe com id do WhatsApp e fora de pendente/enviando — sem isso a
  // mensagem recém-enviada ficava sem a barra até um redesenho completo (o "só apago áudio")
  const coreDe = m => hashStr([m.tipo, m.texto, m.midiaUrl, m.transcricao, m.midiaNome, m.remetente,
    m.encaminhada ? 1 : 0, m.citado ? (m.citado.texto || '') : '',
    m.enquete ? JSON.stringify(m.enquete.votos || {}) : '', m.apagada ? 1 : 0, (m.edicoes || []).length,
    m.externoId ? 1 : 0, ['pendente', 'agendada', 'enviando'].includes(m.status) ? 'p' : 'a'].join('§'));
  const metaDe = m => hashStr([m.status, m.erro, m.agendadaPara, m.autor].join('§'));
  A.hashBolha = coreDe;   // só para os testes: garante que a bolha é redesenhada quando o id do WhatsApp chega
  const reactsDe = m => hashStr(JSON.stringify(m.reacoes || []));

  function trocar(wrapId, html) {
    const w = document.getElementById(wrapId);
    if (!w) return;
    w.innerHTML = html;
    // botões só de ícone: o title vira nome acessível (leitor de tela e tooltip)
    w.querySelectorAll('button[title]:not([aria-label])').forEach(b => b.setAttribute('aria-label', b.title));
  }

  /* ---------- conversa em RASCUNHO ----------
     Clicar num contato (participante de grupo, "Nova conversa") não cria mais um
     registro: abre um rascunho só nesta aba. A conversa de verdade nasce quando a
     primeira mensagem (texto, anexo, áudio, anotação ou agendamento) sai. */
  const convAtual = () => (_c.sel && getConversa(_c.sel)) || (_c.rascunho && _c.sel === _c.rascunho.id ? _c.rascunho : null);
  function abrirRascunho({ telefone, nome, departamentoIds }) {
    const limpo = normPhone(String(telefone || '').split(':')[0].split('@')[0]);
    if (!limpo) { UI.toast('Número inválido.', 'err'); return; }
    const existente = conversaPorTelefone(limpo);
    if (existente) { _c.drawer = false; A.abrir(existente.id); return; }
    const ids = departamentoIds || deptsDoPerfil(eu()).map(d => d.id);
    _c.rascunho = {
      id: 'rascunho-' + Date.now(), rascunho: true, telefone: limpo, nome: nome || telExibicao(limpo),
      tipo: 'individual', grupoJid: '', participantes: [], fotoUrl: '', leadId: null,
      departamentoIds: ids, departamentoId: ids[0] || null, responsavel: null, status: 'aberto',
      tags: [], naoLidas: 0, ultimaMsg: '', ultimaMsgEm: null, arquivada: false, criadoEm: new Date().toISOString()
    };
    _c.sel = _c.rascunho.id; _c.painel = 'conversas'; _c.drawer = false;
    _c.nota = false; if (!_c.enviandoAnexo) descartarAnexos(); _c.sugestoes = null; _c.respondendo = null; _c.buscaChat = null;
    atualizar('rail', 'lista', 'main', 'drawer');
  }
  /* vira registro de verdade (e troca o id selecionado); para conversas normais devolve a própria */
  function materializarRascunho(id) {
    const alvo = id || _c.sel;
    if (_c.rascunho && _c.rascunho.id === alvo) {
      const r = _c.rascunho;
      const c = novaConversa({ nome: r.nome === telExibicao(r.telefone) ? '' : r.nome, telefone: r.telefone, departamentoIds: r.departamentoIds });
      if (_c.sel === alvo) _c.sel = c.id;
      _c.rascunho = null;
      return c;
    }
    return getConversa(alvo);
  }

  /* O rail NÃO é reconstruído a cada troca de painel: trocar o HTML inteiro
     destruía o elemento aberto pelo mouse e o novo nascia fechado — o menu
     "cortava" e reabria. Aqui só o botão ativo e os contadores são remendados
     no DOM que já existe; a transição de largura do CSS segue intacta.
     Se a quantidade ou a ordem dos botões mudou (alçada liberada/retirada), reconstrói. */
  function atualizarRail() {
    const rail = document.querySelector('#wrap-rail .wa-rail');
    const tmp = document.createElement('div');
    tmp.innerHTML = renderRail();
    const novos = tmp.querySelectorAll('.wa-rail-btn');
    const atuais = rail ? rail.querySelectorAll('.wa-rail-btn') : [];
    const mesmaForma = rail && novos.length === atuais.length &&
      Array.from(novos).every((n, i) => n.dataset.painel === atuais[i].dataset.painel);
    if (!mesmaForma) { trocar('wrap-rail', tmp.innerHTML); return; }
    novos.forEach((n, i) => {
      const a = atuais[i];
      a.classList.toggle('ativo', n.classList.contains('ativo'));
      const bn = n.querySelector('.wa-rail-badge'), ba = a.querySelector('.wa-rail-badge');
      if (bn && ba) { if (ba.textContent !== bn.textContent) ba.textContent = bn.textContent; }
      else if (bn) a.appendChild(bn);
      else if (ba) ba.remove();
    });
    const avN = tmp.querySelector('.wa-rail-avatar'), avA = rail.querySelector('.wa-rail-avatar');
    if (avN && avA && avA.innerHTML !== avN.innerHTML) { avA.innerHTML = avN.innerHTML; avA.title = avN.title; }
  }

  /* depois de escolher um painel com o mouse, o rail fecha com calma e só
     reabre quando o cursor sair e voltar (ou ao navegar pelo teclado) */
  function recolherRail() {
    const rail = document.querySelector('#wrap-rail .wa-rail');
    if (!rail || !rail.matches(':hover')) return;
    rail.classList.add('recolhido');
    // Chrome/Edge deixam o botão clicado focado (o rail não é mais reconstruído); sem soltar
    // o foco, :focus-within reabriria o rail sozinho assim que o mouse saísse. O foco de
    // teclado (:focus-visible) fica.
    const f = document.activeElement;
    if (f && rail.contains(f) && !f.matches(':focus-visible')) f.blur();
    const soltar = () => { rail.classList.remove('recolhido'); rail.removeEventListener('mouseleave', soltar); rail.removeEventListener('keydown', soltar); };
    rail.addEventListener('mouseleave', soltar);
    rail.addEventListener('keydown', soltar);
  }

  /* alvos: rail | lista | head | msgs | composer | drawer | main */
  function atualizar(...alvos) {
    if (!document.querySelector('.wa')) { UI.refresh(); return; }
    const conv = convAtual();
    if (alvos.includes('rail')) atualizarRail();
    if (alvos.includes('lista')) {
      const sc = document.querySelector('.wa-lista, .wa-painel-lista');
      const st = sc ? sc.scrollTop : 0;
      trocar('wrap-left', renderEsquerda());
      const sc2 = document.querySelector('.wa-lista, .wa-painel-lista');
      if (sc2 && st) sc2.scrollTop = st;
    }
    if (alvos.includes('main')) {
      trocar('wrap-main', renderMain(conv));
      setTimeout(posRender, 20);
    } else {
      if (alvos.includes('head') && conv) trocar('wa-head-wrap', renderChatHead(conv));
      if (alvos.includes('msgs') && conv) atualizarMsgs(conv);
      if (alvos.includes('composer') && conv) {
        // preserva o texto digitado e o cursor ao re-renderizar o composer
        const ta = document.getElementById('wa-input');
        const guarda = ta ? { v: ta.value, s: ta.selectionStart, foco: document.activeElement === ta } : null;
        trocar('wa-composer-wrap', renderComposer(conv, guarda ? guarda.v : ''));
        const novo = document.getElementById('wa-input');
        if (novo && guarda) {
          novo.value = guarda.v;
          if (guarda.foco) { novo.focus(); try { novo.setSelectionRange(guarda.s, guarda.s); } catch (e) {} }
        }
      }
    }
    if (alvos.includes('drawer')) {
      trocar('wrap-drawer', _c.drawer && conv && _c.painel === 'conversas' ? renderDrawer(conv) : '');
    }
  }

  /* atualiza as mensagens SEM reconstruir bolhas que não mudaram:
     novas são acrescentadas; ticks/reações são remendados na bolha existente */
  function atualizarMsgs(conv) {
    const box = document.getElementById('wa-msgs');
    if (!box) { atualizar('main'); return; }
    const msgs = mensagensDaConversa(conv.id).filter(m => m.status !== 'agendada' && m.status !== 'cancelada').slice(-(_c.limiteMsgs || 200));
    const nos = {};
    box.querySelectorAll('[data-mid]').forEach(n => nos[n.dataset.mid] = n);
    const idsAtuais = new Set(msgs.map(m => m.id));
    Object.keys(nos).forEach(id => { if (!idsAtuais.has(id)) { nos[id].remove(); delete nos[id]; } });
    const noFim = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    let houveNova = false;

    msgs.forEach(m => {
      const n = nos[m.id];
      if (!n) {
        const d = (m.criadoEm || '').slice(0, 10);
        if (box.dataset.ultimoDia !== d) {
          box.insertAdjacentHTML('beforeend', `<div class="wa-dia"><span>${d === todayISO() ? 'HOJE' : fmtDate(d)}</span></div>`);
          box.dataset.ultimoDia = d;
        }
        box.insertAdjacentHTML('beforeend', bolha(m, conv));
        houveNova = true;
        return;
      }
      if (n.dataset.core !== coreDe(m)) { n.outerHTML = bolha(m, conv); return; } // conteúdo mudou: raro
      if (n.dataset.meta !== metaDe(m)) { // só os ticks/status mudaram
        const meta = n.querySelector('.wa-bolha-meta');
        if (meta) meta.outerHTML = metaHTML(m, conv);
        n.dataset.meta = metaDe(m);
      }
      if (n.dataset.reacts !== reactsDe(m)) { // só as reações mudaram
        const antiga = n.querySelector('.wa-reacts');
        if (antiga) antiga.remove();
        const nova = reactsHTML(m);
        if (nova) n.insertAdjacentHTML('beforeend', nova);
        n.classList.toggle('com-reacts', !!nova);
        n.dataset.reacts = reactsDe(m);
      }
    });
    if (houveNova && noFim) box.scrollTop = box.scrollHeight;
  }

  function posRender() {
    const box = document.getElementById('wa-msgs');
    if (box) {
      if (_c.scrollConv !== _c.sel) { box.scrollTop = box.scrollHeight; _c.scrollConv = _c.sel; }
      else if (box.dataset.fixo !== 'nao') box.scrollTop = box.scrollHeight;
    }
    if (nuvem() && document.getElementById('motor-painel')) Views.renderMotor();
  }

  /* =============================================================
     RAIL
  ============================================================= */
  function renderRail() {
    const naoLidasNotif = (state.notificacoes || []).filter(n => !n.lida).length;
    const agendadas = state.mensagens.filter(m => m.status === 'agendada').length;
    const abertas = state.conversas.filter(c => !c.arquivada && c.naoLidas > 0 && podeVerConversa(c)).length;
    // o rótulo fica no DOM sempre (leitores de tela) e aparece quando o rail abre
    const btn = (id, icone, titulo, badge) =>
      `<button class="wa-rail-btn ${_c.painel === id ? 'ativo' : ''}" data-painel="${id}" title="${titulo}" onclick="ChatUI.painel('${id}')">
        ${icone}<span class="wa-rail-rotulo">${titulo}</span>${badge ? `<span class="wa-rail-badge">${badge > 99 ? '99+' : badge}</span>` : ''}</button>`;
    return `<div class="wa-rail-slot"><div class="wa-rail">
      <div class="wa-rail-logo" title="Voltar ao Início do sistema" onclick="location.hash='#/inicio'">${ESCRITORIO.logoSVG}<span class="wa-rail-rotulo">Início do sistema</span></div>
      ${btn('conversas', I.chats, 'Conversas', abertas)}
      ${btn('notificacoes', I.sino, 'Notificações', naoLidasNotif)}
      ${btn('agendadas', I.relogio, 'Mensagens agendadas', agendadas)}
      ${pode('rr_usar') ? btn('rapidas', I.raio, 'Respostas rápidas') : ''}
      ${pode('ver_kanban') ? btn('kanban', I.kanban, 'Kanban de atendimento') : ''}
      <div class="wa-rail-div"></div>
      ${pode('ver_dashboard') ? btn('dashboard', I.grafico, 'Dashboard de atendimento') : ''}
      ${pode('ver_automacoes') ? btn('automacoes', I.robo, 'Automações') : ''}
      ${pode('ver_relatorios') ? btn('relatorios', I.doc, 'Relatórios') : ''}
      ${btn('tags', I.tag, 'Tags')}
      <div class="wa-rail-sep"></div>
      ${btn('config', I.engrenagem, 'Configurações')}
      <div class="wa-rail-avatar" title="${esc(eu().nome || '')}"><span>${esc(primeiroNome(eu().nome || 'V')[0] || 'V').toUpperCase()}</span><span class="wa-rail-rotulo">${esc(primeiroNome(eu().nome || ''))}</span></div>
      ${nuvem() ? `<button class="wa-rail-btn wa-rail-sair" data-painel="__sair" title="Sair do sistema" onclick="ChatUI.sair()">${I.sair}<span class="wa-rail-rotulo">Sair</span></button>` : ''}
    </div></div>`;
  }

  /* dentro do Chat a barra lateral do sistema (com o "Sair") fica escondida:
     este é o caminho de saída de quem passa o dia aqui */
  A.sair = () => {
    if (!nuvem() || Cloud.sairConfirmando()) return;
    // cancelou: Chrome/Edge deixam o botão focado e .wa-rail:focus-within seguraria o rail aberto sobre a lista
    const f = document.activeElement;
    if (f && f.closest && f.closest('.wa-rail') && !f.matches(':focus-visible')) f.blur();
  };

  /* =============================================================
     PAINEL ESQUERDO
  ============================================================= */
  function renderEsquerda() {
    const p = _c.painel;
    if (p === 'notificacoes') return painelNotificacoes();
    if (p === 'agendadas') return painelAgendadas();
    if (p === 'rapidas') return painelRapidas();
    if (p === 'tags') return painelTags();
    if (p === 'config') return painelConfig();
    return painelConversas();
  }

  function cabecalhoEsq(titulo, acoes) {
    return `<div class="wa-left-head"><h2>${titulo}</h2><div class="wa-left-acoes">${acoes || ''}</div></div>`;
  }

  /* ---------- conversas ---------- */
  function conversasFiltradas() {
    let convs = state.conversas.filter(podeVerConversa);
    if (_c.filtro === 'arquivadas') convs = convs.filter(c => c.arquivada);
    else convs = convs.filter(c => !c.arquivada);
    if (_c.filtro === 'naolidas') convs = convs.filter(c => c.naoLidas > 0);
    if (_c.filtro === 'grupos') convs = convs.filter(c => c.tipo === 'grupo');
    if (_c.busca) convs = convs.filter(c => casaBusca(c, _c.busca));
    if (_c.depts.size) convs = convs.filter(c => [..._c.depts].some(f => filtroDept(c, f)));   // qualquer um dos marcados
    if (_c.status) convs = convs.filter(c => c.status === _c.status);
    if (_c.tag) convs = convs.filter(c => (c.tags || []).includes(_c.tag));
    convs.sort((a, b) => (b.ultimaMsgEm || b.criadoEm || '').localeCompare(a.ultimaMsgEm || a.criadoEm || ''));
    return convs;
  }

  const casaBusca = (c, busca) => (c.nome + ' ' + c.telefone + ' ' + (c.tags || []).join(' ') + ' ' + Object.values(c.campos || {}).join(' ')).toLowerCase().includes(String(busca || '').toLowerCase());   // inclui os campos personalizados

  /* barra de seleção em lote: aparece quando _c.selecao (Set) existe */
  function barraSelecao(convs) {
    const n = _c.selecao.size, todas = convs.length > 0 && convs.every(c => _c.selecao.has(c.id));
    const depts = state.departamentos || [];
    return `<div class="wa-selecao">
      <label class="wa-selecao-todas"><input type="checkbox" ${todas ? 'checked' : ''} onchange="ChatUI.selecaoTodas(this.checked)"> Todas (${convs.length})</label>
      <span class="wa-selecao-n">${n} selecionada${n === 1 ? '' : 's'}</span>
      <div class="wa-selecao-acoes">
        <button class="wa-btn claro" ${n ? '' : 'disabled'} onclick="ChatUI.selecaoLidas()" title="Zerar não lidas">${ICO('check')} Lidas</button>
        <button class="wa-btn claro" ${n ? '' : 'disabled'} onclick="ChatUI.selecaoArquivar()">${ICO('archive')} ${_c.filtro === 'arquivadas' ? 'Desarquivar' : 'Arquivar'}</button>
        <select ${n && pode('conversas_delegar') ? '' : 'disabled'} onchange="ChatUI.selecaoDept(this.value);this.value=''" title="Departamento">
          <option value="">Departamento…</option>
          ${depts.map(d => `<option value="${d.id}">+ ${esc(d.nome)}</option>`).join('')}
          ${depts.map(d => `<option value="-${d.id}">− ${esc(d.nome)}</option>`).join('')}
          <option value="__nenhum">Tirar todos</option>
        </select>
        <select ${n ? '' : 'disabled'} onchange="ChatUI.selecaoStatus(this.value);this.value=''" title="Status">
          <option value="">Status…</option>
          ${STATUS_ATENDIMENTO.map(([id, rot]) => `<option value="${id}">${rot}</option>`).join('')}
        </select>
        <button class="wa-ico-btn" title="Sair da seleção" onclick="ChatUI.selecaoAlternar()">${I.x}</button>
      </div>
    </div>`;
  }

  /* filtro de departamentos da lista: mais de um ao mesmo tempo (pedido do time, 06/10/2026).
     Botão no lugar do select de antes; a lista de marcar vive em _c.menuDepto. */
  function rotuloDepto() {
    const n = _c.depts.size;
    if (!n) return 'Depto';
    if (n > 1) return n + ' deptos';
    const id = [..._c.depts][0];
    if (id === 'nenhum') return 'Sem departamento';
    const d = state.departamentos.find(x => x.id === id);
    return d ? esc(d.nome) : 'Depto';
  }
  function filtroDeptoHTML() {
    return `<div class="wa-filtro-depto-wrap">
        <button class="wa-chip wa-filtro-depto ${_c.depts.size ? 'ativo' : ''}" aria-haspopup="menu" aria-expanded="${!!_c.menuDepto}" title="Filtrar por departamento" onclick="ChatUI.menuDepto(event)">${rotuloDepto()} ${ICO('chevron-down')}</button>
        ${_c.menuDepto ? `<div class="wa-menu wa-menu-depto" role="menu" onclick="event.stopPropagation()">
          <label class="wa-menu-opcao"><input type="checkbox" ${_c.depts.has('nenhum') ? 'checked' : ''} onchange="ChatUI.deptoToggle('nenhum', this.checked)"> Sem departamento</label>
          ${state.departamentos.map(d => `<label class="wa-menu-opcao"><input type="checkbox" ${_c.depts.has(d.id) ? 'checked' : ''} onchange="ChatUI.deptoToggle('${d.id}', this.checked)"> <span class="wa-minichip" style="background:${corSegura(d.cor)}">${esc(d.nome)}</span></label>`).join('')}
          ${_c.depts.size ? `<button onclick="ChatUI.deptoLimpar()">${ICO('x')} Limpar</button>` : ''}
        </div>` : ''}
      </div>`;
  }

  function painelConversas() {
    const convs = conversasFiltradas();
    const chip = (id, rot) => `<button class="wa-chip ${_c.filtro === id ? 'ativo' : ''}" onclick="ChatUI.filtro('${id}')">${rot}</button>`;
    // busca sem resultado na caixa: aponta o que está em Arquivadas (resolvidas/fechadas vivem lá)
    const nArquivadas = _c.busca && _c.filtro !== 'arquivadas'
      ? state.conversas.filter(c => c.arquivada && podeVerConversa(c) && casaBusca(c, _c.busca)).length : 0;
    return `<div class="wa-left">
      ${cabecalhoEsq('Conversas', `
        <button class="wa-ico-btn ${_c.selecao ? 'ativo' : ''}" title="Selecionar conversas" aria-pressed="${!!_c.selecao}" onclick="ChatUI.selecaoAlternar()">${ICO('check')}</button>
        ${pode('conversas_criar') ? `<button class="wa-ico-btn" title="Nova conversa" onclick="ChatUI.novaConversa()">${I.maisCirc}</button>` : ''}
        ${pode('grupos_criar') ? `<button class="wa-ico-btn" title="Novo grupo" onclick="ChatUI.novoGrupo()">${I.pessoas}</button>` : ''}`)}
      ${_c.selecao ? barraSelecao(convs) : ''}
      <div class="wa-busca"><input placeholder="Pesquisar ou começar uma nova conversa" value="${esc(_c.busca)}"
        oninput="ChatUI.buscar(this)"></div>
      <div class="wa-filtros">
        ${chip('tudo', 'Tudo')}${chip('naolidas', 'Não lidas')}${chip('grupos', 'Grupos')}${chip('arquivadas', 'Arquivadas')}
        ${filtroDeptoHTML()}
        <select onchange="ChatUI.set('status',this.value)">
          <option value="">Status</option>
          ${STATUS_ATENDIMENTO.map(([id, rot]) => `<option value="${id}" ${_c.status === id ? 'selected' : ''}>${rot}</option>`).join('')}
        </select>
        <select onchange="ChatUI.set('tag',this.value)">
          <option value="">Tag</option>
          ${tagsOrdenadas().map(t => `<option value="${esc(t.nome)}" ${_c.tag === t.nome ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}
        </select>
      </div>
      <div class="wa-lista">
        ${convs.length ? convs.map(itemConversa).join('') :
        `<div class="wa-vazio">Nenhuma conversa${_c.busca || _c.depts.size || _c.status || _c.tag || _c.filtro !== 'tudo' ? ' com esses filtros' : ' ainda.<br>Quando o WhatsApp receber mensagens, elas aparecem aqui'}.${nArquivadas ? `<br><button class="wa-link" onclick="ChatUI.filtro('arquivadas')">${nArquivadas} em Arquivadas</button>` : ''}</div>`}
        ${buscaGlobalHTML()}
      </div>
    </div>`;
  }

  /* busca global: além dos contatos, procura no CONTEÚDO das mensagens */
  function buscaGlobalHTML() {
    const b = (_c.busca || '').toLowerCase().trim();
    if (b.length < 3) return '';
    const hits = [];
    for (let i = state.mensagens.length - 1; i >= 0 && hits.length < 25; i--) {
      const m = state.mensagens[i];
      if (m.tipo === 'anotacao' || m.status === 'cancelada') continue;
      if ((m.texto || '').toLowerCase().includes(b) || (m.transcricao || '').toLowerCase().includes(b)) {
        const cv = getConversa(m.conversaId);
        if (cv && !cv.arquivada && podeVerConversa(cv)) hits.push({ m, cv });
      }
    }
    if (!hits.length) return '';
    return `<div class="wa-secao-titulo">Mensagens (${hits.length})</div>` + hits.map(({ m, cv }) => `
      <div class="wa-conv" onclick="ChatUI.abrirEm('${cv.id}','${m.id}')">
        ${avatarHTML(cv, '', true)}
        <div class="wa-conv-body">
          <div class="wa-conv-top"><b>${esc(cv.nome)}</b><span class="wa-hora">${horaOuData(m.criadoEm)}</span></div>
          <div class="wa-conv-sub"><span class="wa-previa">${m.direcao === 'saida' ? 'Você: ' : ''}${m.tipo !== 'texto' ? ICO(iconeDeMidia(m)) + ' ' : ''}${esc(semMarcadoresWa(previaTexto(m) || m.transcricao || previaDeMidia(m)).slice(0, 90))}</span></div>
        </div>
      </div>`).join('');
  }

  /* ---------- departamentos da conversa (lista; chat-v14a) ----------
     filtroDept: 'nenhum' = fila de triagem (ninguém marcou); id = está naquele departamento.
     chipsDeptHTML: um minichip por departamento, na ordem da lista; `exceto` esconde
     o que já está no filtro da tela (kanban) e mostra só os OUTROS. */
  const deptsDe = c => idsDeDepartamento(c).map(id => state.departamentos.find(d => d.id === id)).filter(Boolean);
  const filtroDept = (c, f) => f === 'nenhum' ? !idsDeDepartamento(c).length : idsDeDepartamento(c).includes(f);
  const chipsDeptHTML = (c, exceto) => deptsDe(c).filter(d => d.id !== exceto)
    .map(d => `<span class="wa-minichip" style="background:${corSegura(d.cor)}">${esc(d.nome)}</span>`).join('');
  const nomesDept = c => deptsDe(c).map(d => d.nome).join(', ');
  /* marcar mais de um depende da coluna departamento_ids (chat-v14a); sem ela, o front antigo continua: um só */
  const deptsMultiplos = () => !nuvem() || !!(Cloud.deptsMultiplos && Cloud.deptsMultiplos());

  function itemConversa(c) {
    const st = statusAtendInfo(c.status);
    const selecionando = !!_c.selecao;
    return `<div class="wa-conv ${_c.sel === c.id ? 'sel' : ''} ${selecionando && _c.selecao.has(c.id) ? 'marcada' : ''}" onclick="${selecionando ? `ChatUI.selecaoToggle('${c.id}')` : `ChatUI.abrir('${c.id}')`}">
      ${selecionando ? `<input type="checkbox" class="wa-conv-check" ${_c.selecao.has(c.id) ? 'checked' : ''} tabindex="-1" aria-label="Selecionar ${esc(c.nome)}">` : ''}
      ${avatarHTML(c, '', true)}
      <div class="wa-conv-body">
        <div class="wa-conv-top"><b>${esc(c.nome)}</b><span class="wa-hora ${c.naoLidas ? 'naolida' : ''}">${horaOuData(c.ultimaMsgEm)}</span></div>
        <div class="wa-conv-sub">
          <span class="wa-previa">${esc(semMarcadoresWa(previaConversa(c) || (c.tipo === 'grupo' ? 'grupo' : telExibicao(c.telefone))))}</span>
          ${c.naoLidas ? `<span class="wa-naolidas">${c.naoLidas}</span>` : ''}
        </div>
        <div class="wa-conv-chips">
          ${chipStatusHTML(c.status)}
          ${tagsDaConversa(c).slice(0, 3).map(t => `<span class="wa-minichip" style="${estiloTag(tagCor(t))}">${esc(t)}</span>`).join('')}
        </div>
      </div>
    </div>`;
  }

  /* ---------- notificações ---------- */
  /* duas seções (pedido do time, 06/10/2026): não lidas em cima, com a contagem; lidas embaixo, esmaecidas */
  function painelNotificacoes() {
    const ns = (state.notificacoes || []).slice().sort((a, b) => (b.criado_em || '').localeCompare(a.criado_em || ''));
    const naoLidas = ns.filter(n => !n.lida), lidas = ns.filter(n => n.lida);
    const item = n => `
          <div class="wa-notif ${n.lida ? 'lida' : 'naolida'}" onclick="ChatUI.abrirNotif('${n.id}')">
            <div class="wa-notif-ico">${n.tipo === 'mencao' ? ICO('pin') : n.tipo === 'delegacao' ? ICO('corner-down-right') : ICO('bell')}</div>
            <div class="wa-notif-corpo">${esc(n.texto)}<small>${fmtDateTime(n.criado_em)}</small></div>
          </div>`;
    return `<div class="wa-left">
      ${cabecalhoEsq('Notificações', naoLidas.length ?
        `<button class="wa-btn claro" onclick="ChatUI.lerTodas()">Marcar todas</button>` : '')}
      <div class="wa-painel-lista">
        ${ns.length ? `
          <div class="wa-secao-titulo">Não lidas${naoLidas.length ? ' (' + naoLidas.length + ')' : ''}</div>
          ${naoLidas.length ? naoLidas.map(item).join('') : '<div class="wa-notif-vazio">Nenhuma por ler.</div>'}
          ${lidas.length ? `<div class="wa-secao-titulo">Lidas</div>${lidas.map(item).join('')}` : ''}` :
        `<div class="wa-vazio">Nenhuma notificação.<br>Você será avisado aqui quando te marcarem numa anotação ou quando chegar mensagem no seu departamento.</div>`}
      </div>
    </div>`;
  }

  /* ---------- agendadas ---------- */
  function painelAgendadas() {
    const msgs = state.mensagens.filter(m => m.status === 'agendada')
      .sort((a, b) => (a.agendadaPara || '').localeCompare(b.agendadaPara || ''));
    return `<div class="wa-left">
      ${cabecalhoEsq('Mensagens agendadas')}
      <div class="wa-painel-lista">
        ${msgs.length ? msgs.map(m => {
          const c = getConversa(m.conversaId);
          // clicar abre a conversa do agendamento; "agendada por" diz quem programou (v6.24.1)
          return `<div class="wa-item" onclick="ChatUI.abrir('${m.conversaId}')">
            <div class="linha"><b>${ICO('alarm-clock')} ${fmtDateTime(m.agendadaPara)}</b>
              <span style="display:flex;gap:2px">
                <button class="wa-ico-btn" title="Ler a mensagem inteira" onclick="event.stopPropagation();ChatUI.verAgendada('${m.id}')">${ICO('eye')}</button>
                <button class="wa-ico-btn" title="Cancelar agendamento" onclick="event.stopPropagation();ChatUI.cancelarAgendada('${m.id}')">${I.lixo}</button></span></div>
            <small>para <b>${esc(c ? c.nome : '?')}</b> · agendada por <b>${esc(nomeDoPerfil(m.autor) || 'Equipe')}</b></small>
            <small>${m.tipo !== 'texto' ? ICO(iconeDeMidia(m)) + ' ' : ''}${esc((m.texto || previaDeMidia(m)).slice(0, 120))}</small>
          </div>`;
        }).join('') : `<div class="wa-vazio">Nenhuma mensagem agendada.<br>No chat, use o botão ${ICO('clock')} (relógio) para programar um envio.</div>`}
      </div>
    </div>`;
  }

  /* ---------- respostas rápidas ---------- */
  function painelRapidas() {
    return `<div class="wa-left">
      ${cabecalhoEsq('Respostas rápidas', pode('rr_editar') ? `<button class="wa-btn" onclick="ChatUI.editarRR(null)">+ Nova</button>` : '')}
      <div class="wa-painel-lista">
        ${state.respostasRapidas.length ? state.respostasRapidas.map(r => `
          <div class="wa-item" ${pode('rr_editar') ? `onclick="ChatUI.editarRR('${r.id}')"` : ''}>
            <div class="linha"><b>${esc(r.atalho || '/' + (r.titulo || '').toLowerCase().replace(/\s.*/, ''))} · ${esc(r.titulo || 'Sem título')}</b>${ICO('pencil')}</div>
            <small>${esc(r.texto.slice(0, 130))}${r.texto.length > 130 ? '…' : ''}</small>
          </div>`).join('') :
        `<div class="wa-vazio">Nenhuma resposta rápida ainda.<br>Crie atalhos como <b>/pagamento</b> e use no chat digitando <b>/</b>.<br>Variáveis: {{nome}}, {{atendente}}, {{empresa}}.</div>`}
      </div>
    </div>`;
  }

  /* ---------- tags ---------- */
  /* ---------- tags: ordem de lista, contraste e aplicação pelo seletor (dono, 12/10/2026) ----------
     A ordem é a coluna tags.ordem (chat-v19c); sem ordem a tag vai para o fim, em ordem alfabética.
     Nas conversas as tags aplicadas aparecem na ordem da lista, não na ordem em que foram marcadas. */
  const tagsOrdenadas = () => (state.tags || []).slice()
    .sort((a, b) => ((a.ordem == null ? 1e9 : Number(a.ordem)) - (b.ordem == null ? 1e9 : Number(b.ordem))) || String(a.nome || '').localeCompare(String(b.nome || '')));
  const tagsDaConversa = c => {
    const pos = new Map(tagsOrdenadas().map((t, i) => [t.nome, i]));
    return (c.tags || []).slice().sort((a, b) => (pos.has(a) ? pos.get(a) : 1e9) - (pos.has(b) ? pos.get(b) : 1e9));
  };
  const tagsDisponiveis = c => tagsOrdenadas().filter(t => !(c.tags || []).includes(t.nome));
  /* fundo da tag + cor do texto por luminância (tag clara, como LEAD em cinza ou PERFIL B em amarelo, leva texto escuro) */
  const estiloTag = cor => {
    const hex = corSegura(cor);
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = m ? 0.2126 * lin(parseInt(m[1], 16)) + 0.7152 * lin(parseInt(m[2], 16)) + 0.0722 * lin(parseInt(m[3], 16)) : 0;
    return `background:${hex};color:${lum > 0.45 ? 'var(--text-heading)' : 'var(--text-on-brand)'}`;
  };
  A.tagsOrdenadas = tagsOrdenadas;
  A.estiloTag = estiloTag;

  function painelTags() {
    return `<div class="wa-left">
      ${cabecalhoEsq('Tags')}
      ${pode('tags_gerir') ? `<div class="wa-form-inline">
        <input type="text" id="tag-nome" placeholder="Nova tag (ex.: Urgente)">
        <input type="color" id="tag-cor" value="${COR_PADRAO_DADO}" title="Cor da tag">
        <button class="wa-btn" onclick="ChatUI.criarTag()">Criar</button>
      </div>` : ''}
      <div class="wa-painel-lista">
        ${(state.tags || []).length ? tagsOrdenadas().map((t, i, lista) => {
          const usos = state.conversas.filter(c => (c.tags || []).includes(t.nome)).length;
          return `<div class="wa-item">
            <div class="linha">
              <b><span class="wa-minichip" style="${estiloTag(t.cor)}">${esc(t.nome)}</span></b>
              <span style="display:flex;gap:2px">
                ${pode('tags_gerir') ? `<button class="wa-ico-btn" title="Subir na lista" onclick="ChatUI.moverTag('${t.id}',-1)" ${i === 0 ? 'disabled' : ''}>${ICO('chevron-up')}</button>
                <button class="wa-ico-btn" title="Descer na lista" onclick="ChatUI.moverTag('${t.id}',1)" ${i === lista.length - 1 ? 'disabled' : ''}>${ICO('chevron-down')}</button>
                <button class="wa-ico-btn" title="Renomear" onclick="ChatUI.renomearTag('${t.id}')">${I.nota}</button>
                <button class="wa-ico-btn" title="Excluir" onclick="ChatUI.excluirTag('${t.id}')">${I.lixo}</button>` : ''}
              </span>
            </div>
            <small>${usos} conversa(s) com esta tag</small>
          </div>`;
        }).join('') : `<div class="wa-vazio">Nenhuma tag ainda. Crie acima — depois é só aplicar nas conversas pelo painel de detalhes.</div>`}
      </div>
    </div>`;
  }

  /* =============================================================
     ADMIN — USUÁRIOS & ALÇADAS
     Vive no Início do sistema (#/usuarios), não no Chat: as alçadas
     valem para todas as plataformas. Fica neste módulo porque a matriz de
     permissões e o pode() são daqui.
  ============================================================= */
  let _adminPerfis = null;
  let _permDraft = null;

  function renderAdminUsuarios() {
    if (!souAdmin()) return `<div class="card"><div class="empty"><div class="big">${ICO('lock')}</div>
      <h3>Área do administrador</h3><p>Só administradores gerenciam usuários e alçadas.</p></div></div>`;
    const aba = _c.adminTab || 'usuarios';
    setTimeout(carregarAdminPerfis, 40);
    return `<div class="usuarios-pagina">
      <p class="muted mb">A permissão efetiva de cada pessoa é a <b>soma</b> das individuais dela + as de cada departamento em que está.
        ${nuvem() && Cloud.alcadasAtivas && !Cloud.alcadasAtivas() ? `<b style="color:var(--state-warning-fg)"> ${ICO('alert-triangle')} Rode nuvem/chat-v8.sql no Supabase para ativar as alçadas.</b>` : ''}</p>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button class="wa-chip ${aba === 'usuarios' ? 'ativo' : ''}" onclick="ChatUI.adminAba('usuarios')">${ICO('user')} Usuários</button>
        <button class="wa-chip ${aba === 'departamentos' ? 'ativo' : ''}" onclick="ChatUI.adminAba('departamentos')">${ICO('folder')} Departamentos</button>
      </div>
      <div id="admin-corpo"><div class="wa-bloco"><small style="color:var(--wa-sec)">${UI.carregando('Carregando equipe')}</small></div></div>
    </div>`;
  }
  A.telaUsuarios = renderAdminUsuarios;
  A.adminAba = aba => { _c.adminTab = aba; UI.refresh(); };

  async function carregarAdminPerfis() {
    const el = document.getElementById('admin-corpo');
    if (!el) return;
    if (!nuvem()) { el.innerHTML = '<div class="wa-bloco"><small style="color:var(--wa-sec)">A gestão de usuários funciona no modo nuvem (com login).</small></div>'; return; }
    try { _adminPerfis = await Cloud.listarPerfis(); }
    catch (e) { el.innerHTML = `<div class="wa-bloco"><small>Erro ao carregar: ${esc(e.message)}</small></div>`; return; }
    el.innerHTML = (_c.adminTab || 'usuarios') === 'usuarios' ? adminTabelaUsuarios() : adminListaDepts();
  }

  const deptsDoPerfil = p => {
    const ids = (p.departamento_ids && p.departamento_ids.length) ? p.departamento_ids
      : (p.departamento_id ? [p.departamento_id] : []);
    return (state.departamentos || []).filter(d => ids.includes(d.id));
  };

  function adminTabelaUsuarios() {
    return (_adminPerfis || []).map(p => `
      <div class="wa-bloco" style="display:flex;gap:14px;align-items:center;padding:14px 20px">
        <span class="chip ${p.papel === 'admin' ? 'chip-navy' : 'chip-gray'}" style="flex-shrink:0">${p.papel === 'admin' ? 'admin' : 'normal'}</span>
        <div style="flex:1;min-width:0">
          <b style="cursor:pointer;color:var(--wa-green-dark)" onclick="ChatUI.adminEditarUsuario('${p.id}')">${esc(p.nome || p.email || '—')}</b>
          ${p.id === eu().id ? '<span class="wa-minichip outline">você</span>' : ''}
          ${p.ativo ? '' : '<span class="chip chip-red">aguardando liberação</span>'}
          <small style="display:block;color:var(--wa-sec)">${esc(p.email || '')}</small>
          <div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">
            ${deptsDoPerfil(p).map(d => `<span class="wa-minichip" style="background:${corSegura(d.cor)}">${esc(d.nome)}</span>`).join('') || '<small style="color:var(--wa-faint)">sem departamento</small>'}
            ${p.exibir_assinatura && p.assinatura ? `<span class="wa-minichip outline">${ICO('pen-line')} ${esc(p.assinatura)}</span>` : ''}
            ${p.modo_espiao ? `<span class="chip chip-navy">${ICO('venetian-mask')} espião</span>` : ''}
            ${p.horario_ativo ? `<span class="chip chip-amber">${ICO('clock')} ${esc(p.horario || '')}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="wa-btn" onclick="ChatUI.adminEditarUsuario('${p.id}')">${ICO('settings')} Gerenciar</button>
          ${p.id !== eu().id ? `<button class="wa-btn ${p.ativo ? 'claro' : ''}" style="${p.ativo ? '' : 'background:var(--state-success-fg)'}"
            onclick="ChatUI.usuarioAtivo('${p.id}', ${!p.ativo})">${p.ativo ? 'Desativar' : ICO('check') + ' Ativar'}</button>` : ''}
        </div>
      </div>`).join('') +
      `<div class="wa-bloco" style="display:flex;gap:14px;align-items:center;justify-content:space-between;padding:14px 20px;flex-wrap:wrap">
        <small style="color:var(--wa-sec);flex:1;min-width:220px"><b>Para adicionar alguém:</b> clique no botão ao lado, preencha nome, e-mail e senha provisória — o acesso é criado sozinho e o novo usuário aparece nesta lista em até 1 minuto.</small>
        <button class="wa-btn" style="flex-shrink:0" onclick="ChatUI.adminNovoUsuario()">${ICO('user-plus')} Adicionar usuário</button>
      </div>`;
  }

  /* ----- criar USUÁRIO novo (o motor executa com a chave mestra) ----- */
  A.adminNovoUsuario = () => {
    if (!souAdmin()) return;
    const depts = state.departamentos || [];
    UI.modal(`<h2>${ICO('user-plus')} Adicionar usuário <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
      <div class="form-row">
        <div class="field"><label>Nome *</label><input id="nu-nome" placeholder="Ex.: Ana Souza"></div>
        <div class="field"><label>E-mail (será o login) *</label><input id="nu-email" type="email" placeholder="ana@${ESCRITORIO.dominioEmail}"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Senha provisória (mínimo 8 caracteres) *</label>
          <div style="display:flex;gap:6px">
            <input id="nu-senha" autocomplete="new-password">
            <button class="btn btn-ghost" style="flex-shrink:0" onclick="ChatUI.novoUsuarioSenha()">${ICO('refresh-cw')} Gerar</button>
          </div></div>
        <div class="field"><label>Nível</label>
          <select id="nu-papel">
            <option value="atendente">Normal (atendente)</option>
            <option value="admin">Administrador</option>
          </select></div>
      </div>
      ${depts.length ? `<div class="field"><label>Departamentos</label>
        <div style="display:flex;gap:10px 16px;flex-wrap:wrap">${depts.map(d => `<label style="display:flex;gap:6px;align-items:center;cursor:pointer;font-weight:400">
          <input type="checkbox" class="nu-dept" value="${d.id}" style="width:auto;flex:0 0 auto"> ${esc(d.nome)}</label>`).join('')}</div></div>` : ''}
      <p class="muted"><b>Importante:</b> anote o e-mail e a senha provisória e repasse para a pessoa — são os dados que ela usará para entrar (a senha não será exibida de novo). O acesso é criado pelo motor e o novo usuário aparece na lista em até 1 minuto.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
        <button class="btn btn-primary" id="nu-criar" onclick="ChatUI.adminCriarUsuario()">${ICO('user-plus')} Criar usuário</button>
      </div>`, { large: true });
  };
  A.novoUsuarioSenha = () => {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const rnd = new Uint32Array(10);
    crypto.getRandomValues(rnd);
    let s = '';
    for (let i = 0; i < rnd.length; i++) s += chars[rnd[i] % chars.length];
    const el = document.getElementById('nu-senha');
    if (el) el.value = s;
  };
  A.adminCriarUsuario = async () => {
    if (!souAdmin()) return;
    const nome = (document.getElementById('nu-nome').value || '').trim();
    const email = (document.getElementById('nu-email').value || '').trim().toLowerCase();
    const senha = document.getElementById('nu-senha').value || '';
    const papel = document.getElementById('nu-papel').value === 'admin' ? 'admin' : 'atendente';
    const departamento_ids = Array.from(document.querySelectorAll('.nu-dept:checked')).map(x => x.value);
    if (!nome) { UI.toast('Informe o nome.', 'err'); return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { UI.toast('Informe um e-mail válido.', 'err'); return; }
    if (senha.length < 8) { UI.toast('A senha provisória precisa ter ao menos 8 caracteres.', 'err'); return; }
    if (!nuvem()) { UI.toast('Criar usuários funciona no modo nuvem (com login).', 'err'); return; }
    const btn = document.getElementById('nu-criar');
    UI.ocupado(btn, 'Enviando ao motor');
    try {
      const cmd = await Cloud.enviarComando('criar_usuario', { email, senha, nome, papel, departamento_ids });
      UI.fecharModal();
      UI.toast('Criando usuário...');
      await Cloud.aguardarComando(cmd.id, 60);
      UI.toast('Usuário criado: ' + email + '. Repasse o e-mail e a senha provisória para a pessoa.');
      carregarAdminPerfis();
    } catch (e) {
      UI.toast(e.message, 'err');
      UI.livre(document.getElementById('nu-criar'));
      carregarAdminPerfis();
    }
  };

  function matrizHTML(perms) {
    perms = perms || {};
    const todas = TODAS_CHAVES.every(k => perms[k]);
    const parcial = !todas && TODAS_CHAVES.some(k => perms[k]);
    // o traço do "selecionar todas" é a propriedade indeterminate, que só existe em JS: liga-se
    // logo depois que a matriz entra no DOM. O data-parcial já desenha o estado sem animar.
    if (parcial) queueMicrotask(sincronizarPermTodas);
    return `<label style="display:flex;gap:8px;align-items:center;margin:8px 0;font-weight:700;cursor:pointer">
        <input type="checkbox" class="perm-todas" style="width:auto" ${todas ? 'checked' : ''} ${parcial ? 'data-parcial' : ''} onchange="ChatUI.permTodas(this.checked)"> Selecionar todas as permissões
      </label>
      <div class="wa-matriz">` + PERMISSOES.map(([grupo, itens]) => `
      <div class="wa-matriz-grupo"><b>${grupo}</b>
        ${itens.map(([k, rot]) => `<label><input type="checkbox" style="width:auto;flex:0 0 auto" ${perms[k] ? 'checked' : ''}
          onchange="ChatUI.permTgl('${k}', this.checked)"> ${rot}</label>`).join('')}
      </div>`).join('') + `</div>`;
  }
  /* "Selecionar todas as permissões" em três estados — marcada (todas), traço (parte), vazia —,
     como o cabeçalho da tabela de Leads. Sem isto, desmarcar uma permissão depois de "selecionar
     todas" deixava a caixa marcada, porque marcar uma permissão não redesenha a matriz. */
  function sincronizarPermTodas() {
    const cab = document.querySelector('#perm-matriz .perm-todas');
    if (!cab || !_permDraft) return;
    const perms = _permDraft.permissoes || {};
    const n = TODAS_CHAVES.filter(k => perms[k]).length;
    const todas = n > 0 && n === TODAS_CHAVES.length;
    cab.checked = todas;
    cab.indeterminate = n > 0 && !todas;
    cab.toggleAttribute('data-parcial', n > 0 && !todas);
  }
  A.permTgl = (k, v) => {
    if (!_permDraft) return;
    _permDraft.permissoes = _permDraft.permissoes || {};
    if (v) _permDraft.permissoes[k] = true; else delete _permDraft.permissoes[k];
    sincronizarPermTodas();   // sem redesenhar a matriz: a caixa "selecionar todas" acompanha
  };
  A.permTodas = marcar => {
    if (!_permDraft) return;
    _permDraft.permissoes = {};
    if (marcar) TODAS_CHAVES.forEach(k => _permDraft.permissoes[k] = true);
    const alvo = document.getElementById('perm-matriz');
    if (alvo) alvo.innerHTML = matrizHTML(_permDraft.permissoes);
  };

  /* ----- editor de USUÁRIO ----- */
  A.adminEditarUsuario = pid => {
    if (!souAdmin()) return;
    const p = (_adminPerfis || []).find(x => x.id === pid);
    if (!p) return;
    _permDraft = {
      tipo: 'usuario', id: p.id, nome: p.nome || '',
      papel: p.papel || 'atendente',
      permissoes: Object.assign({}, p.permissoes || {}),
      assinatura: p.assinatura || '', exibir_assinatura: !!p.exibir_assinatura,
      modo_espiao: !!p.modo_espiao, espiao_zera_ao_enviar: p.espiao_zera_ao_enviar !== false,
      horario_ativo: !!p.horario_ativo, horario: p.horario || 'seg-sex 08:00-18:00'
    };
    UI.modal(`<h2>${ICO('settings')} Gerenciar usuário <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
      <p class="muted mb"><b>${esc(p.nome || '')}</b> · ${esc(p.email || '')}</p>
      <div class="form-row">
        <div class="field"><label>Nome no sistema (só o admin altera)</label>
          <input id="adu-nome" value="${esc(_permDraft.nome)}" placeholder="Ex.: Ana Souza"></div>
        <div class="field"><label>Nível</label>
          <select id="adu-papel">
            <option value="atendente" ${_permDraft.papel !== 'admin' ? 'selected' : ''}>Normal (permissões personalizadas)</option>
            <option value="admin" ${_permDraft.papel === 'admin' ? 'selected' : ''}>Administrador (todas as permissões)</option>
          </select></div>
      </div>
      ${(state.departamentos || []).length ? `<div class="field"><label>Departamentos (a pessoa vê as conversas destes setores)</label>
        <div style="display:flex;gap:10px 16px;flex-wrap:wrap">${state.departamentos.map(d => `<label style="display:flex;gap:6px;align-items:center;cursor:pointer;font-weight:400">
          <input type="checkbox" class="adu-dept" value="${d.id}" style="width:auto;flex:0 0 auto" ${deptsDoPerfil(p).some(x => x.id === d.id) ? 'checked' : ''}> ${esc(d.nome)}</label>`).join('')}</div></div>` : ''}
      <div class="field"><label>Nome visível para o cliente (assinatura nas mensagens)</label>
        <input id="adu-ass" value="${esc(_permDraft.assinatura)}" placeholder="Ex.: Ana Souza - Assessora"></div>
      <div class="field" style="display:flex;flex-direction:column;gap:8px">
        <label style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="checkbox" id="adu-exibir" style="width:auto" ${_permDraft.exibir_assinatura ? 'checked' : ''}> Exibir a assinatura antes de cada mensagem enviada</label>
        <label style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="checkbox" id="adu-espiao" style="width:auto" ${_permDraft.modo_espiao ? 'checked' : ''}> ${ICO('venetian-mask')} <b>Modo Espião</b> — abre conversas sem zerar o contador de não lidas (indicado para gestores)</label>
        <label style="display:flex;gap:8px;align-items:center;cursor:pointer;margin-left:24px"><input type="checkbox" id="adu-espiaozera" style="width:auto" ${_permDraft.espiao_zera_ao_enviar ? 'checked' : ''}> zerar o contador ao enviar mensagem</label>
        <label style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="checkbox" id="adu-horativo" style="width:auto" ${_permDraft.horario_ativo ? 'checked' : ''}> ${ICO('clock')} <b>Horário de acesso</b> — desloga automaticamente fora da janela:</label>
        <input id="adu-horario" value="${esc(_permDraft.horario)}" placeholder="seg-sex 08:00-18:00" style="margin-left:24px;max-width:260px">
      </div>
      <div class="field"><label>Permissões individuais (somam-se às dos departamentos dele)</label>
        <div id="perm-matriz">${matrizHTML(_permDraft.permissoes)}</div></div>
      <div class="modal-actions">
        ${p.id !== (eu().id) ? `<button class="btn btn-danger" style="margin-right:auto" onclick="ChatUI.adminExcluirUsuario('${p.id}')">${ICO('trash-2')} Excluir usuário</button>` : ''}
        <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="ChatUI.adminSalvarUsuario()">${ICO('save')} Salvar alterações</button>
      </div>`, { large: true });
  };

  A.adminExcluirUsuario = async pid => {
    if (!souAdmin()) return;
    const p = (_adminPerfis || []).find(x => x.id === pid);
    if (!p) return;
    if (pid === eu().id) { UI.toast('Você não pode excluir o seu próprio usuário.', 'err'); return; }
    if (!nuvem()) { UI.toast('Excluir usuários funciona no modo nuvem (com login).', 'err'); return; }
    const rotulo = p.nome || p.email || 'este usuário';
    if (!confirm(`Excluir DEFINITIVAMENTE o usuário "${rotulo}"?\n\nO login deixa de existir e a pessoa perde o acesso na hora. As mensagens e conversas que ela atendeu continuam no sistema (sem o vínculo de autor).\n\nSe a pessoa só não deve mais acessar, prefira "Desativar".`)) return;
    try {
      const cmd = await Cloud.enviarComando('excluir_usuario', { perfilId: pid });
      UI.fecharModal();
      UI.toast('Excluindo usuário...');
      await Cloud.aguardarComando(cmd.id, 30);
      UI.toast('Usuário excluído: ' + (p.email || rotulo));
      carregarAdminPerfis();
    } catch (e) {
      UI.toast(e.message, 'err');
      carregarAdminPerfis();
    }
  };

  A.adminSalvarUsuario = async () => {
    const d = _permDraft;
    if (!d || d.tipo !== 'usuario' || !souAdmin()) return;
    const patch = { papel: document.getElementById('adu-papel').value };
    // nome no sistema: só o admin altera (chat-v16b bloqueia a própria pessoa no banco)
    const nomeNovo = (document.getElementById('adu-nome') || { value: d.nome }).value.trim();
    if (nomeNovo && nomeNovo !== d.nome) patch.nome = nomeNovo;
    if (d.id === eu().id && patch.papel !== 'admin') { UI.toast('Você não pode remover o seu próprio acesso de administrador.', 'err'); return; }
    // horário em texto livre inválido congelava a aba da pessoa (laço infinito)
    const horAtivo = document.getElementById('adu-horativo').checked;
    const horTexto = document.getElementById('adu-horario').value.trim() || 'seg-sex 08:00-18:00';
    if (horAtivo && !horarioValido(horTexto)) { UI.toast('Horário de acesso inválido. Use, por exemplo: seg-sex 08:00-18:00', 'err'); return; }
    if (nuvem() && Cloud.alcadasAtivas()) {
      Object.assign(patch, {
        permissoes: d.permissoes || {},
        assinatura: document.getElementById('adu-ass').value.trim(),
        exibir_assinatura: document.getElementById('adu-exibir').checked,
        modo_espiao: document.getElementById('adu-espiao').checked,
        espiao_zera_ao_enviar: document.getElementById('adu-espiaozera').checked,
        horario_ativo: horAtivo,
        horario: horTexto
      });
    }
    // departamentos da pessoa: antes só na criação ou pelo editor do departamento (v6.24.0)
    const caixasDept = Array.from(document.querySelectorAll('.adu-dept'));
    if (caixasDept.length) {
      const ids = caixasDept.filter(x => x.checked).map(x => x.value);
      if (nuvem() && Cloud.alcadasAtivas()) Object.assign(patch, { departamento_ids: ids, departamento_id: ids[0] || null });
      else patch.departamento_id = ids[0] || null;
    }
    try {
      await Cloud.atualizarPerfilAdmin(d.id, patch);
      const meu = Cloud.perfil();
      if (meu && meu.id === d.id) Object.assign(meu, patch);
      UI.fecharModal();
      UI.toast('Alçadas do usuário salvas (valem no próximo pulso de cada aba).');
      carregarAdminPerfis();
    } catch (e) { UI.toast(e.message, 'err'); }
  };

  A.usuarioAtivo = async (pid, ativo) => {
    if (!souAdmin()) return;
    if (pid === eu().id && !ativo) { UI.toast('Você não pode desativar o seu próprio acesso.', 'err'); return; }
    try {
      await Cloud.atualizarPerfilAdmin(pid, { ativo });
      UI.toast(ativo ? 'Acesso liberado.' : 'Acesso desativado.');
    } catch (e) { UI.toast('Erro: ' + e.message, 'err'); }
    carregarAdminPerfis();
  };

  /* ----- editor de DEPARTAMENTO ----- */
  function adminListaDepts() {
    return `<div style="margin-bottom:12px"><button class="wa-btn" onclick="ChatUI.adminEditarDept(null)">+ Novo departamento</button></div>` +
      (state.departamentos || []).map(d => {
        const membros = (_adminPerfis || []).filter(p => deptsDoPerfil(p).some(x => x.id === d.id));
        return `<div class="wa-bloco">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <span class="wa-minichip" style="background:${corSegura(d.cor)};font-size:.8rem;padding:4px 12px">${esc(d.nome)}</span>
            <small style="color:var(--wa-sec)">${membros.length} usuário(s) · ${Object.keys(d.permissoes || {}).length} permissão(ões) do grupo</small>
            <span style="flex:1"></span>
            <button class="wa-btn" onclick="ChatUI.adminEditarDept('${d.id}')">${ICO('settings')} Gerenciar</button>
          </div>
          ${membros.map(p => `<div style="padding:5px 2px;border-top:1px solid var(--wa-border);font-size:.85rem">${ICO('chevron-right')} ${esc(p.nome || p.email)} <small style="color:var(--wa-faint)">${esc(p.email || '')}</small></div>`).join('') || '<small style="color:var(--wa-faint)">sem usuários</small>'}
        </div>`;
      }).join('');
  }

  A.adminEditarDept = did => {
    if (!souAdmin()) return;
    const d = did ? state.departamentos.find(x => x.id === did) : null;
    const membrosAtuais = new Set((_adminPerfis || []).filter(p => d && deptsDoPerfil(p).some(x => x.id === d.id)).map(p => p.id));
    _permDraft = {
      tipo: 'dept', id: d ? d.id : uid(), novo: !d,
      nome: d ? d.nome : '', cor: d ? d.cor : COR_PADRAO_DADO,
      permissoes: Object.assign({}, (d && d.permissoes) || {}),
      membros: membrosAtuais
    };
    UI.modal(`<h2>${ICO('folder')} ${d ? 'Alterar' : 'Novo'} departamento <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
      <div class="form-row">
        <div class="field"><label>Nome do departamento</label><input id="add-nome" value="${esc(_permDraft.nome)}" placeholder="Ex.: Cível Geral"></div>
        <div class="field" style="max-width:110px"><label>Cor</label><input type="color" id="add-cor" value="${corSegura(_permDraft.cor)}" style="width:60px;height:38px;padding:0;border:none;background:none;cursor:pointer"></div>
      </div>
      <div class="field"><label>Usuários deste departamento</label>
        <div style="max-height:190px;overflow-y:auto;border:1px solid var(--border);border-radius:10px;padding:8px">
        ${(_adminPerfis || []).map(p => `<label style="display:flex;gap:8px;align-items:center;padding:4px 2px;cursor:pointer">
          <input type="checkbox" style="width:auto;flex:0 0 auto" ${_permDraft.membros.has(p.id) ? 'checked' : ''}
            onchange="ChatUI.deptMembro('${p.id}', this.checked)"> ${esc(p.nome || p.email)} <small class="muted">${esc(p.email || '')}</small>
        </label>`).join('')}</div></div>
      <div class="field"><label>Permissões do departamento (somam-se às individuais de cada usuário)</label>
        <div id="perm-matriz">${matrizHTML(_permDraft.permissoes)}</div></div>
      <div class="modal-actions">
        ${d ? `<button class="btn btn-danger" style="margin-right:auto" onclick="ChatUI.adminApagarDept('${d.id}')">${ICO('trash-2')} Apagar departamento</button>` : ''}
        <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="ChatUI.adminSalvarDept()">${ICO('save')} Salvar departamento</button>
      </div>`, { large: true });
  };
  A.deptMembro = (pid, dentro) => {
    if (!_permDraft || _permDraft.tipo !== 'dept') return;
    if (dentro) _permDraft.membros.add(pid); else _permDraft.membros.delete(pid);
  };

  A.adminSalvarDept = async () => {
    const d = _permDraft;
    if (!d || d.tipo !== 'dept' || !souAdmin()) return;
    d.nome = document.getElementById('add-nome').value.trim();
    d.cor = document.getElementById('add-cor').value;
    if (!d.nome) { UI.toast('Dê um nome ao departamento', 'err'); return; }
    const alcadas = nuvem() && Cloud.alcadasAtivas();
    const idx = state.departamentos.findIndex(x => x.id === d.id);
    const registro = { id: d.id, nome: d.nome, cor: d.cor, permissoes: d.permissoes || {} };
    if (idx >= 0) state.departamentos[idx] = registro; else state.departamentos.push(registro);
    save();
    // membros: grava a lista de departamentos de cada usuário afetado
    try {
      for (const p of (_adminPerfis || [])) {
        const tinha = deptsDoPerfil(p).some(x => x.id === d.id);
        const quer = d.membros.has(p.id);
        if (tinha === quer) continue;
        let ids = ((p.departamento_ids && p.departamento_ids.length) ? p.departamento_ids.slice()
          : (p.departamento_id ? [p.departamento_id] : []));
        ids = quer ? ids.concat([d.id]) : ids.filter(x => x !== d.id);
        const patch = alcadas ? { departamento_ids: ids, departamento_id: ids[0] || null } : { departamento_id: quer ? d.id : null };
        await Cloud.atualizarPerfilAdmin(p.id, patch);
      }
      UI.fecharModal();
      UI.toast('Departamento salvo.');
      carregarAdminPerfis();
    } catch (e) { UI.toast(e.message, 'err'); }
  };

  A.adminApagarDept = async did => {
    if (!souAdmin()) return;
    const d = state.departamentos.find(x => x.id === did);
    if (!d || !confirm(`Apagar o departamento "${d.nome}"?\n\nAs conversas dele ficarão SEM departamento — e conversa sem departamento é visível a todo o time até ser distribuída de novo.`)) return;
    // tira o departamento das listas (o banco faz o mesmo por gatilho no chat-v14a)
    state.conversas.forEach(c => { if (idsDeDepartamento(c).includes(did)) normalizarDepartamentos(Object.assign(c, { departamentoIds: idsDeDepartamento(c).filter(x => x !== did) })); });
    state.departamentos = state.departamentos.filter(x => x.id !== did);
    save();
    try {
      for (const p of (_adminPerfis || [])) {
        const ids = (p.departamento_ids || []).filter(x => x !== did);
        if ((p.departamento_ids || []).length !== ids.length || p.departamento_id === did) {
          await Cloud.atualizarPerfilAdmin(p.id, nuvem() && Cloud.alcadasAtivas()
            ? { departamento_ids: ids, departamento_id: ids[0] || null }
            : { departamento_id: null });
        }
      }
    } catch (e) {}
    UI.fecharModal();
    UI.toast('Departamento apagado');
    carregarAdminPerfis();
  };

  /* ---------- configurações ---------- */
  function painelConfig() {
    return `<div class="wa-left">
      ${cabecalhoEsq('Configurações')}
      <div class="wa-painel-lista">
        <div class="wa-secao-titulo">${ICO('radio-tower')} Conexão do WhatsApp</div>
        <div style="padding:4px 18px 10px">
          ${nuvem() ? `<div id="motor-painel"><span style="color:var(--wa-sec);font-size:.83rem">${UI.carregando('Consultando o motor')}</span></div>` :
          `<small style="color:var(--wa-sec)">Disponível no modo nuvem (app publicado, com login).</small>`}
        </div>
        ${nuvem() && souAdmin() ? `<div class="wa-item" onclick="ChatUI.vistoriarGrupos()"><b>${ICO('users')} Vistoriar participantes dos grupos</b><small>Confere grupo a grupo no WhatsApp e corrige a lista: sem duplicados e com os números reais. Leva um ou dois minutos.</small></div>` : ''}
        <div class="wa-secao-titulo">${ICO('bell')} Notificações</div>
        <div class="wa-item" style="cursor:default">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.86rem">
            <input type="checkbox" ${prefs.som ? 'checked' : ''} onchange="ChatUI.pref('som',this.checked)"> Som ao receber mensagem/menção
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.86rem;margin-top:8px">
            <input type="checkbox" ${prefs.desktop ? 'checked' : ''} onchange="ChatUI.prefDesktop(this.checked)"> Notificações na área de trabalho
          </label>
        </div>
        <div class="wa-secao-titulo">${ICO('moon')} Aparência</div>
        <div class="wa-item" style="cursor:default">
          <label class="cfg-switch" style="padding:0">
            <input type="checkbox" ${UI.tema.atual() === 'escuro' ? 'checked' : ''} onchange="UI.tema.definir(this.checked ? 'escuro' : 'claro')">
            <span class="cfg-track"></span><span class="cfg-rotulo">Modo noturno (sistema inteiro)</span>
          </label>
        </div>
        <div class="wa-secao-titulo">${ICO('bot')} Inteligência artificial</div>
        <div class="wa-item" style="cursor:default">
          <small>Resumo e busca na conversa usam a <b>IA do escritório</b>, configurada pelo administrador no motor${AI.configurado() ? '' : ' (disponível só no sistema publicado)'}. Se aparecer "não configurada", avise um administrador.</small>
          <small style="margin-top:6px">A transcrição de áudios é <b>sob demanda</b>: clique em ${ICO('sparkles')} Transcrever no próprio áudio. Nada é transcrito automaticamente — assim não se gasta crédito à toa.</small>
        </div>
        <div class="wa-secao-titulo">${ICO('settings')} Sistema</div>
        <div class="wa-item" onclick="location.hash='#/config'"><b>Abrir configurações gerais</b><small>Perfil, equipe e aparência</small></div>
        ${nuvem() ? `<div class="wa-item" onclick="ChatUI.sair()"><b>${ICO('log-out')} Sair do sistema</b><small>Encerra a sessão neste computador</small></div>` : ''}
      </div>
    </div>`;
  }

  /* =============================================================
     ÁREA PRINCIPAL
  ============================================================= */
  function renderMain(conv) {
    if (_c.painel === 'dashboard') return renderDashboard();
    if (_c.painel === 'relatorios') return renderRelatorios();
    if (_c.painel === 'kanban') return renderKanban();
    if (_c.painel === 'automacoes') return renderAutomacoes();
    if (!conv) {
      return `<div class="wa-main"><div class="wa-fundo"></div><div class="wa-vazio-main">
        <div class="big">${ICO('message-circle')}</div><h3>${ESCRITORIO.plataformas.chat}</h3>
        <p>Selecione uma conversa ao lado para atender.<br>Mensagens do WhatsApp do escritório entram aqui em tempo real — com fotos, áudios, vídeos, documentos e grupos.</p>
      </div></div>`;
    }
    return `<div class="wa-main">
      <div class="wa-fundo"></div>
      <div style="display:contents" id="wa-head-wrap">${renderChatHead(conv)}</div>
      ${renderMsgs(conv)}
      <div style="display:contents" id="wa-composer-wrap">${renderComposer(conv)}</div>
    </div>`;
  }

  /* status como .chip do sistema, com glifo — a única forma de mostrar status na interface */
  function chipStatusHTML(status) {
    const st = statusAtendInfo(status);
    return `<span class="chip ${st.chip}">${ICO(st.icone)} ${st.label}</span>`;
  }

  /* menu de troca rápida de status, ancorado no botão do cabeçalho */
  function renderMenuStatus(c) {
    return `<div class="wa-menu wa-menu-status" role="menu" onclick="event.stopPropagation()">
      ${STATUS_ATENDIMENTO.map(([id, rot, , chip, icone]) => `
      <button role="menuitemradio" aria-checked="${c.status === id}" ${c.status === id ? 'class="atual"' : ''}
        onclick="ChatUI.escolherStatus('${c.id}','${id}')"><span class="chip ${chip}">${ICO(icone)} ${rot}</span>
        ${c.status === id ? ICO('check') : ''}</button>`).join('')}
    </div>`;
  }

  function renderChatHead(c) {
    const depts = deptsDe(c);
    const sub = c.tipo === 'grupo'
      ? `${(c.participantes || []).length || '?'} participante(s)`
      : telExibicao(c.telefone) + (c.leadId && getLead(c.leadId) ? ' · lead: ' + esc(primeiroNome(getLead(c.leadId).nome)) : '');
    return `<div class="wa-chat-head">
      ${avatarHTML(c, `onclick="ChatUI.drawer(true)"`)}
      <div class="wa-chat-head-info" onclick="ChatUI.drawer(true)" title="Ver dados do contato">
        <b>${esc(c.nome)}</b>
        <small>${sub}${depts.map(d => ` · <span style="color:${corSegura(d.cor)};font-weight:600">${esc(d.nome)}</span>`).join('')}</small>
      </div>
      ${c.rascunho ? `<div class="wa-chat-head-acoes"><span class="wa-rascunho-selo" title="A conversa é criada quando a primeira mensagem sair">rascunho</span></div>` : `<div class="wa-chat-head-acoes">
        <div class="wa-status-wrap">
          <button class="wa-status-btn" title="Mudar status do atendimento" aria-haspopup="menu" aria-expanded="${!!_c.menuStatus}"
            onclick="ChatUI.menuStatus(event)">${chipStatusHTML(c.status)}${ICO('chevron-down')}</button>
          ${_c.menuStatus ? renderMenuStatus(c) : ''}
        </div>
        <button class="wa-ico-btn" title="Buscar nesta conversa" onclick="ChatUI.buscaChatAbrir()">${I.lupa}</button>
        ${pode('notas_criar') ? `<button class="wa-ico-btn" title="Anotação interna" onclick="ChatUI.toggleNota()">${I.nota}</button>` : ''}
        ${pode('msg_agendar') ? `<button class="wa-ico-btn" title="Agendar mensagem" onclick="ChatUI.agendar()">${I.relogio}</button>` : ''}
        <button class="wa-ico-btn" title="Mais opções" onclick="ChatUI.menuMais(event)">${I.mais}</button>
      </div>`}
      ${_c.menuMais && !c.rascunho ? renderMenuMais(c) : ''}
    </div>
    ${_c.buscaChat != null ? renderBuscaChat(c) : ''}`;
  }

  /* barra de busca dentro da conversa */
  function renderBuscaChat(c) {
    const b = (_c.buscaChat || '').toLowerCase();
    let hits = [];
    if (b.length >= 2) {
      hits = mensagensDaConversa(c.id)
        .filter(m => (m.texto || '').toLowerCase().includes(b) || (m.transcricao || '').toLowerCase().includes(b))
        .reverse().slice(0, 20);
    }
    return `<div class="wa-busca-chat">
      <input id="wa-busca-chat-in" placeholder="Buscar nesta conversa..." value="${esc(_c.buscaChat || '')}" autocomplete="off"
        oninput="ChatUI.buscarNaConversa(this)">
      <button class="wa-ico-btn" title="Fechar busca" onclick="ChatUI.fecharBuscaChat()">${I.x}</button>
      ${b.length >= 2 ? `<div class="wa-busca-chat-res">
        ${hits.length ? hits.map(m => `<div class="wa-sugestao" onclick="ChatUI.irParaMsg('${m.id}')">
          <b>${horaOuData(m.criadoEm)}</b><span>${esc(semMarcadoresWa(previaTexto(m) || m.transcricao || previaDeMidia(m)).slice(0, 90))}</span></div>`).join('')
        : '<div class="wa-sugestao"><span>Nada encontrado nesta conversa.</span></div>'}
      </div>` : ''}
    </div>`;
  }

  function renderMenuMais(c) {
    return `<div class="wa-menu" onclick="event.stopPropagation()">
      <button onclick="ChatUI.drawer(true);ChatUI.fecharMenus()">${ICO('contact')} Dados do contato</button>
      <button onclick="ChatUI.copiarLink('${c.id}')">${ICO('link-2')} Copiar link da conversa</button>
      ${c.naoLidas > 0 ? `<button onclick="ChatUI.marcarLida('${c.id}')">${ICO('eye')} Marcar como lida</button>`
        : `<button onclick="ChatUI.marcarNaoLida('${c.id}')">${ICO('eye-off')} Marcar como não lida</button>`}
      ${pode('ia_analise') ? `<button onclick="ChatUI.iaResumo()">${ICO('bot')} Resumir conversa (IA)</button>
      <button onclick="ChatUI.iaPergunta()">${ICO('search')} Buscar informação (IA)</button>
      <button onclick="ChatUI.analisarSPIN()">${ICO('microscope')} Análise SPIN da conversa</button>` : ''}
      ${pode('ver_relatorios') ? `<button onclick="ChatUI.exportarTranscript('${c.id}')">${ICO('download')} Exportar conversa (.txt)</button>` : ''}
      ${pode('acesso_crm') ? (c.leadId ? `<button onclick="location.hash='#/leads/${c.leadId}'">${ICO('user')} Abrir ficha do lead</button>` :
        `<button onclick="ChatUI.criarLead()">${ICO('user-plus')} Criar lead desta conversa</button>`) : ''}
      ${pode('cadencias_aplicar') && c.tipo !== 'grupo' ? `<button onclick="ChatUI.cadenciaRegistrar()">${ICO('target')} Registrar cadência de follow-up</button>` : ''}
      ${pode('conversas_arquivar') ? `<button onclick="ChatUI.arquivar()">${c.arquivada ? ICO('archive-restore') + ' Desarquivar' : ICO('archive') + ' Arquivar conversa'}</button>` : ''}
    </div>`;
  }

  function renderMsgs(c) {
    // agendadas NÃO aparecem na linha do tempo — vivem no popup sobre o composer
    const todas = mensagensDaConversa(c.id).filter(m => m.status !== 'agendada' && m.status !== 'cancelada');
    const limite = _c.limiteMsgs || 200;
    const msgs = todas.slice(-limite);
    const podeMais = nuvem() && Cloud.incremental && Cloud.incremental() && !_c.histFim[c.id] && _c.hidratada[c.id] && todas.length > 0;
    let corpo = _c.hidratando[c.id]
      ? `<div class="wa-dia" id="wa-hist-carregando">${UI.carregando('Carregando mensagens')}</div>`
      : podeMais
      ? `<div class="wa-dia"><span id="wa-antigas" style="cursor:pointer;color:var(--wa-green-dark);font-weight:700" onclick="ChatUI.carregarAntigas()">${ICO('arrow-up')} Carregar mensagens anteriores</span></div>` : '';
    corpo += todas.length > limite ? `<div class="wa-dia"><span>mostrando as últimas ${limite} mensagens</span></div>` : '';
    let dia = '';
    msgs.forEach(m => {
      const d = (m.criadoEm || '').slice(0, 10);
      if (d !== dia) { dia = d; corpo += `<div class="wa-dia"><span>${d === todayISO() ? 'HOJE' : fmtDate(d)}</span></div>`; }
      corpo += bolha(m, c);
    });
    return `<div class="wa-msgs" id="wa-msgs" data-ultimo-dia="${dia}" onscroll="ChatUI.aoRolar(this)">
      ${corpo || `<div class="wa-dia"><span>${_c.rascunho && _c.rascunho.id === _c.sel ? 'Conversa ainda não salva — ela é criada quando a primeira mensagem sair' : 'Conversa nova — diga um oi'}</span></div>`}
    </div>`;
  }

  function ticks(m) {
    if (m.status === 'lida') return `<span class="wa-ticks lida">${ICO('check-check')}</span>`;
    if (m.status === 'entregue') return `<span class="wa-ticks">${ICO('check-check')}</span>`;
    if (m.status === 'enviada') return `<span class="wa-ticks">${ICO('check')}</span>`;
    if (m.status === 'pendente' || m.status === 'enviando') return `<span class="wa-fila" title="na fila de envio">${ICO('clock')}</span>`;
    if (m.status === 'agendada') return `<span class="wa-fila" title="agendada">${ICO('alarm-clock')} ${horaOuData(m.agendadaPara)}</span>`;
    if (m.status === 'erro') return `<span class="wa-erro" title="${esc(m.erro || 'erro no envio')}">${ICO('alert-triangle')} erro</span>`;
    return '';
  }

  function metaHTML(m, c) {
    const minha = m.direcao === 'saida';
    return `<div class="wa-bolha-meta">${minha && m.autor ? esc(nomeDoPerfil(m.autor)) + ' · ' : ''}${horaCurta(m.criadoEm)} ${minha ? ticks(m) : ''}</div>`;
  }

  function reactsHTML(m) {
    if (!m.reacoes || !m.reacoes.length) return '';
    const grupos = {};
    m.reacoes.forEach(r => {
      const g = grupos[r.emoji] = grupos[r.emoji] || { n: 0, nomes: [], minha: false };
      g.n++;
      if (r.minha) g.minha = true;
      g.nomes.push(r.minha ? 'você' : (r.nome || telExibicao(r.de || '') || 'contato'));
    });
    return `<div class="wa-reacts">${Object.entries(grupos).map(([e, g]) =>
      `<span class="wa-react-pill ${g.minha ? 'minha' : ''}" title="${esc(g.nomes.join(', '))}"
        onclick="event.stopPropagation();ChatUI.reagirPaleta('${m.id}', event)">${esc(e)}${g.n > 1 ? ' ' + g.n : ''}</span>`).join('')}</div>`;
  }

  function bolha(m, c) {
    const marcas = `data-mid="${m.id}" data-core="${coreDe(m)}" data-meta="${metaDe(m)}" data-reacts="${reactsDe(m)}"`;
    if (m.tipo === 'anotacao') {
      const autor = nomeDoPerfil(m.autor) || 'Equipe';
      return `<div class="wa-nota" ${marcas}><div class="wa-nota-cab">${ICO('sticky-note')} <b>${esc(autor)}</b></div>
        <div class="wa-nota-txt">${notaHTML(m.texto)}</div>
        <div class="wa-nota-meta">anotação interna · ${horaCurta(m.criadoEm)}${botaoApagarNota(m)}</div></div>`;
    }
    const minha = m.direcao === 'saida';
    const meta = metaHTML(m, c);
    const quem = !minha && c.tipo === 'grupo' ? nomeDoParticipante(c, m) : '';
    // nome do participante é clicável: abre (ou cria) a conversa individual com ele
    const telQuem = quem ? telefoneDoParticipante(c, m) : '';
    const remetente = !quem ? '' : telQuem
      ? `<button class="wa-remetente" title="Abrir conversa individual com ${esc(quem)}" onclick="event.stopPropagation();ChatUI.participanteConversar('${esc(telQuem)}','${esc(quem)}')">${esc(quem)}</button>`
      : `<div class="wa-remetente">${esc(quem)}</div>`;
    // apagada para todos no WhatsApp: o conteúdo continua aqui (decisão do dono, 05/10/2026 —
    // "fica salvo no nosso sistema, só apaga para o cliente"); a bolha ganha o selo e fica esmaecida
    const seloApagada = m.apagada
      ? `<div class="wa-fwd wa-selo-apagada">${ICO('ban')} ${minha ? 'Apagada para o cliente — continua visível para a equipe' : 'Apagada pelo contato — continua visível para a equipe'}</div>` : '';
    let conteudo = '', midiaCls = '';

    if (m.tipo === 'imagem' && m.midiaUrl) {
      midiaCls = 'midia';
      conteudo = `<img class="wa-img" src="${esc(m.midiaUrl)}" loading="lazy" onclick="ChatUI.lightbox('${m.id}')">`;
    } else if (m.tipo === 'figurinha' && m.midiaUrl) {
      midiaCls = 'midia';
      conteudo = `<img class="wa-figurinha" src="${esc(m.midiaUrl)}" loading="lazy">`;
    } else if (m.tipo === 'video' && m.midiaUrl) {
      midiaCls = 'midia';
      conteudo = `<video class="wa-video" src="${esc(m.midiaUrl)}" controls preload="metadata"></video>`;
    } else if (m.tipo === 'audio' && m.midiaUrl) {
      conteudo = `<div class="wa-player">
        <span class="wa-player-ico">${m.midiaPtt ? ICO('mic') : ICO('music')}</span>
        <button class="wa-player-btn" title="Tocar/pausar" onclick="ChatUI.audioToggle(this)">${I.play}</button>
        <div class="wa-player-meio">
          <input type="range" class="wa-player-seek" value="0" min="0" max="1000" oninput="ChatUI.audioSeek(this)">
          <span class="wa-player-tempo">áudio</span>
        </div>
        <button class="wa-player-vel" title="Velocidade" onclick="ChatUI.audioVel()">${(prefs.velAudio || 1) + 'x'}</button>
        <a class="wa-baixar" href="${esc(urlBaixar(m))}" target="_blank" title="Baixar áudio">${I.baixar}</a>
        <audio preload="metadata" src="${esc(m.midiaUrl)}"
          onplay="ChatUI.audioIco(this)" onpause="ChatUI.audioIco(this)" onended="ChatUI.audioIco(this)"
          onloadedmetadata="ChatUI.audioProg(this)" ontimeupdate="ChatUI.audioProg(this)"></audio>
      </div>`;
      if (m.transcricao) conteudo += `<div class="wa-transcricao">${ICO('text')} ${esc(m.transcricao)}</div>`;
      else if (nuvem() && pode('ia_transcrever')) conteudo += `<button class="wa-transcrever" onclick="ChatUI.transcrever('${m.id}',this)">${ICO('sparkles')} Transcrever áudio</button>`;
    } else if (m.tipo === 'enquete') {
      const e = m.enquete || { pergunta: m.texto, opcoes: [], votos: {} };
      const votos = e.votos || {};
      const contagem = {};
      Object.values(votos).forEach(o => contagem[o] = (contagem[o] || 0) + 1);
      conteudo = `<div class="wa-enquete">
        <div class="wa-enquete-perg">${ICO('chart-column')} ${esc(e.pergunta || m.texto)}</div>
        ${(e.opcoes || []).map(o => `<div class="wa-enquete-op ${contagem[o] ? 'votada' : ''}">
          <span>${esc(o)}</span>${contagem[o] ? `<b>${ICO('check')} ${contagem[o]}</b>` : ''}</div>`).join('')}
        <small>${Object.keys(votos).length
          ? ICO('vote') + ' escolha do cliente: <b>' + esc(Object.values(votos).join(', ')) + '</b>'
          : 'aguardando o cliente tocar numa opção...'}</small>
      </div>`;
    } else if ((m.tipo === 'arquivo' || (m.tipo !== 'texto' && !m.midiaUrl && m.tipo !== 'anotacao')) && (m.midiaUrl || m.midiaNome)) {
      // arquivo grande (chat-v16c): ficou no WhatsApp; só baixa quando alguém pede. O motor guarda a
      // referência por 90 dias (DIAS_REFERENCIA_GRANDE) — depois só reenviando
      const pendente = !m.midiaUrl && m.midiaTamanho > 0 && nuvem();
      const expirada = pendente && (Date.now() - new Date(m.criadoEm).getTime()) > DIAS_REFERENCIA_GRANDE * 86400000;
      conteudo = `<div class="wa-doc"><div class="wa-doc-ico">${ICO(m.tipo === 'arquivo' ? 'file-text' : iconeDeMidia(m))}</div>
        <div class="wa-doc-info"><b>${esc(m.midiaNome || 'Documento')}</b><small>${m.midiaTamanho ? fmtBytes(m.midiaTamanho) : (m.midiaMime || '')}${pendente && !expirada ? ' · fica no WhatsApp até alguém pedir' : ''}</small>
          ${expirada ? `<small class="wa-doc-expirado">Referência expirou (${DIAS_REFERENCIA_GRANDE} dias) — peça o reenvio ao contato</small>` : ''}</div>
        ${m.midiaUrl ? `<a class="wa-baixar" href="${esc(urlBaixar(m))}" target="_blank" title="Baixar">${I.baixar}</a>`
          : pendente && !expirada ? `<button class="wa-btn wa-baixar-grande" title="Baixa do WhatsApp e guarda por 7 dias" onclick="event.stopPropagation();ChatUI.baixarMidia('${m.id}', this)">${I.baixar} Baixar (${fmtBytes(m.midiaTamanho)})</button>` : ''}</div>`;
    } else if (m.tipo === 'texto' && ehContatoCompartilhado(m.texto)) {
      conteudo = contatoHTML(m.texto);
    } else {
      conteudo = `<div class="wa-bolha-txt">${linkificar(textoAtual(m))}</div>`;
    }
    const legenda = (m.tipo !== 'texto' && m.tipo !== 'enquete' && m.texto) ? `<div class="wa-legenda wa-bolha-txt">${linkificar(textoAtual(m))}</div>` : '';
    const edicoes = edicoesHTML(m, minha);
    const reacts = reactsHTML(m);

    // caixinha da mensagem citada (responder) + selo de encaminhada
    // do contato: deixa claro que não foi ele quem escreveu (igual ao selo do WhatsApp)
    const fwd = m.encaminhada ? `<div class="wa-fwd ${minha ? '' : 'contato'}">${I.encaminhar} ${minha ? 'Encaminhada' : 'Encaminhada pelo contato'}</div>` : '';
    const citadoBox = m.citado ? `<div class="wa-citado ${minha ? 'minha' : ''}" onclick="event.stopPropagation();ChatUI.irParaMsg('${m.citado.id || ''}')">
        <b>${m.citado.minha ? 'Você' : esc(m.citado.remetente || c.nome)}</b>
        <span>${esc(semMarcadoresWa(m.citado.texto || '').slice(0, 130))}</span>
      </div>` : '';

    const podeAgir = !m.apagada && !['pendente', 'agendada', 'enviando'].includes(m.status);
    const acoes = podeAgir ? `<div class="wa-acoes-bolha">
        ${pode('msg_enviar') ? `<button title="Responder" onclick="event.stopPropagation();ChatUI.responder('${m.id}')">${I.responder}</button>` : ''}
        <button title="Reagir" onclick="event.stopPropagation();ChatUI.reagirPaleta('${m.id}', event)">${I.emoji}</button>
        ${pode('msg_encaminhar') ? `<button title="Encaminhar" onclick="event.stopPropagation();ChatUI.encaminhar('${m.id}')">${I.encaminhar}</button>` : ''}
        ${minha && !m.apagada && m.externoId && pode('msg_apagar') && (Date.now() - new Date(m.criadoEm).getTime() < 48 * 3600000)
          ? `<button title="Apagar para o cliente" onclick="event.stopPropagation();ChatUI.apagarMsg('${m.id}')">${I.lixo}</button>` : ''}
      </div>` : '';
    return `<div class="wa-bolha ${minha ? 'minha' : ''} ${midiaCls} ${reacts ? 'com-reacts' : ''} ${m.apagada ? 'apagada' : ''}" ${marcas}>${remetente}${seloApagada}${fwd}${citadoBox}${conteudo}${legenda}${edicoes}${meta}${acoes}${reacts}</div>`;
  }

  /* ---------- mensagens editadas (chat-v14b) ----------
     O motor troca o texto da mensagem original e guarda as versões anteriores em
     m.edicoes [{texto, em}]. Antes da migração ele só acrescentava " (editada)" ao
     texto: aqui o sufixo some da bolha e vira o mesmo selo, sem a versão anterior. */
  const SUFIXO_EDITADA = /\s*\((editada|editada no celular)\)$/;
  const textoAtual = m => String(m.texto || '').replace(SUFIXO_EDITADA, '');
  function edicoesHTML(m, minha) {
    const versoes = Array.isArray(m.edicoes) ? m.edicoes.filter(v => v && typeof v.texto === 'string') : [];
    const sufixo = (String(m.texto || '').match(SUFIXO_EDITADA) || [])[1] || '';
    if (!versoes.length && !sufixo) return '';
    const quem = minha ? 'editada no celular' : 'editada pelo contato';
    // "(editada no celular)": o motor soube da edição mas não conseguiu decifrar o texto novo
    if (sufixo === 'editada no celular' && !minha) return `<div class="wa-editada">${ICO('pen-line')} editada pelo contato · texto novo só no celular</div>`;
    if (!versoes.length) return `<div class="wa-editada">${ICO('pen-line')} ${quem}</div>`;
    return `<details class="wa-edicoes" onclick="event.stopPropagation()">
      <summary class="wa-editada" title="Ver o que estava escrito antes">${ICO('pen-line')} ${quem} · ver anterior${versoes.length > 1 ? ` (${versoes.length})` : ''}</summary>
      ${versoes.slice().reverse().map(v => `<div class="wa-edicoes-item"><small>antes${v.em ? ' · ' + horaCurta(v.em) : ''}</small>${linkificar(v.texto)}</div>`).join('')}
    </details>`;
  }

  /* ---------- composer ---------- */
  function renderComposer(c, textoDigitado) {
    if (!pode('msg_enviar')) {
      return `<div class="wa-aviso-nota" style="text-align:center;padding:14px">${ICO('eye')} <b>Modo leitura</b> — você não tem permissão para enviar mensagens nesta conta.</div>`;
    }
    if (_c.rec) {
      return `<div class="wa-composer">
        <div class="wa-rec">
          <div class="wa-rec-dot"></div>
          <span class="wa-rec-tempo" id="rec-tempo">0:00</span>
          <span class="wa-rec-dica">gravando áudio...</span>
        </div>
        <button class="wa-ico-btn" title="Cancelar" onclick="ChatUI.pararGravacao(false)">${I.lixo}</button>
        <button class="wa-enviar" title="Enviar áudio" onclick="ChatUI.pararGravacao(true)">${I.check}</button>
      </div>`;
    }
    const enviando = _c.enviandoAnexo;   // {n, total} enquanto a fila sai; os botões de remover somem
    const temFigurinha = _c.anexos.some(a => a.figurinha);
    const anexo = _c.anexos.length ? `
      <div class="wa-anexo-previa">
        <div class="wa-anexos">
          ${_c.anexos.map((a, i) => `<div class="wa-anexo-item ${enviando && i === 0 ? 'enviando' : ''}" title="${esc(a.file.name)} · ${fmtBytes(a.file.size)}">
            ${a.tipo === 'imagem' ? `<img src="${a.previewUrl}" alt="">` :
              a.tipo === 'video' ? `<video src="${a.previewUrl}" muted></video>` :
              `<div class="wa-anexo-doc">${ICO('file-text')}<small>${esc((a.file.name.includes('.') ? a.file.name.split('.').pop() : '').slice(0, 5).toUpperCase())}</small></div>`}
            <span class="wa-anexo-nome">${esc(a.file.name)}</span>
            ${enviando ? '' : `<button type="button" class="wa-anexo-rm" title="Remover este arquivo" onclick="ChatUI.limparAnexo(${i})">${I.x}</button>`}
          </div>`).join('')}
          ${!enviando && _c.anexos.length < MAX_ANEXOS && !temFigurinha ? `<button type="button" class="wa-anexo-mais" title="Adicionar mais arquivos (até ${MAX_ANEXOS} por envio)" onclick="ChatUI.maisAnexos()">${ICO('plus')}</button>` : ''}
        </div>
        <div class="wa-anexo-info"><b>${_c.anexos.length === 1 ? esc(_c.anexos[0].file.name) : _c.anexos.length + ' arquivos'}</b>${fmtBytes(_c.anexos.reduce((s, a) => s + a.file.size, 0))}${temFigurinha ? ' · será enviada como figurinha (a legenda sai como mensagem à parte)' : ''}
          <div style="margin-top:4px;color:var(--wa-faint)">${enviando ? UI.carregando(`Enviando ${enviando.n} de ${enviando.total}...`)
            : _c.anexos.length > 1 ? 'saem em sequência, nesta ordem — a legenda vai com o primeiro' : 'escreva uma legenda abaixo (opcional) e clique em enviar'}</div></div>
        ${enviando ? '' : `<button class="wa-ico-btn" title="${_c.anexos.length > 1 ? 'Remover todos' : 'Remover anexo'}" onclick="ChatUI.limparAnexo()">${I.x}</button>`}
      </div>` : '';
    // o texto vem de quem chamou (atualizar('composer') passa o que estava digitado); conversa
    // recém-aberta nasce vazia — sem isso a prévia mostrava o rascunho da conversa anterior
    const textoAtualComposer = textoDigitado || '';
    const barraFmt = pode('msg_enviar') && (_c.formatar || semMarcadoresWa(textoAtualComposer) !== textoAtualComposer)
      ? renderFormatacao(textoAtualComposer) : '';
    const resposta = _c.respondendo ? (() => {
      const alvo = state.mensagens.find(x => x.id === _c.respondendo);
      if (!alvo) return '';
      const quem = alvo.direcao === 'saida' ? 'Você' : (alvo.remetente || (c ? c.nome : ''));
      return `<div class="wa-resposta-bar">
        <div class="wa-citado" style="flex:1;margin:0"><b>${esc(quem)}</b><span>${alvo.tipo !== 'texto' ? ICO(iconeDeMidia(alvo)) + ' ' : ''}${esc(semMarcadoresWa(alvo.texto || previaDeMidia(alvo)).slice(0, 120))}</span></div>
        <button class="wa-ico-btn" title="Cancelar resposta" onclick="ChatUI.cancelarResposta()">${I.x}</button>
      </div>`;
    })() : '';
    const ags = state.mensagens.filter(m => m.conversaId === c.id && m.status === 'agendada')
      .sort((a, b) => (a.agendadaPara || '').localeCompare(b.agendadaPara || ''));
    const barraAg = ags.length ? `<div class="wa-ag-bar" onclick="ChatUI.toggleAgendadas()" title="Ver mensagens agendadas desta conversa">
      ${ICO('alarm-clock')} <b>${ags.length}</b> mensagem(ns) agendada(s) — próxima ${fmtDateTime(ags[0].agendadaPara)}
      <span class="wa-ag-ver">${_c.agPop ? 'fechar' : 'ver'}</span>
    </div>` : '';
    return `${anexo}${resposta}${barraAg}
    ${_c.nota ? `<div class="wa-aviso-nota">${ICO('sticky-note')} <b>Modo anotação interna</b> — só a equipe vê. Digite @ para marcar alguém do time; ${UI.kbdTexto('shift+enter')} quebra a linha.</div>` : ''}
    ${barraFmt}
    <div class="wa-composer ${_c.nota ? 'nota' : ''}" style="position:relative">
      ${_c.agPop && ags.length ? renderAgendadasPop(ags) : ''}
      ${_c.emoji ? renderEmojis() : ''}
      ${_c.menuAnexo ? renderMenuAnexo() : ''}
      ${_c.sugestoes ? renderSugestoes() : ''}
      <button class="wa-ico-btn" title="Emojis" onclick="ChatUI.toggleEmoji()">${I.emoji}</button>
      ${!_c.nota && pode('msg_midia') ? `<button class="wa-ico-btn" title="Anexar" onclick="ChatUI.toggleAnexo()">${I.clipe}</button>` : ''}
      <button class="wa-ico-btn ${_c.formatar ? 'ativo' : ''}" title="Formatação do WhatsApp: *negrito* _itálico_ ~tachado~ \`mono\`${_c.nota ? '' : ' — e prévia de como o cliente vê'}" onclick="ChatUI.toggleFormatar()">${I.fmt}</button>
      ${pode('notas_criar') ? `<button class="wa-ico-btn ${_c.nota ? 'gravando' : ''}" title="${_c.nota ? 'Voltar para mensagem' : 'Anotação interna (só o time vê)'}" onclick="ChatUI.toggleNota()">${I.nota}</button>` : ''}
      <textarea id="wa-input" rows="1" placeholder="${_c.nota ? 'Anotação interna... use @ para marcar alguém' : 'Digite uma mensagem'}"
        onkeydown="ChatUI.teclou(event)" oninput="ChatUI.digitou(this)" onpaste="ChatUI.colou(event)"></textarea>
      ${!_c.nota && pode('msg_midia') ? `<button class="wa-ico-btn" title="Gravar áudio" onclick="ChatUI.gravar()">${I.mic}</button>` : ''}
      <button class="wa-enviar" title="Enviar (${UI.kbdTexto('enter')}) — ${UI.kbdTexto('shift+enter')} quebra a linha" aria-label="Enviar" onclick="ChatUI.enviar()">${I.enviar}</button>
      <input type="file" id="wa-file" hidden multiple onchange="ChatUI.arquivoEscolhido(this)">
    </div>`;
  }

  /* barra de formatação do WhatsApp + prévia ao vivo ("assim o cliente vê").
     A prévia usa o MESMO formatador das bolhas (js/texto-wa.js): o que aparece
     aqui é exatamente o que o cliente recebe. Aparece sozinha quando o texto
     tem marcadores; o botão Aa deixa a barra fixa. */
  /* prévia com a assinatura automática (vai na frente da mensagem); na anotação, só o texto */
  function previaWaHTML(v) { return semMarcadoresWa(v) !== v ? formatarWa(_c.nota ? v : comAssinatura(v)) : ''; }
  function renderFormatacao(v) {
    const html = previaWaHTML(v);
    return `<div class="wa-fmt-bar" id="wa-fmt-bar" onclick="event.stopPropagation()">
      <div class="wa-fmt-btns">
        <button type="button" title="Negrito (${UI.kbdTexto('mod+b')}) — *texto*" onclick="ChatUI.formatar('*')"><b>N</b></button>
        <button type="button" title="Itálico (${UI.kbdTexto('mod+i')}) — _texto_" onclick="ChatUI.formatar('_')"><i>I</i></button>
        <button type="button" title="Tachado (${UI.kbdTexto('mod+shift+x')}) — ~texto~" onclick="ChatUI.formatar('~')"><s>S</s></button>
        <button type="button" title="Monoespaçado (${UI.kbdTexto('mod+e')}) — \`texto\`" onclick="ChatUI.formatar('\`')"><code>&lt;/&gt;</code></button>
        <small>selecione um trecho e clique, ou digite os marcadores: *negrito* _itálico_ ~tachado~ \`mono\`</small>
      </div>
      <div class="wa-fmt-previa" id="wa-previa" ${html ? '' : 'hidden'}><small>${_c.nota ? 'Assim fica a anotação' : 'Assim o cliente vê'}</small><div class="wa-bolha-txt">${html}</div></div>
    </div>`;
  }

  /* popup das mensagens agendadas da conversa — mesmo padrão de meta que o
     usuário aprovou (autor · data/hora · reloginho) + Disparar agora / Cancelar */
  function renderAgendadasPop(ags) {
    return `<div class="wa-ag-pop" onclick="event.stopPropagation()">
      <div class="wa-ag-pop-titulo">${ICO('alarm-clock')} Mensagens agendadas desta conversa</div>
      ${ags.map(m => `<div class="wa-ag-item">
        <div class="wa-ag-txt">${esc(m.texto || previaDeMidia(m))}</div>
        <div class="wa-ag-meta">${esc(nomeDoPerfil(m.autor) || 'Equipe')} · ${ICO('alarm-clock')} ${fmtDateTime(m.agendadaPara)}</div>
        <div class="wa-ag-acoes">
          <button class="wa-btn" title="Ler a mensagem inteira" onclick="ChatUI.verAgendada('${m.id}')">${ICO('eye')} Íntegra</button>
          <button class="wa-btn" onclick="ChatUI.dispararAgendada('${m.id}')">${ICO('send')} Disparar agora</button>
          <button class="wa-btn perigo" title="Cancelar agendamento" onclick="ChatUI.cancelarAgendada('${m.id}')">${ICO('trash-2')}</button>
        </div>
      </div>`).join('')}
    </div>`;
  }

  /* seletor de emoji: busca por nome em português (js/emojis.js) e aba "Recentes"
     com os mais usados por usuário (guardados neste computador, por id do perfil) */
  const TODOS_EMOJIS = EMOJIS.flatMap(c => c.lista);
  const nomeEmoji = e => (typeof EMOJI_NOMES !== 'undefined' && EMOJI_NOMES[e]) || '';
  const semAcento = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const chaveRecentes = () => ESCRITORIO.chaves.emojis + ((nuvem() && Cloud.perfil() && Cloud.perfil().id) || 'local');
  function emojisRecentes() {
    try { return JSON.parse(localStorage.getItem(chaveRecentes()) || '{}') || {}; } catch (e) { return {}; }
  }
  function registrarEmoji(e) {
    const r = emojisRecentes();
    r[e] = (r[e] || 0) + 1;
    const top = Object.entries(r).sort((a, b) => b[1] - a[1]).slice(0, 60);
    try { localStorage.setItem(chaveRecentes(), JSON.stringify(Object.fromEntries(top))); } catch (x) {}
  }
  function buscarEmojis(q) {
    const termos = semAcento(q).trim().split(/\s+/).filter(Boolean);
    if (!termos.length) return [];
    return TODOS_EMOJIS.filter(e => { const n = nomeEmoji(e); return n && termos.every(t => n.includes(t)); }).slice(0, 96);
  }
  function emojisGridHTML() {
    const busca = (_c.emojiBusca || '').trim();
    let lista, aviso = '';
    if (busca) {
      lista = buscarEmojis(busca);
      if (!lista.length) aviso = typeof EMOJI_NOMES === 'undefined' ? 'Busca indisponível (js/emojis.js não carregou).' : 'Nada com esse nome — tente outra palavra (ex.: feliz, obrigado, documento).';
    } else if (_c.emojiCat === 0) {
      lista = Object.entries(emojisRecentes()).sort((a, b) => b[1] - a[1]).map(x => x[0]);
      if (!lista.length) aviso = 'Os emojis que você mais usa vão aparecer aqui.';
    } else {
      lista = (EMOJIS[_c.emojiCat - 1] || EMOJIS[0]).lista;
    }
    return lista.map(e => `<button title="${esc(nomeEmoji(e))}" onclick="ChatUI.emoji('${e}')">${e}</button>`).join('') +
      (aviso ? `<div class="wa-emojis-vazio">${aviso}</div>` : '');
  }
  function renderEmojis() {
    const busca = (_c.emojiBusca || '').trim();
    const cats = [{ ico: ICO('history'), rotulo: 'Mais usados' }].concat(EMOJIS);
    return `<div class="wa-emojis" onclick="event.stopPropagation()">
      <input class="wa-emojis-busca" id="wa-emoji-busca" placeholder="Pesquisar emoji (ex.: feliz, obrigado, documento)" value="${esc(_c.emojiBusca || '')}" autocomplete="off"
        oninput="ChatUI.emojiBusca(this.value)" onkeydown="if(event.key==='Escape'){event.stopPropagation();ChatUI.toggleEmoji()}">
      <div class="wa-emojis-cats">
        ${cats.map((e, i) => `<button class="${i === _c.emojiCat && !busca ? 'ativo' : ''}" title="${i === 0 ? 'Mais usados por você' : ''}" onclick="ChatUI.emojiCat(${i})">${e.ico}</button>`).join('')}
      </div>
      <div class="wa-emojis-grid" id="wa-emojis-grid">${emojisGridHTML()}</div>
    </div>`;
  }

  function renderMenuAnexo() {
    return `<div class="wa-menu-anexo" onclick="event.stopPropagation()">
      <button onclick="ChatUI.escolherArquivo('image/*,video/*')">${ICO('image')} Fotos e vídeos</button>
      <button onclick="ChatUI.escolherArquivo('', false, true)" title="Qualquer tipo de arquivo; foto ou vídeo escolhidos aqui vão como documento, sem compressão">${ICO('file-text')} Documento</button>
      <button onclick="ChatUI.escolherArquivo('audio/*')">${ICO('music')} Áudio (arquivo)</button>
      <button onclick="ChatUI.escolherArquivo('image/*', true)">${ICO('sticker')} Imagem como figurinha</button>
    </div>`;
  }

  function renderSugestoes() {
    const s = _c.sugestoes;
    // a dica descreve A.teclou(): Tab e Enter usam sempre a sugestão 0; Esc fecha.
    // mousedown sem padrão: clicar na dica não tira o foco do campo de mensagem
    return `<div class="wa-sugestoes">
      ${s.itens.map((it, i) => `<div class="wa-sugestao ${i === 0 ? 'foco' : ''}" onclick="ChatUI.usarSugestao(${i})">
        <b>${esc(it.rotulo)}</b><span>${esc(it.detalhe || '')}</span></div>`).join('')}
      <div class="wa-sugestoes-dica" onmousedown="event.preventDefault()">${UI.kbd(['tab', 'enter'])} escolhe a primeira · ${UI.kbd('esc')} fecha</div>
    </div>`;
  }

  /* =============================================================
     DRAWER — dados do contato/grupo
  ============================================================= */
  function renderDrawer(c) {
    const tabs = [['dados', c.tipo === 'grupo' ? 'Grupo' : 'Dados'], ['midia', 'Mídia e docs'], ['notas', 'Anotações']];
    return `<div class="wa-drawer">
      <div class="wa-drawer-head">
        <button class="wa-ico-btn" onclick="ChatUI.drawer(false)">${I.x}</button>
        ${c.tipo === 'grupo' ? 'Dados do grupo' : 'Dados do contato'}
      </div>
      <div class="wa-drawer-foto">${avatarHTML(c)}
        ${nuvem() ? `<div style="margin-top:8px"><button class="wa-btn claro" onclick="ChatUI.atualizarFoto()">${ICO('refresh-cw')} Atualizar foto</button></div>` : ''}
      </div>
      <div class="wa-drawer-nome">
        <h3>${esc(c.nome)} ${pode('conversas_renomear') ? `<button class="wa-ico-btn" title="Editar nome" onclick="ChatUI.renomear()">${I.nota}</button>` : ''}</h3>
        ${c.tipo === 'grupo' ? '<small>grupo do WhatsApp</small>' :
        c.telefone.startsWith('lid-')
          ? `<small title="O WhatsApp entregou este contato no formato de privacidade @lid e ainda não revelou o número. Assim que revelar, o ${ESCRITORIO.plataformas.chat} atualiza sozinho.">${ICO('smartphone')} número ainda não revelado pelo WhatsApp</small>`
          : `<small style="font-size:.95rem;font-weight:600;color:var(--wa-text)">${ICO('smartphone')} ${telExibicao(c.telefone)}</small>
             <div style="margin-top:6px"><button class="wa-btn claro" onclick="UI.copiar('${esc(c.telefone)}')">${ICO('copy')} Copiar número</button></div>`}
      </div>
      <div class="wa-drawer-tabs">
        ${tabs.map(([id, rot]) => `<button class="${_c.drawerTab === id ? 'ativo' : ''}" onclick="ChatUI.drawerTab('${id}')">${rot}</button>`).join('')}
      </div>
      <div class="wa-drawer-corpo">
        ${_c.drawerTab === 'midia' ? drawerMidia(c) : _c.drawerTab === 'notas' ? drawerNotas(c) : drawerDados(c)}
      </div>
    </div>`;
  }

  /* ---------- campos personalizados (chat-v18a; spec: nuvem/PLANO-CAMPOS-PERSONALIZADOS.md) ----------
     A lista é do escritório (state.camposPersonalizados); o valor é da conversa (c.campos[id]).
     Cada valor salva sozinho ao sair da caixa, pela função conversa_campo, uma chave por vez. */
  const camposOrdenados = () => (state.camposPersonalizados || []).slice().sort((a, b) => ((Number(a.ordem) || 0) - (Number(b.ordem) || 0)) || String(a.nome).localeCompare(String(b.nome)));
  const ehLink = v => /^https?:\/\//i.test(String(v || ''));
  function secaoCamposHTML(c) {
    const lista = camposOrdenados();
    const gere = pode('campos_gerir');
    if (nuvem() && Cloud.camposAtivos && !Cloud.camposAtivos()) {
      return souAdmin() ? `<div class="wa-campo"><label>Campos personalizados</label>
        <small style="color:var(--wa-faint)">Aplique nuvem/chat-v18a.sql no Supabase para ativar os campos personalizados.</small></div>` : '';
    }
    if (!lista.length && !gere) return '';
    const valores = c.campos || {};
    const linhas = lista.map(k => {
      const v = valores[k.id] || '';
      const acoes = k.tipo === 'link' && ehLink(v)
        ? `<a class="wa-ico-btn" href="${esc(v)}" target="_blank" rel="noopener" title="Abrir">${ICO('arrow-right')}</a><button class="wa-ico-btn" title="Copiar" onclick="UI.copiar('${esc(v)}', this)">${ICO('copy')}</button>`
        : '';
      return `<div class="wa-campo-pers"><span class="wa-campo-pers-rotulo">${esc(k.nome)}</span>
          <div class="wa-campo-pers-valor"><input type="text" data-campo="${k.id}" value="${esc(v)}" placeholder="—"
            onchange="ChatUI.salvarCampo('${c.id}','${k.id}',this)" onkeydown="if(event.key==='Enter'){this.blur()}">${acoes}</div></div>`;
    }).join('');
    return `<div class="wa-campo"><label>Campos personalizados</label>
      ${lista.length ? `<div class="wa-campos-pers">${linhas}</div>` : '<small style="color:var(--wa-faint)">Nenhum campo personalizado ainda.</small>'}
      ${gere ? `<button class="wa-btn claro" style="margin-top:6px" onclick="ChatUI.gerirCampos()">${ICO('clipboard-list')} Gerenciar campos personalizados</button>` : ''}
    </div>`;
  }
  /* erros da função conversa_campo na linguagem de quem usa */
  function traduzirErroCampo(e) {
    const code = e && e.code, msg = String((e && e.message) || '');
    if (code === '42501' || /sem acesso/i.test(msg)) return 'Sem acesso a esta conversa.';
    if (code === '23503' || /campo não encontrado/i.test(msg)) return 'Este campo foi removido.';
    if (code === '22001' || /longo demais/i.test(msg)) return 'Valor longo demais (máximo 2.000 caracteres).';
    return msg || 'Não deu para salvar o campo.';
  }

  function drawerDados(c) {
    const lead = c.leadId ? getLead(c.leadId) : null;
    return `
      <div class="wa-campo"><label>Status do atendimento ${chipStatusHTML(c.status)}</label>
        <select onchange="ChatUI.mudarStatus('${c.id}',this.value);UI.refresh()">
          ${STATUS_ATENDIMENTO.map(([id, rot]) => `<option value="${id}" ${c.status === id ? 'selected' : ''}>${rot}</option>`).join('')}
        </select></div>
      ${deptsMultiplos() ? `<div class="wa-campo"><label>Departamentos <small>(pode marcar mais de um)</small></label>
        <div class="wa-dept-lista">
          ${state.departamentos.map(d => {
            // não marcado = chip "outline" (legível); diluir o chip colorido reprovava no contraste
            const marcado = idsDeDepartamento(c).includes(d.id);
            return `<label class="wa-dept-opcao" title="${marcado ? 'Remover de' : 'Compartilhar com'} ${esc(d.nome)}">
            <input type="checkbox" ${marcado ? 'checked' : ''} ${pode('conversas_delegar') ? '' : 'disabled'}
              onchange="ChatUI.alternarDept('${c.id}','${d.id}',this)">
            <span class="wa-minichip${marcado ? '' : ' outline'}"${marcado ? ` style="background:${corSegura(d.cor)}"` : ''}>${esc(d.nome)}</span></label>`;
          }).join('') || '<small style="color:var(--wa-faint)">Nenhum departamento cadastrado.</small>'}
        </div>
        ${idsDeDepartamento(c).length ? '' : '<small style="color:var(--wa-faint)">Sem departamento: visível a todo o time até ser distribuída.</small>'}
      </div>`
      : `<div class="wa-campo"><label>Departamento (delegar para)</label>
        <select ${pode('conversas_delegar') ? '' : 'disabled'} onchange="ChatUI.delegarDept('${c.id}',this.value)">
          <option value="">— sem departamento —</option>
          ${state.departamentos.map(d => `<option value="${d.id}" ${c.departamentoId === d.id ? 'selected' : ''}>${esc(d.nome)}</option>`).join('')}
        </select>
        ${souAdmin() ? '<small style="color:var(--wa-faint)">Para marcar mais de um departamento, aplique nuvem/chat-v14a.sql no Supabase.</small>' : ''}</div>`}
      <div class="wa-campo"><label>Responsável (delegar para)</label>
        <select ${pode('conversas_delegar') ? '' : 'disabled'} onchange="ChatUI.delegarPessoa('${c.id}',this.value)">
          <option value="">— sem responsável —</option>
          ${(state.time || []).map(p => `<option value="${p.id}" ${c.responsavel === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}
        </select></div>
      <div class="wa-campo"><label>Tags</label>
        <div class="wa-tags-chips">
          ${tagsDaConversa(c).map(nome => `<span class="wa-tag ativo" data-tag="${esc(nome)}" style="${estiloTag(tagCor(nome))}">${esc(nome)}${pode('tags_aplicar') ? `<button class="wa-tag-x" title="Retirar a tag ${esc(nome)}" onclick="ChatUI.toggleTag('${c.id}','${esc(nome)}')">×</button>` : ''}</span>`).join('')
            || `<small style="color:var(--wa-sec)">${(state.tags || []).length ? 'Nenhuma tag nesta conversa.' : `Crie tags no painel <span class="wa-ico-inline">${I.tag}</span> do menu lateral.`}</small>`}
        </div>
        ${pode('tags_aplicar') && tagsDisponiveis(c).length ? `<select class="wa-tag-add" onchange="ChatUI.aplicarTag('${c.id}', this.value)">
          <option value="">+ Adicionar tag…</option>${tagsDisponiveis(c).map(t => `<option value="${esc(t.nome)}">${esc(t.nome)}</option>`).join('')}</select>` : ''}
      </div>
      ${secaoCamposHTML(c)}
      <div class="wa-campo"><label>Lead no CRM</label>
        ${lead ? `<a href="#/leads/${lead.id}" class="wa-btn claro" style="display:inline-block;text-decoration:none">${ICO('user')} ${esc(lead.nome)} · abrir ficha</a>`
        : `<button class="wa-btn claro" onclick="ChatUI.criarLead()">+ Criar lead a partir desta conversa</button>`}
      </div>
      ${secaoCadenciaHTML(c)}
      ${c.tipo === 'grupo' ? drawerGrupo(c) : ''}
      <div style="margin-top:18px;display:flex;gap:8px;flex-wrap:wrap">
        ${pode('conversas_arquivar') ? `<button class="wa-btn claro" onclick="ChatUI.arquivar()">${c.arquivada ? ICO('archive-restore') + ' Desarquivar' : ICO('archive') + ' Arquivar'}</button>` : ''}
      </div>`;
  }

  /* ---------- cadências de follow-up direto no contato (dono, 12/10/2026) ----------
     "Registro de cadências, que hoje só existe no CRM, direto no contato do Chat, só para quem está
     nos departamentos Comercial e os administradores" → alçada cadencias_aplicar (fora do padrão; o
     chat-v19b liga nos departamentos Comercial; admin tem tudo). Usa o mesmo motor do CRM
     (Cadence.aplicar): follow-ups na ficha do lead e mensagens programadas NESTA conversa, que o
     motor envia sozinho. Sem lead vinculado, cria um a partir da conversa (como "Criar lead"). */
  const pendentesDaConversa = c => (c && c.leadId && Cadence.pendentesDoLead) ? Cadence.pendentesDoLead(c.leadId) : [];
  function secaoCadenciaHTML(c) {
    if (c.tipo === 'grupo' || !pode('cadencias_aplicar')) return '';
    const pend = pendentesDaConversa(c);
    if (!pend.length) {
      return `<div class="wa-campo"><label>Cadência de follow-up (CRM)</label>
        <button class="wa-btn claro" onclick="ChatUI.cadenciaRegistrar()">${ICO('target')} Registrar cadência</button>
        <small style="display:block;color:var(--wa-sec);margin-top:4px">Programa os follow-ups na ficha do lead e as mensagens automáticas nesta conversa.</small></div>`;
    }
    const p0 = pend[0];
    return `<div class="wa-campo"><label>Cadência de follow-up (CRM)</label>
      <div class="wa-cadencia"><b>${esc(p0.cadenciaNome || 'Cadência')}</b> · ${pend.length} toque(s) pendente(s)
        <small>Próximo: ${fmtDate(p0.dueDate)} · ${esc(p0.titulo || '')}${p0.msgId ? ' · mensagem programada' : ''}</small>
        <div class="acoes">
          <button class="wa-btn claro" onclick="ChatUI.cadenciaRegistrar()">${ICO('target')} Trocar cadência</button>
          <button class="wa-btn claro" onclick="ChatUI.cadenciaCancelar()">${ICO('x')} Cancelar cadência</button>
        </div></div></div>`;
  }
  const leadDaConversaOuCria = c => {
    const atual = c.leadId ? getLead(c.leadId) : null;
    if (atual) return atual;
    const lead = novoLead({ nome: c.nome, telefone: String(c.telefone || '').startsWith('lid-') ? '' : c.telefone, origem: 'WhatsApp', etapa: 'Contato Feito' });
    atualizarConversa(c.id, { leadId: lead.id });
    return lead;
  };
  A.cadenciaRegistrar = () => {
    const c = getConversa(_c.sel);
    if (!c || c.tipo === 'grupo' || !pode('cadencias_aplicar')) return;
    const cads = (Cadence.all && Cadence.all()) || [];
    if (!cads.length) { UI.toast('Nenhuma cadência cadastrada no CRM.', 'err'); return; }
    const lead = leadDaConversaOuCria(c);
    _c.menuMais = false;
    UI.modal(`<h2>${ICO('target')} Registrar cadência de follow-up <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
      <p class="muted mb"><b>${esc(c.nome)}</b> · lead <b>${esc(lead.nome)}</b> no CRM</p>
      <div class="field"><label>Cadência</label>
        <select id="cc-cad" onchange="ChatUI.cadenciaMudou(this)">${cads.map(k => `<option value="${k.id}" data-ph="${Cadence.pedeHora(k) ? 1 : 0}">${esc(k.nome)} (${(k.passos || []).length} toques)</option>`).join('')}</select>
        <small id="cc-cenario" style="display:block;color:var(--wa-sec);margin-top:4px">${esc(cads[0].cenario || '')}</small></div>
      <div class="form-row">
        <div class="field"><label>Começar em</label><input type="date" id="cc-data" value="${todayISO()}"></div>
        <div class="field" id="cc-hora-wrap" ${Cadence.pedeHora(cads[0]) ? '' : 'hidden'}><label>Horário da consulta</label><input type="time" id="cc-hora" value="10:00"></div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:.86rem;cursor:pointer"><input type="checkbox" id="cc-auto" checked style="width:auto"> Programar os envios automáticos no WhatsApp (nesta conversa)</label>
      <p class="muted" style="margin-top:8px">As mensagens saem prontas, com o nome do contato. Dá para editar ou cancelar cada uma depois em Mensagens agendadas. Follow-ups pendentes anteriores serão substituídos.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="ChatUI.cadenciaConfirmar()">${ICO('target')} Registrar</button>
      </div>`);
  };
  A.cadenciaMudou = sel => {
    const k = Cadence.get(sel.value);
    const w = document.getElementById('cc-hora-wrap'); if (w) w.hidden = !Cadence.pedeHora(k);
    const cen = document.getElementById('cc-cenario'); if (cen) cen.textContent = (k && k.cenario) || '';
  };
  A.cadenciaConfirmar = () => {
    const c = getConversa(_c.sel);
    if (!c || c.tipo === 'grupo' || !pode('cadencias_aplicar')) return;
    const g = id => document.getElementById(id);
    const cad = Cadence.get(g('cc-cad') && g('cc-cad').value);
    if (!cad) { UI.toast('Escolha a cadência.', 'err'); return; }
    const lead = leadDaConversaOuCria(c);
    const data = (g('cc-data') && g('cc-data').value) || todayISO();
    const auto = !!(g('cc-auto') && g('cc-auto').checked);
    const horaRef = (Cadence.pedeHora(cad) && g('cc-hora') && g('cc-hora').value) || '';
    const n = Cadence.aplicar(lead.id, cad.id, data, { autoEnviar: auto, horaRef });
    const programadas = state.followups.filter(f => f.leadId === lead.id && f.status === 'pendente' && f.msgId).length;
    UI.fecharModal();
    UI.toast(`Cadência registrada: ${n} follow-up(s)${programadas ? ` · ${programadas} mensagem(ns) programada(s) nesta conversa` : ''}.`);
    atualizar('head', 'drawer', 'composer', 'msgs');
  };
  A.cadenciaCancelar = () => {
    const c = getConversa(_c.sel);
    if (!c || !c.leadId || !pode('cadencias_aplicar')) return;
    if (!confirm('Cancelar a cadência deste contato?\n\nOs follow-ups pendentes e as mensagens ainda não enviadas saem da fila.')) return;
    const n = Cadence.cancelarPendentes(c.leadId, 'cancelada pelo atendente no ' + ESCRITORIO.plataformas.chat);
    UI.toast(`${n} follow-up(s) cancelado(s).`);
    atualizar('head', 'drawer', 'composer', 'msgs');
  };

  /* localiza a conversa INDIVIDUAL de um participante do grupo.
     O telefone pode vir como '5522...', com sufixo de aparelho ('5522...:12') ou 'lid-XXX'. */
  function convDoParticipante(tel, lid) {
    tel = String(tel || '');
    const individuais = state.conversas.filter(x => x.tipo !== 'grupo' && x.telefone && !String(x.telefone).startsWith('grupo-'));
    if (tel && !tel.startsWith('lid-')) {
      const limpo = normPhone(tel.split(':')[0].split('@')[0]);
      const porTel = limpo && individuais.find(x => !String(x.telefone).startsWith('lid-') && normPhone(String(x.telefone).split(':')[0]) === limpo);
      if (porTel) return porTel;
    }
    // conversa que ainda só conhece o lid (o motor grava 'lid-<lid>' até o número aparecer)
    const l = lid ? 'lid-' + String(lid) : (tel.startsWith('lid-') ? tel : '');
    return (l && individuais.find(x => x.telefone === l)) || null;
  }

  /* nome a exibir para quem mandou numa conversa de grupo: o anotado no participante
     (pushName real) vence o remetente gravado na mensagem */
  function participanteDe(c, m) {
    const jid = String(m.participante || '');
    if (!c || c.tipo !== 'grupo' || !jid) return null;
    const d = jid.split('@')[0].split(':')[0];
    return (c.participantes || []).find(x => x.telefone === d || x.lid === d || x.telefone === 'lid-' + d) || null;
  }
  function nomeDoParticipante(c, m) {
    const p = participanteDe(c, m);
    return (p && p.nome) || m.remetente || '';
  }
  /* telefone (ou 'lid-…') de quem mandou a mensagem no grupo, para abrir a conversa individual */
  function telefoneDoParticipante(c, m) {
    const p = participanteDe(c, m);
    if (p && p.telefone) return p.telefone;
    const jid = String(m.participante || '');
    const d = jid.split('@')[0].split(':')[0];
    if (!d) return '';
    return jid.endsWith('@lid') ? 'lid-' + d : (/^\d+$/.test(d) ? d : '');
  }

  function drawerGrupo(c) {
    const parts = c.participantes || [];
    return `<div class="wa-campo"><label>${parts.length} participante(s)</label>
      <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        ${pode('grupos_membros') ? `<button class="wa-btn claro" onclick="ChatUI.grupoAdd()">+ Adicionar</button>` : ''}
        <button class="wa-btn claro" onclick="ChatUI.grupoAtualizarMembros()">${ICO('refresh-cw')} Atualizar lista</button>
      </div>
      ${parts.map(p => {
        const conv = convDoParticipante(p.telefone, p.lid);
        const semNumero = String(p.telefone || '').startsWith('lid-') || !p.telefone;
        // nome real (pushName anotado pelo motor) > nome da conversa individual > telefone
        const nome = p.nome || (conv && conv.nome) || (semNumero ? 'Participante' : telExibicao(p.telefone));
        // participante 'lid-' sem conversa já pareada = WhatsApp ainda não revelou o número real
        const podeConversar = !!conv || !semNumero;
        const abrir = podeConversar ? `onclick="ChatUI.participanteConversar('${esc(p.telefone)}','${esc(p.nome || '')}')" title="Abrir conversa individual com ${esc(nome)}"` : '';
        return `<div class="wa-participante">
          <div class="wa-avatar ${podeConversar ? 'clicavel' : ''}" ${abrir}>${esc((nome || '?')[0] || '?').toUpperCase()}</div>
          <div class="wa-participante-info ${podeConversar ? 'clicavel' : ''}" ${abrir}><b>${esc(nome)}</b> ${p.admin ? '<span class="chip chip-navy">admin</span>' : ''}
            <small>${semNumero ? 'número ainda não revelado pelo WhatsApp' : telExibicao(p.telefone)}</small></div>
          ${podeConversar
            ? `<button class="wa-btn claro" title="Abrir conversa individual com ${esc(nome)}" onclick="ChatUI.participanteConversar('${esc(p.telefone)}','${esc(p.nome || '')}')">${ICO('message-circle')} Privado</button>`
            : `<button class="wa-btn claro" disabled title="Número ainda não revelado pelo WhatsApp">${ICO('message-circle')} Privado</button>`}
          ${pode('grupos_membros') ? `<button class="wa-ico-btn" title="Remover do grupo" onclick="ChatUI.grupoRemover('${esc(p.telefone)}')">${I.x}</button>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  }

  function drawerMidia(c) {
    const msgs = mensagensDaConversa(c.id).filter(m => m.midiaUrl).reverse();
    const visuais = msgs.filter(m => m.tipo === 'imagem' || m.tipo === 'video' || m.tipo === 'figurinha');
    const docs = msgs.filter(m => m.tipo === 'arquivo');
    const audios = msgs.filter(m => m.tipo === 'audio');
    return `
      ${visuais.length ? `<div class="wa-campo"><label>Fotos e vídeos (${visuais.length})</label>
        <div class="wa-galeria">${visuais.map(m => m.tipo === 'video'
          ? `<video src="${esc(m.midiaUrl)}" onclick="ChatUI.lightbox('${m.id}')"></video>`
          : `<img src="${esc(m.midiaUrl)}" loading="lazy" onclick="ChatUI.lightbox('${m.id}')">`).join('')}</div></div>` : ''}
      ${docs.length ? `<div class="wa-campo"><label>Documentos (${docs.length})</label>
        ${docs.map(m => `<div class="wa-doc" style="margin-bottom:6px"><div class="wa-doc-ico">${ICO('file-text')}</div>
          <div class="wa-doc-info"><b>${esc(m.midiaNome || 'Documento')}</b><small>${fmtDate((m.criadoEm || '').slice(0, 10))} · ${fmtBytes(m.midiaTamanho)}</small></div>
          <a class="wa-baixar" href="${esc(urlBaixar(m))}" target="_blank">${I.baixar}</a></div>`).join('')}</div>` : ''}
      ${audios.length ? `<div class="wa-campo"><label>Áudios (${audios.length})</label>
        ${audios.map(m => `<div style="margin-bottom:8px"><audio src="${esc(m.midiaUrl)}" controls preload="none" style="width:100%;height:36px"></audio>
          ${m.transcricao ? `<div class="wa-transcricao">${esc(m.transcricao)}</div>` : ''}</div>`).join('')}</div>` : ''}
      ${!msgs.length ? '<div class="wa-vazio">Nenhuma mídia nesta conversa ainda.</div>' : ''}`;
  }

  function drawerNotas(c) {
    const notas = mensagensDaConversa(c.id).filter(m => m.tipo === 'anotacao').reverse();
    return `
      ${pode('notas_criar') ? `<button class="wa-btn" style="margin-bottom:12px" onclick="ChatUI.drawer(false);ChatUI.toggleNota(true)">+ Nova anotação</button>` : ''}
      ${notas.length ? notas.map(m => `<div class="wa-nota-hist">
        <div class="wa-nota-hist-cab"><b>${esc(nomeDoPerfil(m.autor) || 'Equipe')}</b> · <small>${fmtDateTime(m.criadoEm)}</small>${botaoApagarNota(m)}</div><div class="wa-nota-txt">${notaHTML(m.texto)}</div>
      </div>`).join('') : `<div class="wa-vazio">Nenhuma anotação interna ainda.<br>Use o botão ${I.nota} no chat para registrar informações que só a equipe vê.</div>`}`;
  }

  /* ---------- apagar anotação interna (chat-v19a) ----------
     Anotação é só da equipe: com a alçada notas_apagar (liberada por padrão) qualquer
     um apaga a sua ou a de um colega, de vez, direto no banco — a RLS confere a alçada
     de novo lá; nada passa pelo motor. As outras abas veem sumir ao recarregar. */
  const botaoApagarNota = m => pode('notas_apagar')
    ? `<button class="wa-nota-apagar" title="Apagar anotação" onclick="event.stopPropagation();ChatUI.apagarNota('${m.id}')">${I.lixo}</button>` : '';

  A.apagarNota = async mid => {
    const i = state.mensagens.findIndex(x => x.id === mid && x.tipo === 'anotacao');
    if (i < 0 || !pode('notas_apagar')) return;
    if (!confirm('Apagar esta anotação interna?\n\nEla some para toda a equipe e não dá para recuperar.')) return;
    const tirar = () => {
      const j = state.mensagens.findIndex(x => x.id === mid);
      if (j >= 0) state.mensagens.splice(j, 1);
      save(); atualizar('msgs', 'drawer');
    };
    if (!nuvem()) { tirar(); return; }
    try {
      await Cloud.apagarAnotacao(mid);
      tirar();
      UI.toast('Anotação apagada.');
    } catch (e) { UI.toast(e.message, 'err'); }
  };

  /* =============================================================
     DASHBOARD DE ATENDIMENTO
  ============================================================= */
  function tempoDesde(iso) {
    if (!iso) return '—';
    const min = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
    if (min < 60) return min + ' min';
    if (min < 1440) return Math.round(min / 60) + ' h';
    return Math.round(min / 1440) + ' d';
  }
  const fmtMin = m => m == null ? '—' : (m < 60 ? Math.round(m) + ' min' : (m / 60).toFixed(1).replace('.', ',') + ' h');

  /* movimento por dia: recebidas × enviadas em duas linhas, com leitura dia a dia (js/ui-grafico.js).
     As cores continuam as de antes — recebidas --chart-2, enviadas --chart-1 —, e a legenda sai do componente. */
  function dashChartSVG(serie) {
    return UI.graficoLinhas(serie, [
      { nome: 'Recebidas', cor: 'var(--chart-2)', chave: 'ent' },
      { nome: 'Enviadas', cor: 'var(--chart-1)', chave: 'sai' }
    ], { titulo: 'Mensagens por dia, recebidas e enviadas', vazio: 'Nenhuma mensagem no período.' });
  }

  function renderDashboard() {
    const dias = _c.dashDias;
    const ini = addDaysISO(todayISO(), -(dias - 1));
    const hoje = todayISO();
    const convs = state.conversas.filter(podeVerConversa);
    const ativas = convs.filter(c => !c.arquivada);
    const emAberto = c => c.status !== 'resolvido' && c.status !== 'fechado';
    const msgs = state.mensagens.filter(m => m.tipo !== 'anotacao' && (m.criadoEm || '').slice(0, 10) >= ini);
    const recebidas = msgs.filter(m => m.direcao === 'entrada');
    const enviadas = msgs.filter(m => m.direcao === 'saida' && !['pendente', 'agendada', 'erro', 'cancelada'].includes(m.status));
    const hojeIn = recebidas.filter(m => m.criadoEm.slice(0, 10) === hoje).length;
    const hojeOut = enviadas.filter(m => m.criadoEm.slice(0, 10) === hoje).length;
    const novasHoje = convs.filter(c => (c.criadoEm || '').slice(0, 10) === hoje).length;
    const resolvidasHoje = convs.filter(c => !emAberto(c) && (c.atualizadoEm || '').slice(0, 10) === hoje).length;

    // fila de atenção: conversas cuja ÚLTIMA mensagem é do cliente (aguardando resposta)
    const fila = [];
    ativas.filter(emAberto).forEach(c => {
      const ms = mensagensDaConversa(c.id).filter(m => m.tipo !== 'anotacao');
      const ult = ms[ms.length - 1];
      if (ult && ult.direcao === 'entrada') fila.push({ c, desde: ult.criadoEm });
    });
    fila.sort((a, b) => (a.desde || '').localeCompare(b.desde || ''));
    const semDono = ativas.filter(c => emAberto(c) && !c.responsavel).length;
    const semDepto = ativas.filter(c => emAberto(c) && !idsDeDepartamento(c).length).length;
    const agendadas = state.mensagens.filter(m => m.status === 'agendada').length;
    const erros = state.mensagens.filter(m => m.status === 'erro' && (m.criadoEm || '').slice(0, 10) >= ini).length;

    // 1ª resposta por conversa no período + % dentro da meta de 5 min
    const tempos = [];
    convs.forEach(c => {
      const ms = mensagensDaConversa(c.id).filter(m => m.tipo !== 'anotacao' && (m.criadoEm || '').slice(0, 10) >= ini);
      const primeira = ms.find(m => m.direcao === 'entrada');
      if (!primeira) return;
      const resposta = ms.find(m => m.direcao === 'saida' && m.criadoEm > primeira.criadoEm);
      if (resposta) tempos.push((new Date(resposta.criadoEm) - new Date(primeira.criadoEm)) / 60000);
    });
    const tMedio = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null;
    const pctMeta = tempos.length ? Math.round(tempos.filter(t => t <= 5).length / tempos.length * 100) : null;

    // série diária dupla (recebidas × enviadas)
    const serie = [];
    for (let i = dias - 1; i >= 0; i--) {
      const d = addDaysISO(hoje, -i);
      serie.push({
        label: d.slice(8, 10) + '/' + d.slice(5, 7), hoje: d === hoje, data: d,
        ent: recebidas.filter(m => m.criadoEm.slice(0, 10) === d).length,
        sai: enviadas.filter(m => m.criadoEm.slice(0, 10) === d).length
      });
    }

    // horários de pico (mensagens recebidas por hora)
    const porHora = {};
    recebidas.forEach(m => { const h = new Date(m.criadoEm).getHours(); porHora[h] = (porHora[h] || 0) + 1; });
    const horas = Object.entries(porHora).map(([h, v]) => ({ label: h + 'h–' + (Number(h) + 1) + 'h', value: v }))
      .sort((a, b) => b.value - a.value).slice(0, 6);

    // por atendente: enviadas + resolvidas sob responsabilidade
    const porAtendente = {};
    enviadas.forEach(m => { if (m.autor) { const n = nomeDoPerfil(m.autor) || '?'; porAtendente[n] = (porAtendente[n] || 0) + 1; } });
    // por departamento (com a cor do depto) — conversa em dois departamentos conta nos dois
    const porDept = state.departamentos.map(d => ({
      label: d.nome, color: d.cor,
      value: ativas.filter(c => idsDeDepartamento(c).includes(d.id)).length
    })).concat([{ label: 'Sem departamento', color: 'var(--text-subtle)', value: ativas.filter(c => !idsDeDepartamento(c).length).length }])
      .filter(x => x.value).sort((a, b) => b.value - a.value);
    // top tags
    const porTag = {};
    ativas.forEach(c => (c.tags || []).forEach(t => porTag[t] = (porTag[t] || 0) + 1));

    // status clicáveis (resolvidas/fechadas estão arquivadas, mas contam aqui)
    const chipsStatus = STATUS_ATENDIMENTO.map(([id]) => {
      const n = convs.filter(c => c.status === id && (!c.arquivada || statusEncerra(id))).length;
      return `<button class="wa-chip wa-chip-status" onclick="ChatUI.dashFiltrar('${id}')">${chipStatusHTML(id)} <b>${n}</b></button>`;
    }).join('');

    // tabela "não resolvidos/fechados" por departamento e por usuário, como no ChatGuru:
    // colunas Aberto / Em atendimento / Aguardando / Total; célula clicável abre a lista filtrada
    const abertas = ativas.filter(emAberto);
    const COLUNAS = ['aberto', 'em_atendimento', 'aguardando'];
    const linhaTabela = (rotulo, lista, filtroDept) => {
      const celula = s => {
        const v = lista.filter(c => c.status === s).length;
        const cls = statusAtendInfo(s).chip.replace('chip-st-', 'st-');
        return `<td class="wa-st-cel ${v ? cls : 'zero'}" ${v && filtroDept ? `onclick="ChatUI.dashFiltrar('${s}','tudo','${filtroDept}')" title="Abrir na lista"` : ''}>${v}</td>`;
      };
      return `<tr><th>${rotulo}</th>${COLUNAS.map(celula).join('')}<td class="wa-st-total ${lista.length ? '' : 'zero'}">${lista.length}</td></tr>`;
    };
    const tabelaStatus = `<table class="wa-tabela-status">
      <thead><tr><th>Departamento ou usuário</th>
        ${COLUNAS.map(s => `<th>${chipStatusHTML(s)}<b>${abertas.filter(c => c.status === s).length}</b></th>`).join('')}<th>Total</th></tr></thead>
      <tbody>
        ${linhaTabela(`${ICO('users')} Sem departamento`, abertas.filter(c => !idsDeDepartamento(c).length), 'nenhum')}
        ${state.departamentos.map(d => linhaTabela(`<span class="wa-dot" style="background:${corSegura(d.cor)}"></span>${esc(d.nome)}`, abertas.filter(c => idsDeDepartamento(c).includes(d.id)), d.id)).join('')}
        ${(state.time || []).map(p => linhaTabela(`${ICO('user')} ${esc(p.nome)}<small>${esc(p.email || '')}</small>`, abertas.filter(c => c.responsavel === p.id))).join('')}
      </tbody></table>`;

    const kpi = (num, rot, opts = {}) =>
      `<div class="wa-card ${opts.classe || ''}" ${opts.onclick ? `style="cursor:pointer" onclick="${opts.onclick}" title="Clique para ver"` : ''}>
        <div class="num" ${opts.cor ? `style="color:${opts.cor}"` : ''}>${num}</div><div class="rot">${rot}</div></div>`;

    return `<div class="wa-main painel"><div class="wa-painel-grande">
      <h2>${ICO('chart-column')} Dashboard de atendimento</h2>
      <div class="sub">Visão do ${ESCRITORIO.plataformas.chat} agora e nos
        <select style="border:1px solid var(--wa-border);border-radius:8px;padding:4px 8px" onchange="ChatUI.set('dashDias',Number(this.value))">
          ${[7, 14, 30, 90].map(d => `<option value="${d}" ${dias === d ? 'selected' : ''}>últimos ${d} dias</option>`).join('')}
        </select> · cartões coloridos são clicáveis</div>

      <div class="wa-secao-titulo" style="padding-left:2px">${ICO('flame')} Agora — precisa de ação</div>
      <div class="wa-cards">
        ${kpi(fila.length, 'clientes aguardando resposta', { cor: fila.length ? 'var(--state-danger-fg)' : 'var(--state-success-fg)', onclick: "ChatUI.dashFiltrar('', 'naolidas')" })}
        ${kpi(fila.length ? tempoDesde(fila[0].desde) : '—', 'espera mais antiga', { cor: fila.length ? 'var(--state-danger-fg)' : undefined })}
        ${kpi(semDono, 'sem responsável definido', { cor: semDono ? 'var(--state-warning-fg)' : undefined, onclick: "ChatUI.dashFiltrar('')" })}
        ${kpi(semDepto, 'sem departamento (triagem)', { cor: semDepto ? 'var(--state-warning-fg)' : undefined, onclick: "ChatUI.dashFiltrar('', 'tudo', 'nenhum')" })}
        ${kpi(agendadas, 'mensagens agendadas', { onclick: "ChatUI.painel('agendadas')" })}
        ${erros ? kpi(erros, 'falhas de envio no período', { cor: 'var(--state-danger-fg)' }) : ''}
      </div>

      ${fila.length ? `<div class="wa-bloco"><h4>${ICO('timer')} Fila de atenção — respondendo do mais antigo para o mais novo</h4>
        ${fila.slice(0, 8).map(({ c, desde }) => {
          const min = (Date.now() - new Date(desde)) / 60000;
          const cor = min > 60 ? 'var(--state-danger-fg)' : min > 15 ? 'var(--state-warning-fg)' : 'var(--state-success-fg)';
          return `<div class="wa-fila-item" onclick="ChatUI.abrir('${c.id}')">
            <b>${esc(c.nome)}</b>
            <span class="wa-fila-espera" style="color:${cor}">${ICO('timer')} há ${tempoDesde(desde)}</span>
            <small>${esc(semMarcadoresWa(previaConversa(c) || '').slice(0, 70))}</small>
            <span>${chipsDeptHTML(c)}
              ${c.responsavel ? `<span class="wa-minichip outline">${esc(nomeDoPerfil(c.responsavel))}</span>` : '<span class="wa-minichip" style="background:var(--state-warning-fg)">sem dono</span>'}</span>
          </div>`;
        }).join('')}
        ${fila.length > 8 ? `<small style="color:var(--wa-sec)">…e mais ${fila.length - 8}. </small>` : ''}
      </div>` : `<div class="wa-bloco" style="border-left:4px solid var(--state-success-fg)"><h4>${ICO('circle-check')} Nenhum cliente esperando resposta</h4>
        <small style="color:var(--wa-sec)">Todas as conversas ativas foram respondidas. Bom trabalho!</small></div>`}

      <div class="wa-secao-titulo" style="padding-left:2px">${ICO('trending-up')} Hoje e no período</div>
      <div class="wa-cards">
        ${kpi(hojeIn, 'msgs recebidas hoje', { classe: 'destaque' })}
        ${kpi(hojeOut, 'msgs enviadas hoje')}
        ${kpi(novasHoje, 'conversas novas hoje')}
        ${kpi(resolvidasHoje, 'resolvidas hoje', { cor: 'var(--state-success-fg)' })}
        ${kpi(fmtMin(tMedio), 'tempo médio de 1ª resposta', { cor: tMedio != null && tMedio <= 5 ? 'var(--state-success-fg)' : tMedio != null ? 'var(--state-warning-fg)' : undefined })}
        ${kpi(pctMeta == null ? '—' : pctMeta + '%', 'respondidas em até 5 min<br>(meta: responder em 5 min = 21× mais conversão)', { cor: pctMeta >= 70 ? 'var(--state-success-fg)' : 'var(--state-warning-fg)' })}
      </div>

      <div class="wa-bloco"><h4>Chats não resolvidos/fechados</h4>
        <small style="color:var(--wa-sec);display:block;margin:-6px 0 10px">Tudo que ainda não teve o atendimento concluído, por departamento e por responsável. Uma conversa em dois departamentos conta nos dois.</small>
        <div class="wa-tabela-rolagem">${tabelaStatus}</div></div>

      <div class="wa-bloco"><h4>Status das conversas ativas — clique para filtrar</h4>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${chipsStatus}</div></div>

      <div class="wa-bloco"><h4>Movimento por dia (recebidas × enviadas)</h4>${dashChartSVG(serie)}</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="wa-bloco"><h4>${ICO('users')} Mensagens enviadas por atendente</h4>
          ${UI.hbarHTML(Object.entries(porAtendente).map(([label, value]) => ({ label, value, color: 'var(--state-success-fg)' })).sort((a, b) => b.value - a.value))}</div>
        <div class="wa-bloco"><h4>${ICO('folder')} Conversas ativas por departamento</h4>${UI.hbarHTML(porDept)}
          <small style="color:var(--wa-faint)">Uma conversa em dois departamentos conta nos dois.</small></div>
        <div class="wa-bloco"><h4>${ICO('clock')} Horários de pico (msgs recebidas)</h4>${UI.hbarHTML(horas, {})}</div>
        <div class="wa-bloco"><h4>${ICO('tag')} Tags mais usadas</h4>
          ${Object.keys(porTag).length ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${Object.entries(porTag).sort((a, b) => b[1] - a[1]).slice(0, 12)
            .map(([t, n]) => `<button class="wa-chip" style="${estiloTag(tagCor(t))};font-weight:700" onclick="ChatUI.dashTag('${esc(t)}')">${esc(t)}: ${n}</button>`).join('')}</div>`
          : '<div class="muted">Nenhuma tag aplicada ainda.</div>'}</div>
      </div>
    </div></div>`;
  }

  /* =============================================================
     KANBAN — conversas por status, com arrastar e soltar
  ============================================================= */
  function renderKanban() {
    if (_c.kanbanDept === undefined) {
      // abre no meu departamento se tenho um só; com vários (ou nenhum), em "Todos"
      const meus = deptsDoPerfil(eu());
      _c.kanbanDept = meus.length === 1 ? meus[0].id : '';
    }
    // encerradas ficam arquivadas, mas continuam nas colunas Resolvido/Fechado do quadro
    const convs = state.conversas.filter(c => (!c.arquivada || statusEncerra(c.status)) && podeVerConversa(c) &&
      (!_c.kanbanDept || filtroDept(c, _c.kanbanDept)));
    const dept = state.departamentos.find(d => d.id === _c.kanbanDept);
    return `<div class="wa-main painel"><div class="wa-painel-grande" style="max-width:none">
      <h2>${I.kanban} Kanban de atendimento</h2>
      <div class="sub">Arraste os cartões entre as colunas para mudar o status ·
        <select style="border:1px solid var(--wa-border);border-radius:8px;padding:4px 8px" onchange="ChatUI.set('kanbanDept',this.value)">
          <option value="">Todos os departamentos</option>
          <option value="nenhum" ${_c.kanbanDept === 'nenhum' ? 'selected' : ''}>Sem departamento</option>
          ${state.departamentos.map(d => `<option value="${d.id}" ${_c.kanbanDept === d.id ? 'selected' : ''}>${esc(d.nome)}</option>`).join('')}
        </select>
        ${dept ? `<span class="wa-minichip" style="background:${corSegura(dept.cor)}">${esc(dept.nome)}</span>` : ''}</div>
      <div class="wa-kanban">
        ${STATUS_ATENDIMENTO.map(([id]) => {
          const cards = convs.filter(c => c.status === id)
            .sort((a, b) => (a.ultimaMsgEm || a.criadoEm || '').localeCompare(b.ultimaMsgEm || b.criadoEm || ''));
          return `<div class="wa-kcol" ondragover="event.preventDefault();this.classList.add('alvo')"
              ondragleave="this.classList.remove('alvo')"
              ondrop="this.classList.remove('alvo');ChatUI.kanbanDrop(event,'${id}')">
            <div class="wa-kcol-cab">${chipStatusHTML(id)}
              <span class="wa-kqtd">${cards.length}</span></div>
            <div class="wa-kcol-corpo">
              ${cards.map(c => {
                return `<div class="wa-kcard" draggable="true"
                    ondragstart="event.dataTransfer.setData('text/plain','${c.id}')"
                    onclick="ChatUI.abrir('${c.id}')">
                  <div class="wa-kcard-topo"><b>${c.tipo === 'grupo' ? ICO('users') + ' ' : ''}${esc(c.nome)}</b>
                    ${c.naoLidas ? `<span class="wa-naolidas">${c.naoLidas}</span>` : ''}</div>
                  <small>${esc(semMarcadoresWa(previaConversa(c) || '').slice(0, 60)) || '<i>sem mensagens</i>'}</small>
                  <div class="wa-kcard-rodape">
                    <span title="tempo desde a última mensagem">${ICO('timer')} ${tempoDesde(c.ultimaMsgEm || c.criadoEm)}</span>
                    ${chipsDeptHTML(c, _c.kanbanDept)}
                    ${c.responsavel ? `<span class="wa-minichip outline">${esc(nomeDoPerfil(c.responsavel))}</span>` : ''}
                    ${tagsDaConversa(c).slice(0, 2).map(t => `<span class="wa-minichip" style="${estiloTag(tagCor(t))}">${esc(t)}</span>`).join('')}
                  </div>
                </div>`;
              }).join('') || '<div class="wa-kvazio">vazio</div>'}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div></div>`;
  }

  A.kanbanDrop = (ev, status) => {
    ev.preventDefault();
    const cid = ev.dataTransfer.getData('text/plain');
    const c = getConversa(cid);
    if (!c || c.status === status) return;
    A.mudarStatus(cid, status);
    UI.toast(`${c.nome} → ${statusAtendInfo(status).label}`);
    atualizar('main', 'lista');
  };

  /* v6: ponto único de mudança de status — ao resolver/fechar, dispara a
     análise SPIN heurística silenciosa da conversa (se habilitada) */
  A.mudarStatus = (cid, status) => {
    const c = getConversa(cid);
    if (!c || c.status === status) return;
    // resolvido/fechado saem da caixa de entrada (arquivada); um status em aberto devolve à caixa
    atualizarConversa(cid, { status, arquivada: statusEncerra(status) });
    if (statusEncerra(status)) analiseAutomaticaDaConversa(c);
  };

  /* =============================================================
     AUTOMAÇÕES — quando (gatilho) → se (condições) → então (ações)
  ============================================================= */
  const GATILHOS = { mensagem_recebida: 'Quando chegar mensagem', conversa_criada: 'Quando um novo contato chamar' };
  const CONDS = {
    contem_texto: ['Mensagem contém...', 'palavras separadas por vírgula'],
    nao_contem: ['Mensagem NÃO contém...', 'palavras separadas por vírgula'],
    primeira_mensagem: ['É a primeira mensagem do contato', null],
    dentro_horario: ['Dentro do horário...', 'ex.: seg-sex 08:00-18:00'],
    fora_horario: ['Fora do horário...', 'ex.: seg-sex 08:00-18:00'],
    sem_departamento: ['Conversa sem departamento', null],
    departamento: ['Departamento da conversa é...', 'nome do departamento'],
    individual: ['É conversa individual (não grupo)', null],
    grupo: ['É um grupo', null]
  };
  const ACOES = {
    enviar_mensagem: ['Enviar mensagem', 'texto — use {{nome}}'],
    enquete_departamentos: ['Enviar enquete de departamentos (cliente toca e é direcionado)', 'pergunta (opcional)', true],
    aplicar_tag: ['Aplicar tag', 'nome da tag'],
    delegar_departamento: ['Delegar ao departamento (substitui os atuais)', 'nome do departamento'],
    acrescentar_departamento: ['Acrescentar o departamento (mantém os outros)', 'nome do departamento'],
    delegar_atendente: ['Delegar ao atendente', 'primeiro nome'],
    mudar_status: ['Mudar status para', 'aberto | em_atendimento | aguardando | resolvido | fechado'],
    notificar: ['Notificar os administradores', 'texto do aviso'],
    criar_lead: ['Criar lead no CRM', null]
  };

  function resumoAutomacao(a) {
    const se = (a.condicoes || []).map(x => (CONDS[x.tipo] ? CONDS[x.tipo][0].replace('...', '') : x.tipo) + (x.valor ? ` “${x.valor}”` : '')).join(' E ');
    const entao = (a.acoes || []).map(x => (ACOES[x.tipo] ? ACOES[x.tipo][0] : x.tipo) + (x.valor ? ` “${String(x.valor).slice(0, 40)}${String(x.valor).length > 40 ? '…' : ''}”` : '')).join(' → ');
    return `${GATILHOS[a.gatilho] || a.gatilho}${se ? ' · SE ' + se : ''} · ENTÃO ${entao || '(nada)'}`;
  }

  function renderAutomacoes() {
    const avisoNuvem = nuvem() && !Cloud.automacoesAtivas()
      ? `<div class="wa-bloco" style="border-left:4px solid var(--state-warning-fg)"><h4>${ICO('alert-triangle')} Falta ativar no banco</h4>
        <small style="color:var(--wa-sec)">Rode o arquivo <b>nuvem/chat-v5.sql</b> no SQL Editor do Supabase. O motor ativa sozinho em até 1 minuto.</small></div>`
      : '';
    setTimeout(carregarLogAutomacoes, 60);
    return `<div class="wa-main painel"><div class="wa-painel-grande">
      <h2>${I.robo} Automações</h2>
      <div class="sub">Regras <b>QUANDO → SE → ENTÃO</b> executados pelo motor 24h por dia — saudações, triagem, delegação automática...</div>
      ${pode('automacoes_editar') ? `<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        <button class="wa-btn" onclick="ChatUI.autoEditar(null)">+ Nova automação</button>
        <button class="wa-btn" onclick="ChatUI.autoCriarIA()">${ICO('sparkles')} Criar com IA</button>
        <button class="wa-btn claro" onclick="ChatUI.autoImportar()">${ICO('download')} Importar</button>
      </div>` : ''}
      ${avisoNuvem}
      ${(state.automacoes || []).length ? state.automacoes.map(a => `
        <div class="wa-bloco" style="display:flex;gap:12px;align-items:flex-start;${a.ativa ? '' : 'opacity:.55'}">
          <label class="wa-toggle" title="${a.ativa ? 'Desligar' : 'Ligar'}">
            <input type="checkbox" ${a.ativa ? 'checked' : ''} onchange="ChatUI.autoAtiva('${a.id}',this.checked)">
            <span></span>
          </label>
          <div style="flex:1;min-width:0">
            <h4 style="margin-bottom:4px">${esc(a.nome)} ${a.ativa ? '' : '<span class="chip chip-gray">desligada</span>'}</h4>
            <small style="color:var(--wa-sec);line-height:1.5;display:block">${esc(resumoAutomacao(a))}</small>
            <small style="color:var(--wa-faint)">não repete para a mesma conversa por ${a.cooldownHoras}h</small>
          </div>
          ${pode('automacoes_editar') ? `<div style="display:flex;gap:2px;flex-shrink:0">
            <button class="wa-ico-btn" title="Editar" onclick="ChatUI.autoEditar('${a.id}')">${I.nota}</button>
            <button class="wa-ico-btn" title="Copiar JSON (exportar)" onclick="ChatUI.autoExportar('${a.id}')">${I.encaminhar}</button>
            <button class="wa-ico-btn" title="Excluir" onclick="ChatUI.autoExcluir('${a.id}')">${I.lixo}</button>
          </div>` : ''}
        </div>`).join('')
      : `<div class="wa-bloco"><h4>Nenhuma automação ainda</h4>
        <small style="color:var(--wa-sec);line-height:1.6">Ideias para começar (crie com 1 clique no ${ICO('sparkles')} Criar com IA):<br>
        • “Dê boas-vindas a todo contato novo e pergunte em que podemos ajudar”<br>
        • “Fora do horário seg-sex 08:00-18:00, avise que respondemos no próximo dia útil”<br>
        • “Se a mensagem falar de trabalhista, delegue ao Jurídico e aplique a tag Trabalhista”</small></div>`}
      <div class="wa-bloco"><h4>${ICO('scroll-text')} Últimas execuções</h4><div id="auto-log"><small class="muted">${UI.carregando('Carregando')}</small></div></div>
    </div></div>`;
  }

  async function carregarLogAutomacoes() {
    const el = document.getElementById('auto-log');
    if (!el) return;
    if (!nuvem() || !Cloud.automacoesAtivas()) { el.innerHTML = '<small style="color:var(--wa-sec)">Disponível no modo nuvem, com o chat-v5.sql ativo.</small>'; return; }
    try {
      const rows = await Cloud.logAutomacoes();
      el.innerHTML = (rows || []).length ? rows.map(r => `
        <div style="padding:7px 0;border-bottom:1px solid var(--wa-border);font-size:.83rem">
          ${ICO('bot')} <b>${esc((r.automacoes && r.automacoes.nome) || 'automação')}</b> em
          <a href="#" onclick="event.preventDefault();ChatUI.abrir('${r.conversa_id}')">${esc((r.conversas && r.conversas.nome) || 'conversa')}</a>
          <small style="color:var(--wa-faint)"> · ${esc(r.detalhe)} · ${fmtDateTime(r.executado_em)}</small>
        </div>`).join('') : '<small style="color:var(--wa-sec)">Nenhuma execução ainda — assim que uma automação disparar, aparece aqui.</small>';
    } catch (e) { el.innerHTML = '<small style="color:var(--wa-sec)">Erro ao carregar o log: ' + esc(e.message) + '</small>'; }
  }

  /* ---------- editor de automação ---------- */
  let _draft = null;

  function linhaBuilder(lista, rotulos, i, prefixo) {
    const item = lista[i];
    const [, dica] = rotulos[item.tipo] || ['?', ''];
    return `<div class="wa-auto-linha">
      <select onchange="ChatUI.autoCampo('${prefixo}',${i},'tipo',this.value)">
        ${Object.entries(rotulos).map(([t, [rot]]) => `<option value="${t}" ${item.tipo === t ? 'selected' : ''}>${rot}</option>`).join('')}
      </select>
      ${dica != null ? `<input value="${esc(item.valor || '')}" placeholder="${esc(dica)}"
        oninput="ChatUI.autoCampo('${prefixo}',${i},'valor',this.value)" list="auto-dicas-${prefixo}-${item.tipo}">` : ''}
      <button class="wa-ico-btn" title="Remover" onclick="ChatUI.autoLinha('${prefixo}',${i},false)">${I.x}</button>
    </div>`;
  }

  function renderEditorAutomacao() {
    const a = _draft;
    const datalists = `
      <datalist id="auto-dicas-cond-departamento">${state.departamentos.map(d => `<option value="${esc(d.nome)}">`).join('')}</datalist>
      <datalist id="auto-dicas-acao-delegar_departamento">${state.departamentos.map(d => `<option value="${esc(d.nome)}">`).join('')}</datalist>
      <datalist id="auto-dicas-acao-acrescentar_departamento">${state.departamentos.map(d => `<option value="${esc(d.nome)}">`).join('')}</datalist>
      <datalist id="auto-dicas-acao-aplicar_tag">${tagsOrdenadas().map(t => `<option value="${esc(t.nome)}">`).join('')}</datalist>
      <datalist id="auto-dicas-acao-delegar_atendente">${(state.time || []).map(p => `<option value="${esc(primeiroNome(p.nome))}">`).join('')}</datalist>
      <datalist id="auto-dicas-acao-mudar_status">${STATUS_ATENDIMENTO.map(([id]) => `<option value="${id}">`).join('')}</datalist>`;
    UI.modal(`<h2>${ICO('bot')} ${a.id ? 'Editar' : 'Nova'} automação <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
      ${datalists}
      <div class="form-row">
        <div class="field"><label>Nome</label><input id="au-nome" value="${esc(a.nome || '')}" placeholder="Ex.: Boas-vindas automáticas"></div>
        <div class="field"><label>Não repetir p/ mesma conversa por (horas)</label><input id="au-cool" type="number" min="0" step="0.5" value="${a.cooldownHoras == null ? 12 : a.cooldownHoras}"></div>
      </div>
      <div class="field"><label>QUANDO (gatilho)</label>
        <select id="au-gatilho">${Object.entries(GATILHOS).map(([g, rot]) => `<option value="${g}" ${a.gatilho === g ? 'selected' : ''}>${rot}</option>`).join('')}</select>
      </div>
      <div class="field"><label>SE (todas as condições precisam valer — vazio = sempre)</label>
        <div id="au-conds">${a.condicoes.map((_, i) => linhaBuilder(a.condicoes, CONDS, i, 'cond')).join('')}</div>
        <button class="btn btn-ghost btn-sm" onclick="ChatUI.autoLinha('cond',-1,true)">+ condição</button>
      </div>
      <div class="field"><label>ENTÃO (ações em sequência)</label>
        <div id="au-acoes">${a.acoes.map((_, i) => linhaBuilder(a.acoes, ACOES, i, 'acao')).join('')}</div>
        <button class="btn btn-ghost btn-sm" onclick="ChatUI.autoLinha('acao',-1,true)">+ ação</button>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="ChatUI.autoSalvar()">Salvar automação</button>
      </div>`, { large: true });
  }

  A.autoEditar = aid => {
    const a = aid ? state.automacoes.find(x => x.id === aid) : null;
    _draft = a ? JSON.parse(JSON.stringify(a)) : { id: null, nome: '', ativa: true, gatilho: 'mensagem_recebida', cooldownHoras: 12, condicoes: [], acoes: [{ tipo: 'enviar_mensagem', valor: '' }] };
    renderEditorAutomacao();
  };
  A.autoCampo = (prefixo, i, campo, valor) => {
    const lista = prefixo === 'cond' ? _draft.condicoes : _draft.acoes;
    if (!lista[i]) return;
    lista[i][campo] = valor;
    if (campo === 'tipo') { lista[i].valor = ''; renderEditorAutomacao(); }
  };
  A.autoLinha = (prefixo, i, adicionar) => {
    _draft.nome = document.getElementById('au-nome').value;
    _draft.cooldownHoras = Number(document.getElementById('au-cool').value) || 0;
    _draft.gatilho = document.getElementById('au-gatilho').value;
    const lista = prefixo === 'cond' ? _draft.condicoes : _draft.acoes;
    if (adicionar) lista.push({ tipo: prefixo === 'cond' ? 'contem_texto' : 'enviar_mensagem', valor: '' });
    else lista.splice(i, 1);
    renderEditorAutomacao();
  };
  A.autoSalvar = () => {
    _draft.nome = document.getElementById('au-nome').value.trim();
    _draft.cooldownHoras = Math.max(0, Number(document.getElementById('au-cool').value) || 0);
    _draft.gatilho = document.getElementById('au-gatilho').value;
    _draft.condicoes = (_draft.condicoes || []).filter(x => CONDS[x.tipo]);
    _draft.acoes = (_draft.acoes || []).filter(x => ACOES[x.tipo] && (ACOES[x.tipo][1] == null || ACOES[x.tipo][2] || String(x.valor || '').trim()));
    if (!_draft.nome) { UI.toast('Dê um nome à automação', 'err'); return; }
    if (!_draft.acoes.length) { UI.toast('Adicione ao menos uma ação com valor preenchido', 'err'); return; }
    // texto de horário inválido travava o motor inteiro (laço infinito no parser)
    const horaRuim = _draft.condicoes.find(x => /horario/.test(x.tipo) && !horarioValido(x.valor));
    if (horaRuim) { UI.toast('Horário inválido na condição. Use, por exemplo: seg-sex 08:00-18:00', 'err'); return; }
    if (_draft.id) {
      const i = state.automacoes.findIndex(x => x.id === _draft.id);
      if (i >= 0) state.automacoes[i] = _draft;
    } else {
      _draft.id = uid();
      _draft.criadoEm = new Date().toISOString();
      state.automacoes.push(_draft);
    }
    save();
    UI.fecharModal();
    UI.toast('Automação salva (o motor aplica em até 1 min).');
    atualizar('main');
  };
  A.autoAtiva = (aid, ativa) => {
    const a = state.automacoes.find(x => x.id === aid);
    if (!a) return;
    a.ativa = ativa;
    save();
    UI.toast(ativa ? 'Automação ligada.' : 'Automação desligada.');
    atualizar('main');
  };
  A.autoExcluir = aid => {
    const a = state.automacoes.find(x => x.id === aid);
    if (!a || !confirm(`Excluir a automação "${a.nome}"?`)) return;
    state.automacoes = state.automacoes.filter(x => x.id !== aid);
    save();
    atualizar('main');
  };
  A.autoExportar = aid => {
    const a = state.automacoes.find(x => x.id === aid);
    if (!a) return;
    const { id, criadoEm, ...resto } = a;
    UI.copiar(JSON.stringify(resto, null, 2));
  };
  A.autoImportar = () => {
    UI.modal(`<h2>${ICO('download')} Importar automação <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
      <p class="muted mb">Cole aqui o JSON de uma automação (ex.: gerado pelo Claude ou exportado de outra conta).</p>
      <div class="field"><textarea id="au-json" rows="10" placeholder='{"nome":"...","gatilho":"mensagem_recebida","condicoes":[...],"acoes":[...]}'></textarea></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="ChatUI.autoImportarOk()">Revisar e salvar</button>
      </div>`, { large: true });
  };
  A.autoImportarOk = () => {
    try {
      const a = JSON.parse(document.getElementById('au-json').value);
      _draft = {
        id: null, nome: a.nome || 'Importada', ativa: true,
        gatilho: GATILHOS[a.gatilho] ? a.gatilho : 'mensagem_recebida',
        cooldownHoras: a.cooldownHoras == null ? 12 : Number(a.cooldownHoras),
        condicoes: (a.condicoes || []).filter(x => CONDS[x.tipo]),
        acoes: (a.acoes || []).filter(x => ACOES[x.tipo])
      };
      renderEditorAutomacao();
    } catch (e) { UI.toast('JSON inválido: ' + e.message, 'err'); }
  };
  A.autoCriarIA = () => {
    if (!AI.configurado()) { UI.toast('A IA do escritório funciona só no sistema publicado (modo nuvem).', 'err'); return; }
    UI.modal(`<h2>${ICO('sparkles')} Criar automação com IA <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
      <p class="muted mb">Descreva o que você quer que aconteça, em português normal. Exemplos:<br>
      <i>“Quando um contato novo mandar mensagem, dê boas-vindas e pergunte se é sobre caso trabalhista, família ou outro assunto”</i><br>
      <i>“Fora do horário seg-sex 08:00-18:00, responda que retornamos no próximo dia útil”</i></p>
      <div class="field"><textarea id="au-pedido" rows="4" placeholder="Descreva a automação..."></textarea></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
        <button class="btn btn-primary" id="au-gerar" onclick="ChatUI.autoGerarIA()">${ICO('sparkles')} Gerar</button>
      </div>`, { large: true });
    setTimeout(() => { const t = document.getElementById('au-pedido'); if (t) t.focus(); }, 60);
  };
  A.autoGerarIA = async () => {
    const pedido = document.getElementById('au-pedido').value.trim();
    if (!pedido) return;
    const btn = document.getElementById('au-gerar');
    UI.ocupado(btn, 'Gerando');
    try {
      const contexto = `Contexto do escritório — departamentos: ${state.departamentos.map(d => d.nome).join(', ') || 'nenhum'}; tags existentes: ${tagsOrdenadas().map(t => t.nome).join(', ') || 'nenhuma'}; atendentes: ${(state.time || []).map(p => primeiroNome(p.nome)).join(', ') || 'nenhum'}.`;
      const a = await AI.gerarAutomacao(pedido, contexto);
      _draft = {
        id: null, nome: a.nome || 'Automação', ativa: true,
        gatilho: GATILHOS[a.gatilho] ? a.gatilho : 'mensagem_recebida',
        cooldownHoras: a.cooldownHoras == null ? 12 : Number(a.cooldownHoras),
        condicoes: (a.condicoes || []).filter(x => CONDS[x.tipo]),
        acoes: (a.acoes || []).filter(x => ACOES[x.tipo])
      };
      renderEditorAutomacao();
      UI.toast('Automação gerada — revise e salve.');
    } catch (e) {
      UI.toast(e.message, 'err');
      UI.livre(btn);
    }
  };

  /* =============================================================
     RELATÓRIOS
  ============================================================= */
  function renderRelatorios() {
    const dias = _c.relDias;
    return `<div class="wa-main painel"><div class="wa-painel-grande">
      <h2>${ICO('file-chart-column')} Relatórios de atendimento</h2>
      <div class="sub">Exportações em CSV (abrem no Excel/Google Planilhas) com os filtros abaixo.</div>
      <div class="wa-filtros-rel">
        <label style="font-size:.83rem;color:var(--wa-sec)">Período:</label>
        <select onchange="ChatUI.set('relDias',Number(this.value))">
          ${[7, 15, 30, 60, 90, 365].map(d => `<option value="${d}" ${dias === d ? 'selected' : ''}>últimos ${d} dias</option>`).join('')}
        </select>
        <label style="font-size:.83rem;color:var(--wa-sec)">Departamento:</label>
        <select onchange="ChatUI.set('relDept',this.value)">
          <option value="">Todos</option>
          <option value="nenhum" ${_c.relDept === 'nenhum' ? 'selected' : ''}>Sem departamento</option>
          ${state.departamentos.map(d => `<option value="${d.id}" ${_c.relDept === d.id ? 'selected' : ''}>${esc(d.nome)}</option>`).join('')}
        </select>
      </div>
      <div class="wa-bloco"><h4>${ICO('contact')} Relatório de conversas</h4>
        <p style="font-size:.83rem;color:var(--wa-sec);margin-bottom:10px">Uma linha por conversa: contato, departamento, responsável, status, tags, volume de mensagens e datas.</p>
        <button class="wa-btn" onclick="ChatUI.relConversas()">${ICO('download')} Baixar CSV de conversas</button></div>
      <div class="wa-bloco"><h4>${ICO('message-circle')} Relatório de mensagens</h4>
        <p style="font-size:.83rem;color:var(--wa-sec);margin-bottom:10px">Todas as mensagens do período, com data, conversa, direção, autor, tipo e conteúdo (inclui transcrições de áudio).</p>
        <button class="wa-btn" onclick="ChatUI.relMensagens()">${ICO('download')} Baixar CSV de mensagens</button></div>
      <div class="wa-bloco"><h4>${ICO('users')} Produtividade por atendente</h4>
        <p style="font-size:.83rem;color:var(--wa-sec);margin-bottom:10px">Mensagens enviadas, conversas sob responsabilidade e anotações por pessoa do time.</p>
        <button class="wa-btn" onclick="ChatUI.relAtendentes()">${ICO('download')} Baixar CSV de produtividade</button></div>
    </div></div>`;
  }

  const csvLinha = arr => arr.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/\n/g, ' ') + '"').join(';');

  function relFiltro() {
    const ini = addDaysISO(todayISO(), -(_c.relDias - 1));
    let convs = state.conversas.filter(podeVerConversa);
    if (_c.relDept) convs = convs.filter(c => filtroDept(c, _c.relDept));
    return { ini, convs };
  }

  /* =============================================================
     AÇÕES
  ============================================================= */
  A.painel = p => {
    if (_c.painel === p) { if (p === 'conversas') A.recarregarConversas(); return; }   // já no painel: o clique vale como "atualizar"
    _c.painel = p; _c.menuMais = false; _c.menuStatus = false; _c.menuDepto = false;
    atualizar('rail', 'lista', 'main', 'drawer'); recolherRail();
    if (p === 'conversas') A.recarregarConversas();
  };
  /* botão Conversas do rail (dono, 09/10/2026): além de abrir o painel, recarrega as conversas do banco.
     Usa a recarga leve do pulso de 4 min (lista de conversas inteira + só o delta das mensagens) e redesenha
     de forma cirúrgica, sem reconstruir o composer. No modo local não há o que recarregar. */
  let _recarregando = false;
  A.recarregarConversas = async () => {
    if (!nuvem() || _recarregando) return;
    _recarregando = true;
    try {
      await Cloud.carregarTudo(true);
      atualizar('rail', 'lista', 'msgs', 'head');
      UI.toast('Conversas atualizadas.');
    } catch (e) { UI.toast('Não consegui atualizar agora: ' + e.message, 'err'); }
    finally { _recarregando = false; }
  };
  A.filtro = f => { if (_c.filtro === f) return; _c.filtro = f; atualizar('lista'); };
  /* filtro de departamentos: abrir/fechar a lista, marcar/desmarcar, limpar */
  A.menuDepto = ev => { if (ev && ev.stopPropagation) ev.stopPropagation(); _c.menuDepto = !_c.menuDepto; atualizar('lista'); };
  A.deptoToggle = (id, marcado) => { if (marcado) _c.depts.add(id); else _c.depts.delete(id); atualizar('lista'); };
  A.deptoLimpar = () => { _c.depts.clear(); atualizar('lista'); };

  /* ---------- seleção em lote na lista ---------- */
  const selecionadas = () => Array.from(_c.selecao || []).map(getConversa).filter(Boolean);
  A.selecaoAlternar = () => { _c.selecao = _c.selecao ? null : new Set(); atualizar('lista'); };
  A.selecaoToggle = cid => {
    if (!_c.selecao) return;
    if (_c.selecao.has(cid)) _c.selecao.delete(cid); else _c.selecao.add(cid);
    atualizar('lista');
  };
  A.selecaoTodas = marcar => { if (!_c.selecao) return; _c.selecao = new Set(marcar ? conversasFiltradas().map(c => c.id) : []); atualizar('lista'); };
  A.selecaoLidas = () => {
    const lista = selecionadas().filter(c => c.naoLidas > 0);
    lista.forEach(c => { c.naoLidas = 0; if (nuvem()) Cloud.marcarLida(c.id).catch(() => {}); });
    if (!nuvem()) save();
    UI.toast(`${lista.length} conversa${lista.length === 1 ? '' : 's'} marcada${lista.length === 1 ? '' : 's'} como lida${lista.length === 1 ? '' : 's'}.`);
    atualizar('rail', 'lista', 'head');
  };
  A.selecaoArquivar = () => {
    const arquivar = _c.filtro !== 'arquivadas';
    const lista = selecionadas();
    lista.forEach(c => atualizarConversa(c.id, { arquivada: arquivar }));
    if (arquivar && lista.some(c => c.id === _c.sel)) { _c.sel = null; _c.drawer = false; }
    _c.selecao = new Set();
    UI.toast(`${lista.length} conversa${lista.length === 1 ? '' : 's'} ${arquivar ? 'arquivada' : 'desarquivada'}${lista.length === 1 ? '' : 's'}.`);
    atualizar('rail', 'lista', 'main', 'drawer');
  };
  A.selecaoDept = v => {
    if (!v) return;
    if (!pode('conversas_delegar')) { UI.toast('Você não tem alçada para delegar.', 'err'); return; }
    const lista = selecionadas();
    const d = state.departamentos.find(x => x.id === v.replace(/^-/, ''));
    lista.forEach(c => {
      let ids = idsDeDepartamento(c);
      if (v === '__nenhum') ids = [];
      else if (v.startsWith('-')) ids = ids.filter(x => x !== v.slice(1));
      else if (!ids.includes(v)) ids = ids.concat(v);
      definirDepartamentos(c.id, ids);
    });
    UI.toast(v === '__nenhum' ? `${lista.length} conversa(s) sem departamento.` : `${lista.length} conversa(s): ${v.startsWith('-') ? 'removidas de' : 'marcadas em'} ${d ? d.nome : ''}.`);
    atualizar('lista', 'head', 'drawer');
  };
  A.selecaoStatus = st => {
    if (!st) return;
    const lista = selecionadas();
    lista.forEach(c => A.mudarStatus(c.id, st));
    if (statusEncerra(st) && lista.some(c => c.id === _c.sel)) { _c.sel = null; _c.drawer = false; }
    _c.selecao = new Set();
    UI.toast(`${lista.length} conversa(s) → ${statusAtendInfo(st).label}${statusEncerra(st) ? ' (foram para Arquivadas)' : ''}.`);
    atualizar('rail', 'lista', 'main', 'drawer');
  };
  A.atualizarLista = () => atualizar('lista');
  A.filtrarContatos = (prefixo, termo) => {
    const t = (termo || '').toLowerCase().trim();
    document.querySelectorAll('#' + prefixo + '-lista .ct-item').forEach(el => {
      el.style.display = !t || el.dataset.busca.includes(t) ? 'flex' : 'none';
    });
  };
  A.dashFiltrar = (status, filtro, dept) => {
    _c.painel = 'conversas';
    _c.status = status || '';
    _c.filtro = filtro || (statusEncerra(status) ? 'arquivadas' : 'tudo');   // encerradas vivem em Arquivadas
    _c.depts = new Set(dept ? [dept] : []); _c.menuDepto = false; _c.tag = ''; _c.busca = '';
    atualizar('rail', 'lista', 'main');
  };
  A.dashTag = tag => {
    _c.painel = 'conversas';
    _c.tag = tag; _c.status = ''; _c.filtro = 'tudo'; _c.busca = '';
    atualizar('rail', 'lista', 'main');
  };
  // filtros do painel principal (dashboard, relatórios, kanban) redesenham o main; os da lista, só a lista
  A.set = (k, v) => { _c[k] = v; atualizar(['dashDias','relDias','relDept','kanbanDept'].includes(k) ? 'main' : 'lista'); };
  A.pref = (k, v) => { prefs[k] = v; salvarPrefs(); };
  A.prefDesktop = async v => {
    if (v && 'Notification' in window && Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { UI.toast('Permissão de notificação negada pelo navegador', 'err'); atualizar('lista'); return; }
    }
    prefs.desktop = v; salvarPrefs();
  };
  let _buscaTimer = null;
  A.buscar = input => {
    _c.busca = input.value;
    // debounce: a busca global varre TODAS as mensagens — re-renderiza só após a pausa na digitação
    clearTimeout(_buscaTimer);
    _buscaTimer = setTimeout(() => {
      const pos = input.selectionStart;
      atualizar('lista');
      const novo = document.querySelector('.wa-busca input');
      if (novo) { novo.focus(); novo.setSelectionRange(pos, pos); }
    }, 220);
  };
  /* prepara o estado para mostrar a conversa — seleção, não lidas, histórico. Não redesenha:
     no clique, A.abrir chama atualizar(); no link direto, o próprio render da rota desenha */
  function selecionar(cid) {
    _c.sel = cid; _c.painel = 'conversas'; _c.scrollConv = null;
    _c.nota = false; if (!_c.enviandoAnexo) descartarAnexos(); _c.sugestoes = null;   // lote em voo continua indo para a conversa de origem
    _c.respondendo = null; _c.buscaChat = null; _c.limiteMsgs = 200;
    const c = getConversa(cid);
    if (c && c.naoLidas) {
      const meu = nuvem() && Cloud.perfil();
      if (!(meu && meu.modo_espiao)) { // espião não zera ao abrir
        c.naoLidas = 0;
        if (nuvem()) Cloud.marcarLida(cid); else save();
      }
    }
    // HIDRATAÇÃO: o histórico pertence à CONVERSA — quem pode vê-la, vê tudo dela.
    // A janela inicial do login traz só as 1500 msgs globais mais recentes; conversas
    // delegadas depois (ou antigas) chegariam vazias. Na primeira abertura, busca as
    // últimas 200 mensagens DESTA conversa direto do banco (a RLS garante o direito).
    if (nuvem() && Cloud.incremental && Cloud.incremental() && !_c.hidratada[cid]) {
      _c.hidratada[cid] = true;
      _c.hidratando[cid] = true;
      (async () => {
        try {
          const n = await Cloud.carregarHistorico(cid, new Date(Date.now() + 60000).toISOString());
          if (n < 200) _c.histFim[cid] = true;  // menos de 1 página = já temos o histórico inteiro
          _c.hidratando[cid] = false;
          if (n && _c.sel === cid) atualizar('main');
        } catch (e) { _c.hidratada[cid] = false; _c.hidratando[cid] = false; }
        // sem mensagem nova (ou com erro) não há re-render: tira a pílula direto, sem refazer o
        // composer — a não ser que a conversa aberta agora ainda esteja buscando a dela
        const pilula = document.getElementById('wa-hist-carregando');
        if (pilula && !_c.hidratando[_c.sel]) pilula.remove();
      })();
    }
  }
  A.abrir = cid => {
    // conversa já aberta (ex.: duplo clique): não re-renderiza — evita o "pisca"
    if (_c.sel === cid && _c.painel === 'conversas') {
      const t = document.getElementById('wa-input'); if (t) t.focus();
      return;
    }
    selecionar(cid);
    atualizar('rail', 'lista', 'main', 'drawer');
    setTimeout(() => { const t = document.getElementById('wa-input'); if (t) t.focus(); }, 60);
  };
  /* link direto (#/atendimento/<id>), copiado pelo menu ⋯: abre a conversa e tira o id da
     URL — o link é consumido uma vez, então F5 e "marcar como não lida" seguem como sempre.
     Quem não enxerga a conversa (RLS/departamento) não a tem no estado: cai no aviso. */
  function abrirPorLink(cid) {
    history.replaceState(null, '', '#/atendimento');
    const c = getConversa(cid);
    if (!c || !podeVerConversa(c)) {
      UI.toast('Conversa não encontrada: pode ter sido apagada ou estar fora dos seus departamentos.', 'err');
      return;
    }
    selecionar(cid);
    // a lista precisa mostrar a conversa aberta: encerradas vivem em Arquivadas
    if (c.arquivada) _c.filtro = 'arquivadas';
    else if (_c.filtro === 'arquivadas') _c.filtro = 'tudo';
  }
  /* o link é o endereço atual + a rota com o id (vale no domínio próprio e na reserva da Vercel).
     Copia ANTES de fechar o menu (a área de transferência exige o gesto do clique); como o botão
     some com o menu, o retorno é o toast (botao = null) */
  A.copiarLink = cid => {
    UI.copiar(location.origin + location.pathname + '#/atendimento/' + cid, null, 'Link da conversa copiado.');
    _c.menuMais = false;
    atualizar('head');
  };
  /* v6: ponte usada pela ficha do lead no CRM — abre a conversa vinculada no Chat */
  A.abrirPorLead = leadId => {
    const conv = conversaDoLead(leadId);
    if (!conv) { UI.toast('Este lead não tem conversa vinculada no ' + ESCRITORIO.plataformas.chat + '.', 'err'); return false; }
    A.abrir(conv.id); // prepara o estado (seleção, não-lidas, hidratação do histórico)
    if (!document.body.classList.contains('modo-chat')) location.hash = '#/atendimento';
    return true;
  };
  A.drawer = aberto => { _c.drawer = aberto; atualizar('drawer'); };
  A.drawerTab = t => { _c.drawerTab = t; atualizar('drawer'); };
  A.fecharMenus = () => { _c.menuMais = false; _c.menuStatus = false; _c.menuAnexo = false; _c.emoji = false; _c.agPop = false; atualizar('head', 'composer'); };

  /* troca rápida de status pelo cabeçalho — passa pelo ponto único A.mudarStatus */
  A.menuStatus = ev => { ev.stopPropagation(); _c.menuStatus = !_c.menuStatus; _c.menuMais = false; atualizar('head'); };
  A.escolherStatus = (cid, status) => {
    A.mudarStatus(cid, status);
    _c.menuStatus = false;
    atualizar('head', 'lista', 'drawer');
  };
  /* ação explícita do usuário: vale até no modo espião */
  A.marcarLida = cid => {
    const c = getConversa(cid);
    if (!c) return;
    c.naoLidas = 0;
    if (nuvem()) Cloud.marcarLida(cid).catch(e => UI.toast('Não deu para marcar como lida: ' + e.message, 'err'));
    else save();
    _c.menuMais = false;
    atualizar('rail', 'lista', 'head');
  };
  /* volta a conversa para a fila de não lidas do time e a FECHA — se ficasse
     aberta, o abrir() e o pulso zerariam o contador de novo em segundos */
  A.marcarNaoLida = async cid => {
    const c = getConversa(cid);
    if (!c) return;
    _c.menuMais = false;
    try {
      if (nuvem()) await Cloud.marcarNaoLida(cid); else save();
      c.naoLidas = Math.max(c.naoLidas || 0, 1);
      _c.sel = null;
      atualizar('rail', 'lista', 'main', 'drawer');
      UI.toast('Conversa marcada como não lida.');
    } catch (e) { UI.toast('Não deu para marcar como não lida: ' + e.message, 'err'); atualizar('head'); }
  };
  A.toggleAgendadas = () => { _c.agPop = !_c.agPop; _c.emoji = false; _c.menuAnexo = false; atualizar('composer'); };

  /* dispara AGORA uma mensagem agendada — as demais mantêm data e horário */
  /* íntegra da mensagem agendada (dono, 14/10/2026: "não conseguimos ler a íntegra"): o painel e o popup
     mostram prévias; aqui vai o texto inteiro, para quem, quando e quem agendou, com as ações */
  A.verAgendada = mid => {
    const m = state.mensagens.find(x => x.id === mid && x.status === 'agendada');
    if (!m) { UI.toast('Esta mensagem já saiu da fila de agendamento.', 'err'); return; }
    const c = getConversa(m.conversaId);
    UI.modal(`<h2>${ICO('alarm-clock')} Mensagem agendada <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
      <p class="muted mb">Para <b>${esc(c ? c.nome : '?')}</b> · ${fmtDateTime(m.agendadaPara)} · agendada por <b>${esc(nomeDoPerfil(m.autor) || 'Equipe')}</b></p>
      <div class="wa-agendada-integra">${m.tipo !== 'texto' ? `<div class="muted">${ICO(iconeDeMidia(m))} ${esc(previaDeMidia(m))}</div>` : ''}${m.texto ? linkificar(m.texto) : ''}</div>
      <div class="modal-actions">
        ${c ? `<button class="btn btn-ghost" style="margin-right:auto" onclick="UI.fecharModal();ChatUI.abrir('${c.id}')">${ICO('message-circle')} Abrir conversa</button>` : ''}
        <button class="btn btn-ghost" onclick="UI.fecharModal();ChatUI.cancelarAgendada('${m.id}')">${ICO('trash-2')} Cancelar agendamento</button>
        <button class="btn btn-primary" onclick="UI.fecharModal();ChatUI.dispararAgendada('${m.id}')">${ICO('send')} Disparar agora</button>
      </div>`, { large: true });
  };
  A.dispararAgendada = mid => {
    const m = state.mensagens.find(x => x.id === mid && x.status === 'agendada');
    if (!m) return;
    const c = getConversa(m.conversaId);
    if (!confirm(`Disparar esta mensagem AGORA para ${c ? c.nome : 'o contato'}?\n\n"${(m.texto || '').slice(0, 120)}"`)) return;
    m.status = 'pendente';           // o motor envia em segundos
    m.agendadaPara = null;
    m.criadoEm = new Date().toISOString();  // entra no fim da conversa, como envio de agora
    if (c) { c.ultimaMsg = (m.texto || previaDeMidia(m)).slice(0, 120); c.ultimaMsgEm = m.criadoEm; }
    save();
    empurrarNuvem();
    UI.toast('Mensagem disparada — enviando agora.');
    atualizar('rail', 'lista', 'msgs', 'composer');
  };
  A.menuMais = ev => { ev.stopPropagation(); _c.menuMais = !_c.menuMais; _c.menuStatus = false; atualizar('head'); };
  A.aoRolar = box => {
    box.dataset.fixo = (box.scrollHeight - box.scrollTop - box.clientHeight < 60) ? 'sim' : 'nao';
  };

  /* ---------- envio ---------- */
  A.teclou = ev => {
    // atalhos de formatação do WhatsApp (valem na mensagem e na anotação)
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey) {
      const k = String(ev.key || '').toLowerCase();
      const marcador = k === 'b' ? '*' : k === 'i' ? '_' : k === 'e' ? '`' : (k === 'x' && ev.shiftKey) ? '~' : '';
      if (marcador) { ev.preventDefault(); A.formatar(marcador); return; }
    }
    if (_c.sugestoes && (ev.key === 'Enter' || ev.key === 'Tab')) { ev.preventDefault(); A.usarSugestao(0); return; }
    if (ev.key === 'Escape') { _c.sugestoes = null; _c.emoji = false; _c.menuAnexo = false; _c.menuStatus = false; _c.menuMais = false; atualizar('head', 'composer'); return; }
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); A.enviar(); }
  };

  A.digitou = ta => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    const v = ta.value;
    atualizarPrevia(v);
    // sugestões de respostas rápidas ( /atalho ) e menções ( @nome em modo nota )
    let sug = null;
    if (!_c.nota && v.startsWith('/') && !v.includes('\n')) {
      const filtro = v.slice(1).toLowerCase();
      const itens = state.respostasRapidas
        .filter(r => (r.atalho + ' ' + r.titulo).toLowerCase().includes(filtro))
        .slice(0, 6)
        .map(r => ({ rotulo: r.atalho || '/' + (r.titulo || ''), detalhe: r.texto.slice(0, 70), acao: 'rr', id: r.id }));
      if (itens.length) sug = { itens };
    } else if (_c.nota) {
      const m = v.match(/@(\w*)$/);
      if (m) {
        const filtro = m[1].toLowerCase();
        const itens = (state.time || [])
          .filter(p => p.nome && p.nome.toLowerCase().includes(filtro))
          .slice(0, 6)
          .map(p => ({ rotulo: '@' + primeiroNome(p.nome), detalhe: p.nome, acao: 'mencao', id: p.id }));
        if (itens.length) sug = { itens };
      }
    }
    const tinha = !!_c.sugestoes;
    _c.sugestoes = sug;
    if (!!sug !== tinha || sug) {
      // re-renderiza só a área de sugestões para não perder o foco
      const comp = document.querySelector('.wa-composer');
      if (comp) {
        const antiga = comp.querySelector('.wa-sugestoes');
        if (antiga) antiga.remove();
        if (sug) comp.insertAdjacentHTML('afterbegin', renderSugestoes());
      }
    }
  };

  A.usarSugestao = i => {
    const s = _c.sugestoes;
    if (!s || !s.itens[i]) return;
    const it = s.itens[i];
    const ta = document.getElementById('wa-input');
    if (it.acao === 'rr') {
      const r = state.respostasRapidas.find(x => x.id === it.id);
      const c = getConversa(_c.sel);
      const lead = c && c.leadId ? getLead(c.leadId) : { nome: c ? c.nome : '' };
      if (ta && r) { ta.value = renderTemplate(r.texto, lead); ta.focus(); A.digitou(ta); }
    } else if (it.acao === 'mencao') {
      const p = (state.time || []).find(x => x.id === it.id);
      if (ta && p) {
        ta.value = ta.value.replace(/@\w*$/, '@' + primeiroNome(p.nome) + ' ');
        ta.focus();
      }
    }
    _c.sugestoes = null;
    const antiga = document.querySelector('.wa-sugestoes');
    if (antiga) antiga.remove();
  };

  A.toggleNota = forcar => {
    _c.nota = forcar === true ? true : !_c.nota;
    _c.sugestoes = null;
    atualizar('composer');
    setTimeout(() => { const t = document.getElementById('wa-input'); if (t) t.focus(); }, 40);
  };
  A.toggleEmoji = () => {
    _c.emoji = !_c.emoji; _c.menuAnexo = false;
    if (_c.emoji) {
      _c.emojiBusca = '';
      // sem "recentes" ainda: abre nas carinhas, não numa aba vazia
      if (_c.emojiCat === 0 && !Object.keys(emojisRecentes()).length) _c.emojiCat = 1;
    }
    atualizar('composer');
    if (_c.emoji) setTimeout(() => { const b = document.getElementById('wa-emoji-busca'); if (b) b.focus(); }, 40);
  };
  /* a busca remenda só a grade: o campo de pesquisa não perde o foco nem o texto */
  A.emojiBusca = v => {
    _c.emojiBusca = v;
    const grid = document.getElementById('wa-emojis-grid');
    if (grid) grid.innerHTML = emojisGridHTML();
    document.querySelectorAll('.wa-emojis-cats button').forEach((b, i) => b.classList.toggle('ativo', !v.trim() && i === _c.emojiCat));
  };

  /* ---------- formatação do WhatsApp no composer ---------- */
  /* prévia remendada no DOM a cada tecla (sem re-render: o foco e o cursor ficam onde estão) */
  function atualizarPrevia(v) {
    const html = previaWaHTML(v);
    let bar = document.getElementById('wa-fmt-bar');
    if (!bar && !html) return;
    if (!bar) {
      const comp = document.querySelector('.wa-composer');
      if (!comp) return;
      comp.insertAdjacentHTML('beforebegin', renderFormatacao(v));
      return;
    }
    if (!html && !_c.formatar) { bar.remove(); return; }
    const prev = bar.querySelector('#wa-previa');
    if (prev) { prev.hidden = !html; prev.querySelector('.wa-bolha-txt').innerHTML = html; }
  }
  A.toggleFormatar = () => {
    _c.formatar = !_c.formatar;
    _c.emoji = false; _c.menuAnexo = false;
    atualizar('composer');
    setTimeout(() => { const t = document.getElementById('wa-input'); if (t) t.focus(); }, 40);
  };
  /* envolve a seleção com o marcador (ou insere o par e deixa o cursor no meio).
     Espaços nas pontas ficam fora: "* texto *" não formata no WhatsApp. */
  A.formatar = m => {
    const ta = document.getElementById('wa-input');
    if (!ta) return;
    const v = ta.value;
    const s = ta.selectionStart == null ? v.length : ta.selectionStart;
    const e = ta.selectionEnd == null ? s : ta.selectionEnd;
    const sel = v.slice(s, e);
    const esq = (sel.match(/^\s*/) || [''])[0], dir = (sel.match(/\s*$/) || [''])[0];
    const miolo = sel.slice(esq.length, sel.length - dir.length);
    const abre = (m === '`' && miolo.includes('\n')) ? '```' : m;
    let novo, pos;
    if (miolo) { novo = v.slice(0, s) + esq + abre + miolo + abre + dir + v.slice(e); pos = s + esq.length + abre.length + miolo.length + abre.length; }
    else { novo = v.slice(0, s) + abre + abre + v.slice(e); pos = s + abre.length; }
    ta.value = novo;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    A.digitou(ta);
  };
  A.emojiCat = i => { _c.emojiCat = i; _c.emojiBusca = ''; atualizar('composer'); };
  A.emoji = e => {
    const ta = document.getElementById('wa-input');
    if (!ta) return;
    const p = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    ta.value = ta.value.slice(0, p) + e + ta.value.slice(p);
    ta.focus();
    ta.setSelectionRange(p + e.length, p + e.length);
    registrarEmoji(e);
    A.digitou(ta);
  };

  A.enviar = async () => {
    let c = convAtual();
    if (!c) return;
    const ta = document.getElementById('wa-input');
    const texto = (ta && ta.value.trim()) || '';
    // anotação interna decide primeiro: com arquivos na fila, Enter não pode mandar nada ao cliente
    if (_c.nota) { if (texto) A.salvarNota(texto); return; }
    if (_c.anexos.length) return A.enviarAnexo();
    if (!texto) return;
    c = materializarRascunho();   // rascunho vira conversa só agora, com a 1ª mensagem
    registrarMensagem(c.id, { direcao: 'saida', texto: comAssinatura(texto), citado: citadoAtual(c) });
    zerarSeEspiao(c);
    if (c.status === 'aberto') atualizarConversa(c.id, { status: 'em_atendimento' });
    _c.sugestoes = null;
    ta.value = '';
    ta.style.height = '42px';
    atualizarPrevia('');
    const sug = document.querySelector('.wa-sugestoes'); if (sug) sug.remove();
    const respondia = !!_c.respondendo;
    _c.respondendo = null;
    atualizar(respondia ? 'composer' : 'msgs', 'msgs', 'lista');
    empurrarNuvem();
    const box = document.getElementById('wa-msgs'); if (box) box.scrollTop = box.scrollHeight;
    const t2 = document.getElementById('wa-input'); if (t2) t2.focus();
  };

  /* assinatura do atendente em negrito na linha de cima (mesma regra para o envio e para a prévia) */
  const comAssinatura = texto => assinarTexto(texto);   // regra única em store.js (envio, agendamento e cadência)

  /* modo espião com "zerar ao enviar": responder (texto, áudio ou anexo) zera as
     não lidas — antes só o texto zerava e o contador ficava preso depois de um áudio */
  function zerarSeEspiao(c) {
    const meuP = nuvem() && Cloud.perfil();
    if (meuP && meuP.modo_espiao && meuP.espiao_zera_ao_enviar && c && c.naoLidas) { c.naoLidas = 0; Cloud.marcarLida(c.id); }
  }

  /* snapshot da mensagem sendo respondida (limpa depois do envio) */
  function citadoAtual(c) {
    if (!_c.respondendo) return null;
    const alvo = state.mensagens.find(x => x.id === _c.respondendo);
    if (!alvo) return null;
    return {
      id: alvo.id,
      externoId: alvo.externoId || '',
      texto: (alvo.texto || previaDeMidia(alvo)).slice(0, 200),
      remetente: alvo.direcao === 'entrada' ? (alvo.remetente || (c ? c.nome : '')) : '',
      minha: alvo.direcao === 'saida',
      participante: alvo.participante || '',
      tipo: alvo.tipo
    };
  }

  A.responder = mid => {
    _c.respondendo = mid;
    _c.nota = false;
    atualizar('composer');
    setTimeout(() => { const t = document.getElementById('wa-input'); if (t) t.focus(); }, 40);
  };
  A.cancelarResposta = () => { _c.respondendo = null; atualizar('composer'); };

  /* ---------- encaminhar ---------- */
  A.encaminhar = mid => {
    const convs = state.conversas.filter(cv => !cv.arquivada && podeVerConversa(cv))
      .sort((a, b) => (b.ultimaMsgEm || '').localeCompare(a.ultimaMsgEm || ''));
    UI.modal(`<h2>${ICO('forward')} Encaminhar mensagem <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
      <div class="field"><label>Enviar para (pode marcar mais de um)</label>
        <input id="fw-busca" placeholder="Pesquisar conversa ou grupo..." autocomplete="off"
          oninput="ChatUI.filtrarContatos('fw', this.value)" style="margin-bottom:8px">
        <div style="max-height:250px;overflow-y:auto;border:1px solid var(--border);border-radius:10px;padding:8px" id="fw-lista">
        ${convs.map(cv => `<label class="ct-item" data-busca="${esc((cv.nome + ' ' + cv.telefone).toLowerCase())}"
            style="display:flex;gap:8px;align-items:center;padding:5px 2px;cursor:pointer">
          <input type="checkbox" class="fw-chk" value="${cv.id}" style="width:auto;flex:0 0 auto">
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${cv.tipo === 'grupo' ? ICO('users') + ' ' : ''}${esc(cv.nome)}</span>
          <small class="muted" style="flex-shrink:0">${cv.tipo === 'grupo' ? 'grupo' : telExibicao(cv.telefone)}</small>
        </label>`).join('')}</div></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="ChatUI.encaminharConfirma('${mid}')">${ICO('forward')} Encaminhar</button>
      </div>`, { large: true });
  };
  A.encaminharConfirma = mid => {
    const m = state.mensagens.find(x => x.id === mid);
    const ids = Array.from(document.querySelectorAll('.fw-chk:checked')).map(x => x.value);
    if (!m) return;
    if (!ids.length) { UI.toast('Marque ao menos um destino', 'err'); return; }
    ids.forEach(cid => registrarMensagem(cid, {
      direcao: 'saida', tipo: m.tipo === 'anotacao' ? 'texto' : m.tipo, texto: m.texto,
      midiaUrl: m.midiaUrl, midiaMime: m.midiaMime, midiaNome: m.midiaNome,
      midiaTamanho: m.midiaTamanho, midiaPtt: m.midiaPtt, encaminhada: true
    }));
    UI.fecharModal();
    UI.toast(`Mensagem encaminhada para ${ids.length} conversa(s).`);
    atualizar('lista', 'msgs');
    empurrarNuvem();
  };

  /* ---------- navegar até uma mensagem (busca/citação) ---------- */
  A.irParaMsg = mid => {
    if (!mid) return;
    let n = document.querySelector(`[data-mid="${mid}"]`);
    if (!n) {
      const todas = mensagensDaConversa(_c.sel);
      const idx = todas.findIndex(x => x.id === mid);
      if (idx < 0) return;
      _c.limiteMsgs = Math.max(200, todas.length - idx + 20);
      atualizar('main');
      const box = document.getElementById('wa-msgs');
      if (box) box.dataset.fixo = 'nao';
      n = document.querySelector(`[data-mid="${mid}"]`);
    }
    if (n) {
      n.scrollIntoView({ block: 'center' });
      n.classList.add('wa-flash');
      setTimeout(() => n.classList.remove('wa-flash'), 1800);
    }
  };
  A.abrirEm = (cid, mid) => { A.abrir(cid); setTimeout(() => A.irParaMsg(mid), 160); };

  /* pagina o histórico antigo da conversa mantendo a rolagem ancorada */
  A.carregarAntigas = async () => {
    const c = getConversa(_c.sel);
    if (!c || !nuvem()) return;
    const todas = mensagensDaConversa(c.id);
    if (!todas.length) return;
    const link = document.getElementById('wa-antigas');
    if (link && !UI.ocupado(link, 'Carregando mensagens anteriores')) return;  // já está buscando
    const box = document.getElementById('wa-msgs');
    const alturaAntes = box ? box.scrollHeight : 0;
    try {
      const n = await Cloud.carregarHistorico(c.id, todas[0].criadoEm);
      if (n < 200) _c.histFim[c.id] = true;
      _c.limiteMsgs = mensagensDaConversa(c.id).length + 50;
      _c.scrollConv = c.id;
      atualizar('main');
      const box2 = document.getElementById('wa-msgs');
      if (box2) {
        box2.dataset.fixo = 'nao';
        box2.scrollTop = box2.scrollHeight - alturaAntes; // mantém a tela no mesmo ponto
      }
      if (!n) UI.toast('Início da conversa — todo o histórico está carregado');
    } catch (e) { UI.toast(e.message, 'err'); UI.livre(link); }
  };

  /* vigia do motor: faixa vermelha no topo quando o WhatsApp não está fluindo */
  A.aoMotor = m => {
    const el = document.getElementById('wa-motor-aviso');
    const noChat = document.body.classList.contains('modo-chat');
    const semSinal = m && m.atualizado_em && (Date.now() - new Date(m.atualizado_em).getTime() > 3.5 * 60000);
    const problema = !m || m.situacao !== 'conectado' || semSinal;
    if (!problema || !noChat) { if (el) el.remove(); return; }
    const rotulos = { desconectado: 'desconectado', aguardando_qr: 'aguardando leitura do QR (Configurações)', erro: 'com erro' };
    const texto = m && m.situacao !== 'conectado'
      ? `Motor WhatsApp ${rotulos[m.situacao] || m.situacao} — mensagens não estão fluindo.`
      : `Motor WhatsApp sem sinal há ${Math.round((Date.now() - new Date(m.atualizado_em).getTime()) / 60000)} min — verifique o Railway.`;
    if (el) { el.textContent = texto; return; }
    const div = document.createElement('div');
    div.id = 'wa-motor-aviso';
    div.textContent = texto;
    document.body.appendChild(div);
  };

  /* ---------- busca na conversa ---------- */
  A.buscaChatAbrir = () => {
    _c.buscaChat = _c.buscaChat == null ? '' : null;
    atualizar('head');
    setTimeout(() => { const i = document.getElementById('wa-busca-chat-in'); if (i) i.focus(); }, 40);
  };
  A.buscarNaConversa = input => {
    const pos = input.selectionStart;
    _c.buscaChat = input.value;
    atualizar('head');
    const i = document.getElementById('wa-busca-chat-in');
    if (i) { i.focus(); i.setSelectionRange(pos, pos); }
  };
  A.fecharBuscaChat = () => { _c.buscaChat = null; atualizar('head'); };

  /* ---------- player de áudio ---------- */
  const fmtSeg = s => {
    if (!isFinite(s)) return '·:··';
    s = Math.round(s);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  const playerDe = el => el.closest('.wa-player');
  A.audioToggle = btn => {
    const a = playerDe(btn).querySelector('audio');
    if (a.paused) {
      document.querySelectorAll('.wa-player audio').forEach(o => { if (o !== a) o.pause(); });
      a.playbackRate = Number(prefs.velAudio || 1);
      a.play().catch(e => UI.toast('Não consegui tocar o áudio: ' + e.message, 'err'));
    } else a.pause();
  };
  A.audioIco = a => {
    const btn = playerDe(a).querySelector('.wa-player-btn');
    if (btn) btn.innerHTML = a.paused ? I.play : I.pausa;
  };
  A.audioProg = a => {
    const p = playerDe(a);
    const seek = p.querySelector('.wa-player-seek');
    const tempo = p.querySelector('.wa-player-tempo');
    if (seek && a.duration) seek.value = a.currentTime / a.duration * 1000;
    if (tempo) tempo.textContent = a.currentTime > 0.2
      ? fmtSeg(a.currentTime) + ' / ' + fmtSeg(a.duration)
      : fmtSeg(a.duration);
  };
  A.audioSeek = seek => {
    const a = playerDe(seek).querySelector('audio');
    if (a.duration) a.currentTime = seek.value / 1000 * a.duration;
  };
  A.audioVel = () => {
    const ordem = [1, 1.5, 2];
    prefs.velAudio = ordem[(ordem.indexOf(Number(prefs.velAudio || 1)) + 1) % ordem.length];
    salvarPrefs();
    document.querySelectorAll('.wa-player-vel').forEach(b => b.textContent = prefs.velAudio + 'x');
    document.querySelectorAll('.wa-player audio').forEach(a => { if (!a.paused) a.playbackRate = prefs.velAudio; });
  };

  A.salvarNota = async texto => {
    const c = materializarRascunho();
    if (!c) return;
    // menções: @PrimeiroNome → ids dos perfis
    const mencoes = [];
    (state.time || []).forEach(p => {
      const n = primeiroNome(p.nome);
      if (n && new RegExp('@' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(texto)) mencoes.push(p.id);
    });
    registrarMensagem(c.id, { direcao: 'saida', tipo: 'anotacao', texto, status: 'recebida', mencoes });
    if (nuvem() && mencoes.length) {
      const outros = mencoes.filter(id => id !== eu().id);
      if (outros.length) {
        Cloud.notificar(outros, `${primeiroNome(eu().nome)} marcou você em ${c.nome}: “${texto.slice(0, 90)}”`, c.id, 'mencao')
          .catch(() => {});
      }
    }
    _c.nota = false;
    const ta = document.getElementById('wa-input'); if (ta) ta.value = '';
    atualizar('composer', 'msgs');
    empurrarNuvem();
    const box = document.getElementById('wa-msgs'); if (box) box.scrollTop = box.scrollHeight;
  };

  /* ---------- anexos ---------- */
  A.toggleAnexo = () => { _c.menuAnexo = !_c.menuAnexo; _c.emoji = false; atualizar('composer'); };
  A.escolherArquivo = (accept, figurinha, documento) => {
    const input = document.getElementById('wa-file');
    if (!input) return;
    _c.anexoModo = { accept: accept || '', documento: !!documento };   // o "+" da fila repete a mesma escolha
    input.accept = accept || '';
    input.dataset.figurinha = figurinha ? '1' : '';
    input.dataset.documento = documento ? '1' : '';
    input.click();
  };
  /* entrada única dos anexos: pelo clipe, arrastando para a conversa ou colando (Ctrl+V).
     Até MAX_ANEXOS por envio, de qualquer tipo (o que não é foto/vídeo/áudio vai como
     documento, com o nome original); acima do limite do bucket (60 MB) fica de fora. */
  const MAX_ANEXOS = 5;
  const LIMITE_ANEXO = 60 * 1024 * 1024;
  function descartarAnexos() {
    (_c.anexos || []).forEach(a => { try { URL.revokeObjectURL(a.previewUrl); } catch (e) {} });
    _c.anexos = [];
  }
  function anexarArquivos(files, figurinha, documento) {
    let lista = Array.from(files || []).filter(Boolean);
    if (!lista.length) return;
    if (_c.nota) { UI.toast('Saia do modo anotação para anexar arquivos — anexo vai para o cliente.', 'err'); return; }
    // figurinha vai sozinha (o WhatsApp não aceita legenda nem lote nela)
    if (_c.anexos.some(a => a.figurinha) || (figurinha && _c.anexos.length)) { UI.toast('Figurinha vai sozinha — envie-a ou remova-a antes de anexar outros arquivos.', 'err'); return; }
    if (figurinha) lista = lista.slice(0, 1);
    const grandes = lista.filter(f => f.size > LIMITE_ANEXO);
    if (grandes.length) UI.toast(`Acima de 60 MB, ficou de fora: ${grandes.map(f => f.name).join(', ')}`, 'err');
    lista = lista.filter(f => f.size <= LIMITE_ANEXO);
    if (!lista.length) return;
    const vaga = MAX_ANEXOS - _c.anexos.length;
    if (vaga <= 0) { UI.toast(`Máximo de ${MAX_ANEXOS} arquivos por envio — mande estes e anexe os próximos depois.`, 'err'); return; }
    if (lista.length > vaga) UI.toast(`Só cabem mais ${vaga} arquivo(s) neste envio (máximo ${MAX_ANEXOS}) — os primeiros ${vaga} entraram.`);
    lista.slice(0, vaga).forEach(file => _c.anexos.push({
      file,
      previewUrl: URL.createObjectURL(file),
      // "Documento" no menu: foto/vídeo vão como arquivo, no original (sem a compressão do WhatsApp)
      tipo: figurinha ? 'figurinha' : (documento ? 'arquivo' : tipoDoMime(file.type)),
      figurinha: !!figurinha, documento: !!documento
    }));
    _c.menuAnexo = false;
    atualizar('composer');
    setTimeout(() => { const t = document.getElementById('wa-input'); if (t) { t.placeholder = 'Legenda (opcional)'; t.focus(); } }, 40);
  }
  A.arquivoEscolhido = input => {
    const files = Array.from(input.files || []);
    const figurinha = input.dataset.figurinha === '1';
    const documento = input.dataset.documento === '1';
    input.value = '';
    anexarArquivos(files, figurinha, documento);
  };
  /* colar imagem/arquivo da área de transferência; texto colado segue normal */
  A.colou = ev => {
    if (!_c.sel || _c.nota || !pode('msg_midia')) return;
    const itens = (ev.clipboardData && ev.clipboardData.items) || [];
    for (const it of itens) {
      if (it.kind !== 'file') continue;
      const bruto = it.getAsFile();
      if (!bruto) continue;
      ev.preventDefault();
      const ext = (bruto.name && bruto.name.includes('.')) ? bruto.name.split('.').pop() : (bruto.type.split('/')[1] || 'bin');
      const nome = (!bruto.name || /^(image|blob)\b/i.test(bruto.name)) ? `colado-${Date.now()}.${ext}` : bruto.name;
      anexarArquivos([new File([bruto], nome, { type: bruto.type })]);
      return;
    }
  };
  /* "+" da fila: mesma opção do menu (Documento, Fotos e vídeos…), nunca figurinha */
  A.maisAnexos = () => { const m = _c.anexoModo || {}; A.escolherArquivo(m.accept, false, m.documento); };
  /* sem índice: remove todos; com índice: só aquele arquivo. Em voo não dá para tirar. */
  A.limparAnexo = i => {
    if (_c.enviandoAnexo) { UI.toast('Aguarde o envio terminar.'); return; }
    if (i == null) descartarAnexos();
    else {
      const a = _c.anexos[i];
      if (a) { try { URL.revokeObjectURL(a.previewUrl); } catch (e) {} _c.anexos.splice(i, 1); }
    }
    atualizar('composer');
  };

  /* envia os anexos em sequência, na ordem da prévia: uma mensagem por arquivo;
     legenda e citação (responder) vão só com o primeiro, como no WhatsApp */
  A.enviarAnexo = async () => {
    if (_c.enviandoAnexo) { UI.toast(`Aguarde — enviando ${_c.enviandoAnexo.n} de ${_c.enviandoAnexo.total}...`); return; }
    const c = materializarRascunho();
    if (!c || !_c.anexos.length) return;
    const fila = _c.anexos.slice();
    _c.enviandoAnexo = { n: 1, total: fila.length };
    const ta = document.getElementById('wa-input');
    const legenda = (ta && ta.value.trim()) || '';
    const citado = citadoAtual(c);
    // legenda vai no primeiro que aceita legenda (figurinha não aceita); só figurinhas → sai como texto à parte
    const idxLegenda = fila.findIndex(a => !a.figurinha);
    atualizar('composer');
    let enviados = 0, idx = 0;
    try {
      for (const ax of fila) {
        const i = idx++;
        if (!_c.anexos.includes(ax)) continue;   // removido da fila antes de começar
        _c.enviandoAnexo.n = enviados + 1;
        let dados;
        if (nuvem()) {
          dados = await Cloud.uploadMidia(ax.file, c.id);
        } else {
          dados = { url: ax.previewUrl, mime: ax.file.type, nome: ax.file.name, tamanho: ax.file.size };
        }
        registrarMensagem(c.id, {
          direcao: 'saida',
          tipo: ax.figurinha ? 'figurinha' : (ax.documento ? 'arquivo' : tipoDoMime(dados.mime)),
          texto: i === idxLegenda ? legenda : '',
          midiaUrl: dados.url, midiaMime: dados.mime, midiaNome: dados.nome, midiaTamanho: dados.tamanho,
          citado: i === 0 ? citado : null          // responder com foto/arquivo também cita (só o primeiro)
        });
        enviados++;
        // o que já saiu sai da prévia: se o próximo falhar, só ele fica esperando
        const pos = _c.anexos.indexOf(ax);
        if (pos >= 0) { if (nuvem()) { try { URL.revokeObjectURL(ax.previewUrl); } catch (e) {} } _c.anexos.splice(pos, 1); }
        if (enviados === 1) { _c.respondendo = null; if (ta && _c.sel === c.id) ta.value = ''; }
        zerarSeEspiao(c);
        atualizar('composer', 'msgs', 'lista');
        empurrarNuvem();
      }
      if (idxLegenda === -1 && legenda) { registrarMensagem(c.id, { direcao: 'saida', texto: comAssinatura(legenda), citado: null }); empurrarNuvem(); }
      if (_c.sel !== c.id) UI.toast(`${enviados > 1 ? enviados + ' arquivos enviados' : 'Arquivo enviado'} para ${c.nome || 'a conversa onde você anexou'}.`);
      const box = document.getElementById('wa-msgs'); if (box) box.scrollTop = box.scrollHeight;
    } catch (e) {
      UI.toast((enviados ? `${enviados} de ${fila.length} enviado(s). ` : '') + e.message, 'err');
    } finally { _c.enviandoAnexo = null; atualizar('composer'); }
  };

  /* ---------- gravação de áudio ---------- */
  A.gravar = async () => {
    if (_c.rec) return;
    const convOrigem = _c.sel;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tipos = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4', ''];
      const mime = tipos.find(t => !t || (window.MediaRecorder && MediaRecorder.isTypeSupported(t)));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const enviar = _c.rec && _c.rec.enviar;
        clearInterval(_c.rec && _c.rec.timer);
        _c.rec = null;
        if (!enviar || !chunks.length) { atualizar('composer'); return; }
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const c = materializarRascunho(convOrigem);
        if (!c) return;
        if (_c.sel !== convOrigem) UI.toast('Áudio enviado para ' + (c.nome || 'a conversa onde a gravação começou') + '.');
        UI.toast('Enviando áudio...');
        try {
          const nome = 'audio-' + Date.now() + '.' + ((rec.mimeType || '').includes('ogg') ? 'ogg' : (rec.mimeType || '').includes('mp4') ? 'm4a' : 'webm');
          const file = new File([blob], nome, { type: blob.type });
          const dados = nuvem() ? await Cloud.uploadMidia(file, c.id)
            : { url: URL.createObjectURL(blob), mime: blob.type, nome, tamanho: blob.size };
          registrarMensagem(c.id, {
            direcao: 'saida', tipo: 'audio', texto: '',
            midiaUrl: dados.url, midiaMime: dados.mime, midiaNome: dados.nome,
            midiaTamanho: dados.tamanho, midiaPtt: true,
            // só cita se o atendente continua na conversa em que começou a responder
            citado: _c.sel === convOrigem ? citadoAtual(c) : null
          });
          if (_c.sel === convOrigem) _c.respondendo = null;
          zerarSeEspiao(c);
          atualizar('composer', 'msgs', 'lista');
          empurrarNuvem();
          const box = document.getElementById('wa-msgs'); if (box) box.scrollTop = box.scrollHeight;
        } catch (e) { UI.toast(e.message, 'err'); atualizar('composer'); }
      };
      rec.start(250);
      _c.rec = { recorder: rec, inicio: Date.now(), enviar: false, timer: setInterval(() => {
        const el = document.getElementById('rec-tempo');
        if (el && _c.rec) {
          const s = Math.floor((Date.now() - _c.rec.inicio) / 1000);
          el.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
        }
      }, 500) };
      atualizar('composer');
    } catch (e) {
      UI.toast('Não consegui acessar o microfone: ' + e.message, 'err');
    }
  };
  A.pararGravacao = enviar => {
    if (!_c.rec) return;
    _c.rec.enviar = enviar;
    try { _c.rec.recorder.stop(); } catch (e) {}
  };

  /* ---------- agendamento ---------- */
  A.agendar = () => {
    const eraRascunho = !!(_c.rascunho && _c.rascunho.id === _c.sel);
    const c = materializarRascunho();   // agendar já é mandar mensagem: a conversa nasce aqui
    if (!c) return;
    if (eraRascunho) atualizar('head', 'lista');
    const ta = document.getElementById('wa-input');
    const texto = (ta && ta.value.trim()) || '';
    UI.modal(`<h2>${ICO('alarm-clock')} Agendar mensagem <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
      <p class="muted mb">Para <b>${esc(c.nome)}</b> — o Motor dispara sozinho no horário marcado.</p>
      <div class="field"><label>Mensagem</label><textarea id="ag-texto" rows="4">${esc(texto)}</textarea></div>
      <div class="field"><label>Enviar em</label><input type="datetime-local" id="ag-quando" value="${todayISO()}T09:00"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="ChatUI.confirmarAgendamento()">Agendar</button>
      </div>`);
  };
  A.confirmarAgendamento = () => {
    const texto = document.getElementById('ag-texto').value.trim();
    const quando = document.getElementById('ag-quando').value;
    if (!texto || !quando) { UI.toast('Preencha a mensagem e o horário', 'err'); return; }
    // sai assinada como um envio normal (antes a agendada partia sem o nome de quem agendou)
    registrarMensagem(_c.sel, { direcao: 'saida', texto: comAssinatura(texto), agendadaPara: new Date(quando).toISOString() });
    UI.fecharModal();
    const ta = document.getElementById('wa-input'); if (ta) ta.value = '';
    UI.toast('Mensagem agendada.');
    atualizar('rail', 'msgs', 'lista');
    empurrarNuvem();
  };
  A.cancelarAgendada = mid => {
    const m = state.mensagens.find(x => x.id === mid);
    if (!m) return;
    if (m.status !== 'agendada') { UI.toast('Esta mensagem já saiu da fila de agendamento.', 'err'); atualizar('composer'); return; }
    if (nuvem() && m.autor && m.autor !== eu().id && !souAdmin()) { UI.toast('Só quem agendou (ou um administrador) pode cancelar.', 'err'); return; }
    if (!confirm('Cancelar esta mensagem agendada?\n\n"' + (m.texto || '').slice(0, 120) + '"')) return;
    cancelarAgendadaLocal(m); // vira 'cancelada' — a linha não é apagada
    // fica registrado na conversa do cliente quem cancelou, para quando era e o que dizia (v6.24.1):
    // a agendada cancelada some da linha do tempo, então a anotação interna é o rastro que a equipe vê
    registrarMensagem(m.conversaId, {
      direcao: 'saida', tipo: 'anotacao', status: 'recebida',
      texto: `${primeiroNome(eu().nome) || 'Equipe'} cancelou a mensagem agendada para ${fmtDateTime(m.agendadaPara)}: “${(m.texto || previaDeMidia(m)).slice(0, 200)}”`
    });
    save();
    UI.toast('Agendamento cancelado');
    atualizar('rail', 'lista', 'msgs', 'composer');
  };

  /* ---------- conversa: dados, tags, delegação ---------- */
  A.renomear = () => {
    const c = getConversa(_c.sel);
    if (!c) return;
    UI.modal(`<h2>Editar nome do contato <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
      <div class="field"><label>Nome exibido no ${ESCRITORIO.plataformas.chat}</label><input id="rn-nome" value="${esc(c.nome)}"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="ChatUI.salvarNome()">Salvar</button>
      </div>`);
    setTimeout(() => { const i = document.getElementById('rn-nome'); if (i) { i.focus(); i.select(); } }, 60);
  };
  A.salvarNome = () => {
    const nome = document.getElementById('rn-nome').value.trim();
    if (!nome) return;
    atualizarConversa(_c.sel, { nome });
    UI.fecharModal();
    UI.toast('Nome atualizado.');
    atualizar('head', 'lista', 'drawer');
  };
  A.toggleTag = (cid, nome) => {
    const c = getConversa(cid);
    if (!c) return;
    const tags = c.tags || [];
    atualizarConversa(cid, { tags: tags.includes(nome) ? tags.filter(t => t !== nome) : [...tags, nome] });
    atualizar('lista', 'drawer');
  };
  /* seletor "Adicionar tag" do drawer: só entra depois de escolhida; repetida ou vazia não entra */
  A.aplicarTag = (cid, nome) => {
    const c = getConversa(cid);
    if (!c || !nome || !pode('tags_aplicar') || (c.tags || []).includes(nome)) return;
    atualizarConversa(cid, { tags: [...(c.tags || []), nome] });
    atualizar('lista', 'drawer');
  };
  /* subir/descer uma tag na lista (tags_gerir): ao mover, toda a lista ganha ordem numérica — a que
     não tinha ordem vai para o fim — e a vizinha troca de lugar */
  A.moverTag = (tid, delta) => {
    if (!pode('tags_gerir')) return;
    const lista = tagsOrdenadas();
    lista.forEach((t, i) => { t.ordem = i + 1; });
    const i = lista.findIndex(t => t.id === tid), j = i + Number(delta);
    if (i >= 0 && j >= 0 && j < lista.length) { lista[i].ordem = j + 1; lista[j].ordem = i + 1; }
    save();
    atualizar('lista', 'drawer');
  };
  /* select único (modo sem a migração chat-v14a): substitui a lista inteira */
  A.delegarDept = (cid, deptId) => {
    definirDepartamentos(cid, deptId ? [deptId] : []);
    const d = state.departamentos.find(x => x.id === deptId);
    UI.toast(d ? `Delegada ao departamento ${d.nome}.` : 'Departamento removido');
    atualizar('head', 'lista', 'drawer');
  };
  /* marcação múltipla: liga/desliga UM departamento. Na nuvem vai pela RPC
     conversa_departamento (append/remove atômico no banco — não leva a lista
     da aba, que pode estar velha); sem a RPC, cai no upsert da linha. */
  A.alternarDept = async (cid, did, input) => {
    const c = getConversa(cid);
    const d = state.departamentos.find(x => x.id === did);
    if (!c || !d) return;
    const ids = idsDeDepartamento(c);
    // a caixa é a intenção da pessoa; o store só muda depois do await — um 2º clique
    // durante a RPC (arrependimento) repetiria a mesma ação se olhasse só o store
    const ligar = input ? !!input.checked : !ids.includes(did);
    const novos = ligar ? (ids.includes(did) ? ids : [...ids, did]) : ids.filter(x => x !== did);
    // desligar o último dos MEUS departamentos tira a conversa da minha vista
    if (!ligar && nuvem() && !souAdmin() && c.responsavel !== eu().id && !pode('conversas_todas')) {
      const meus = deptsDoPerfil(eu()).map(x => x.id);
      if (meus.includes(did) && !novos.some(x => meus.includes(x)) &&
        !confirm(`Ao remover de ${d.nome}, você deixará de ver esta conversa.\n\nContinuar?`)) {
        if (input) input.checked = true;
        return;
      }
    }
    try {
      if (nuvem() && Cloud.deptsMultiplos()) {
        const lista = await Cloud.alternarDepartamento(cid, did, ligar);
        // sem a RPC (null: 404/PGRST202) a mudança sobe pelo upsert do sync —
        // a sombra só avança quando o banco já gravou pela RPC
        if (Array.isArray(lista)) { definirDepartamentos(cid, lista); Cloud.conversaSincronizada(cid); }
        else definirDepartamentos(cid, novos);
      } else definirDepartamentos(cid, novos);
    } catch (e) {
      if (input) input.checked = !ligar;
      UI.toast('Não foi possível alterar o departamento: ' + (e.message || e), 'err');
      return;
    }
    const restantes = idsDeDepartamento(getConversa(cid));
    UI.toast(ligar ? (restantes.length > 1 ? `Compartilhada com ${d.nome}.` : `Delegada ao departamento ${d.nome}.`) : `Removida de ${d.nome}.`);
    atualizar('head', 'lista', 'drawer');
  };
  A.delegarPessoa = (cid, pid) => {
    atualizarConversa(cid, { responsavel: pid || null });
    const c = getConversa(cid);
    if (pid && nuvem() && pid !== eu().id) {
      Cloud.notificar([pid], `${primeiroNome(eu().nome)} delegou a conversa ${c ? c.nome : ''} para você`, cid, 'delegacao').catch(() => {});
    }
    UI.toast(pid ? `Delegada para ${nomeDoPerfil(pid)}.` : 'Responsável removido');
    atualizar('head', 'lista', 'drawer');
  };
  A.arquivar = () => {
    const c = getConversa(_c.sel);
    if (!c) return;
    atualizarConversa(c.id, { arquivada: !c.arquivada });
    UI.toast(c.arquivada ? 'Conversa arquivada.' : 'Conversa desarquivada.');
    _c.menuMais = false; _c.drawer = false;
    if (c.arquivada) _c.sel = null;
    atualizar('rail', 'lista', 'main', 'drawer');
  };
  A.atualizarFoto = async () => {
    if (!nuvem()) return;
    try {
      UI.toast('Pedindo a foto ao motor...');
      const cmd = await Cloud.enviarComando('atualizar_foto', { conversaId: _c.sel });
      await Cloud.aguardarComando(cmd.id);
      await Cloud.carregarTudo(true);
      UI.toast('Foto atualizada.');
      atualizar('head', 'lista', 'drawer');
    } catch (e) { UI.toast(e.message, 'err'); }
  };
  A.criarLead = () => {
    const c = getConversa(_c.sel);
    if (!c) return;
    const lead = novoLead({ nome: c.nome, telefone: c.telefone.startsWith('lid-') || c.tipo === 'grupo' ? '' : c.telefone, origem: 'WhatsApp', etapa: 'Contato Feito' });
    atualizarConversa(c.id, { leadId: lead.id });
    UI.toast('Lead criado e vinculado.');
    _c.menuMais = false;
    atualizar('head', 'drawer');
  };

  /* ---------- nova conversa / grupo ---------- */
  A.novaConversa = () => {
    UI.modal(`<h2>Nova conversa <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
      <div class="form-row">
        <div class="field"><label>Nome do contato</label><input id="nc-nome" placeholder="Maria Silva"></div>
        <div class="field"><label>WhatsApp *</label><input id="nc-tel" placeholder="(22) 99999-9999"></div>
      </div>
      <p class="muted">Se já existir um lead com esse telefone, a conversa é vinculada automaticamente.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="ChatUI.criarConversa()">Criar conversa</button>
      </div>`);
  };
  A.criarConversa = () => {
    // os dois campos são lidos ANTES de fechar a janela: UI.fecharModal esvazia o #modal e o campo
    // deixa de existir (13/10/2026: "Algo deu errado" ao adicionar contato — null.value no nome)
    const tel = document.getElementById('nc-tel').value.trim();
    const nomeEl = document.getElementById('nc-nome');
    const nome = nomeEl ? nomeEl.value.trim() : '';
    if (!tel) { UI.toast('Informe o WhatsApp', 'err'); return; }
    // abre um rascunho: a conversa só é criada quando a 1ª mensagem sair
    // (nasce no(s) departamento(s) de quem criou; contato novo que chama vai pela automação)
    UI.fecharModal();
    abrirRascunho({ nome, telefone: tel });
  };

  /* catálogo unificado: conversas com número identificado + leads do CRM */
  function catalogoContatos(excluir) {
    const excl = new Set(excluir || []);
    const vistos = new Set();
    const lista = [];
    state.conversas.forEach(c => {
      if (c.tipo === 'grupo' || !c.telefone || c.telefone.startsWith('lid-') || c.telefone.startsWith('grupo-')) return;
      if (excl.has(c.telefone) || vistos.has(c.telefone)) return;
      vistos.add(c.telefone);
      lista.push({ tel: c.telefone, nome: c.nome || telExibicao(c.telefone), origem: 'conversa' });
    });
    (state.leads || []).forEach(l => {
      const tel = normPhone(l.telefone);
      if (!tel || tel.length < 10 || excl.has(tel) || vistos.has(tel)) return;
      vistos.add(tel);
      lista.push({ tel, nome: l.nome || telExibicao(tel), origem: 'lead' });
    });
    return lista.sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
  }

  function listaContatosHTML(idPrefixo, excluir) {
    const contatos = catalogoContatos(excluir);
    return `<div class="field"><label>Participantes — pesquise e marque (${contatos.length} contato(s))</label>
      <input id="${idPrefixo}-busca" placeholder="Pesquisar por nome ou número..." autocomplete="off"
        oninput="ChatUI.filtrarContatos('${idPrefixo}', this.value)" style="margin-bottom:8px">
      <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:10px;padding:8px" id="${idPrefixo}-lista">
      ${contatos.length ? contatos.map(ct => `<label class="ct-item" data-busca="${esc((ct.nome + ' ' + ct.tel).toLowerCase())}"
          style="display:flex;gap:8px;align-items:center;padding:5px 2px;cursor:pointer">
        <input type="checkbox" class="${idPrefixo}-chk" value="${esc(ct.tel)}" style="width:auto;flex:0 0 auto">
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ct.nome)}</span>
        <small class="muted" style="flex-shrink:0">${telExibicao(ct.tel)}${ct.origem === 'lead' ? ' · lead' : ''}</small>
      </label>`).join('') : '<small class="muted">Nenhum contato com número identificado ainda — use o campo de números abaixo.</small>'}</div></div>
    <div class="field"><label>Outros números (separados por vírgula)</label>
      <input id="${idPrefixo}-extra" placeholder="22999990000, 21988887777"></div>`;
  }
  function telefonesEscolhidos(idPrefixo) {
    const marcados = Array.from(document.querySelectorAll('.' + idPrefixo + '-chk:checked')).map(x => x.value);
    const extras = (document.getElementById(idPrefixo + '-extra').value || '').split(',').map(t => normPhone(t)).filter(Boolean);
    return [...new Set([...marcados, ...extras])];
  }

  A.novoGrupo = () => {
    UI.modal(`<h2>${ICO('users')} Novo grupo de WhatsApp <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
      <div class="field"><label>Nome do grupo *</label><input id="ng-nome" placeholder="Ex.: Cliente Maria — Caso Trabalhista"></div>
      ${listaContatosHTML('ng')}
      <p class="muted">O grupo é criado de verdade no WhatsApp do escritório, com os participantes acima.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
        <button class="btn btn-primary" id="ng-criar" onclick="ChatUI.criarGrupo()">Criar grupo</button>
      </div>`, { large: true });
  };
  A.criarGrupo = async () => {
    const nome = document.getElementById('ng-nome').value.trim();
    const tels = telefonesEscolhidos('ng');
    if (!nome || !tels.length) { UI.toast('Informe o nome e ao menos 1 participante', 'err'); return; }
    if (!nuvem()) {
      const c = novaConversa({ nome, telefone: 'grupo-' + Date.now(), tipo: 'grupo', participantes: tels.map(t => ({ telefone: t })) });
      UI.fecharModal(); A.abrir(c.id); return;
    }
    const btn = document.getElementById('ng-criar');
    UI.ocupado(btn, 'Criando no WhatsApp');
    try {
      const cmd = await Cloud.enviarComando('criar_grupo', { nome, telefones: tels });
      const r = await Cloud.aguardarComando(cmd.id, 30);
      await Cloud.carregarTudo(true);
      UI.fecharModal();
      UI.toast('Grupo criado no WhatsApp.');
      if (r.resultado && r.resultado.conversaId) A.abrir(r.resultado.conversaId); else atualizar('lista');
    } catch (e) {
      UI.toast(e.message, 'err');
      UI.livre(btn);
    }
  };
  A.grupoAdd = () => {
    const c = getConversa(_c.sel);
    if (!c) return;
    UI.modal(`<h2>Adicionar ao grupo <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
      ${listaContatosHTML('ga', (c.participantes || []).map(p => p.telefone))}
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="ChatUI.grupoAddConfirma()">Adicionar</button>
      </div>`, { large: true });
  };
  A.grupoAddConfirma = async () => {
    const c = getConversa(_c.sel);
    const tels = telefonesEscolhidos('ga');
    if (!c || !tels.length) { UI.toast('Escolha ao menos 1 contato', 'err'); return; }
    UI.fecharModal();
    if (!nuvem()) { atualizarConversa(c.id, { participantes: [...(c.participantes || []), ...tels.map(t => ({ telefone: t, lid: '', nome: '', admin: false }))] }); atualizar('head', 'drawer'); return; }
    try {
      UI.toast('Adicionando no WhatsApp...');
      const cmd = await Cloud.enviarComando('grupo_add', { grupoJid: c.grupoJid, telefones: tels });
      await Cloud.aguardarComando(cmd.id, 30);
      await Cloud.carregarTudo(true);
      UI.toast('Participante(s) adicionado(s).');
      atualizar('head', 'drawer');
    } catch (e) { UI.toast(e.message, 'err'); }
  };
  A.grupoRemover = async tel => {
    const c = getConversa(_c.sel);
    if (!c || !confirm('Remover ' + telExibicao(tel) + ' do grupo?')) return;
    if (!nuvem()) { atualizarConversa(c.id, { participantes: (c.participantes || []).filter(p => p.telefone !== tel) }); atualizar('head', 'drawer'); return; }
    try {
      const cmd = await Cloud.enviarComando('grupo_remover', { grupoJid: c.grupoJid, telefones: [tel] });
      await Cloud.aguardarComando(cmd.id, 30);
      await Cloud.carregarTudo(true);
      UI.toast('Removido do grupo.');
      atualizar('head', 'drawer');
    } catch (e) { UI.toast(e.message, 'err'); }
  };
  /* vistoria dos grupos (dono, 09/10/2026): o motor confere cada grupo no WhatsApp e regrava a lista de
     participantes sem duplicados e com o número real; aqui só se dispara o comando e se mostra o relatório */
  A.vistoriarGrupos = async () => {
    if (!nuvem() || !souAdmin()) return;
    if (!confirm('Vistoriar todos os grupos agora?\n\nO motor consulta cada grupo no WhatsApp e corrige a lista de participantes (sem duplicados, com o número real). Leva um ou dois minutos.')) return;
    try {
      UI.toast('Vistoriando os grupos no WhatsApp... isso pode levar um ou dois minutos.');
      const cmd = await Cloud.enviarComando('grupos_vistoria', { aplicar: true });
      const c = await Cloud.aguardarComando(cmd.id, 300);
      await Cloud.carregarTudo(true);
      atualizar('lista', 'head', 'drawer');
      mostrarVistoria(c.resultado || {});
    } catch (e) { UI.toast(/comando desconhecido/.test(e.message) ? 'O motor ainda não foi atualizado para a vistoria dos grupos.' : e.message, 'err'); }
  };
  function mostrarVistoria(r) {
    const det = r.detalhes || [];
    const linha = d => d.erro
      ? `<tr><td>${esc(d.nome || '')}</td><td colspan="4" style="color:var(--state-danger-fg)">${esc(d.erro)}</td></tr>`
      : `<tr><td>${esc(d.nome || '')}</td><td>${d.antes} → ${d.depois}</td><td>${d.lidsCrus || 0}</td><td>${d.duplicatas || 0}</td><td>${d.removidos || 0} / ${d.incluidos || 0}${d.semNumero ? ` · ${d.semNumero} sem número` : ''}</td></tr>`;
    UI.modal(`<h2>${ICO('users')} Vistoria dos grupos <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
      <p class="muted"><b>${r.grupos || 0}</b> grupo(s) · <b>${r.consultados || 0}</b> consultado(s) no WhatsApp · <b>${r.corrigidos || 0}</b> corrigido(s) · <b>${r.comErro || 0}</b> com erro<br>
        <b>${r.lidsCrus || 0}</b> participante(s) estavam com o identificador do WhatsApp no lugar do número · <b>${r.duplicatas || 0}</b> duplicata(s) removida(s)${r.semNumero ? ` · <b>${r.semNumero}</b> ainda sem número revelado pelo WhatsApp` : ''}</p>
      ${det.length ? `<div class="wa-vistoria"><table><thead><tr><th>Grupo</th><th>Participantes</th><th>Nº errado</th><th>Duplicatas</th><th>Saíram / entraram</th></tr></thead><tbody>${det.map(linha).join('')}</tbody></table></div>`
        : '<p class="muted">Nenhuma diferença: as listas já batiam com o WhatsApp.</p>'}
      <div class="modal-actions"><button class="btn btn-primary" onclick="UI.fecharModal()">Fechar</button></div>`, { large: true });
  }
  A.grupoAtualizarMembros = async () => {
    const c = getConversa(_c.sel);
    if (!c || !nuvem()) return;
    try {
      UI.toast('Consultando o WhatsApp...');
      const cmd = await Cloud.enviarComando('grupo_membros', { grupoJid: c.grupoJid });
      await Cloud.aguardarComando(cmd.id, 30);
      await Cloud.carregarTudo(true);
      UI.toast('Lista de participantes atualizada.');
      atualizar('head', 'drawer');
    } catch (e) { UI.toast(e.message, 'err'); }
  };
  /* abre (ou cria) a conversa individual com um participante do grupo */
  A.participanteConversar = (tel, nome) => {
    tel = String(tel || '');
    const existente = convDoParticipante(tel);
    if (existente) { _c.drawer = false; A.abrir(existente.id); return; }
    if (tel.startsWith('lid-')) { UI.toast('O WhatsApp ainda não revelou o número deste participante.', 'err'); return; }
    const limpo = normPhone(tel.split(':')[0].split('@')[0]);
    if (!limpo) { UI.toast('Número do participante inválido.', 'err'); return; }
    if (!pode('conversas_criar')) { UI.toast('Você não tem alçada para criar conversas.', 'err'); return; }
    // rascunho: nada é gravado até a primeira mensagem sair
    abrirRascunho({ nome: nome || '', telefone: limpo });
  };

  /* ---------- respostas rápidas ---------- */
  A.editarRR = rid => {
    const r = rid ? state.respostasRapidas.find(x => x.id === rid) : null;
    UI.modal(`<h2>${r ? 'Editar' : 'Nova'} resposta rápida <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
      <div class="form-row">
        <div class="field"><label>Atalho (digite no chat com /)</label><input id="rr-atalho" value="${esc(r ? r.atalho : '')}" placeholder="/pagamento"></div>
        <div class="field"><label>Título</label><input id="rr-titulo" value="${esc(r ? r.titulo : '')}" placeholder="Dados de pagamento"></div>
      </div>
      <div class="field"><label>Mensagem (use {{nome}}, {{atendente}}, {{empresa}})</label>
        <textarea id="rr-texto" rows="5">${esc(r ? r.texto : '')}</textarea></div>
      <div class="modal-actions">
        ${r ? `<button class="btn btn-danger" style="margin-right:auto" onclick="state.respostasRapidas=state.respostasRapidas.filter(x=>x.id!=='${rid}');save();UI.fecharModal();UI.toast('Excluída');ChatUI.atualizarLista()">Excluir</button>` : ''}
        <button class="btn btn-ghost" onclick="UI.fecharModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="ChatUI.salvarRR(${r ? `'${rid}'` : 'null'})">Salvar</button>
      </div>`);
  };
  A.salvarRR = rid => {
    const dados = {
      atalho: document.getElementById('rr-atalho').value.trim(),
      titulo: document.getElementById('rr-titulo').value.trim(),
      texto: document.getElementById('rr-texto').value.trim()
    };
    if (!dados.texto) { UI.toast('Escreva a mensagem', 'err'); return; }
    if (rid) Object.assign(state.respostasRapidas.find(x => x.id === rid), dados);
    else state.respostasRapidas.push({ id: uid(), dono: null, ...dados });
    save();
    UI.fecharModal();
    UI.toast('Resposta rápida salva.');
    atualizar('lista');
  };

  /* ---------- tags ---------- */
  A.criarTag = () => {
    const nome = document.getElementById('tag-nome').value.trim();
    const cor = document.getElementById('tag-cor').value;
    if (!nome) { UI.toast('Dê um nome à tag', 'err'); return; }
    if ((state.tags || []).some(t => t.nome.toLowerCase() === nome.toLowerCase())) { UI.toast('Já existe uma tag com esse nome', 'err'); return; }
    state.tags.push({ id: uid(), nome, cor, ordem: tagsOrdenadas().length + 1 });   // nova tag vai para o fim da lista
    save();
    UI.toast('Tag criada.');
    atualizar('lista', 'drawer');
  };
  A.renomearTag = tid => {
    const t = state.tags.find(x => x.id === tid);
    if (!t) return;
    const novo = prompt('Novo nome da tag:', t.nome);
    if (!novo || novo.trim() === t.nome) return;
    const antigo = t.nome;
    t.nome = novo.trim();
    state.conversas.forEach(c => {
      if ((c.tags || []).includes(antigo)) c.tags = c.tags.map(x => x === antigo ? t.nome : x);
    });
    save();
    atualizar('lista', 'drawer');
  };
  A.excluirTag = tid => {
    const t = state.tags.find(x => x.id === tid);
    if (!t || !confirm(`Excluir a tag "${t.nome}"? Ela será removida de todas as conversas.`)) return;
    state.tags = state.tags.filter(x => x.id !== tid);
    state.conversas.forEach(c => {
      if ((c.tags || []).includes(t.nome)) c.tags = c.tags.filter(x => x !== t.nome);
    });
    save();
    atualizar('lista', 'drawer');
  };

  /* ---------- campos personalizados: salvar um valor ---------- */
  A.salvarCampo = async (cid, campoId, input) => {
    const c = getConversa(cid);
    if (!c) return;
    const valor = String((input && input.value) || '').trim();
    const anterior = (c.campos || {})[campoId];
    const aplicar = v => { c.campos = Object.assign({}, c.campos || {}); if (v) c.campos[campoId] = v; else delete c.campos[campoId]; };
    aplicar(valor);
    save();
    const marcarSalvo = () => { if (!input || !input.classList) return; input.classList.add('salvo'); setTimeout(() => input.classList.remove('salvo'), 1600); };
    if (!nuvem()) { marcarSalvo(); return; }
    try {
      const novo = await Cloud.definirCampo(cid, campoId, valor);
      if (novo === null) throw Object.assign(new Error('Aplique nuvem/chat-v18a.sql no Supabase para ativar os campos personalizados.'), { code: 'SEM_MIGRACAO' });
      if (novo && typeof novo === 'object') { c.campos = novo; save(); }
      marcarSalvo();
    } catch (e) {
      aplicar(anterior || '');
      save();
      if (input) input.value = anterior || '';
      UI.toast(traduzirErroCampo(e), 'err');
      if (e && e.code === '23503') {
        // o campo sumiu (um colega apagou): recarrega a lista do banco; sem rede, tira só o local
        let ok = false;
        try { ok = nuvem() && Cloud.recarregarCampos ? await Cloud.recarregarCampos() : false; } catch (e2) { ok = false; }
        if (!ok) state.camposPersonalizados = (state.camposPersonalizados || []).filter(k => k.id !== campoId);
        atualizar('drawer');
      }
    }
  };
  /* ---------- campos personalizados: janela de gestão (alçada campos_gerir) ----------
     A lista é do escritório: tudo aqui mexe em state.camposPersonalizados + save(); o sync genérico grava. */
  A.gerirCampos = () => {
    if (!pode('campos_gerir')) { UI.toast('Sem alçada para gerir campos personalizados.', 'err'); return; }
    const lista = camposOrdenados();
    const linhas = lista.length ? lista.map((k, i) => {
      const usos = state.conversas.filter(c => (c.campos || {})[k.id]).length;
      return `<div class="wa-item">
        <div class="linha" style="gap:6px">
          <input type="text" value="${esc(k.nome)}" aria-label="Nome do campo" onchange="ChatUI.campoRenomear('${k.id}', this)">
          <select aria-label="Tipo do campo" onchange="ChatUI.campoTipo('${k.id}', this)">
            <option value="texto" ${k.tipo !== 'link' ? 'selected' : ''}>Texto</option>
            <option value="link" ${k.tipo === 'link' ? 'selected' : ''}>Link</option>
          </select>
          <span style="display:flex;gap:2px">
            <button class="wa-ico-btn" title="Subir" ${i === 0 ? 'disabled' : ''} onclick="ChatUI.campoMover('${k.id}', -1)">${ICO('arrow-up')}</button>
            <button class="wa-ico-btn" title="Descer" ${i === lista.length - 1 ? 'disabled' : ''} onclick="ChatUI.campoMover('${k.id}', 1)">${ICO('arrow-down')}</button>
            <button class="wa-ico-btn" title="Excluir" onclick="ChatUI.campoExcluir('${k.id}')">${I.lixo}</button>
          </span>
        </div>
        <small>${usos} conversa(s) com valor</small>
      </div>`;
    }).join('') : '<div class="wa-vazio">Nenhum campo ainda. Crie abaixo.</div>';
    UI.modal(`<h2>${ICO('clipboard-list')} Gerenciar campos personalizados <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
      <p class="muted mb">A lista vale para todas as conversas. Excluir um campo tira a linha da tela; os valores já preenchidos ficam guardados sem aparecer.</p>
      <div class="wa-painel-lista">${linhas}</div>
      <div class="wa-form-inline" style="margin-top:12px">
        <input type="text" id="cp-novo-nome" placeholder="Novo campo (ex.: Nº processo)">
        <select id="cp-novo-tipo" aria-label="Tipo do novo campo"><option value="texto">Texto</option><option value="link">Link</option></select>
        <button class="wa-btn" onclick="ChatUI.campoCriar()">Criar</button>
      </div>`, { large: true });
  };
  const nomeRepetido = (nome, exceto) => (state.camposPersonalizados || []).some(c => c.id !== exceto && String(c.nome).toLowerCase() === nome.toLowerCase());
  A.campoCriar = () => {
    const nomeEl = document.getElementById('cp-novo-nome'), tipoEl = document.getElementById('cp-novo-tipo');
    const nome = String((nomeEl && nomeEl.value) || '').trim();
    if (!nome) { UI.toast('Dê um nome ao campo', 'err'); return; }
    if (nomeRepetido(nome)) { UI.toast('Já existe um campo com esse nome', 'err'); return; }
    const ordem = Math.max(0, ...(state.camposPersonalizados || []).map(c => Number(c.ordem) || 0)) + 1;
    state.camposPersonalizados.push({ id: uid(), nome, tipo: tipoEl && tipoEl.value === 'link' ? 'link' : 'texto', ordem });
    save();
    A.gerirCampos();
    atualizar('drawer');
  };
  A.campoRenomear = (id, input) => {
    const k = (state.camposPersonalizados || []).find(c => c.id === id);
    if (!k) return;
    const nome = String((input && input.value) || '').trim();
    if (!nome) { if (input) input.value = k.nome; return; }
    if (nomeRepetido(nome, id)) { UI.toast('Já existe um campo com esse nome', 'err'); if (input) input.value = k.nome; return; }
    k.nome = nome;
    save();
    atualizar('drawer');
  };
  A.campoTipo = (id, select) => {
    const k = (state.camposPersonalizados || []).find(c => c.id === id);
    if (!k) return;
    k.tipo = select && select.value === 'link' ? 'link' : 'texto';
    save();
    atualizar('drawer');
  };
  A.campoMover = (id, dir) => {
    const lista = camposOrdenados();
    lista.forEach((c, i) => { c.ordem = i + 1; });   // normaliza antes de trocar
    const i = lista.findIndex(c => c.id === id), j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= lista.length) return;
    const a = lista[i].ordem; lista[i].ordem = lista[j].ordem; lista[j].ordem = a;
    save();
    A.gerirCampos();
    atualizar('drawer');
  };
  A.campoExcluir = id => {
    const k = (state.camposPersonalizados || []).find(c => c.id === id);
    if (!k || !confirm(`Excluir o campo "${k.nome}"? Os valores já preenchidos deixam de aparecer (ficam guardados).`)) return;
    state.camposPersonalizados = state.camposPersonalizados.filter(c => c.id !== id);
    save();
    A.gerirCampos();
    atualizar('drawer');
  };

  /* ---------- usuários e departamentos ---------- */
            
  /* ---------- notificações ---------- */
  A.abrirNotif = async nid => {
    const n = (state.notificacoes || []).find(x => x.id === nid);
    if (!n) return;
    if (!n.lida && nuvem()) Cloud.marcarNotifLida(nid);
    n.lida = true;
    if (n.conversa_id && getConversa(n.conversa_id)) A.abrir(n.conversa_id);
    else atualizar('rail', 'lista');
  };
  A.lerTodas = async () => {
    if (nuvem()) await Cloud.marcarNotifsLidas();
    else (state.notificacoes || []).forEach(n => n.lida = true);
    atualizar('rail', 'lista');
  };

  /* ---------- lightbox ---------- */
  A.lightbox = mid => {
    const m = state.mensagens.find(x => x.id === mid);
    if (!m) return;
    const el = document.createElement('div');
    el.className = 'wa-lightbox';
    el.innerHTML = `<div class="wa-lightbox-top">
        <a href="${esc(urlBaixar(m))}" target="_blank" title="Baixar">${I.baixar}</a>
        <button title="Fechar" onclick="this.closest('.wa-lightbox').remove()">${ICO('x')}</button>
      </div>
      ${m.tipo === 'video' ? `<video src="${esc(m.midiaUrl)}" controls autoplay></video>` : `<img src="${esc(m.midiaUrl)}">`}`;
    el.addEventListener('click', e => { if (e.target === el) el.remove(); });
    document.body.appendChild(el);
  };

  /* ---------- reações ---------- */
  A.reagirPaleta = (mid, ev) => {
    document.querySelectorAll('.wa-react-paleta').forEach(el => el.remove());
    const m = state.mensagens.find(x => x.id === mid);
    if (!m) return;
    const minha = (m.reacoes || []).find(r => r.minha);
    const el = document.createElement('div');
    el.className = 'wa-react-paleta';
    el.innerHTML = ['👍', '❤️', '😂', '😮', '😢', '🙏'].map(e =>
      `<button ${minha && minha.emoji === e ? 'class="ativa"' : ''} onclick="ChatUI.reagir('${mid}','${e}')">${e}</button>`).join('') +
      (minha ? `<button class="remover" title="Remover minha reação" onclick="ChatUI.reagir('${mid}','')">${ICO('x')}</button>` : '');
    document.body.appendChild(el);
    const r = (ev.currentTarget || ev.target).getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(window.innerWidth - 300, r.left - 110)) + 'px';
    el.style.top = Math.max(8, r.top - 56) + 'px';
    setTimeout(() => document.addEventListener('click', function fecha(e2) {
      if (!el.contains(e2.target)) { el.remove(); document.removeEventListener('click', fecha); }
    }), 30);
  };

  A.reagir = async (mid, emoji) => {
    document.querySelectorAll('.wa-react-paleta').forEach(el => el.remove());
    const m = state.mensagens.find(x => x.id === mid);
    if (!m) return;
    if (!nuvem()) {
      m.reacoes = (m.reacoes || []).filter(r => !r.minha);
      if (emoji) m.reacoes.push({ emoji, de: '', nome: 'Você', minha: true });
      save(); atualizar('msgs'); return;
    }
    // otimista: mostra na hora e confirma com o motor em seguida
    const antes = m.reacoes || [];
    m.reacoes = antes.filter(r => !r.minha);
    if (emoji) m.reacoes.push({ emoji, de: '', nome: primeiroNome(eu().nome) || 'Você', minha: true });
    atualizar('msgs');
    try {
      const cmd = await Cloud.enviarComando('reagir', { mensagemId: mid, emoji, autorNome: primeiroNome(eu().nome) || 'Atendente' });
      const r = await Cloud.aguardarComando(cmd.id, 25);
      if (r.resultado && r.resultado.reacoes) { m.reacoes = r.resultado.reacoes; atualizar('msgs'); }
    } catch (e) {
      m.reacoes = antes;
      atualizar('msgs');
      UI.toast(e.message, 'err');
    }
  };

  /* ---------- apagar mensagem enviada (revogação p/ todos) ---------- */
  A.apagarMsg = async mid => {
    const m = state.mensagens.find(x => x.id === mid);
    if (!m || !confirm('Apagar esta mensagem para o cliente no WhatsApp?\n\nEla continua guardada aqui, visível só para a equipe.')) return;
    if (!nuvem()) { m.apagada = true; save(); atualizar('msgs'); return; }
    try {
      const cmd = await Cloud.enviarComando('apagar_mensagem', { mensagemId: mid });
      await Cloud.aguardarComando(cmd.id, 25);
      m.apagada = true;
      atualizar('msgs', 'lista');
      UI.toast('Mensagem apagada para o cliente.');
    } catch (e) { UI.toast(e.message, 'err'); }
  };

  /* ---------- arquivo grande sob demanda (chat-v16c) ----------
     o motor baixa do WhatsApp só agora (em fluxo) e guarda no Storage por 7 dias;
     a bolha ganha o link assim que a mensagem volta atualizada */
  A.baixarMidia = async (mid, btn) => {
    if (!nuvem() || !state.mensagens.some(x => x.id === mid)) return;
    UI.ocupado(btn, 'Baixando do WhatsApp');
    try {
      const cmd = await Cloud.enviarComando('baixar_midia', { mensagemId: mid });
      // o motor tem até ~17 min (download + envio ao Storage): espera em rodadas de 10 min, até 3
      let r;
      for (let rodada = 0; ; rodada++) {
        try { r = await Cloud.aguardarComando(cmd.id, 600); break; }
        catch (e) { if (!e.prazoEsgotado || rodada >= 2) throw e; UI.toast('Arquivo grande — o download continua, aguarde...'); }
      }
      const url = r && r.resultado && r.resultado.url;
      if (!url) throw new Error('o motor não devolveu o endereço do arquivo');
      // o pulso pode ter trocado o objeto durante a espera (reação, edição): busca de novo
      const m = state.mensagens.find(x => x.id === mid);
      if (m && !m.midiaUrl) { m.midiaUrl = url; atualizar('msgs'); }
      UI.toast('Arquivo pronto para baixar — fica disponível por 7 dias.');
    } catch (e) { UI.toast(e.message, 'err'); UI.livre(btn); }
  };

  /* ---------- transcrição sob demanda ---------- */
  A.transcrever = async (mid, btn) => {
    if (!nuvem()) return;
    UI.ocupado(btn, 'Transcrevendo');
    try {
      const cmd = await Cloud.enviarComando('transcrever', { mensagemId: mid });
      const r = await Cloud.aguardarComando(cmd.id, 40);
      const m = state.mensagens.find(x => x.id === mid);
      if (m) m.transcricao = (r.resultado && r.resultado.transcricao) || '(sem fala reconhecível)';
      atualizar('msgs');
    } catch (e) {
      UI.toast(e.message, 'err');
      UI.livre(btn);
    }
  };

  /* ---------- IA: resumo, busca ---------- */
  function conversaComoTexto(c, limite) {
    const atendente = primeiroNome(state.settings.nomeAtendente) || 'Atendente';
    return mensagensDaConversa(c.id)
      .filter(m => m.tipo !== 'anotacao')
      .slice(-(limite || 400))
      .map(m => {
        const quem = m.direcao === 'saida' ? (nomeDoPerfil(m.autor) || atendente) : (m.remetente || c.nome || 'Cliente');
        const oque = m.tipo === 'texto' ? m.texto : `[${previaDeMidia(m)}]${m.transcricao ? ' transcrição: ' + m.transcricao : ''}${m.texto ? ' legenda: ' + m.texto : ''}`;
        return `[${fmtDateTime(m.criadoEm)}] ${quem}: ${String(oque).replace(/\n/g, ' ')}`;
      }).join('\n');
  }
  function modalIA(titulo, corpo) {
    UI.modal(`<h2>${titulo} <button class="modal-close" onclick="UI.fecharModal()">${ICO('x')}</button></h2>${corpo}`, { large: true });
  }
  A.iaResumo = async () => {
    _c.menuMais = false;
    const c = getConversa(_c.sel);
    if (!c) return;
    if (!AI.configurado()) { modalIA(ICO('bot') + ' Resumir conversa', `<p class="muted">A IA do escritório funciona só no sistema publicado (modo nuvem).</p>`); return; }
    modalIA(ICO('bot') + ' Resumo da conversa', `<p class="muted">${UI.carregando('Analisando ' + (c.nome || 'a conversa') + ' (pode levar até um minuto)')}</p>`);
    try {
      const texto = await AI.resumirConversa(conversaComoTexto(c), c.nome, c.id);
      modalIA(ICO('bot') + ' Resumo da conversa', `<div style="white-space:pre-wrap;line-height:1.65;font-size:.92rem">${esc(texto)}</div>
        <div class="modal-actions"><button class="btn btn-ghost" onclick="UI.copiar(${JSON.stringify(texto).replace(/"/g, '&quot;')})">${ICO('copy')} Copiar</button>
        <button class="btn btn-primary" onclick="UI.fecharModal()">Fechar</button></div>`);
    } catch (e) { modalIA(ICO('bot') + ' Resumo da conversa', `<p class="muted">${esc(e.message)}</p>`); }
  };
  A.iaPergunta = () => {
    _c.menuMais = false;
    const c = getConversa(_c.sel);
    if (!c) return;
    if (!AI.configurado()) { modalIA(ICO('search') + ' Buscar com IA', `<p class="muted">A IA do escritório funciona só no sistema publicado (modo nuvem).</p>`); return; }
    modalIA(ICO('search') + ' Buscar informação nesta conversa', `
      <div class="field"><label>O que você quer saber?</label>
        <input id="ia-pergunta" placeholder="Ex.: qual o número do processo que o cliente mencionou?"></div>
      <div id="ia-resposta"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="UI.fecharModal()">Fechar</button>
        <button class="btn btn-primary" onclick="ChatUI.iaPerguntaEnviar()">Buscar</button>
      </div>`);
    setTimeout(() => {
      const i = document.getElementById('ia-pergunta');
      if (i) { i.focus(); i.addEventListener('keydown', e => { if (e.key === 'Enter') A.iaPerguntaEnviar(); }); }
    }, 60);
  };
  A.iaPerguntaEnviar = async () => {
    const c = getConversa(_c.sel);
    const pergunta = document.getElementById('ia-pergunta').value.trim();
    const out = document.getElementById('ia-resposta');
    if (!c || !pergunta || !out) return;
    out.innerHTML = '<p class="muted">' + UI.carregando('Procurando') + '</p>';
    try {
      const resp = await AI.perguntarConversa(conversaComoTexto(c), pergunta, c.nome, c.id);
      out.innerHTML = `<div style="white-space:pre-wrap;line-height:1.6;font-size:.9rem;background:var(--surface-accent-soft);border-radius:10px;padding:12px;margin-top:6px">${esc(resp)}</div>`;
    } catch (e) { out.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  };
  /* transforma a conversa em texto "Quem: fala" para o motor de análise
     (compartilhado pela análise manual e pela automática) */
  function conversaParaAnalise(c) {
    const msgs = mensagensDaConversa(c.id).filter(m => m.tipo !== 'anotacao' && m.texto);
    const atendente = primeiroNome(state.settings.nomeAtendente) || 'Atendente';
    const texto = msgs.map(m => `${m.direcao === 'saida' ? atendente : (c.nome || 'Cliente')}: ${m.texto.replace(/\n/g, ' ')}`).join('\n');
    return { msgs, atendente, texto };
  }
  A.conversaParaAnalise = conversaParaAnalise;   // usado pela ficha do lead (views-leads.js)

  A.analisarSPIN = () => {
    _c.menuMais = false;
    const c = getConversa(_c.sel);
    if (!c) return;
    // a análise agora mora na ficha do lead — sem lead vinculado ela não teria onde aparecer
    if (!c.leadId) {
      UI.toast('Vincule esta conversa a um lead antes de analisar — a análise fica na ficha dele.', 'err');
      return;
    }
    const { msgs, atendente, texto } = conversaParaAnalise(c);
    if (msgs.length < 2) { UI.toast('Poucas mensagens para analisar (mínimo: um diálogo)', 'err'); return; }
    const a = Analysis.analyze(texto, { leadId: c.leadId, atendente, nomeLead: c.nome });
    state.analyses.unshift(a);
    save();
    UI.toast('Análise concluída! Score: ' + a.scores.geral);
    Views.irParaAnalise(c.leadId, a.id);
  };

  /* v6: análise SPIN heurística SILENCIOSA ao resolver/fechar a conversa —
     sem modal e sem navegar; o resultado fica na ficha do lead no CRM.
     No máximo 1 análise automática por conversa a cada 24h. */
  function analiseAutomaticaDaConversa(c) {
    try {
      if (!c || !c.leadId || state.settings.analiseAutomatica === false) return;
      const { msgs, atendente, texto } = conversaParaAnalise(c);
      if (msgs.length < 6) return;
      const limite = Date.now() - 86400000;
      const jaTem = state.analyses.some(a => a.leadId === c.leadId && a.automatica &&
        new Date(a.criadoEm).getTime() > limite);
      if (jaTem) return;
      const a = Analysis.analyze(texto, { leadId: c.leadId, atendente, nomeLead: c.nome });
      a.automatica = true;
      state.analyses.unshift(a);
      registrarEvento(c.leadId, 'analise', 'Análise automática ao encerrar a conversa — score ' +
        (a.scores && a.scores.geral != null ? a.scores.geral : '—'));
      save();
      UI.toast('Análise da conversa registrada no CRM.');
    } catch (e) { console.error('Análise automática falhou', e); }
  }
  A.exportarTranscript = cid => {
    _c.menuMais = false;
    const c = getConversa(cid);
    if (!c) return;
    const cab = `${ESCRITORIO.plataformas.chat.toUpperCase()} — conversa com ${c.nome}\n${c.tipo === 'grupo' ? 'Grupo' : 'Telefone: ' + telExibicao(c.telefone)}\nExportado em ${fmtDateTime(new Date().toISOString())}\n${'='.repeat(50)}\n\n`;
    const linhas = mensagensDaConversa(cid).map(m => {
      if (m.tipo === 'anotacao') return `[${fmtDateTime(m.criadoEm)}] ANOTAÇÃO (${nomeDoPerfil(m.autor) || 'Equipe'}): ${m.texto}`;
      const quem = m.direcao === 'saida' ? (nomeDoPerfil(m.autor) || 'Atendente') : (m.remetente || c.nome);
      const oque = m.tipo === 'texto' ? m.texto : `${previaDeMidia(m)}${m.midiaUrl ? ' <' + m.midiaUrl + '>' : ''}${m.transcricao ? '\n   transcrição: ' + m.transcricao : ''}${m.texto ? '\n   legenda: ' + m.texto : ''}`;
      return `[${fmtDateTime(m.criadoEm)}] ${quem}: ${oque}`;
    }).join('\n');
    baixarArquivo(`conversa-${(c.nome || 'contato').replace(/[^\w\d]+/g, '-').toLowerCase()}.txt`, cab + linhas);
  };

  /* ---------- relatórios ---------- */
  A.relConversas = () => {
    const { ini, convs } = relFiltro();
    const linhas = [csvLinha(['Contato/Grupo', 'Telefone', 'Tipo', 'Departamento', 'Responsável', 'Status', 'Tags', 'Criada em', 'Última mensagem em', 'Msgs recebidas', 'Msgs enviadas', 'Anotações', 'Arquivada'])];
    convs.forEach(c => {
      const ms = mensagensDaConversa(c.id).filter(m => (m.criadoEm || '').slice(0, 10) >= ini);
      if (!ms.length && (c.criadoEm || '').slice(0, 10) < ini) return;
      linhas.push(csvLinha([
        c.nome, c.tipo === 'grupo' ? 'grupo' : telExibicao(c.telefone), c.tipo,
        nomesDept(c), nomeDoPerfil(c.responsavel), statusAtendInfo(c.status).label,
        (c.tags || []).join(', '), fmtDateTime(c.criadoEm), fmtDateTime(c.ultimaMsgEm),
        ms.filter(m => m.direcao === 'entrada' && m.tipo !== 'anotacao').length,
        ms.filter(m => m.direcao === 'saida' && m.tipo !== 'anotacao').length,
        ms.filter(m => m.tipo === 'anotacao').length,
        c.arquivada ? 'sim' : 'não'
      ]));
    });
    baixarArquivo(`${ESCRITORIO.arquivo}-chat-conversas-${todayISO()}.csv`, linhas.join('\n'), 'text/csv;charset=utf-8');
    UI.toast('Relatório de conversas baixado.');
  };
  A.relMensagens = () => {
    const { ini, convs } = relFiltro();
    const ids = new Set(convs.map(c => c.id));
    const linhas = [csvLinha(['Data/Hora', 'Conversa', 'Direção', 'Quem', 'Tipo', 'Conteúdo', 'Transcrição', 'Status'])];
    state.mensagens
      .filter(m => ids.has(m.conversaId) && (m.criadoEm || '').slice(0, 10) >= ini)
      .sort((a, b) => (a.criadoEm || '').localeCompare(b.criadoEm || ''))
      .forEach(m => {
        const c = getConversa(m.conversaId);
        const quem = m.tipo === 'anotacao' ? (nomeDoPerfil(m.autor) || 'Equipe') + ' (anotação)' :
          m.direcao === 'saida' ? (nomeDoPerfil(m.autor) || 'Atendente') : (m.remetente || (c ? c.nome : ''));
        linhas.push(csvLinha([
          fmtDateTime(m.criadoEm), c ? c.nome : '', m.direcao === 'saida' ? 'enviada' : 'recebida',
          quem, m.tipo, m.tipo === 'texto' || m.tipo === 'anotacao' ? m.texto : previaDeMidia(m) + (m.texto ? ' — ' + m.texto : ''),
          m.transcricao || '', m.status
        ]));
      });
    baixarArquivo(`${ESCRITORIO.arquivo}-chat-mensagens-${todayISO()}.csv`, linhas.join('\n'), 'text/csv;charset=utf-8');
    UI.toast('Relatório de mensagens baixado.');
  };
  A.relAtendentes = () => {
    const { ini, convs } = relFiltro();
    const ids = new Set(convs.map(c => c.id));
    const por = {};
    const garante = n => por[n] = por[n] || { msgs: 0, notas: 0, convs: 0 };
    state.mensagens.filter(m => ids.has(m.conversaId) && (m.criadoEm || '').slice(0, 10) >= ini && m.direcao === 'saida').forEach(m => {
      const n = nomeDoPerfil(m.autor) || 'Sem identificação';
      if (m.tipo === 'anotacao') garante(n).notas++; else garante(n).msgs++;
    });
    convs.forEach(c => { if (c.responsavel) garante(nomeDoPerfil(c.responsavel) || '?').convs++; });
    const linhas = [csvLinha(['Atendente', 'Mensagens enviadas', 'Anotações internas', 'Conversas sob responsabilidade'])];
    Object.entries(por).sort((a, b) => b[1].msgs - a[1].msgs)
      .forEach(([n, v]) => linhas.push(csvLinha([n, v.msgs, v.notas, v.convs])));
    baixarArquivo(`${ESCRITORIO.arquivo}-chat-atendentes-${todayISO()}.csv`, linhas.join('\n'), 'text/csv;charset=utf-8');
    UI.toast('Relatório de produtividade baixado.');
  };

  /* =============================================================
     GANCHOS DO CLOUD (pulso / notificações em tempo quase-real)
  ============================================================= */
  A.aoAtualizar = digitando => {
    if (!document.body.classList.contains('modo-chat')) { UI.atualizarBadges(); return; }
    const modal = document.getElementById('modal-backdrop');
    if (modal && !modal.hidden) return;
    // cirúrgico: as mensagens novas entram sem reconstruir a tela (áudio continua tocando)
    atualizar('rail', 'msgs');
    if (!digitando) atualizar('lista');
  };
  A.aoNotificar = (tipo, dados) => {
    if (tipo === 'mencao') {
      UI.toast(dados.texto || 'Você foi marcado numa anotação');
      som();
      desktopNotif(ESCRITORIO.plataformas.chat + ' — você foi marcado', dados.texto || '');
    } else if (tipo === 'mensagem') {
      const vendo = document.body.classList.contains('modo-chat') && _c.sel === dados.id && !document.hidden;
      if (vendo) return;
      UI.toast('Nova mensagem: ' + (dados.nome || 'conversa') + (dados.ultima_msg ? ' — ' + dados.ultima_msg.slice(0, 60) : ''));
      som();
      desktopNotif(dados.nome || 'Nova mensagem', dados.ultima_msg || '');
    }
  };
  A.aoAtualizarSino = () => {
    if (!document.body.classList.contains('modo-chat')) return;
    atualizar('rail');
    const ae = document.activeElement;
    const digitando = ae && /INPUT|TEXTAREA/.test(ae.tagName);
    if (_c.painel === 'notificacoes' && !digitando) atualizar('lista');
  };

  /* arrastar e soltar arquivo sobre a conversa aberta (só com alçada de mídia e fora do modo anotação) */
  const temArquivos = ev => !!(ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files'));
  const alvoDeDrop = ev => document.body.classList.contains('modo-chat') && _c.sel && _c.painel === 'conversas' &&
    !_c.nota && pode('msg_midia') && !!(ev.target && ev.target.closest && ev.target.closest('.wa-main'));
  let _arrastando = 0;
  const marcarArraste = ligado => { const m = document.querySelector('.wa-main'); if (m) m.classList.toggle('arrastando', ligado); };
  document.addEventListener('dragenter', ev => {
    if (!temArquivos(ev)) return;
    ev.preventDefault();
    if (!alvoDeDrop(ev)) return;
    _arrastando++;
    marcarArraste(true);
  });
  document.addEventListener('dragover', ev => {
    if (!temArquivos(ev)) return;
    ev.preventDefault();   // sem isto o navegador abre o arquivo solto fora da área
    ev.dataTransfer.dropEffect = alvoDeDrop(ev) ? 'copy' : 'none';
  });
  document.addEventListener('dragleave', ev => {
    if (!temArquivos(ev) || !_arrastando) return;
    if (--_arrastando === 0) marcarArraste(false);
  });
  document.addEventListener('drop', ev => {
    if (!temArquivos(ev)) return;
    ev.preventDefault();
    _arrastando = 0;
    marcarArraste(false);
    if (!alvoDeDrop(ev)) return;
    const files = ev.dataTransfer.files;
    if (!files || !files.length) return;
    anexarArquivos(Array.from(files));
  });

  /* fecha menus flutuantes ao clicar fora */
  document.addEventListener('click', e => {
    if (!document.body.classList.contains('modo-chat')) return;
    if (_c.menuDepto && !e.target.closest('.wa-menu-depto') && !e.target.closest('.wa-filtro-depto')) {
      _c.menuDepto = false; atualizar('lista');
    }
    if ((_c.menuMais || _c.menuStatus || _c.menuAnexo || _c.emoji) &&
      !e.target.closest('.wa-menu') && !e.target.closest('.wa-menu-anexo') && !e.target.closest('.wa-emojis') &&
      !e.target.closest('.wa-ico-btn') && !e.target.closest('.wa-status-btn')) {
      _c.menuMais = false; _c.menuStatus = false; _c.menuAnexo = false; _c.emoji = false;
      atualizar('head', 'composer');
    }
  });

  return A;
})();

/* compatibilidade com chamadas antigas (topbar / outras telas) */
Views.atNovaConversa = ChatUI.novaConversa;
window.ChatUI = ChatUI;
