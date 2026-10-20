/* ============================================================
   TEXTO-WA — formatação de texto no padrão do WhatsApp
   *negrito*  _itálico_  ~tachado~  `mono`  ```bloco mono```

   Arquivo puro (sem DOM) para rodar nos testes. Regras de fronteira iguais
   às do WhatsApp: o marcador de abertura não pode vir colado a letra ou
   número, nem ser seguido de espaço; o de fechamento não pode ser precedido
   de espaço nem seguido de letra/número; nada de quebra de linha dentro,
   salvo no bloco ```. Marcador sem par fica como foi digitado.

   formatarWa(texto)      → HTML seguro (esc() antes de qualquer regex;
                            URLs viram <a> e nunca são formatadas por dentro)
   semMarcadoresWa(texto) → texto puro sem os marcadores (prévias e citações)
============================================================ */

/* sem grupo de captura: nos replace() abaixo o 2º argumento do callback precisa ser a posição */
const URL_RE_WA = /(?:https?:\/\/[^\s<]+|www\.[a-z0-9][a-z0-9.-]*\.[a-z]{2,}[^\s<]*)/gi;

/* marcadores inline: [caractere, tag] — ordem importa para o aninhamento */
const SIMBOLOS_WA = [['*', 'strong'], ['_', 'em'], ['~', 's']];

function regexMarcadorWa(m) {
  const q = m === '*' ? '\\*' : m;   // no modo unicode só caracteres de sintaxe aceitam escape
  // (?<!letra|número|mesmo marcador) m (conteúdo sem quebra, sem o marcador, sem espaço nas pontas) m (?!letra|número|mesmo marcador)
  return new RegExp(`(?<![\\p{L}\\p{N}${q}])${q}(?=\\S)((?:(?!${q})[^\\n])*?\\S)${q}(?![\\p{L}\\p{N}${q}])`, 'gu');
}
const REGEX_SIMBOLOS_WA = SIMBOLOS_WA.map(([m, tag]) => [regexMarcadorWa(m), tag]);

/* aplica os marcadores inline num trecho já sem URLs e sem blocos mono.
   `embrulhar(tag, conteudo)` decide o que vira cada par (HTML ou só o conteúdo). */
function aplicarMarcadoresWa(txt, embrulhar) {
  // trechos mono guardam o conteúdo intacto: nada é formatado dentro deles
  const guardados = [];
  const guardar = html => { guardados.push(html); return '\u0000' + (guardados.length - 1) + '\u0000'; };
  let saida = txt
    .replace(/```([\s\S]+?)```/g, (_, c) => guardar(embrulhar('pre', c)))
    .replace(/`([^`\n]+)`/g, (_, c) => guardar(embrulhar('code', c)));
  for (const [re, tag] of REGEX_SIMBOLOS_WA) saida = saida.replace(re, (_, c) => embrulhar(tag, c));
  return saida.replace(/\u0000(\d+)\u0000/g, (_, i) => guardados[+i]);
}

function embrulharHtmlWa(tag, c) {
  if (tag === 'pre') return '<pre class="wa-mono">' + c + '</pre>';
  if (tag === 'code') return '<code class="wa-mono">' + c + '</code>';
  return '<' + tag + '>' + c + '</' + tag + '>';
}

function linkHtmlWa(u) {
  let fim = '';
  const m = /[),.;:!?\]]+$/.exec(u);                    // pontuação colada no fim não faz parte do link
  if (m) { fim = m[0]; u = u.slice(0, -fim.length); }
  const href = /^https?:\/\//i.test(u) ? u : 'https://' + u;
  return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + u + '</a>' + fim;
}

function formatarWa(texto) {
  const t = esc(texto);
  const partes = [];
  let ult = 0;
  t.replace(URL_RE_WA, (u, pos) => {
    partes.push({ t: t.slice(ult, pos) });
    partes.push({ u });
    ult = pos + u.length;
    return u;
  });
  partes.push({ t: t.slice(ult) });
  return partes.map(p => p.u !== undefined ? linkHtmlWa(p.u) : aplicarMarcadoresWa(p.t, embrulharHtmlWa)).join('');
}

function semMarcadoresWa(texto) {
  const t = String(texto == null ? '' : texto);
  const partes = [];
  let ult = 0;
  t.replace(URL_RE_WA, (u, pos) => { partes.push({ t: t.slice(ult, pos) }); partes.push({ u }); ult = pos + u.length; return u; });
  partes.push({ t: t.slice(ult) });
  return partes.map(p => p.u !== undefined ? p.u : aplicarMarcadoresWa(p.t, (_, c) => c)).join('');
}
