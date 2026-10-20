/* ============ ANALYSIS — motor de análise de atendimentos ============
   Baseado em: SPIN Selling (Neil Rackham), Negocie Como Se Sua Vida
   Dependesse Disso / Never Split the Difference (Chris Voss), As Armas
   da Persuasão (Robert Cialdini), Prospecção Fanática e Objections
   (Jeb Blount), Receita Previsível (Aaron Ross), e estudos de
   speed-to-lead (Lead Response Management Study / InsideSales, HBR).
==================================================================== */

const Analysis = (() => {

  /* ---------- bancos de palavras (PT-BR) ---------- */
  const KW = {
    saudacao: ['bom dia', 'boa tarde', 'boa noite', 'olá', 'ola ', 'oi ', 'oi,', 'oi!', 'tudo bem', 'tudo bom', 'prazer', 'como vai'],
    empatia: ['entendo', 'imagino', 'compreendo', 'faz sentido', 'faz todo sentido', 'deve ser', 'sinto muito', 'fico feliz', 'que bom', 'perfeito', 'ótimo', 'otimo', 'legal', 'bacana', 'com certeza', 'pode ficar tranquil'],
    perguntaAberta: ['como ', 'o que ', 'oque ', 'qual ', 'quais ', 'quando ', 'onde ', 'por que ', 'porque você', 'me conta', 'me conte', 'me fala', 'me fale', 'pode me falar', 'o quanto'],
    spinSituacao: ['atualmente', 'hoje voc', 'hoje como', 'como funciona', 'como vocês fazem', 'como voces fazem', 'como é feito', 'há quanto tempo', 'ha quanto tempo', 'quantos', 'quantas', 'com que frequência', 'quem cuida', 'quem é responsável'],
    spinProblema: ['dificuldade', 'problema', 'desafio', 'incomoda', 'atrapalha', ' dor ', 'preocupa', 'frustra', 'complicado', 'bagunça', 'bagunca', 'atrasado', 'não funciona', 'nao funciona'],
    spinImplicacao: ['impacto', 'custa pra você', 'quanto isso custa', 'o que acontece se', 'se continuar', 'consequência', 'consequencia', 'risco', 'perder', 'perde', 'multa', 'prejuízo', 'prejuizo', 'quanto você deixa'],
    spinNecessidade: ['ajudaria', 'resolveria', 'valeria', 'importante pra você', 'importante para você', 'o que mudaria', 'benefício', 'beneficio', 'imagina se', 'como seria se', 'faria diferença', 'faria diferenca'],
    cta: ['podemos agendar', 'vamos agendar', 'que tal', 'prefere', 'posso te ligar', 'posso ligar', 'vamos marcar', 'te espero', 'fechamos', 'podemos fechar', 'vamos fechar', 'posso enviar', 'te envio', 'faz sentido pra você', 'faz sentido para você', 'quinta às', 'segunda às', 'amanhã às', 'amanha as', 'qual melhor horário', 'qual o melhor horário', 'bora', 'topa'],
    fechamentoPassivo: ['qualquer coisa estou', 'qualquer coisa me chama', 'fico à disposição', 'fico a disposição', 'fico a disposicao', 'estou à disposição', 'estou a disposicao', 'qualquer dúvida', 'qualquer duvida', 'quando quiser me', 'sem compromisso'],
    urgencia: ['vagas', 'até sexta', 'ate sexta', 'últimas', 'ultimas', 'apenas', 'somente até', 'condição especial', 'condicao especial', 'essa semana', 'só até', 'so ate', 'por tempo limitado', 'agenda está fechando', 'restam'],
    provaSocial: ['clientes como', 'nossos clientes', 'casos como o seu', 'resultados', 'depoimento', 'assim como a', 'assim como o', 'reduziram', 'aumentaram', 'já ajudamos', 'ja ajudamos', 'mais de'],
    valor: ['benefício', 'beneficio', 'resultado', 'retorno', 'economia', 'economizar', 'ganho', 'resolver', 'solução', 'solucao', 'garantia', 'acompanhamento', 'reduzir', 'aumentar', 'proteger', 'segurança', 'seguranca', 'tranquilidade'],
    vosCalibrada: ['o que exatamente', 'como posso', 'o que ainda não ficou', 'o que ainda nao ficou', 'o que te impede', 'como podemos', 'o que precisaria acontecer', 'o que falta pra', 'o que falta para', 'como você imagina', 'qual parte'],
    preco: ['r$', 'reais', 'investimento é', 'investimento de', 'valor é', 'valor de', 'custa', 'mensalidade', '/mês', '/mes', 'por mês', 'por mes', 'à vista', 'a vista', 'parcela']
  };

  const OBJECOES = [
    { tipo: 'preco', rotulo: 'Preço / Valor', kws: ['caro', 'valor alto', 'muito alto', 'não tenho dinheiro', 'nao tenho dinheiro', 'sem condições', 'sem condicoes', 'orçamento apertado', 'orcamento apertado', 'desconto', 'mais barato', 'não cabe', 'nao cabe', 'fora do orçamento', 'fora do orcamento'] },
    { tipo: 'tempo', rotulo: 'Adiamento ("vou pensar")', kws: ['vou pensar', 'preciso pensar', 'depois eu vejo', 'mais pra frente', 'mais para frente', 'agora não', 'agora nao', 'sem tempo', 'depois te falo', 'te falo depois', 'semana que vem eu', 'mês que vem', 'mes que vem', 'te aviso', 'qualquer coisa te chamo', 'vou analisar', 'vou avaliar'] },
    { tipo: 'autoridade', rotulo: 'Decisor ausente', kws: ['conversar com', 'ver com meu', 'ver com minha', 'meu sócio', 'meu socio', 'minha sócia', 'meu marido', 'minha esposa', 'meu chefe', 'a diretoria', 'consultar', 'não decido sozinho', 'nao decido sozinho', 'preciso ver com'] },
    { tipo: 'confianca', rotulo: 'Desconfiança / Risco', kws: ['não conheço', 'nao conheco', 'funciona mesmo', 'será que funciona', 'sera que funciona', 'garantia', 'medo', 'receio', 'golpe', 'confiar', 'nunca ouvi falar', 'já fui enganado', 'ja fui enganado'] },
    { tipo: 'concorrencia', rotulo: 'Concorrência / Já possui', kws: ['já tenho', 'ja tenho', 'já trabalho com', 'ja trabalho com', 'outra empresa', 'outro fornecedor', 'outro advogado', 'outro escritório', 'outro escritorio', 'cotando', 'outros orçamentos', 'outros orcamentos', 'pesquisando outras'] }
  ];

  const SINAIS_COMPRA = ['quanto custa', 'qual o valor', 'qual valor', 'qual o preço', 'qual o preco', 'preço', 'formas de pagamento', 'como pago', 'parcel', 'quando começa', 'quando comeca', 'como funciona o processo', 'contrato', 'quero contratar', 'quero fechar', 'vamos fechar', 'me manda', 'pode ser', 'funciona pra mim', 'gostei', 'faz sentido', 'me interessou', 'interessante', 'ajudaria demais', 'preciso disso', 'prazo de entrega', 'quando podemos começar', 'quando podemos comecar'];

  const CAPITULACAO = ['tudo bem, qualquer coisa', 'ok, qualquer coisa', 'sem problemas, me avisa', 'tranquilo, me chama', 'ok então', 'ok entao', 'tudo bem então', 'tudo bem entao', 'fico no aguardo então', 'beleza, me avisa'];

  /* ---------- parser de conversa ---------- */

  // formatos aceitos:
  // [dd/mm/aaaa hh:mm] Nome: msg   |   dd/mm/aaaa hh:mm - Nome: msg   |   Nome: msg
  const RE_WA1 = /^\[?(\d{1,2}\/\d{1,2}\/\d{2,4})[,\s]+(\d{1,2}:\d{2})(?::\d{2})?\]?\s*[-–—]?\s*([^:]{1,45}):\s?(.*)$/;
  const RE_SIMPLE = /^([^:]{1,45}):\s?(.*)$/;

  function parse(texto) {
    const linhas = String(texto || '').split(/\r?\n/);
    const msgs = [];
    for (const linha of linhas) {
      const l = linha.trim();
      if (!l) continue;
      let m = l.match(RE_WA1);
      if (m) {
        msgs.push({ quem: m[3].trim(), texto: m[4] || '', data: m[1], hora: m[2] });
        continue;
      }
      m = l.match(RE_SIMPLE);
      // evita tratar "10:30" ou URLs como falante
      if (m && !/^\d+$/.test(m[1].trim()) && !/https?$/.test(m[1].trim())) {
        msgs.push({ quem: m[1].trim(), texto: m[2] || '' });
        continue;
      }
      if (msgs.length) msgs[msgs.length - 1].texto += '\n' + l;
    }
    const participantes = [...new Set(msgs.map(m => m.quem))].filter(p => !/^(mensagens e ligações|as mensagens)/i.test(p));
    return { msgs: msgs.filter(m => participantes.includes(m.quem)), participantes };
  }

  function chutarAtendente(participantes) {
    const nomeCfg = primeiroNome(state.settings.nomeAtendente).toLowerCase();
    const empresa = (state.settings.empresa || '').toLowerCase();
    for (const p of participantes) {
      const pl = p.toLowerCase();
      if (/(atendente|vendedor|consultor|comercial|equipe|suporte|você|voce|eu)/.test(pl)) return p;
      if (nomeCfg && pl.includes(nomeCfg)) return p;
      if (empresa && pl.includes(empresa)) return p;
    }
    return participantes[0] || '';
  }

  /* ---------- helpers de detecção ---------- */
  const low = s => ' ' + String(s || '').toLowerCase() + ' ';
  const temKw = (texto, lista) => { const t = low(texto); return lista.some(k => t.includes(k)); };
  const acharKw = (texto, lista) => { const t = low(texto); return lista.filter(k => t.includes(k)); };
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const trecho = (s, max = 110) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > max ? s.slice(0, max) + '…' : s; };

  /* ---------- análise principal ---------- */

  function analyze(texto, opts = {}) {
    const { msgs, participantes } = parse(texto);
    const atendente = opts.atendente || chutarAtendente(participantes);
    const msgsA = msgs.filter(m => m.quem === atendente);
    const msgsL = msgs.filter(m => m.quem !== atendente);
    const nomeLead = opts.nomeLead || (participantes.find(p => p !== atendente) || 'Lead');
    const textoA = msgsA.map(m => m.texto).join('\n');
    const findings = [];
    const add = (dim, tipo, texto, ref) => findings.push({ dim, tipo, texto, ref });

    /* ----- estatísticas base ----- */
    const palavras = arr => arr.reduce((s, m) => s + m.texto.split(/\s+/).length, 0);
    const stats = {
      totalMsgs: msgs.length,
      msgsAtendente: msgsA.length,
      msgsLead: msgsL.length,
      palavrasAtendente: palavras(msgsA),
      palavrasLead: palavras(msgsL),
      perguntasAtendente: msgsA.filter(m => m.texto.includes('?')).length,
      ultimoAutor: msgs.length ? (msgs[msgs.length - 1].quem === atendente ? 'atendente' : 'lead') : null
    };
    // maior sequência de mensagens seguidas do atendente
    let seq = 0, maxSeq = 0;
    msgs.forEach(m => { if (m.quem === atendente) { seq++; maxSeq = Math.max(maxSeq, seq); } else seq = 0; });
    stats.maxSequenciaAtendente = maxSeq;

    /* ===== 1. CONEXÃO & RAPPORT ===== */
    let conexao = 40;
    const primeirasA = msgsA.slice(0, 2).map(m => m.texto).join(' ');
    if (temKw(primeirasA, KW.saudacao)) {
      conexao += 20;
      add('conexao', 'ok', 'Abertura com saudação e quebra-gelo — cria receptividade antes de vender.', 'Como Fazer Amigos e Influenciar Pessoas — Dale Carnegie');
    } else if (msgsA.length) {
      conexao -= 15;
      add('conexao', 'alerta', 'A conversa começou sem saudação/quebra-gelo. Abrir direto no assunto reduz a receptividade do lead.', 'Dale Carnegie');
    }
    const nomeLeadPrim = primeiroNome(nomeLead).toLowerCase();
    const usosNome = nomeLeadPrim && nomeLeadPrim.length > 2 ? (textoA.toLowerCase().match(new RegExp('\\b' + nomeLeadPrim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g')) || []).length : 0;
    if (usosNome >= 2) {
      conexao += 20;
      add('conexao', 'ok', `O atendente usou o nome do lead ${usosNome}x — "o nome de uma pessoa é o som mais doce que ela conhece".`, 'Dale Carnegie');
    } else if (msgsA.length >= 3) {
      conexao -= 5;
      add('conexao', 'alerta', 'O nome do lead quase não foi usado. Personalizar com o nome aumenta conexão e atenção.', 'Dale Carnegie');
    }
    const empatias = acharKw(textoA, KW.empatia).length;
    if (empatias >= 2) {
      conexao += 20;
      add('conexao', 'ok', 'Uso consistente de validação emocional ("entendo", "faz sentido") — empatia tática mantém o lead aberto.', 'Never Split the Difference — Chris Voss');
    } else if (msgsL.length >= 2) {
      conexao -= 5;
      add('conexao', 'alerta', 'Pouca validação emocional. Rotular o sentimento do lead ("imagino que isso preocupe...") derruba resistências.', 'Chris Voss (rotulação)');
    }

    /* ===== 2. INVESTIGAÇÃO (SPIN) ===== */
    let investigacao = 20;
    const spin = {
      situacao: msgsA.filter(m => temKw(m.texto, KW.spinSituacao) && m.texto.includes('?')).length,
      problema: msgsA.filter(m => temKw(m.texto, KW.spinProblema)).length,
      implicacao: msgsA.filter(m => temKw(m.texto, KW.spinImplicacao)).length,
      necessidade: msgsA.filter(m => temKw(m.texto, KW.spinNecessidade)).length
    };
    const perguntasAbertas = msgsA.filter(m => m.texto.includes('?') && temKw(m.texto, KW.perguntaAberta)).length;
    if (stats.perguntasAtendente >= 3) { investigacao += 20; }
    else if (stats.perguntasAtendente <= 1 && msgsA.length >= 3) {
      add('investigacao', 'erro', `Apenas ${stats.perguntasAtendente} pergunta(s) feita(s). Quem pergunta conduz: vendedores de alta performance fazem diagnóstico antes de apresentar solução.`, 'SPIN Selling — Neil Rackham');
    }
    if (perguntasAbertas >= 2) {
      investigacao += 15;
      add('investigacao', 'ok', `${perguntasAbertas} pergunta(s) aberta(s) ("como", "o que", "qual") — extraem muito mais informação que perguntas de sim/não.`, 'SPIN Selling');
    }
    if (spin.situacao) { investigacao += 10; add('investigacao', 'ok', 'Perguntas de Situação identificadas (contexto atual do lead).', 'SPIN Selling — Situação'); }
    if (spin.problema) { investigacao += 12; add('investigacao', 'ok', 'A dor/problema do lead foi explorada explicitamente.', 'SPIN Selling — Problema'); }
    if (spin.implicacao) { investigacao += 15; add('investigacao', 'ok', 'Perguntas de Implicação (custo de não resolver) — é o que separa vendedores medianos dos de elite.', 'SPIN Selling — Implicação'); }
    else if (spin.problema) { add('investigacao', 'alerta', 'A dor apareceu, mas faltou ampliá-la: "o que acontece se isso continuar?". Implicação gera senso de urgência genuíno.', 'SPIN Selling — Implicação'); }
    if (spin.necessidade) { investigacao += 13; add('investigacao', 'ok', 'Perguntas de Necessidade de Solução ("isso ajudaria?") — fazem o próprio lead verbalizar o valor.', 'SPIN Selling — Need-payoff'); }

    /* ===== 3. APRESENTAÇÃO DE VALOR ===== */
    let valor = 40;
    const kwValor = acharKw(textoA, KW.valor).length;
    const usouProva = temKw(textoA, KW.provaSocial);
    const falouPreco = temKw(textoA, KW.preco);
    if (kwValor >= 3) { valor += 20; add('valor', 'ok', 'Discurso orientado a resultado/benefício, não só a características do serviço.', 'SPIN Selling / Challenger Sale'); }
    else if (falouPreco) { valor -= 10; add('valor', 'alerta', 'O preço apareceu com pouca construção de valor antes. Preço sem valor ancorado sempre parece caro.', 'As Armas da Persuasão — Cialdini (ancoragem)'); }
    if (usouProva) { valor += 20; add('valor', 'ok', 'Prova social utilizada (casos/resultados de clientes) — um dos gatilhos mais poderosos de persuasão.', 'Cialdini — Prova Social'); }
    else if (falouPreco) { add('valor', 'alerta', 'Nenhuma prova social antes do preço. Cite um caso/resultado concreto para justificar o investimento.', 'Cialdini — Prova Social'); }
    if (falouPreco) {
      // preço veio antes de diagnóstico?
      const idxPreco = msgs.findIndex(m => m.quem === atendente && temKw(m.texto, KW.preco));
      const perguntasAntes = msgs.slice(0, idxPreco).filter(m => m.quem === atendente && m.texto.includes('?')).length;
      if (perguntasAntes >= 2) { valor += 15; add('valor', 'ok', 'O preço só foi apresentado após diagnóstico — sequência correta: dor → valor → preço.', 'SPIN Selling'); }
      else { valor -= 10; add('valor', 'erro', 'Preço apresentado cedo demais, antes de diagnóstico suficiente. O lead compara preço, não valor.', 'SPIN Selling'); }
    }

    /* ===== 4. OBJEÇÕES ===== */
    const objecoesDetectadas = [];
    msgsL.forEach((m, i) => {
      OBJECOES.forEach(o => {
        if (temKw(m.texto, o.kws)) {
          const idxGlobal = msgs.indexOf(m);
          const respostas = msgs.slice(idxGlobal + 1).filter(x => x.quem === atendente).slice(0, 2);
          const respTexto = respostas.map(r => r.texto).join(' ');
          const tratada = respostas.length > 0 && (
            respTexto.includes('?') || temKw(respTexto, KW.vosCalibrada) || temKw(respTexto, KW.provaSocial) || temKw(respTexto, KW.cta)
          ) && !temKw(respTexto, CAPITULACAO);
          if (!objecoesDetectadas.some(x => x.tipo === o.tipo && x.trecho === trecho(m.texto))) {
            objecoesDetectadas.push({ tipo: o.tipo, rotulo: o.rotulo, trecho: trecho(m.texto), tratada });
          }
        }
      });
    });
    let objecoes = objecoesDetectadas.length ? 30 : 65;
    objecoesDetectadas.forEach(o => {
      if (o.tratada) {
        objecoes += Math.round(50 / objecoesDetectadas.length);
        add('objecoes', 'ok', `Objeção de ${o.rotulo} ("${o.trecho}") foi contornada com pergunta/reenquadramento em vez de aceitação passiva.`, 'Objections — Jeb Blount / Chris Voss');
      } else {
        objecoes -= 5;
        add('objecoes', 'erro', `Objeção de ${o.rotulo} ("${o.trecho}") ficou sem tratamento. Nunca aceite a objeção de primeira: isole-a e responda com pergunta calibrada.`, 'Objections — Jeb Blount');
      }
    });
    if (!objecoesDetectadas.length && msgsL.length >= 2) {
      add('objecoes', 'ok', 'Nenhuma objeção explícita detectada nesta conversa.', null);
    }
    if (temKw(textoA, CAPITULACAO)) {
      objecoes -= 15;
      add('objecoes', 'erro', 'Detectada capitulação ("tudo bem, qualquer coisa me chama") — isso entrega o controle da venda ao lead.', 'Prospecção Fanática — Jeb Blount');
    }
    const usouCalibrada = msgsA.some(m => temKw(m.texto, KW.vosCalibrada));
    if (usouCalibrada) { objecoes += 10; add('objecoes', 'ok', 'Uso de pergunta calibrada ("o que exatamente...?", "como...?") — técnica de Voss para destravar resistência.', 'Chris Voss — perguntas calibradas'); }

    /* ===== 5. FECHAMENTO & CTA ===== */
    let fechamento = 30;
    const ultimaA = msgsA.length ? msgsA[msgsA.length - 1].texto : '';
    const ctas = msgsA.filter(m => temKw(m.texto, KW.cta)).length;
    const propostaAgenda = /\b(agendar|marcar|reuni[ãa]o|call|convite|hor[áa]rio|às \d|as \d{1,2}h)\b/i.test(textoA);
    if (ctas >= 1) { fechamento += 20; add('fechamento', 'ok', `${ctas} chamada(s) para ação identificada(s) — o atendente pediu o próximo passo.`, 'The Lost Art of Closing — Anthony Iannarino'); }
    else { add('fechamento', 'erro', 'Nenhuma chamada para ação clara. Toda conversa comercial deve terminar com um próximo passo definido (data, hora, compromisso).', 'Anthony Iannarino'); }
    if (propostaAgenda) { fechamento += 20; add('fechamento', 'ok', 'Foi proposto um compromisso concreto (agenda/horário) — o avanço ficou amarrado.', null); }
    if (temKw(ultimaA, KW.fechamentoPassivo)) {
      fechamento -= 20;
      add('fechamento', 'erro', 'A conversa terminou com fechamento passivo ("fico à disposição"). Isso transfere a iniciativa para o lead — e lead ocupado não volta.', 'Prospecção Fanática — Jeb Blount');
    } else if (ultimaA.includes('?') || temKw(ultimaA, KW.cta)) {
      fechamento += 15;
      add('fechamento', 'ok', 'A última mensagem do atendente termina com pergunta/CTA — mantém a bola com o lead e a conversa viva.', null);
    }
    const usouUrgencia = temKw(textoA, KW.urgencia);
    if (usouUrgencia) { fechamento += 10; add('fechamento', 'ok', 'Gatilho de escassez/urgência utilizado.', 'Cialdini — Escassez'); }

    /* ===== 6. CONDUÇÃO DA CONVERSA ===== */
    let conducao = 60;
    const ratio = stats.palavrasLead ? stats.palavrasAtendente / stats.palavrasLead : 99;
    if (ratio > 3) {
      conducao -= 20;
      add('conducao', 'alerta', 'O atendente falou muito mais que o lead (monólogo). Na venda consultiva, o lead deve falar mais — quem fala demais não escuta a dor.', 'SPIN Selling');
    } else if (ratio >= 0.8 && ratio <= 2.2) {
      conducao += 15;
      add('conducao', 'ok', 'Bom equilíbrio de participação entre atendente e lead.', null);
    }
    if (stats.maxSequenciaAtendente >= 4) {
      conducao -= 15;
      add('conducao', 'alerta', `${stats.maxSequenciaAtendente} mensagens seguidas do atendente sem resposta — metralhadora de texto afasta o lead. Prefira mensagens curtas + pergunta.`, null);
    }
    const mediaP = msgsA.length ? stats.palavrasAtendente / msgsA.length : 0;
    if (mediaP > 80) {
      conducao -= 10;
      add('conducao', 'alerta', 'Mensagens muito longas (média > 80 palavras). Em WhatsApp, blocos de texto enormes não são lidos.', null);
    }
    if (stats.ultimoAutor === 'atendente' && msgsL.length) {
      add('conducao', 'alerta', 'A última mensagem é do atendente e ainda não foi respondida — agende um follow-up (80% das vendas exigem 5+ contatos).', 'Estudo IRC Sales Solutions / Jeb Blount');
    }

    /* ---------- sinais de compra ---------- */
    const sinais = [];
    msgsL.forEach(m => {
      const achados = acharKw(m.texto, SINAIS_COMPRA);
      if (achados.length) sinais.push({ trecho: trecho(m.texto), kws: achados });
    });

    /* ---------- scores ---------- */
    const scores = {
      conexao: clamp(Math.round(conexao), 0, 100),
      investigacao: clamp(Math.round(investigacao), 0, 100),
      valor: clamp(Math.round(valor), 0, 100),
      objecoes: clamp(Math.round(objecoes), 0, 100),
      fechamento: clamp(Math.round(fechamento), 0, 100),
      conducao: clamp(Math.round(conducao), 0, 100)
    };
    scores.geral = Math.round(
      scores.conexao * .15 + scores.investigacao * .20 + scores.valor * .15 +
      scores.objecoes * .20 + scores.fechamento * .20 + scores.conducao * .10
    );

    /* ---------- temperatura & etapa sugerida ---------- */
    let temperatura = 'Morno';
    if (sinais.length >= 2 || /quero (contratar|fechar)|vamos fechar|pode ser/i.test(msgsL.map(m => m.texto).join(' '))) temperatura = 'Quente';
    if (!sinais.length && (objecoesDetectadas.some(o => o.tipo === 'tempo') || stats.msgsLead <= 1)) temperatura = 'Frio';
    if (sinais.length >= 1 && objecoesDetectadas.every(o => o.tratada)) temperatura = 'Quente';

    let etapaSugerida = 'Contato Feito';
    if (spin.problema || spin.necessidade) etapaSugerida = 'Qualificado';
    if (falouPreco) etapaSugerida = 'Proposta Enviada';
    if (falouPreco && objecoesDetectadas.length) etapaSugerida = 'Negociação';

    /* ---------- cenário, cadência e respostas sugeridas ---------- */
    const objNaoTratada = objecoesDetectadas.find(o => !o.tratada) || objecoesDetectadas[objecoesDetectadas.length - 1];
    let cenario, cadenciaSugerida;
    if (stats.ultimoAutor === 'atendente' && !sinais.length && !objecoesDetectadas.length) {
      cenario = 'sem_resposta'; cadenciaSugerida = 'speed-to-lead';
    } else if (objNaoTratada && objNaoTratada.tipo === 'tempo') {
      cenario = 'objecao_tempo'; cadenciaSugerida = 'vou-pensar';
    } else if (falouPreco) {
      cenario = objNaoTratada ? 'objecao_' + objNaoTratada.tipo : (sinais.length ? 'sinal_compra' : 'pos_proposta');
      cadenciaSugerida = 'pos-proposta';
    } else if (objNaoTratada) {
      cenario = 'objecao_' + objNaoTratada.tipo; cadenciaSugerida = 'vou-pensar';
    } else if (sinais.length) {
      cenario = 'sinal_compra'; cadenciaSugerida = 'pos-proposta';
    } else {
      cenario = 'diagnostico'; cadenciaSugerida = 'speed-to-lead';
    }

    const respostas = sugerirRespostas(cenario, objecoesDetectadas, nomeLead);
    const proximosPassos = montarProximosPassos(cenario, objecoesDetectadas, sinais, stats, temperatura);

    return {
      id: uid(),
      leadId: opts.leadId || null,
      criadoEm: new Date().toISOString(),
      atendente, nomeLead, participantes,
      conversaTexto: texto,
      msgs, stats, spin, scores, findings,
      objecoes: objecoesDetectadas, sinais,
      temperatura, etapaSugerida, cenario, cadenciaSugerida,
      respostas, proximosPassos,
      ai: null
    };
  }

  /* ---------- respostas sugeridas por cenário ---------- */

  const RESPOSTAS = {
    objecao_preco: [
      {
        titulo: 'Reancorar no custo de não resolver',
        ref: 'SPIN Selling (Implicação) + Cialdini (ancoragem)',
        texto: `Entendo perfeitamente, {{nome}} — investimento é uma decisão séria. 🙂\nMe deixa te fazer uma pergunta: quanto está custando pra você deixar isso como está hoje? (prazos perdidos, retrabalho, risco...)\nQuando a gente coloca na ponta do lápis, geralmente o problema custa mais caro que a solução. Posso te mostrar essa conta?`
      },
      {
        titulo: 'Isolar a objeção (é só o preço?)',
        ref: 'Objections — Jeb Blount',
        texto: `{{nome}}, só pra eu entender direitinho: se o investimento coubesse no seu orçamento hoje, a solução em si faz sentido pra você?\nPergunto porque, se for só uma questão de formato, consigo ver condições de pagamento que se encaixem melhor.`
      }
    ],
    objecao_tempo: [
      {
        titulo: 'Pergunta calibrada para destravar',
        ref: 'Never Split the Difference — Chris Voss',
        texto: `Claro, {{nome}}! Decisão boa é decisão pensada. 😉\nSó pra eu te ajudar melhor: o que exatamente você ainda precisa avaliar? É o valor, o formato ou o momento?\nAssim eu já te trago a resposta certa em vez de te deixar com dúvida.`
      },
      {
        titulo: 'Compromisso com data (não deixar solto)',
        ref: 'The Lost Art of Closing — Anthony Iannarino',
        texto: `Perfeito, {{nome}}. Faço assim: te chamo na quinta pra gente fechar essa conversa, pode ser?\nSe até lá surgir qualquer dúvida, me manda aqui que respondo na hora. Combinado?`
      }
    ],
    objecao_autoridade: [
      {
        titulo: 'Incluir o decisor na conversa',
        ref: 'SPIN Selling / Jeb Blount',
        texto: `Faz todo sentido envolver {{nome}} — decisão a dois tem que ser alinhada. 👍\nPra facilitar: que tal uma conversa rápida de 15 minutos com vocês dois? Assim a outra pessoa tira as dúvidas direto comigo e você não precisa "revender" a ideia sozinho(a). Amanhã às 10h ou 16h, qual fica melhor?`
      },
      {
        titulo: 'Munir o lead para vender internamente',
        ref: 'Challenger Sale',
        texto: `Perfeito, {{nome}}! Pra te ajudar nessa conversa, vou te mandar um resumo em 3 pontos: o problema que resolvemos, o resultado esperado e o investimento.\nAssim fica fácil apresentar. Te envio agora e amanhã te chamo pra saber como foi, fechado?`
      }
    ],
    objecao_confianca: [
      {
        titulo: 'Prova social + redução de risco',
        ref: 'Cialdini — Prova Social e Autoridade',
        texto: `Sua cautela faz total sentido, {{nome}} — e é exatamente por isso que trabalho com transparência total.\nTe mando 2 casos de clientes com situação parecida com a sua e o resultado que tiveram? Além disso, nosso contrato prevê [garantia/condição de saída], então o risco fica do nosso lado, não do seu.`
      }
    ],
    objecao_concorrencia: [
      {
        titulo: 'Diferenciar sem atacar',
        ref: 'Challenger Sale — ensinar algo novo',
        texto: `Que bom que você já está cuidando disso, {{nome}}! 👏\nMe conta: o que você mais valoriza no serviço atual? E o que sente que poderia ser melhor?\nPergunto porque muitos clientes chegaram até nós exatamente pelo [diferencial], e vale a pena você comparar antes de decidir.`
      }
    ],
    sinal_compra: [
      {
        titulo: 'Fechamento direto com agenda',
        ref: 'Anthony Iannarino — pedir o compromisso',
        texto: `Que ótimo, {{nome}}! Então vamos deixar isso resolvido pra você. 🚀\nConsigo iniciar seu atendimento ainda esta semana. Me confirma dois pontos: [dado necessário 1] e [dado necessário 2]?\nTe mando o contrato hoje e amanhã já damos o primeiro passo. Fechado?`
      },
      {
        titulo: 'Fechamento por alternativa',
        ref: 'Técnica clássica de fechamento',
        texto: `Perfeito, {{nome}}! Pra gente começar: prefere assinar com pagamento à vista (com desconto) ou parcelado?\nQualquer uma das opções, já garanto seu início pra esta semana.`
      }
    ],
    sem_resposta: [
      {
        titulo: 'Follow-up com valor (não cobrança)',
        ref: 'Prospecção Fanática — Jeb Blount',
        texto: `Oi {{nome}}, tudo bem? 🙂\nLembrei de você porque [novidade/conteúdo/caso relacionado à dor do lead].\nAquela questão que conversamos continua no seu radar? Se quiser, retomo de onde paramos — sem compromisso.`
      },
      {
        titulo: 'Pergunta de direção (Voss)',
        ref: 'Chris Voss — pergunta orientada ao "não"',
        texto: `{{nome}}, você desistiu de resolver [dor/problema]?\n(Essa pergunta costuma reativar 30-40% dos leads sumidos — é fácil responder "não, não desisti", e a conversa volta.)`
      }
    ],
    pos_proposta: [
      {
        titulo: 'Acompanhamento consultivo da proposta',
        ref: 'Jeb Blount — follow-up estruturado',
        texto: `Oi {{nome}}! Passando pra saber o que achou da proposta. 🙂\nFicou alguma dúvida sobre o escopo ou o investimento? Me fala com sinceridade — se algo não encaixou, eu ajusto o desenho contigo.`
      }
    ],
    diagnostico: [
      {
        titulo: 'Aprofundar o diagnóstico (SPIN)',
        ref: 'SPIN Selling — Problema e Implicação',
        texto: `{{nome}}, me conta uma coisa: hoje, o que mais te incomoda em relação a [tema]?\nE se isso continuar do jeito que está pelos próximos 6 meses, qual o impacto pra você/sua empresa?`
      }
    ]
  };

  function sugerirRespostas(cenario, objecoesDetectadas, nomeLead) {
    const out = [];
    const push = key => (RESPOSTAS[key] || []).forEach(r => out.push({ ...r }));
    push(cenario);
    // acrescenta respostas para outras objeções não tratadas
    objecoesDetectadas.filter(o => !o.tratada).forEach(o => {
      const key = 'objecao_' + o.tipo;
      if (key !== cenario) push(key);
    });
    if (!out.length) push('diagnostico');
    return out.slice(0, 4);
  }

  function montarProximosPassos(cenario, objs, sinais, stats, temperatura) {
    const passos = [];
    if (cenario === 'sem_resposta') passos.push('Lead sem resposta: envie o follow-up sugerido HOJE e aplique a cadência "Lead Novo" — falar em até 5 min multiplica a conversão em até 21x, e cada dia parado esfria o lead.');
    if (cenario === 'sinal_compra') passos.push('Sinal de compra claro! Não espere: proponha o fechamento com data e próximo passo concreto ainda hoje.');
    if (objs.some(o => o.tipo === 'tempo' && !o.tratada)) passos.push('Objeção "vou pensar" em aberto: use a pergunta calibrada sugerida e agende um retorno com data marcada.');
    if (objs.some(o => o.tipo === 'autoridade')) passos.push('Há um decisor ausente: proponha reunião com todos os decisores juntos — nunca deixe o lead "revender" sozinho.');
    if (objs.some(o => o.tipo === 'preco' && !o.tratada)) passos.push('Objeção de preço sem tratamento: reancorar no custo do problema antes de falar de desconto.');
    if (stats.perguntasAtendente <= 1) passos.push('No próximo contato, faça mais perguntas (SPIN): situação → problema → implicação → necessidade.');
    if (temperatura === 'Quente') passos.push('Lead QUENTE: prioridade máxima da sua agenda. Follow-up em no máximo 24h.');
    if (temperatura === 'Frio') passos.push('Lead frio: entre na cadência de reaquecimento com toques de valor (conteúdo, casos), sem pressão de venda.');
    if (!passos.length) passos.push('Mantenha a cadência de follow-ups ativa e registre a próxima interação.');
    return passos;
  }

  function labelDim(d) {
    return {
      conexao: 'Conexão & Rapport', investigacao: 'Investigação (SPIN)', valor: 'Apresentação de Valor',
      objecoes: 'Contorno de Objeções', fechamento: 'Fechamento & CTA', conducao: 'Condução da Conversa'
    }[d] || d;
  }

  function labelScore(n) {
    if (n >= 80) return { label: 'Excelente', cls: 'green' };
    if (n >= 60) return { label: 'Bom', cls: 'cyan' };
    if (n >= 40) return { label: 'Regular', cls: 'amber' };
    return { label: 'Crítico', cls: 'red' };
  }

  return { parse, analyze, chutarAtendente, labelDim, labelScore, RESPOSTAS };
})();
