/* ============================================================
   COPIAR — retorno no próprio botão

   Na Agenda a equipe copia a mensagem do follow-up e cola no WhatsApp. O único
   retorno era um toast no canto da tela, longe do clique: com vários botões
   "Copiar" na mesma tela, não ficava claro qual tinha copiado. Aqui o próprio
   botão responde — o ícone vira check por 1,6s e volta; se a cópia falhou,
   vira alerta.

   Este arquivo NÃO copia nada. Quem copia continua sendo UI.copiar (ui-core.js).
   Ela chama UI.retornoCopia(origem) de forma síncrona, ANTES do primeiro await,
   e recebe concluir(ok), que chama quando a área de transferência responde.
   As chamadas de UI.copiar nas views não mudam.

   Como o botão é encontrado:
     · UI.copiar(texto, botao) → o botão passado (forma preferida em código novo:
                                  onclick="UI.copiar(texto, this)")
     · UI.copiar(texto)        → o clique em andamento (window.event), subindo
                                  do alvo até 'button, .btn, .wa-btn, .wa-ico-btn'
   Limitação: chamada que não nasce de um clique — atalho de teclado, setTimeout,
   depois de um await — não acha botão. Aí o aviso é o toast, como sempre foi.

   Decisões (detalhes no RELATORIO.md do pacote):
     · sucesso com botão  → check no botão + aviso ao leitor de tela, sem toast
     · sucesso sem botão  → toast + aviso ao leitor de tela
     · falha              → alerta no botão (se houver) + toast de erro + aviso
                            urgente: o ícone sozinho não diz o que fazer
     · botão com texto    → o texto não muda; "Copiado" é mais largo que
                            "Copiar" e a linha pularia. Só o ícone troca.
     · botão só com texto → o check aparece no lugar do rótulo, na mesma caixa
     · clique repetido    → um timer por botão, reiniciado a cada clique; o estado
                            é um atributo só (data-copiar), então o ícone não
                            tem como ficar errado
     · o botão nunca é desabilitado durante o check: desabilitar tira o foco de
       quem usa teclado
   ============================================================

   Este arquivo é um porte do componente Copy Button do Spell UI (https://spell.sh),
   sem React/TypeScript/Tailwind/lucide-react. Licença original:

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

const BotaoCopiar = (function () {
  'use strict';

  /* Tempos de permanência do estado (não são duração de movimento: a troca de
     ícone em si usa --dur-fast/--dur-base no CSS e zera com reduced-motion). */
  const TEMPO_OK = 1600;       // o check fica 1,6s e o botão volta a oferecer "copiar"
  const TEMPO_ERRO = 3200;     // o alerta dura o mesmo que o toast que o explica
  const ESPERA_LEITOR = 100;   // região viva: esvazia e reescreve, senão a mesma frase não é lida de novo

  const SELETOR = 'button, .btn, .wa-btn, .wa-ico-btn';
  const MSG_OK = 'Copiado para a área de transferência.';
  const MSG_ERRO = 'Não foi possível copiar: o navegador bloqueou a área de transferência. ' +
    'Selecione o texto e copie manualmente.';

  const timers = new WeakMap();   // botão → timer do estado; some sozinho quando o botão sai do DOM
  const regioes = {};
  const esperas = {};

  /* ---------------- 1. qual botão ---------------- */

  function botaoDe(origem) {
    if (!origem) return null;
    // um elemento: quem chamou disse qual é
    if (origem.nodeType === 1) return origem.closest(SELETOR) || origem;
    // um evento: só vale clique. Num atalho de teclado o alvo é o elemento com
    // foco, que pode ser qualquer botão — marcar o botão errado é pior que o toast.
    if (origem.type !== 'click') return null;
    const alvo = origem.target;
    return alvo && typeof alvo.closest === 'function' ? alvo.closest(SELETOR) : null;
  }

  /* ---------------- 2. a pilha: original, check e alerta na mesma célula ---------------- */

  /* O check e o alerta copiam as classes e medidas do ícone original: as regras de
     tamanho do contexto (.btn svg, .btn-sm svg, .wa-ico-btn svg…) valem igual
     para os três, então a célula tem exatamente o tamanho do ícone de antes. */
  function svgDe(marcacao, modelo) {
    const molde = document.createElement('template');
    molde.innerHTML = marcacao;               // ICO() devolve '' para ícone inexistente
    const svg = molde.content.firstElementChild;
    if (!svg) return null;
    if (modelo) {
      const cls = modelo.getAttribute('class');
      if (cls === null) svg.removeAttribute('class'); else svg.setAttribute('class', cls);
      ['width', 'height'].forEach(a => { if (modelo.hasAttribute(a)) svg.setAttribute(a, modelo.getAttribute(a)); });
    }
    return svg;
  }

  function pilhaDe(botao) {
    const pronta = botao.querySelector('.copiar-pilha');
    if (pronta) return pronta;
    if (typeof ICO !== 'function') return null;

    const icone = botao.querySelector('svg');
    if (!icone && !botao.firstChild) return null;
    const ok = svgDe(ICO('check'), icone);
    const erro = svgDe(ICO('alert-circle'), icone);
    if (!ok || !erro) return null;            // sem ícones, fica só o toast

    // Sem aria-hidden na pilha: no botão só com texto o rótulo mora aqui dentro
    // e continua sendo o nome acessível. Os svgs do ICO() já vêm com aria-hidden.
    const pilha = document.createElement('span');
    pilha.className = 'copiar-pilha';
    let original = icone;
    if (icone) {
      // fora de botão flex (ícone em linha de texto), o vertical-align do ícone
      // — ex.: .ico{vertical-align:-.18em} — passa para a pilha, senão ele sobe
      const va = getComputedStyle(icone).verticalAlign;
      if (va && va !== 'baseline') pilha.style.verticalAlign = va;
      icone.parentNode.insertBefore(pilha, icone);
    } else {
      // botão só com texto: o rótulo inteiro vira a camada de baixo
      original = document.createElement('span');
      original.className = 'copiar-rotulo';
      while (botao.firstChild) original.appendChild(botao.firstChild);
      botao.appendChild(pilha);
    }
    original.classList.add('copiar-orig');
    ok.classList.add('copiar-ok');
    erro.classList.add('copiar-erro');
    pilha.append(original, ok, erro);
    // calcula o estilo de repouso já: sem isso, a primeira troca aconteceria sem transição
    void pilha.offsetWidth;
    return pilha;
  }

  /* ---------------- 3. o estado ---------------- */

  /* estado: 'ok' | 'erro' | null (volta ao repouso). fixo: sem timer (só a demo usa). */
  function mostrar(botao, estado, fixo) {
    if (!botao || !botao.isConnected || !pilhaDe(botao)) return false;
    clearTimeout(timers.get(botao));
    timers.delete(botao);
    if (!estado) { botao.removeAttribute('data-copiar'); return true; }
    botao.setAttribute('data-copiar', estado);
    if (!fixo) {
      timers.set(botao, setTimeout(() => {
        timers.delete(botao);
        botao.removeAttribute('data-copiar');
      }, estado === 'erro' ? TEMPO_ERRO : TEMPO_OK));
    }
    return true;
  }

  /* ---------------- 4. leitor de tela ---------------- */

  function regiao(urgente) {
    const chave = urgente ? 'urgente' : 'educada';
    const pronta = regioes[chave];
    if (pronta && pronta.isConnected) return pronta;
    const el = document.createElement('div');
    el.className = 'copiar-aviso';
    if (urgente) {
      el.setAttribute('role', 'alert');        // já é assertivo; aria-live duplicado faz alguns leitores falarem duas vezes
    } else {
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
    }
    el.setAttribute('aria-atomic', 'true');
    document.body.appendChild(el);
    return (regioes[chave] = el);
  }

  function anunciar(texto, urgente) {
    const el = regiao(urgente);
    const chave = urgente ? 'urgente' : 'educada';
    clearTimeout(esperas[chave]);
    el.textContent = '';
    esperas[chave] = setTimeout(() => { el.textContent = texto; }, ESPERA_LEITOR);
  }

  /* ---------------- 5. o que UI.copiar chama ---------------- */

  /* Síncrono: tem de rodar enquanto o clique ainda está acontecendo. */
  function retorno(origem) {
    const botao = botaoDe(origem);
    return function concluir(ok) {
      const noBotao = mostrar(botao, ok ? 'ok' : 'erro');   // falso se o botão sumiu num re-render
      anunciar(ok ? MSG_OK : MSG_ERRO, !ok);
      if (!ok) UI.toast(MSG_ERRO, 'err');
      else if (!noBotao) UI.toast(MSG_OK);
      return noBotao;
    };
  }

  function init() {
    // as regiões vivas precisam existir antes do primeiro aviso: criada e
    // preenchida no mesmo instante, a região costuma ser ignorada pelo leitor
    if (document.body) { regiao(false); regiao(true); }
  }

  return { init, retorno, mostrar, anunciar, botaoDe };
})();

if (typeof UI !== 'undefined') Object.assign(UI, { retornoCopia: BotaoCopiar.retorno });
BotaoCopiar.init();
