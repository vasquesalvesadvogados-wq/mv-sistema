/* ============================================================
   MOSTRAR SENHA — botão de olho nos campos de senha

   Acha todo input[type=password] — os que já vêm no HTML (#auth-senha) e os
   que aparecem depois (a tela de nova senha que o cloud.js injeta, a chave da
   API em Configurações) — e põe, logo depois de cada um, um botão que alterna
   entre mostrar e ocultar o que foi digitado.

   Este arquivo NÃO edita ninguém: só observa o DOM, como o ui-abertura.js.
   Contratos preservados:
     · o input não sai do lugar. Mover um nó tira o foco dele, e o cloud.js
       foca #ns-senha ~80 ms depois de injetar. O botão entra como irmão;
     · ID, autocomplete, placeholder e listeners do input ficam como estão;
     · o botão é type="button" e não escuta teclado: o Enter no campo segue
       direto para o listener do cloud.js.

   Volta a ocultar sozinho (type="password") quando:
     · um contêiner ganha o atributo hidden — é assim que o cloud.js esconde o
       #auth-gate depois do login e o ui-core fecha o modal. O #auth-senha
       continua no DOM com o valor preenchido: se o gate reabrir, não pode
       reabrir com a senha à mostra;
     · pagehide — quem volta pelo histórico (bfcache) encontra a página
       exatamente como deixou;
     · o input é desabilitado — o botão desabilitado não conseguiria ocultar.
   De propósito, NÃO oculta ao trocar de aba: conferir a chave da API contra o
   console da Anthropic, em outra aba, é justamente o uso do botão.

   Nome acessível fixo, "Mostrar senha", com aria-pressed — o padrão de botão
   de alternância do WAI-ARIA APG. Trocar o nome para "Ocultar senha" junto com
   aria-pressed="true" seria lido "Ocultar senha, pressionado": o contrário do
   que está na tela.
   ============================================================

   Este arquivo é porte do componente Label Input do Spell UI (https://spell.sh),
   só o botão de senha: o rótulo flutuante não veio (o sistema usa rótulo acima
   do campo). Sem React/TypeScript/Tailwind. Licença original:

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

const MostrarSenha = (function () {
  'use strict';

  const SELETOR = 'input[type="password"]';
  const ROTULO = 'Mostrar senha';

  let iniciado = false;
  let avisouCss = false;

  /* ---------------- onde o botão cabe ----------------
     O CSS (seção "mostrar/ocultar senha" do styles.css) faz do pai do input um
     flex com quebra de linha, em que cada filho ocupa a linha inteira. Isso só
     é seguro num contêiner de bloco cujos irmãos já ocupavam a linha inteira —
     o <div class="field"><label>…</label><input></div> do sistema. Input numa
     linha flex ao lado de outro botão, ou com texto solto em volta, fica como
     está: melhor sem olho do que com o layout quebrado. */
  function cabe(input) {
    const pai = input.parentElement;
    if (!pai || input.hidden || getComputedStyle(input).display === 'none') return false;
    if (!pai.classList.contains('senha-campo')) {
      const d = getComputedStyle(pai).display;
      if (d !== 'block' && d !== 'flow-root' && d !== 'list-item') return false;
    }
    for (const no of pai.childNodes) {
      if (no.nodeType === Node.TEXT_NODE) {
        if (no.textContent.trim()) return false;
      } else if (no.nodeType === Node.ELEMENT_NODE && no !== input && !no.classList.contains('senha-alternar')) {
        const d = getComputedStyle(no).display;
        if (d.startsWith('inline') || d === 'contents') return false;
      }
    }
    return true;
  }

  function criarBotao(input) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'senha-alternar';
    b.setAttribute('aria-label', ROTULO);
    b.setAttribute('aria-pressed', 'false');
    if (input.id) b.setAttribute('aria-controls', input.id);
    b.disabled = input.disabled;
    // os dois ícones ficam empilhados; o CSS troca um pelo outro por opacidade
    b.innerHTML = '<span class="senha-olho">' +
      ICO('eye', 'senha-ico-mostrar') + ICO('eye-off', 'senha-ico-ocultar') + '</span>';
    return b;
  }

  function melhorar(input) {
    const vizinho = input.nextElementSibling;
    if (vizinho && vizinho.classList.contains('senha-alternar')) return; // já tem botão
    if (!cabe(input)) return;

    const pai = input.parentElement;
    const jaEra = pai.classList.contains('senha-campo');
    pai.classList.add('senha-campo');
    /* js/ e css/ saem da Vercel com cache "immutable" de um ano. Se este arquivo
       chegar novo e o styles.css continuar velho no navegador, o botão cairia
       cru embaixo do campo — na tela de login. Sem a regra carregada, não põe nada. */
    if (getComputedStyle(pai).display !== 'flex') {
      if (!jaEra) pai.classList.remove('senha-campo');
      if (!avisouCss) {
        avisouCss = true;
        console.warn('[MostrarSenha] CSS da seção "mostrar/ocultar senha" ausente (styles.css antigo em cache?) — nenhum botão inserido.');
      }
      return;
    }

    input.classList.add('senha-valor');
    /* À mostra, o campo vira type="text": o corretor ortográfico avançado do
       Chrome e do Edge manda o texto de campo comum para o servidor dele, e o
       teclado do celular capitalizaria ou corrigiria a senha. */
    input.setAttribute('spellcheck', 'false');
    if (!input.hasAttribute('autocapitalize')) input.setAttribute('autocapitalize', 'off');
    if (!input.hasAttribute('autocorrect')) input.setAttribute('autocorrect', 'off');
    input.after(criarBotao(input));
  }

  /* mostra (visivel = true) ou oculta o input que vem logo antes do botão */
  function definir(botao, visivel) {
    const input = botao.previousElementSibling;
    if (!input || input.tagName !== 'INPUT') return;
    // trocar o type pode levar o cursor para o começo do campo (Safari, Firefox)
    let sel = null;
    if (document.activeElement === input) {
      try { sel = [input.selectionStart, input.selectionEnd, input.selectionDirection]; } catch (e) { sel = null; }
    }
    input.type = visivel ? 'text' : 'password';
    botao.setAttribute('aria-pressed', visivel ? 'true' : 'false');
    if (sel && sel[0] !== null) {
      try { input.setSelectionRange(sel[0], sel[1], sel[2] || 'none'); } catch (e) { /* tipo sem seleção */ }
    }
  }

  /* volta a ocultar tudo o que estiver à mostra dentro de raiz */
  function ocultar(raiz) {
    (raiz || document).querySelectorAll('.senha-alternar[aria-pressed="true"]')
      .forEach(b => definir(b, false));
  }

  function aoMudar(registros) {
    for (const r of registros) {
      if (r.type === 'childList') {
        for (const no of r.addedNodes) {
          if (no.nodeType !== Node.ELEMENT_NODE) continue;
          if (no.matches(SELETOR)) melhorar(no);
          else if (no.firstElementChild) no.querySelectorAll(SELETOR).forEach(melhorar);
        }
      } else if (r.attributeName === 'hidden') {
        if (r.target.hidden) ocultar(r.target);
      } else if (r.attributeName === 'disabled' && r.target.classList.contains('senha-valor')) {
        const b = r.target.nextElementSibling;
        if (!b || !b.classList.contains('senha-alternar')) continue;
        if (r.target.disabled) definir(b, false);
        b.disabled = r.target.disabled;
      }
    }
  }

  function botaoDoEvento(ev) {
    return ev.target instanceof Element ? ev.target.closest('.senha-alternar') : null;
  }

  function aoClicar(ev) {
    const b = botaoDoEvento(ev);
    if (b && !b.disabled) definir(b, b.getAttribute('aria-pressed') !== 'true');
  }

  /* Com o cursor no campo, clicar no olho não tira o foco dele: dá para seguir
     digitando. Pelo teclado nada muda — quem chegou por Tab já está no botão. */
  function aoApertar(ev) {
    const b = botaoDoEvento(ev);
    if (b && document.activeElement === b.previousElementSibling) ev.preventDefault();
  }

  function init() {
    if (iniciado) return;
    iniciado = true;
    // ícone que falta vira string vazia, em silêncio: botão vazio é pior que nenhum
    if (typeof window.ICO !== 'function' || typeof window.ICO.tem !== 'function' ||
        !ICO.tem('eye') || !ICO.tem('eye-off')) {
      console.warn('[MostrarSenha] ícones "eye"/"eye-off" ausentes em js/icones.js — nenhum botão inserido.');
      return;
    }

    document.querySelectorAll(SELETOR).forEach(melhorar);

    new MutationObserver(aoMudar).observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled']
    });

    // fase de captura: trechos do Chat param a propagação do clique
    document.addEventListener('click', aoClicar, true);
    document.addEventListener('mousedown', aoApertar, true);
    window.addEventListener('pagehide', () => ocultar(document));
  }

  return { init, ocultar };
})();

MostrarSenha.init();
