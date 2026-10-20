/* ============ CSV — importação do CRM, exportação e backup ============ */

const CSV = (() => {

  /* parser robusto: aspas, quebras de linha dentro de campos, ; , ou TAB */
  function detectDelimiter(text) {
    const linha = text.split(/\r?\n/).find(l => l.trim()) || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let inQ = false;
    for (const ch of linha) {
      if (ch === '"') inQ = !inQ;
      else if (!inQ && counts[ch] != null) counts[ch]++;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ',';
  }

  function parse(text) {
    text = String(text || '').replace(/^﻿/, ''); // remove BOM
    const delim = detectDelimiter(text);
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === delim) { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
          if (c === '\r' && text[i + 1] === '\n') i++;
          row.push(field); field = '';
          if (row.some(f => f.trim() !== '')) rows.push(row);
          row = [];
        } else field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); if (row.some(f => f.trim() !== '')) rows.push(row); }
    if (!rows.length) return { headers: [], rows: [] };
    const headers = rows[0].map(h => h.trim());
    return { headers, rows: rows.slice(1) };
  }

  /* campos do sistema disponíveis para mapeamento */
  const CAMPOS = [
    { id: '', label: '— Ignorar coluna —' },
    { id: 'nome', label: 'Nome' },
    { id: 'link', label: 'Link da conversa (chat)' },
    { id: 'telefone', label: 'Telefone / WhatsApp' },
    { id: 'email', label: 'E-mail' },
    { id: 'empresa', label: 'Empresa' },
    { id: 'tags', label: 'Tags' },
    { id: 'origem', label: 'Origem / Fonte' },
    { id: 'area', label: 'Área do caso' },
    { id: 'perfil', label: 'Perfil (A/B/C)' },
    { id: 'etapa', label: 'Etapa do funil' },
    { id: 'temperatura', label: 'Temperatura' },
    { id: 'valor', label: 'Valor (R$)' },
    { id: 'dor', label: 'Dor / Interesse' },
    { id: 'numeroProcesso', label: 'Número do processo' },
    { id: 'comarcaVara', label: 'Comarca / Vara' },
    { id: 'prazoLimite', label: 'Prazo limite (data)' },
    { id: 'notas', label: 'Notas / Observações' },
    { id: 'criadoEm', label: 'Data de criação' }
  ];

  const GUESS = [
    [/^(nome|name|cliente|contato|contact|lead)$/i, 'nome'],
    [/nome|name/i, 'nome'],
    [/link|url|conversa|chat/i, 'link'],
    [/^tags?$|etiqueta|marcador|r[óo]tulo/i, 'tags'],
    [/[áa]rea|caso|assunto|categoria/i, 'area'],
    [/^perfil/i, 'perfil'],
    [/processo|autos|\bcnj\b/i, 'numeroProcesso'],
    [/comarca|vara|foro|ju[íi]zo/i, 'comarcaVara'],
    [/prazo|deadline|vencimento/i, 'prazoLimite'],
    [/whats|celular|telefone|phone|fone|mobile|tel\b/i, 'telefone'],
    [/e-?mail/i, 'email'],
    [/empresa|company|organiza/i, 'empresa'],
    [/origem|fonte|source|canal|campanha|utm/i, 'origem'],
    [/etapa|est[áa]gio|stage|status|fase|pipeline/i, 'etapa'],
    [/temperatura|rating|score/i, 'temperatura'],
    [/valor|value|pre[çc]o|amount|ticket|or[çc]amento/i, 'valor'],
    [/dor|necessidade|interesse|assunto|servi[çc]o|produto/i, 'dor'],
    [/nota|obs|coment|descri|detalhe/i, 'notas'],
    [/data|criad|created|date/i, 'criadoEm']
  ];

  function guessMapping(headers) {
    const usado = new Set();
    return headers.map(h => {
      for (const [re, campo] of GUESS) {
        if (re.test(h) && !usado.has(campo)) { usado.add(campo); return campo; }
      }
      return '';
    });
  }

  function normalizarEtapa(v) {
    const s = String(v || '').toLowerCase().trim();
    if (!s) return 'Novo';
    if (/ganh|won|fechad|vendid|cliente/.test(s)) return 'Ganho';
    if (/perd|lost|descart/.test(s)) return 'Perdido';
    if (/negocia/.test(s)) return 'Negociação';
    if (/proposta|or[çc]amento|quote/.test(s)) return 'Proposta Enviada';
    if (/qualific/.test(s)) return 'Qualificado';
    if (/contato|contact|atendimento|andamento/.test(s)) return 'Contato Feito';
    return 'Novo';
  }

  function normalizarTemp(v) {
    const s = String(v || '').toLowerCase();
    if (/quente|hot|alto|high|a\b/.test(s)) return 'Quente';
    if (/frio|cold|baixo|low|c\b/.test(s)) return 'Frio';
    return 'Morno';
  }

  function normalizarData(v) {
    if (!v) return null;
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) {
      const y = m[3].length === 2 ? '20' + m[3] : m[3];
      return new Date(`${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T12:00:00`).toISOString();
    }
    const d = new Date(s);
    return isNaN(d) ? null : d.toISOString();
  }

  /* importa as linhas segundo o mapeamento; retorna {importados, ignorados} */
  function importar(rows, mapping, opts = {}) {
    let importados = 0, ignorados = 0;
    const jaExiste = (tel, email) => state.leads.some(l =>
      (tel && normPhone(l.telefone) === tel) || (email && l.email && l.email.toLowerCase() === email)
    );
    rows.forEach(r => {
      const data = {};
      mapping.forEach((campo, i) => {
        if (campo && r[i] != null && String(r[i]).trim() !== '') data[campo] = String(r[i]).trim();
      });
      if (!data.nome && !data.telefone && !data.email) { ignorados++; return; }
      const tel = normPhone(data.telefone || '');
      const email = (data.email || '').toLowerCase();
      if (opts.dedupe && jaExiste(tel, email)) { ignorados++; return; }
      // inteligência de tags: origem, área do caso e perfil derivados automaticamente
      const tagsArr = parseTags(data.tags);
      const der = derivarDosTags(tagsArr);
      novoLead({
        ...data,
        nome: data.nome || data.email || data.telefone || 'Sem nome',
        etapa: normalizarEtapa(data.etapa),
        temperatura: data.temperatura ? normalizarTemp(data.temperatura) : 'Morno',
        valor: parseMoney(data.valor),
        origem: data.origem || der.origem || '',
        area: data.area || der.area || '',
        perfil: (data.perfil || der.perfil || '').toUpperCase().replace(/[^ABC]/g, '').slice(0, 1),
        numeroProcesso: data.numeroProcesso || '',
        comarcaVara: data.comarcaVara || '',
        prazoLimite: data.prazoLimite ? ((normalizarData(data.prazoLimite) || '').slice(0, 10) || null) : null,
        criadoEm: normalizarData(data.criadoEm) || new Date().toISOString()
      });
      importados++;
    });
    return { importados, ignorados };
  }

  /* ---------- exportação ---------- */

  function baixar(nome, conteudo, tipo) {
    const blob = new Blob([conteudo], { type: tipo || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  /* exporta todos os leads ou apenas um subconjunto (ações em massa) */
  function exportarLeads(subset) {
    const lista = Array.isArray(subset) && subset.length ? subset : state.leads;
    const cab = ['Nome', 'Link', 'Telefone', 'Email', 'Empresa', 'Tags', 'Origem', 'Área', 'Perfil', 'Etapa', 'Temperatura', 'Valor', 'Contratos', 'Total Contratado', 'Dor', 'Número Processo', 'Comarca/Vara', 'Prazo Limite', 'Notas', 'Motivo Perda', 'Criado Em'];
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const linhas = lista.map(l => [
      l.nome, l.link, l.telefone, l.email, l.empresa, (l.tags || []).join(', '), l.origem, l.area, l.perfil, l.etapa, l.temperatura,
      l.valor, (l.contratos || []).map(c => c.servico + ' (' + fmtMoney(valorContrato(c)) + ')').join(' | '), totalContratado(l),
      l.dor, l.numeroProcesso, l.comarcaVara, l.prazoLimite ? fmtDate(l.prazoLimite) : '',
      l.notas, l.motivoPerda, fmtDate(l.criadoEm ? l.criadoEm.slice(0, 10) : '')
    ].map(q).join(';'));
    baixar(ESCRITORIO.arquivo + '-leads-' + todayISO() + '.csv', '﻿' + cab.map(q).join(';') + '\n' + linhas.join('\n'), 'text/csv;charset=utf-8');
  }

  function exportarBackup() {
    // a chave da IA é pessoal deste navegador: não viaja no arquivo
    const copia = Object.assign({}, state, { settings: Object.assign({}, state.settings) });   // a chave da IA não mora mais no navegador
    baixar(ESCRITORIO.arquivo + '-backup-' + todayISO() + '.json', JSON.stringify(copia, null, 2), 'application/json');
  }

  function importarBackup(file, cb) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.leads || !data.settings) throw new Error('Arquivo inválido');
        state = data;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        cb(null);
      } catch (e) { cb(e); }
    };
    reader.readAsText(file);
  }

  return { parse, CAMPOS, guessMapping, importar, exportarLeads, exportarBackup, importarBackup, baixar };
})();
