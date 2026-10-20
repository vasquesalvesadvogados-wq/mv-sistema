/* ============================================================
   GRÁFICO DIÁRIO — colunas e linhas com leitura dia a dia (v6.9)

   O buraco que isto fecha: os gráficos de série temporal eram SVG sem
   tooltip — não dava para ler o valor de um dia nem a data exata.

   Duas formas, escolhidas pelo trabalho do dado (RELATORIO.md, "A forma"):
     UI.barChartSVG(items, opts?)           COLUNAS — contagem diária esparsa
                                            (leads por dia: muitos zeros e um pico)
     UI.graficoLinhas(dias, series, opts?)  LINHAS — duas ou mais séries no tempo
                                            (mensagens recebidas × enviadas)

   Leitura, em qualquer entrada:
     · ponteiro: o dia mais próximo "gruda" (snap) e o cartão mostra data e valor
     · toque: tocar mostra e o cartão fica; arrastar na horizontal percorre os
       dias; arrastar na vertical continua rolando a página (touch-action)
     · teclado: Tab foca o gráfico; ← → percorrem os dias, Home/End vão às
       pontas, PageUp/PageDown andam 7 dias, Esc fecha o cartão
     · leitor de tela: o gráfico é um slider (aria-valuetext = "quarta-feira,
       16 de setembro de 2026: 12 leads"), com resumo e tabela ocultos

   Por que nada vaza a cada render (o Dashboard é refeito a cada sync):
     · as views são template strings — os dados viajam no próprio HTML, em
       data-grafico (JSON). Nenhuma referência a elemento sobrevive ao render;
     · os listeners são delegados no document e ligados UMA vez, na carga;
     · UM MutationObserver acha gráficos novos (coleção viva por classe: o custo
       acompanha o número de gráficos, não o tamanho da mutação) e UM
       ResizeObserver redesenha na largura real do card. Gráfico que saiu do
       DOM é desobservado na varredura seguinte;
     · o cartão é UM elemento, filho do body, position:fixed — não é cortado
       pela rolagem do card nem do painel do Chat e fica sempre dentro da tela.
   ============================================================

   porte do componente Chart do Spell UI (https://spell.sh), sem React,
   TypeScript e Tailwind. Licença original:

   MIT License

   Copyright (c) 2025 Spell UI

   Permission is hereby granted, free of charge, to any person obtaining a copy
   of this software and associated documentation files (the "Software"), to deal
   in the Software without restriction, including without limitation the rights
   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   copies of the Software, and to permit persons to whom the Software is
   furnished to do so, subject to the following conditions:

   The above copyright notice and this permission notice shall be included in all
   copies or substantial portions of the Software.

   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   SOFTWARE.
   ============================================================ */

