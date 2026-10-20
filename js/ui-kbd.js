/* ============================================================
   KBD — atalhos de teclado à vista (v6.8)

   Este arquivo NÃO cria atalho nenhum. Os atalhos já existem nos handlers
   de teclado do sistema (views-chat.js, ui-core.js) e
   nenhum aparecia na interface. Aqui só se EXIBE:

     UI.kbd('mod+z')        → HTML com <kbd> semântico, uma tecla por <kbd>
     UI.kbdTexto('mod+z')   → texto puro para title: "⌘Z" no Mac, "Ctrl+Z" no resto
     UI.kbdMac              → true quando a plataforma é Apple
     UI.atalhos('nome')     → abre a legenda de atalhos no modal do sistema
     UI.ATALHOS             → o catálogo da legenda (descreve os handlers)

   "mod" é a tecla de comando da plataforma: ⌘ no Mac, Ctrl no Windows e no
   Linux. Os handlers aceitam ctrlKey || metaKey, então as duas
   funcionam nos dois sistemas; a tela mostra a que é natural em cada um.

   Melhora de DOM sem editar quem o cria (o padrão de ui-abertura.js):
     · um MutationObserver no #modal dá title "Fechar (Esc)" e aria-label aos
       botões .modal-close que ainda não têm nome — é onde o Esc global do
       ui-core.js passa a aparecer.
   ============================================================

   Este arquivo é porte do componente Keyboard Shortcuts (Kbd) do Spell UI (https://spell.sh),
   sem React/TypeScript/Tailwind e sem react-hotkeys-hook. Licença original:

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

const Kbd = (function () {
  'use strict';

  /* ---------------- plataforma ---------------- */

  /* userAgentData só existe no Chromium (e só em https ou localhost); o
     navigator.platform cobre Safari e Firefox. iPad em modo desktop se
     apresenta como "MacIntel" — e o teclado dele tem ⌘, então a leitura vale. */
  function detectarMac() {
    try {
      const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
      return /mac|iphone|ipad|ipod/i.test(p);
    } catch (e) {
      return false;
    }
  }
  const MAC = detectarMac();

  /* opts.mac força a plataforma — para a demo e para testar o Windows num Mac */
  function ehMac(opts) {
    return (opts && typeof opts.mac === 'boolean') ? opts.mac : MAC;
  }

  /* ---------------- teclas ---------------- */

  /* mac / pc: o que aparece. fala: o nome lido pelo leitor de tela quando o
     que aparece é um símbolo. ordemMac / ordemPc: lugar do modificador — o
     macOS escreve ⌃⌥⇧⌘ antes da tecla; o Windows, Ctrl+Alt+Shift.
     Símbolo só nos modificadores do Mac (a convenção dos menus do macOS);
     tecla com nome fica por extenso nos dois sistemas. */
  const TECLAS = {
    mod:       { mac: '⌘', pc: 'Ctrl', fala: 'Command', ordemMac: 3, ordemPc: 0 },
    ctrl:      { mac: '⌃', pc: 'Ctrl', fala: 'Control', ordemMac: 0, ordemPc: 0 },
    alt:       { mac: '⌥', pc: 'Alt', fala: 'Option', ordemMac: 1, ordemPc: 1 },
    shift:     { mac: '⇧', pc: 'Shift', fala: 'Shift', ordemMac: 2, ordemPc: 2 },
    enter:     { mac: 'Enter', pc: 'Enter' },
    esc:       { mac: 'Esc', pc: 'Esc' },
    tab:       { mac: 'Tab', pc: 'Tab' },
    espaco:    { mac: 'Espaço', pc: 'Espaço' },
    delete:    { mac: 'Delete', pc: 'Delete' },
    backspace: { mac: 'Delete', pc: 'Backspace' },   // no teclado do Mac, a tecla de apagar se chama delete
    setas:     { mac: 'Setas', pc: 'Setas' },
    up:        { mac: '↑', pc: '↑', fala: 'seta para cima' },
    down:      { mac: '↓', pc: '↓', fala: 'seta para baixo' },
    left:      { mac: '←', pc: '←', fala: 'seta para a esquerda' },
    right:     { mac: '→', pc: '→', fala: 'seta para a direita' }
  };

  /* nomes do Spell UI (command, option, arrowleft…) continuam valendo */
  const APELIDOS = {
    cmd: 'mod', command: 'mod', control: 'ctrl', option: 'alt', opt: 'alt',
    'return': 'enter', escape: 'esc', del: 'delete', space: 'espaco', 'espaço': 'espaco',
    arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', plus: '+'
  };

  /* 'mod+shift+z' → ['mod', 'shift', 'z']. O "+" do fim é a própria tecla:
     '+' → ['+'] e 'mod++' → ['mod', '+']. */
  function partir(combo) {
    return String(combo == null ? '' : combo).trim().toLowerCase()
      .split(/\+(?!$)/)
      .map(t => t.trim())
      .filter(Boolean)
      .map(t => APELIDOS[t] || t);
  }

  function rotulo(t, mac) {
    const k = TECLAS[t];
    if (k) return mac ? k.mac : k.pc;
    return t.length === 1 ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1);
  }

  /* modificadores primeiro, na ordem da plataforma; o resto mantém a ordem
     dada (o sort do ES2019 é estável). Rótulo repetido sai: no PC, mod e
     ctrl são o mesmo Ctrl. */
  function teclasDe(combo, mac) {
    const peso = t => {
      const k = TECLAS[t];
      const o = k && (mac ? k.ordemMac : k.ordemPc);
      return typeof o === 'number' ? o : 9;
    };
    const vistos = new Set();
    return partir(combo)
      .sort((a, b) => peso(a) - peso(b))
      .filter(t => {
        const r = rotulo(t, mac);
        if (vistos.has(r)) return false;
        vistos.add(r);
        return true;
      });
  }

  function escapar(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function teclaHTML(t, mac) {
    const k = TECLAS[t];
    const vis = rotulo(t, mac);
    // símbolo (⌘ ⇧ ← …): o leitor de tela ouve o nome da tecla, não o nome do glifo
    if (k && k.fala && vis.length === 1) {
      return `<kbd><span aria-hidden="true">${vis}</span><span class="kbd-sr">${escapar(k.fala)}</span></kbd>`;
    }
    return `<kbd>${escapar(vis)}</kbd>`;
  }

  function comboHTML(combo, mac) {
    const teclas = teclasDe(combo, mac);
    if (!teclas.length) return '';
    // no Mac os símbolos andam juntos (⇧⌘Z); no Windows e no Linux, Ctrl+Shift+Z
    const sep = mac ? '' : '<span class="kbd-mais" aria-hidden="true">+</span>';
    return `<kbd class="kbd">${teclas.map(t => teclaHTML(t, mac)).join(sep)}</kbd>`;
  }

  function comboTexto(combo, mac) {
    return teclasDe(combo, mac).map(t => rotulo(t, mac)).join(mac ? '' : '+');
  }

  /* UI.kbd('mod+z')                    → uma combinação
     UI.kbd(['mod+shift+z', 'mod+y'])   → alternativas separadas por "ou";
                                          as que ficam iguais na plataforma saem
                                          (Delete e Backspace são uma só no Mac) */
  function kbd(combo, opts) {
    const mac = ehMac(opts);
    const vistos = new Set();
    return (Array.isArray(combo) ? combo : [combo])
      .filter(c => {
        const txt = comboTexto(c, mac);
        if (!txt || vistos.has(txt)) return false;
        vistos.add(txt);
        return true;
      })
      .map(c => comboHTML(c, mac))
      .join(' <span class="kbd-ou">ou</span> ');
  }

  /* texto puro, para title="…": `Desfazer (${UI.kbdTexto('mod+z')})` → "Desfazer (⌘Z)" */
  function kbdTexto(combo, opts) {
    const mac = ehMac(opts);
    const lista = (Array.isArray(combo) ? combo : [combo]).map(c => comboTexto(c, mac)).filter(Boolean);
    return Array.from(new Set(lista)).join(' ou ');
  }

  /* ---------------- catálogo das legendas ----------------
     Descreve handlers que JÁ EXISTEM — mudou o handler, mude aqui. Cada entrada
     é { titulo, sub, abre, grupos }, aberta por UI.atalhos('<nome>'). Vazio por
     enquanto: nenhuma tela do sistema tem legenda de atalhos.
     edita: true → sai da legenda quando o usuário só pode ler. */
  const ATALHOS = {};

  /* ---------------- legenda ---------------- */

  function entradaHTML(item, mac) {
    const teclas = item.teclas ? kbd(item.teclas, { mac }) : '';
    const gesto = item.gesto ? `<span class="kbd-gesto">${escapar(item.gesto)}</span>` : '';
    if (teclas && gesto) return `${teclas}<span class="kbd-gesto" aria-hidden="true">+</span>${gesto}`;
    return teclas || gesto;
  }

  function legendaHTML(cat, o) {
    const mac = ehMac(o);
    const grupos = cat.grupos
      .map(g => ({ rotulo: g.rotulo, itens: (g.itens || []).filter(i => !(o.leitura && i.edita)) }))
      .filter(g => g.itens.length);
    const abre = cat.abre ? ` ${kbd(cat.abre, { mac })} abre esta lista.` : '';
    const leitura = o.leitura ? ' Em modo leitura, os atalhos de edição ficam de fora.' : '';
    return `<div class="kbd-legenda" tabindex="-1">
      <h2><span class="kbd-legenda-titulo" id="kbd-legenda-titulo">${ICO('keyboard')}${escapar(cat.titulo)}</span>
        <button type="button" class="modal-close" aria-label="Fechar" title="Fechar (${escapar(kbdTexto('esc', { mac }))})" onclick="UI.fecharModal()">${ICO('x')}</button></h2>
      <p class="kbd-legenda-sub">${escapar(cat.sub || '')}${abre}${leitura}</p>
      <div class="kbd-legenda-grupos">${grupos.map(g => `
        <div class="kbd-legenda-grupo">
          <h3 class="kbd-legenda-rotulo">${escapar(g.rotulo)}</h3>
          <dl>${g.itens.map(i => `
            <div class="kbd-legenda-item"><dt>${escapar(i.faz)}</dt><dd>${entradaHTML(i, mac)}</dd></div>`).join('')}
          </dl>
        </div>`).join('')}
      </div>
    </div>`;
  }

  /* enquanto a legenda está aberta: { origem } — quem tinha o foco antes */
  let legenda = null;

  function elementos() {
    const m = document.getElementById('modal');
    const bd = document.getElementById('modal-backdrop');
    const raiz = m && m.querySelector('.kbd-legenda');
    return { m, bd, raiz, aberta: !!(raiz && bd && !bd.hidden) };
  }

  /* UI.atalhos('nome', { leitura, mac }) — ou um catálogo no mesmo formato */
  function atalhos(nome, opts) {
    const cat = typeof nome === 'string' ? ATALHOS[nome] : nome;
    if (!cat || !Array.isArray(cat.grupos)) {
      console.warn('[Kbd] legenda de atalhos desconhecida:', nome);
      return null;
    }
    const o = opts || {};
    const origem = legenda ? legenda.origem : document.activeElement;
    const m = UI.modal(legendaHTML(cat, o), { large: true });
    legenda = { origem };
    // o #modal é compartilhado: os dois atributos saem quando a legenda sai (aoMudarModal)
    m.setAttribute('aria-labelledby', 'kbd-legenda-titulo');
    m.setAttribute('aria-modal', 'true');
    const { bd, raiz } = elementos();
    if (bd) bd.scrollTop = 0;
    // o foco entra na janela: o leitor de tela anuncia o título e as setas rolam a lista
    if (raiz) raiz.focus({ preventScroll: true });
    return m;
  }

  function prenderTab(ev, raiz) {
    const focaveis = Array.from(raiz.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    if (!focaveis.length) { ev.preventDefault(); raiz.focus({ preventScroll: true }); return; }
    const primeiro = focaveis[0], ultimo = focaveis[focaveis.length - 1];
    const ativo = document.activeElement;
    const dentro = raiz.contains(ativo);
    if (ev.shiftKey && (!dentro || ativo === raiz || ativo === primeiro)) { ev.preventDefault(); ultimo.focus(); }
    else if (!ev.shiftKey && (!dentro || ativo === ultimo)) { ev.preventDefault(); primeiro.focus(); }
  }

  /* Fase de CAPTURA no documento: roda antes do Esc do ui-core e do teclado da
     demais telas, que escutam na fase de bolha. Sem isto, o Esc que fecha a
     legenda chegaria também ao handler da tela que está por baixo. Só age com
     a legenda aberta. */
  function aoTeclar(ev) {
    if (!legenda) return;
    const { raiz, aberta } = elementos();
    if (!aberta) return;
    if (ev.key === 'Escape' || ev.key === '?') {
      ev.preventDefault();
      ev.stopPropagation();
      UI.fecharModal();
      return;
    }
    if (ev.key === 'Tab') prenderTab(ev, raiz);
  }

  /* dá nome ao "x" das janelas: title com o atalho, aria-label para o leitor de tela */
  function nomearFechar(m) {
    m.querySelectorAll('.modal-close').forEach(b => {
      if (!b.hasAttribute('title')) b.setAttribute('title', `Fechar (${kbdTexto('esc')})`);
      if (!b.hasAttribute('aria-label') && !b.textContent.trim()) b.setAttribute('aria-label', 'Fechar');
    });
  }

  function aoMudarModal() {
    const { m, bd, raiz } = elementos();
    if (!m) return;
    nomearFechar(m);
    if (!legenda || raiz) return;
    // a legenda saiu (fechou, ou outra janela tomou o lugar)
    const { origem } = legenda;
    legenda = null;
    if (m.getAttribute('aria-labelledby') === 'kbd-legenda-titulo') {
      m.removeAttribute('aria-labelledby');
      m.removeAttribute('aria-modal');
    }
    if (bd && !bd.hidden) return;                                   // outra janela: o foco é dela
    const ativo = document.activeElement;
    if (ativo && ativo !== document.body && ativo.isConnected) return; // o foco já achou lugar
    // devolve o foco a quem abriu; se a barra de origem foi redesenhada, ao botão novo
    const alvo = (origem && origem.isConnected) ? origem : document.querySelector('[data-kbd-legenda]');
    if (alvo && typeof alvo.focus === 'function') alvo.focus({ preventScroll: true });
  }

  function init() {
    const m = document.getElementById('modal');
    if (m) {
      nomearFechar(m);
      new MutationObserver(aoMudarModal).observe(m, { childList: true });
    }
    document.addEventListener('keydown', aoTeclar, true);
  }

  return { init, kbd, kbdTexto, atalhos, ATALHOS, mac: MAC };
})();

/* helpers de template no objeto UI, ao lado de UI.modal e UI.toast */
Object.assign(UI, {
  kbd: Kbd.kbd,
  kbdTexto: Kbd.kbdTexto,
  kbdMac: Kbd.mac,
  atalhos: Kbd.atalhos,
  ATALHOS: Kbd.ATALHOS
});

Kbd.init();
