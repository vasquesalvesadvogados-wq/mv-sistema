/* ============================================================
   SPINNER — indicador de carregamento do sistema

   Para usar dentro das template strings das views:

     UI.spinner(tamanho, rotulo)    o indicador.
                                    Sem rótulo: decorativo (aria-hidden), vai AO
                                    LADO de um texto que já diz o que acontece.
                                    Com rótulo: sozinho — role="status" e o
                                    rótulo só para leitor de tela.
     UI.carregando(texto, tamanho)  linha de status: indicador + texto visível,
                                    com role="status". Tamanho padrão 14.
     UI.ocupado(botao, texto)       botão em andamento: guarda o conteúdo,
     UI.livre(botao)                desabilita, marca aria-busy e mostra
                                    indicador + texto. livre() devolve tudo
                                    como estava. O texto nunca some: o botão
                                    não vira um ícone mudo.

   Tamanhos: só 14, 16 e 20 (os do Design System). Outro valor vira o padrão.
   Cor: currentColor — herda do texto em volta.
   Textos: passe texto puro; os helpers escapam.

   Nada gira. O desenho é o ícone loader da biblioteca (ICO('loader'), 8 raios)
   e cada raio só muda de opacidade — ver a seção "indicador de carregamento"
   do styles.css. Com prefers-reduced-motion, o CSS para a animação num quadro
   fixo e o texto continua dizendo o que acontece.

   Carga inicial: com sessão salva, o main.js espera o Cloud.iniciar() (perfil +
   dados) antes do primeiro UI.navegar(), e até lá o #view fica vazio. O bloco
   no fim deste arquivo põe um indicador ali; o primeiro navegar() o substitui.
   Não toca no cloud.js nem na tela de login.
   ============================================================

   porte do componente Bars Spinner do Spell UI (https://spell.sh)
   Sem React/TypeScript/styled-jsx; o Spinner (arco girando) do mesmo pacote
   foi avaliado e ficou de fora. Licença original:

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

(function () {
  'use strict';

  if (typeof UI === 'undefined' || typeof ICO !== 'function') {
    console.warn('[Spinner] carregue icones.js e ui-core.js antes de ui-spinner.js.');
    return;
  }
  // ICO() devolve string vazia, em silêncio, para ícone que não existe
  if (ICO.tem && !ICO.tem('loader')) {
    console.warn('[Spinner] o ícone "loader" não está em icones.js: o indicador vai sair vazio.');
  }

  const TAMANHOS = [14, 16, 20];

  /* botão ocupado → o que livre() devolve. WeakMap: botão que sai do DOM
     (modal fechado, re-render do sync) some daqui sozinho, sem vazar. */
  const ocupados = new WeakMap();

  /* mesmo escape do esc() de store.js; local para o módulo não depender dele */
  function escapar(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function medida(tamanho, padrao) {
    const n = Number(tamanho);
    return TAMANHOS.indexOf(n) >= 0 ? n : padrao;
  }

  /* o SVG já sai de ICO() com aria-hidden="true" e stroke="currentColor" */
  function glifo(t) {
    return ICO('loader', 'spinner spinner-' + t);
  }

  function spinner(tamanho, rotulo) {
    const svg = glifo(medida(tamanho, 16));
    if (!rotulo) return svg;
    const texto = rotulo === true ? 'Carregando' : rotulo;
    return '<span class="spinner-status" role="status">' + svg +
      '<span class="spinner-rotulo">' + escapar(texto) + '</span></span>';
  }

  /* Texto como nó solto, sem <span> (ver .carregando no CSS). O espaço antes do
     texto some dentro de flex (o gap manda) e separa o glifo quando o invólucro
     é inline — um <span> do Chat, ou o CSS ainda velho no cache. */
  function carregando(texto, tamanho) {
    return '<span class="carregando" role="status">' + glifo(medida(tamanho, 14)) + ' ' +
      escapar(texto || 'Carregando') + '</span>';
  }

  function alvo(el) {
    return typeof el === 'string' ? document.getElementById(el) : el;
  }

  /* devolve true se o botão acabou de ficar ocupado e false se já estava (só
     troca o texto) ou se não existe — serve de trava contra clique duplo em
     elemento que não é <button>:  if (!UI.ocupado(el, 'Buscando')) return; */
  function ocupado(botao, texto, tamanho) {
    const el = alvo(botao);
    if (!el || el.nodeType !== 1) return false;
    let estado = ocupados.get(el);
    const agora = !estado;
    if (agora) {
      estado = {
        html: el.innerHTML,
        rotulo: el.textContent.replace(/\s+/g, ' ').trim(),
        disabled: 'disabled' in el ? el.disabled : null,   // só controles de formulário têm disabled
        foco: document.activeElement === el
      };
      ocupados.set(el, estado);
      if (estado.disabled !== null) el.disabled = true;
      el.setAttribute('aria-busy', 'true');
    }
    // DS: glifo de 14 no botão sm/md, 16 no lg
    const t = medida(tamanho, el.classList.contains('btn-lg') ? 16 : 14);
    const rotulo = texto != null && String(texto).trim() ? String(texto) : estado.rotulo;
    el.innerHTML = glifo(t) + ' ' + escapar(rotulo);   // mesmo "ICO(...) + ' texto'" das views
    return agora;
  }

  function livre(botao) {
    const el = alvo(botao);
    const estado = el && ocupados.get(el);
    if (!estado) return false;
    ocupados.delete(el);
    el.innerHTML = estado.html;
    if (estado.disabled !== null) el.disabled = estado.disabled;
    el.removeAttribute('aria-busy');
    // o disabled derruba o foco para o body: quem estava no botão volta para ele
    const ativo = document.activeElement;
    if (estado.foco && el.isConnected && !el.disabled && (!ativo || ativo === document.body)) {
      el.focus({ preventScroll: true });
    }
    return true;
  }

  Object.assign(UI, { spinner, carregando, ocupado, livre });

  /* ---------- carga inicial ----------
     Roda no DOMContentLoaded, que só dispara depois de todos os scripts defer.
     Até lá o main.js já decidiu o caminho:
       · sem nuvem, ou link de nova senha → UI.navegar() já rodou (#nav cheio): nada a fazer
       · nuvem sem sessão → mostrarGate() já escondeu o .app: o indicador não aparece
       · sessão salva → Cloud.iniciar() está esperando a rede: o #view está vazio
     O #nav vazio é o sinal de que navegar() ainda não rodou — renderNav() sempre o preenche. */
  function indicadorInicial() {
    const view = document.getElementById('view');
    const nav = document.getElementById('nav');
    if (!view || !nav) return;   // outra página (ex.: a demo)
    if (nav.childElementCount || view.childElementCount || view.textContent.trim()) return;
    view.innerHTML = '<div class="empty">' + carregando('Carregando seus dados', 20) + '</div>';
  }
  if (document.readyState === 'complete') indicadorInicial();
  else document.addEventListener('DOMContentLoaded', indicadorInicial, { once: true });
})();