const Grafico = (function () {
  'use strict';

  /* ---------------- geometria ----------------
     Especificações de marca do skill dataviz, em px de CSS. Cor, raio e corpo
     de fonte NÃO moram aqui: vêm dos tokens (medidas() e css/styles.css). */
  const ALTURA_PLOT = 128;      // altura útil das marcas
  const TOPO = 20;              // folga acima: rótulo do pico e topo da escala
  const EIXO_X = 24;            // faixa dos rótulos de data
  const ALTURA = TOPO + ALTURA_PLOT + EIXO_X;
  const COLUNA_MAX = 24;        // coluna nunca passa de 24px: a sobra do dia é ar
  const VAO_MIN = 2;            // vão mínimo entre colunas vizinhas
  const PONTO_FIM = 8;           // ponto de fim de linha (≥ 8px), com anel de 2px
  const AVANCO_MONO = 0.6;      // DM Mono: todo glifo avança 600/1000 em (medido no woff2)
  const LARGURA_NOMINAL = 640;  // desenho antes da primeira medida (largura-base do Chart do Spell UI)
  const MARGEM_TELA = 8;        // o cartão nunca encosta na borda da tela
  const AFASTAMENTO = 10;       // entre a marca e o cartão
  const FOLGA_DEDO = 28;        // no toque, o cartão sobe acima do dedo
  const ALTURA_ROTULO = 13;     // dois rótulos de fim de linha mais próximos que isto colidem
  const PASSOS_EIXO = [1, 2, 3, 7, 14, 28, 56, 91];   // de quantos em quantos dias rotular
  const MAX_SERIES = 4;         // skill: até 4 séries com rótulo direto; acima disso é outro gráfico
  const TECLAS = new Map([['ArrowRight', 1], ['ArrowUp', 1], ['ArrowLeft', -1], ['ArrowDown', -1], ['PageUp', 7], ['PageDown', -7]]);

  /* ---------------- tokens lidos do CSS ---------------- */
  let _medidas = null;
  function medidas() {
    if (_medidas) return _medidas;
    const cs = getComputedStyle(document.documentElement);
    const raio = parseFloat(cs.getPropertyValue('--radius-xs'));
    const corpo = parseFloat(cs.getPropertyValue('--text-2xs'));
    const m = { raio: raio > 0 ? raio : 0, char: corpo > 0 ? corpo * AVANCO_MONO : 7 };
    if (raio > 0 && corpo > 0) _medidas = m; // só guarda quando o tokens.css já está aplicado
    return m;
  }

  /* ---------------- utilidades ---------------- */
  const f = n => Math.round(n * 100) / 100;
  const limitar = (v, min, max) => Math.min(Math.max(v, min), max);
  const soma = v => v.reduce((a, b) => a + b, 0);
  const maiorTexto = lista => lista.reduce((a, t) => Math.max(a, String(t).length), 1);
  const COR_TOKEN = /^var\(--[a-z0-9-]+\)$/;
  const SERIE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']; // ordem fixa, nunca ciclada por posto

  function escHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function numero(v) {
    const n = Number(v);
    return isFinite(n) && n > 0 ? n : 0; // contagem: vazio, negativo ou texto viram 0
  }
  function fmtNum(n) {
    try { return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 }); } catch (e) { return String(n); }
  }
  function unidade(m, v) { return m.un ? (v === 1 ? m.un[0] : m.un[1]) : ''; }

  /* ---------------- datas (pt-BR, sem depender do ICU do navegador) ----------------
     Visual: "qua, 16 set" — o eixo já mostra o número do dia; o cartão acrescenta
     o que falta (dia da semana e mês). Ano só quando não é o corrente.
     Leitor de tela e tabela: "quarta-feira, 16 de setembro de 2026". */
  const DIA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const DIA_LONGO = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const ISO = /^(\d{4})-(\d{2})-(\d{2})/;
  const dois = n => String(n).padStart(2, '0');

  function hojeISO() {
    const d = new Date();
    return d.getFullYear() + '-' + dois(d.getMonth() + 1) + '-' + dois(d.getDate());
  }
  function partes(iso) {
    const r = ISO.exec(iso || '');
    if (!r) return null;
    const a = +r[1], mes = +r[2], dia = +r[3];
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    return { a, mes, dia, sem: new Date(a, mes - 1, dia, 12).getDay() };
  }
  function dataCurta(iso, reserva) {
    const p = partes(iso);
    if (!p) return reserva || '';
    const ano = p.a !== new Date().getFullYear() ? ' ' + p.a : '';
    return `${DIA_CURTO[p.sem]}, ${p.dia} ${MES_CURTO[p.mes - 1]}${ano}`;
  }
  function dataLonga(iso, reserva) {
    const p = partes(iso);
    return p ? `${DIA_LONGO[p.sem]}, ${p.dia} de ${MES_LONGO[p.mes - 1]} de ${p.a}` : (reserva || '');
  }
  function dataSemSemana(iso, reserva) {
    const p = partes(iso);
    return p ? `${p.dia} de ${MES_LONGO[p.mes - 1]} de ${p.a}` : (reserva || '');
  }

  /* ---------------- modelo (é ele que viaja em data-grafico) ---------------- */
  function modelo(tipo, dias, series, opts) {
    const o = opts || {};
    const hj = hojeISO();
    const comData = dias.every(d => d && partes(d.data));
    const comMes = comData && String(dias[0].data).slice(0, 7) !== String(dias[dias.length - 1].data).slice(0, 7);
    const iHoje = dias.findIndex(d => d && d.hoje);
    const un = Array.isArray(o.unidade) && o.unidade.length
      ? [String(o.unidade[0]), String(o.unidade[1] == null ? o.unidade[0] : o.unidade[1])] : null;
    return {
      tipo,
      titulo: String(o.titulo || (tipo === 'colunas' ? 'Valores por dia' : 'Séries por dia')),
      un,
      vazio: String(o.vazio || 'Sem dados no período.'),
      dias: dias.map((d, i) => {
        const x = d || {};
        const iso = comData ? String(x.data).slice(0, 10) : '';
        const p = partes(iso);
        const rotulo = String(x.label == null ? '' : x.label);
        const futuro = comData ? iso > hj : (iHoje >= 0 && i > iHoje);
        // campos falsos ou redundantes ficam de fora: é isto que vai para o data-grafico
        return {
          iso,
          rotulo: p ? undefined : rotulo,
          eixo: p ? dois(p.dia) + (comMes ? '/' + dois(p.mes) : '') : rotulo,
          hoje: x.hoje ? true : undefined,
          futuro: futuro ? true : undefined
        };
      }),
      series: series.map((s, k) => ({
        nome: String(s.nome || ''),
        cor: COR_TOKEN.test(s.cor || '') ? s.cor : SERIE[k % SERIE.length],
        v: dias.map(d => numero(d ? d[s.chave] : 0))
      }))
    };
  }

  /* escala do eixo Y: passos 1-2-5, três ou quatro intervalos, sempre inteiros */
  function escala(max) {
    if (!(max > 0)) return { topo: 0, marcas: [0] };
    const alvo = max / 3;
    const pot = Math.pow(10, Math.floor(Math.log10(alvo)));
    const passo = Math.max(1, [1, 2, 5, 10].map(k => k * pot).find(p => p >= alvo));
    const topo = Math.ceil(max / passo) * passo;
    const marcas = [];
    for (let t = 0; t <= topo; t += passo) marcas.push(t);
    return { topo, marcas };
  }

  /* o pico só ganha rótulo quando é único — rótulo seletivo, nunca um número por coluna */
  function picoUnico(v) {
    let max = 0, idx = -1, repetido = false;
    v.forEach((x, i) => {
      if (x > max) { max = x; idx = i; repetido = false; } else if (x === max && max > 0) repetido = true;
    });
    return repetido ? -1 : idx;
  }
  function indiceDoMaximo(v) {
    let idx = 0;
    v.forEach((x, i) => { if (x > v[idx]) idx = i; });
    return idx;
  }
  function indiceInicial(m) {
    const h = m.dias.findIndex(d => d.hoje);
    if (h >= 0) return h;
    for (let i = m.dias.length - 1; i >= 0; i--) if (!m.dias[i].futuro) return i;
    return m.dias.length - 1;
  }

  /* ---------------- desenho na largura W ---------------- */
  function desenhar(m, W) {
    const md = medidas();
    const n = m.dias.length;
    const linhas = m.tipo === 'linhas';
    const max = m.series.reduce((a, s) => Math.max(a, ...s.v), 0);
    const esc = escala(max);
    const rotY = esc.marcas.map(fmtNum);
    const esq = Math.ceil(maiorTexto(rotY) * md.char) + 8;
    const finais = linhas ? m.series.map(s => fmtNum(s.v[n - 1])) : [];
    const sarjeta = linhas ? Math.ceil(maiorTexto(finais) * md.char) + 12 : 0;
    const dir = Math.max(esq + n, W - sarjeta);
    const slot = (dir - esq) / n;
    const base = TOPO + ALTURA_PLOT;
    const yDe = v => (esc.topo ? base - (v / esc.topo) * ALTURA_PLOT : base);
    const cx = [];
    for (let i = 0; i < n; i++) cx.push(esq + slot * (i + 0.5));
    const geo = { largura: W, altura: ALTURA, esq, dir, slot, barra: 0, cx, topo: [], ys: [] };

    let grade = '', marcas = '', textos = '';
    esc.marcas.forEach((t, k) => {
      const y = Math.round(yDe(t)) + 0.5;
      if (t > 0) grade += `<line class="grafico-grade" x1="${esq}" x2="${f(dir)}" y1="${y}" y2="${y}"/>`;
      textos += `<text class="grafico-eixo" x="${esq - 8}" y="${y}" dy=".32em" text-anchor="end">${rotY[k]}</text>`;
    });
    const linhaBase = `<line class="grafico-base" x1="${esq}" x2="${f(dir)}" y1="${base + 0.5}" y2="${base + 0.5}"/>`;

    if (!linhas) {
      /* colunas: ≤ 24px, ponta de dados arredondada (--radius-xs), base reta */
      const b = Math.max(1, Math.min(COLUNA_MAX, Math.round(slot - Math.max(VAO_MIN, slot * 0.28))));
      geo.barra = b;
      const v = m.series[0].v;
      v.forEach((val, i) => {
        if (!(val > 0)) { geo.topo.push(base); return; }
        const h = Math.max(2, Math.round((val / esc.topo) * ALTURA_PLOT));
        const x = Math.round(cx[i] - b / 2), y = base - h;
        const r = f(Math.min(md.raio, b / 2, h));
        geo.topo.push(y);
        marcas += `<path class="grafico-barra" data-i="${i}" d="M${x} ${base}V${f(y + r)}A${r} ${r} 0 0 1 ${f(x + r)} ${y}H${f(x + b - r)}A${r} ${r} 0 0 1 ${x + b} ${f(y + r)}V${base}Z"/>`;
      });
      const iPico = picoUnico(v);
      if (iPico >= 0) {
        const t = fmtNum(v[iPico]);
        const meia = (t.length * md.char) / 2;
        textos += `<text class="grafico-valor" x="${f(limitar(cx[iPico], esq + meia, W - meia))}" y="${geo.topo[iPico] - 6}" text-anchor="middle">${t}</text>`;
      }
    } else {
      /* linhas: 2px, junta redonda; marcador de 8px com anel da superfície no fim */
      m.series.forEach(s => {
        const ys = s.v.map(yDe);
        geo.ys.push(ys);
        if (n > 1) marcas += `<path class="grafico-linha" style="stroke:${s.cor}" d="M${cx.map((x, i) => f(x) + ' ' + f(ys[i])).join('L')}"/>`;
      });
      m.series.forEach((s, k) => {
        marcas += `<circle class="grafico-fim" cx="${f(cx[n - 1])}" cy="${f(geo.ys[k][n - 1])}" r="${PONTO_FIM / 2 + 1}" style="fill:${s.cor}"/>`;
      });
      for (let i = 0; i < n; i++) geo.topo.push(Math.min(...geo.ys.map(y => y[i])));
      // valor no fim de cada linha — só se não colidem; senão legenda + cartão bastam
      const yFim = geo.ys.map(y => y[n - 1]);
      const colidem = yFim.some((a, i) => yFim.some((c, j) => i < j && Math.abs(a - c) < ALTURA_ROTULO));
      if (!colidem) {
        finais.forEach((t, k) => {
          textos += `<text class="grafico-valor" x="${f(cx[n - 1] + PONTO_FIM / 2 + 6)}" y="${f(yFim[k])}" dy=".32em">${t}</text>`;
        });
      }
    }

    textos += rotulosX(m, cx, slot, base, W, md);
    const svg = `<svg class="grafico-svg" width="100%" height="${ALTURA}" viewBox="0 0 ${W} ${ALTURA}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${grade}${linhaBase}${marcas}${textos}</svg>`;
    return { svg, geo };
  }

  /* rótulos de data: quantos couberem sem encostar, ancorados em "hoje" (ou no
     último dia) — o dia de hoje nunca some e os demais caem no mesmo dia da semana */
  function rotulosX(m, cx, slot, base, W, md) {
    const n = m.dias.length;
    const precisa = maiorTexto(m.dias.map(d => d.eixo)) * md.char + 10;
    const passo = PASSOS_EIXO.find(p => p * slot >= precisa) || Math.ceil(precisa / slot);
    let ancora = m.dias.findIndex(d => d.hoje);
    if (ancora < 0) ancora = n - 1;
    const itens = [];
    for (let i = ancora % passo; i < n; i += passo) {
      const t = m.dias[i].eixo;
      if (!t) continue;
      const meia = (t.length * md.char) / 2;
      const x = limitar(cx[i], meia, W - meia);
      itens.push({ i, t, x, ini: x - meia, fim: x + meia });
    }
    const ok = [];
    itens.forEach(it => {
      const ant = ok[ok.length - 1];
      if (ant && it.ini < ant.fim + 4) {
        if (it.i !== ancora) return; // quem sai é o vizinho, nunca o "hoje"
        ok.pop();
      }
      ok.push(it);
    });
    return ok.map(it =>
      `<text class="grafico-eixo${m.dias[it.i].hoje ? ' grafico-eixo--hoje' : ''}" x="${f(it.x)}" y="${base + 17}" text-anchor="middle">${escHTML(it.t)}</text>`
    ).join('');
  }

  /* ---------------- textos acessíveis ---------------- */
  function textoLeitor(m, i) {
    const d = m.dias[i];
    const quando = (d.hoje ? 'hoje, ' : '') + dataLonga(d.iso, d.rotulo);
    let valor;
    if (d.futuro) valor = 'data futura';
    else if (m.tipo === 'colunas') {
      const v = m.series[0].v[i];
      valor = fmtNum(v) + (m.un ? ' ' + unidade(m, v) : '');
    } else valor = m.series.map(s => `${s.nome} ${fmtNum(s.v[i])}`).join(', ');
    return `${quando}: ${valor}`;
  }

  function resumo(m) {
    const n = m.dias.length;
    const ini = dataSemSemana(m.dias[0].iso, m.dias[0].rotulo);
    const fim = dataSemSemana(m.dias[n - 1].iso, m.dias[n - 1].rotulo);
    const periodo = n > 1 ? `De ${ini} a ${fim}` : `Em ${ini}`;
    let corpo;
    if (m.tipo === 'colunas') {
      const v = m.series[0].v, total = soma(v);
      if (total > 0) {
        const iMax = indiceDoMaximo(v);
        const un = m.un ? ' ' + unidade(m, total) : '';
        corpo = `${fmtNum(total)}${un} no total; maior valor ${fmtNum(v[iMax])}, em ${dataLonga(m.dias[iMax].iso, m.dias[iMax].rotulo)}`;
      } else corpo = m.vazio;
    } else {
      corpo = m.series.some(s => soma(s.v) > 0)
        ? m.series.map(s => `${s.nome}, ${fmtNum(soma(s.v))} no total`).join('; ')
        : m.vazio;
    }
    return `${periodo}: ${corpo.replace(/\.$/, '')}. Use as setas para ler cada dia.`;
  }

  function tabela(m) {
    const cab = m.tipo === 'colunas'
      ? `<th scope="col">${escHTML(m.un ? m.un[1].charAt(0).toUpperCase() + m.un[1].slice(1) : 'Valor')}</th>`
      : m.series.map(s => `<th scope="col">${escHTML(s.nome)}</th>`).join('');
    const linhas = m.dias.map((d, i) =>
      `<tr><th scope="row">${escHTML(dataLonga(d.iso, d.rotulo))}</th>${m.series.map(s => `<td>${d.futuro ? '—' : fmtNum(s.v[i])}</td>`).join('')}</tr>`
    ).join('');
    return `<table class="grafico-sr"><caption>${escHTML(m.titulo)}</caption><thead><tr><th scope="col">Dia</th>${cab}</tr></thead><tbody>${linhas}</tbody></table>`;
  }

  /* ---------------- template (o que as views concatenam) ---------------- */
  let seq = 0;

  function moldura(m) {
    const id = 'grafico-' + (++seq);
    const n = m.dias.length;
    const i0 = indiceInicial(m);
    const { svg } = desenhar(m, LARGURA_NOMINAL);
    const linhas = m.tipo === 'linhas';
    const legenda = linhas
      ? `<ul class="grafico-legenda">${m.series.map(s => `<li><span class="grafico-chave" style="color:${s.cor}"></span>${escHTML(s.nome)}</li>`).join('')}</ul>`
      : '';
    const guia = linhas
      ? `<div class="grafico-cursor" style="top:${TOPO - 4}px;height:${ALTURA_PLOT + 4}px" hidden></div>`
      : `<div class="grafico-faixa" style="top:${TOPO - 6}px;height:${ALTURA_PLOT + 6}px" hidden></div>`;
    const pontos = linhas
      ? m.series.map((s, k) => `<span class="grafico-ponto" data-s="${k}" style="color:${s.cor}" hidden></span>`).join('')
      : '';
    const semValor = m.series.every(s => soma(s.v) === 0)
      ? `<div class="grafico-vazio-msg" style="top:${TOPO}px;height:${ALTURA_PLOT}px">${escHTML(m.vazio)}</div>`
      : '';
    return `<div class="grafico grafico--${m.tipo}" data-grafico="${escHTML(JSON.stringify(m))}">${legenda}` +
      `<div class="grafico-plot" tabindex="0" role="slider" aria-label="${escHTML(m.titulo)}" aria-describedby="${id}-resumo"` +
      ` aria-valuemin="0" aria-valuemax="${n - 1}" aria-valuenow="${i0}" aria-valuetext="${escHTML(textoLeitor(m, i0))}" data-i="${i0}">` +
      `${guia}${svg}${pontos}${semValor}</div>` +
      `<p id="${id}-resumo" hidden>${escHTML(resumo(m))}</p>${tabela(m)}</div>`;
  }

  function semDias(opts) {
    const txt = (opts && opts.vazio) || 'Sem dados no período.';
    return `<div class="grafico grafico--sem-dias"><p class="grafico-vazio" style="min-height:${ALTURA}px">${escHTML(txt)}</p></div>`;
  }

  /* API — colunas: items = [{label, value, hoje?, data?}] (a mesma do barChartSVG antigo)
     opts = { titulo, unidade: ['lead','leads'], vazio } — tudo opcional */
  function colunas(items, opts) {
    const lista = Array.isArray(items) ? items : [];
    if (!lista.length) return semDias(opts);
    return moldura(modelo('colunas', lista, [{ nome: (opts && opts.titulo) || '', cor: 'var(--chart-1)', chave: 'value' }], opts));
  }

  /* API — linhas: dias = [{label, data?, hoje?, ...valores}]
     series = [{nome, chave, cor?}] (cor: token, ex. 'var(--chart-2)'; sem cor, segue --chart-1..5)
     opts = { titulo, vazio } */
  function linhas(dias, series, opts) {
    const lista = Array.isArray(dias) ? dias : [];
    const ss = (Array.isArray(series) ? series : []).filter(s => s && s.chave).slice(0, MAX_SERIES);
    if (!lista.length || !ss.length) return semDias(opts);
    return moldura(modelo('linhas', lista, ss, opts));
  }

  /* ---------------- ciclo de vida: montar, medir, desmontar ---------------- */
  const vivos = document.getElementsByClassName('grafico'); // coleção viva
  const montados = new Set();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(aoMedir) : null;

  function montar(raiz) {
    if (raiz._gr) return raiz._gr;
    let m = null;
    try { m = JSON.parse(raiz.getAttribute('data-grafico') || 'null'); } catch (e) { m = null; }
    const valido = !!(m && Array.isArray(m.dias) && m.dias.length && Array.isArray(m.series) && m.series.length);
    raiz._gr = { m: valido ? m : null, geo: null, largura: 0 };
    if (!valido) return raiz._gr;
    raiz._gr.geo = desenhar(m, LARGURA_NOMINAL).geo;
    raiz._gr.largura = LARGURA_NOMINAL;
    montados.add(raiz);
    if (ro) ro.observe(raiz);
    else redesenhar(raiz, Math.floor(raiz.clientWidth));
    return raiz._gr;
  }

  function redesenhar(raiz, w) {
    const gr = raiz._gr;
    if (!gr || !gr.m || !(w > 0) || w === gr.largura) return;
    const { svg, geo } = desenhar(gr.m, w);
    const velho = raiz.querySelector('.grafico-svg');
    if (velho) velho.outerHTML = svg;
    gr.geo = geo;
    gr.largura = w;
    if (ativo && ativo.raiz === raiz) pintar(true);
  }

  function aoMedir(entradas) {
    entradas.forEach(en => {
      const raiz = en.target;
      if (!raiz.isConnected) { ro.unobserve(raiz); montados.delete(raiz); return; }
      redesenhar(raiz, Math.floor(en.contentRect.width));
    });
  }

  function varrer() {
    for (let i = 0; i < vivos.length; i++) if (!vivos[i]._gr) montar(vivos[i]);
    montados.forEach(raiz => {
      if (raiz.isConnected) return;
      if (ro) ro.unobserve(raiz);
      montados.delete(raiz);
    });
    if (ativo && !ativo.plot.isConnected) { ativo = null; if (dica) dica.hidden = true; }
  }

  /* ---------------- interação (um gráfico ativo por vez) ---------------- */
  let dica = null;   // o cartão: um só, filho do body
  let ativo = null;  // { plot, raiz, i, origem: 'ponteiro'|'teclado'|'toque', toque: {id, y, arrastando} }
  let quadroPos = 0;

  function dadosDe(raiz) { return raiz._gr || montar(raiz); }

  function indiceNoPonto(plot, clientX) {
    const raiz = plot.closest('.grafico');
    const g = raiz ? dadosDe(raiz) : null;
    if (!g || !g.m || !g.geo) return -1;
    const caixa = plot.getBoundingClientRect();
    const x = (clientX - caixa.left) * (g.geo.largura / (caixa.width || 1));
    return limitar(Math.floor((x - g.geo.esq) / g.geo.slot), 0, g.m.dias.length - 1);
  }

  function ativar(plot, i, origem, toque) {
    const raiz = plot.closest('.grafico');
    const g = raiz ? dadosDe(raiz) : null;
    if (!g || !g.m || !g.geo || i < 0) return;
    i = limitar(Math.round(i), 0, g.m.dias.length - 1);
    const primeira = !ativo || ativo.plot !== plot;
    if (!primeira && ativo.i === i && ativo.origem === origem && !toque) return;
    if (primeira) apagar();
    ativo = { plot, raiz, i, origem, toque: toque || null };
    if (plot.getAttribute('data-i') !== String(i)) {
      plot.setAttribute('data-i', i);
      plot.setAttribute('aria-valuenow', i);
      plot.setAttribute('aria-valuetext', textoLeitor(g.m, i));
    }
    pintar(primeira);
  }

  function pintar(primeira) {
    const { plot, raiz, i } = ativo;
    const g = raiz._gr, geo = g.geo;
    const caixa = plot.getBoundingClientRect();
    const kx = caixa.width / geo.largura || 1;
    const ky = caixa.height / geo.altura || 1;
    const x = geo.cx[i] * kx;
    if (primeira) plot.classList.add('grafico-sem-transicao');
    if (g.m.tipo === 'colunas') {
      const faixa = plot.querySelector('.grafico-faixa');
      if (faixa) {
        const w = Math.max(6, Math.min(geo.slot, geo.barra + 12)) * kx;
        faixa.style.width = f(w) + 'px';
        faixa.style.transform = `translateX(${f(x - w / 2)}px)`;
        faixa.hidden = false;
      }
      const velha = plot.querySelector('.grafico-barra.ativa');
      if (velha) velha.classList.remove('ativa');
      const nova = plot.querySelector(`.grafico-barra[data-i="${i}"]`);
      if (nova) nova.classList.add('ativa');
    } else {
      const cursor = plot.querySelector('.grafico-cursor');
      if (cursor) { cursor.style.transform = `translateX(${f(x - 0.5)}px)`; cursor.hidden = false; }
      plot.querySelectorAll('.grafico-ponto').forEach(p => {
        const ys = geo.ys[+p.getAttribute('data-s')];
        if (!ys) return;
        p.hidden = false;
        const meio = p.offsetWidth / 2;
        p.style.transform = `translate(${f(x - meio)}px,${f(ys[i] * ky - meio)}px)`;
      });
    }
    if (primeira) { void plot.offsetWidth; plot.classList.remove('grafico-sem-transicao'); }
    mostrarDica(primeira);
  }

  function apagar() {
    if (!ativo) return;
    const plot = ativo.plot;
    plot.querySelectorAll('.grafico-faixa,.grafico-cursor,.grafico-ponto').forEach(el => { el.hidden = true; });
    const barra = plot.querySelector('.grafico-barra.ativa');
    if (barra) barra.classList.remove('ativa');
  }

  function esconder() {
    apagar();
    ativo = null;
    if (dica) dica.hidden = true;
  }

  function el(tag, classe, texto) {
    const e = document.createElement(tag);
    e.className = classe;
    if (texto != null) e.textContent = texto; // rótulos são dado: textContent, nunca innerHTML
    return e;
  }

  function mostrarDica(primeira) {
    if (!dica) {
      dica = el('div', 'grafico-dica');
      dica.setAttribute('aria-hidden', 'true'); // o leitor de tela já ouve o aria-valuetext
      dica.hidden = true;
      document.body.appendChild(dica);
    }
    const m = ativo.raiz._gr.m, i = ativo.i, d = m.dias[i];
    dica.textContent = '';
    const cab = el('div', 'grafico-dica-data', dataCurta(d.iso, d.rotulo));
    if (d.hoje) cab.appendChild(el('span', 'grafico-dica-hoje', 'hoje'));
    dica.appendChild(cab);
    if (m.tipo === 'colunas') {
      const v = m.series[0].v[i];
      const linha = el('div', 'grafico-dica-unica');
      linha.appendChild(el('span', 'grafico-dica-valor', d.futuro ? '—' : fmtNum(v)));
      const nome = d.futuro ? 'data futura' : unidade(m, v);
      if (nome) linha.appendChild(el('span', 'grafico-dica-nome', nome));
      dica.appendChild(linha);
    } else {
      const grade = el('div', 'grafico-dica-linhas');
      m.series.forEach(s => {
        const chave = el('span', 'grafico-chave');
        chave.style.color = s.cor; // a chave pinta com currentColor
        grade.appendChild(chave);
        grade.appendChild(el('span', 'grafico-dica-valor', d.futuro ? '—' : fmtNum(s.v[i])));
        grade.appendChild(el('span', 'grafico-dica-nome', s.nome.toLocaleLowerCase('pt-BR')));
      });
      dica.appendChild(grade);
    }
    if (primeira) dica.classList.add('grafico-sem-transicao');
    posicionarDica();
    if (primeira) { void dica.offsetWidth; dica.classList.remove('grafico-sem-transicao'); }
  }

  function posicionarDica() {
    if (!ativo || !dica) return;
    const { plot, raiz, i, origem, toque } = ativo;
    const g = raiz._gr, geo = g.geo;
    const caixa = plot.getBoundingClientRect();
    const kx = caixa.width / geo.largura || 1;
    const ky = caixa.height / geo.altura || 1;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const ax = caixa.left + geo.cx[i] * kx;
    const folga = g.m.tipo === 'linhas' ? PONTO_FIM / 2 + 2 : 0;
    const marcaY = caixa.top + geo.topo[i] * ky;
    // gráfico rolado para fora da tela (com o foco nele): o cartão não aponta para o nada
    if (caixa.bottom < 0 || caixa.top > vh || ax < 0 || ax > vw) { dica.hidden = true; return; }
    dica.hidden = false;
    const w = dica.offsetWidth, h = dica.offsetHeight;
    let ay = marcaY - folga;
    if (origem === 'toque' && toque) ay = Math.min(ay, toque.y - FOLGA_DEDO);
    const x = limitar(ax - w / 2, MARGEM_TELA, Math.max(MARGEM_TELA, vw - MARGEM_TELA - w));
    let y = ay - AFASTAMENTO - h;
    if (y < MARGEM_TELA) {
      const abaixo = origem === 'toque' && toque ? Math.max(marcaY, toque.y) + FOLGA_DEDO : marcaY + folga + AFASTAMENTO;
      y = Math.max(MARGEM_TELA, Math.min(abaixo, vh - MARGEM_TELA - h));
    }
    dica.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
  }

  function agendarPosicao() {
    if (!ativo || quadroPos) return;
    quadroPos = requestAnimationFrame(() => { quadroPos = 0; posicionarDica(); });
  }

  const plotDe = alvo => (alvo && alvo.closest ? alvo.closest('.grafico-plot') : null);

  function ligar() {
    // mouse (e caneta pairando): o dia mais próximo do ponteiro
    document.addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse' || (e.pointerType === 'pen' && !e.buttons)) {
        const plot = plotDe(e.target);
        if (plot) ativar(plot, indiceNoPonto(plot, e.clientX), 'ponteiro');
        return;
      }
      // toque: só enquanto o dedo arrasta no gráfico em que começou
      if (ativo && ativo.toque && ativo.toque.arrastando && ativo.toque.id === e.pointerId) {
        ativar(ativo.plot, indiceNoPonto(ativo.plot, e.clientX), 'toque', { id: e.pointerId, y: e.clientY, arrastando: true });
      }
    }, { passive: true });

    document.addEventListener('pointerdown', e => {
      const plot = plotDe(e.target);
      if (plot && e.pointerType !== 'mouse') {
        ativar(plot, indiceNoPonto(plot, e.clientX), 'toque', { id: e.pointerId, y: e.clientY, arrastando: true });
      } else if (!plot && ativo && ativo.origem === 'toque') {
        esconder(); // tocou fora: o cartão fixado sai
      }
    }, { passive: true });

    document.addEventListener('pointerup', e => {
      if (ativo && ativo.toque && ativo.toque.id === e.pointerId) ativo.toque.arrastando = false; // o cartão fica
    }, { passive: true });

    // o navegador assumiu o gesto (rolagem vertical): some
    document.addEventListener('pointercancel', e => {
      if (ativo && ativo.toque && ativo.toque.id === e.pointerId) esconder();
    }, { passive: true });

    document.addEventListener('pointerout', e => {
      if (e.pointerType === 'touch' || !ativo || ativo.origem !== 'ponteiro') return;
      if (!ativo.plot.contains(e.target) || ativo.plot.contains(e.relatedTarget)) return;
      if (document.activeElement === ativo.plot) { ativo.origem = 'teclado'; return; } // continua para o teclado
      esconder();
    }, { passive: true });

    document.addEventListener('focusin', e => {
      const plot = e.target && e.target.classList && e.target.classList.contains('grafico-plot') ? e.target : null;
      if (!plot || (ativo && ativo.plot === plot)) return;
      ativar(plot, +plot.getAttribute('data-i') || 0, 'teclado');
    });

    document.addEventListener('focusout', e => {
      if (ativo && e.target === ativo.plot && ativo.origem === 'teclado') esconder();
    });

    document.addEventListener('keydown', e => {
      const plot = e.target && e.target.classList && e.target.classList.contains('grafico-plot') ? e.target : null;
      if (!plot || e.altKey || e.ctrlKey || e.metaKey) return;
      const raiz = plot.closest('.grafico');
      const g = raiz ? dadosDe(raiz) : null;
      if (!g || !g.m) return;
      const n = g.m.dias.length;
      const atual = ativo && ativo.plot === plot ? ativo.i : (+plot.getAttribute('data-i') || 0);
      let i;
      if (TECLAS.has(e.key)) i = atual + TECLAS.get(e.key);
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = n - 1;
      else if (e.key === 'Escape') { if (ativo && ativo.plot === plot) esconder(); return; }
      else return;
      e.preventDefault();
      ativar(plot, i, 'teclado');
    });

    // rolagem de qualquer contêiner (o painel do Chat rola por dentro) e resize
    document.addEventListener('scroll', agendarPosicao, { capture: true, passive: true });
    window.addEventListener('resize', agendarPosicao, { passive: true });

    new MutationObserver(varrer).observe(document.body, { childList: true, subtree: true });
    varrer();
  }

  if (document.body) ligar();
  else document.addEventListener('DOMContentLoaded', ligar);

  /* para o teste de integração: o número de montados acompanha os gráficos na
     tela e o cartão é sempre um só, por mais renders que aconteçam */
  function diagnostico() {
    return {
      montados: montados.size,
      naTela: document.querySelectorAll('.grafico[data-grafico]').length,
      cartoes: document.querySelectorAll('body > .grafico-dica').length
    };
  }

  return { colunas, linhas, diagnostico };
})();

/* helpers de template no objeto UI (este arquivo carrega logo depois do ui-core.js).
   barChartSVG mantém a assinatura antiga — as chamadas atuais seguem funcionando. */
if (typeof UI !== 'undefined') {
  Object.assign(UI, {
    barChartSVG: (items, opts) => Grafico.colunas(items, opts),
    graficoLinhas: (dias, series, opts) => Grafico.linhas(dias, series, opts)
  });
}
