/* ============ UI-TEMA — modo noturno (DESIGN.md §11) ============
   Preferência por aparelho, em localStorage (ESCRITORIO.chaves.tema): 'claro' (padrão),
   'escuro' ou 'auto' (segue o sistema operacional). O <head> do index.html
   aplica o data-tema antes do primeiro paint, para a página não piscar;
   aqui fica só a troca em tempo de uso e o botão.
   Quem desenha com cor em JS (gráficos) ouve o evento ESCRITORIO.evento.tema. */
(function () {
  const CHAVE = ESCRITORIO.chaves.tema;
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function preferencia() {
    try { return localStorage.getItem(CHAVE) || 'claro'; } catch (e) { return 'claro'; }
  }
  function efetivo(pref) {
    if (pref === 'auto') return mq && mq.matches ? 'escuro' : 'claro';
    return pref === 'escuro' ? 'escuro' : 'claro';
  }
  function aplicar(pref) {
    const t = efetivo(pref);
    document.documentElement.dataset.tema = t;
    document.querySelectorAll('[data-tema-botao]').forEach(b => {
      b.setAttribute('aria-pressed', String(t === 'escuro'));
      b.innerHTML = (t === 'escuro' ? ICO('sun') : ICO('moon')) + ' ' + (t === 'escuro' ? 'Modo claro' : 'Modo noturno');
    });
    document.dispatchEvent(new CustomEvent(ESCRITORIO.evento.tema, { detail: { tema: t, preferencia: pref } }));
  }
  function definir(pref) {
    try { localStorage.setItem(CHAVE, pref); } catch (e) {}
    aplicar(pref);
  }
  function alternar() { definir(efetivo(preferencia()) === 'escuro' ? 'claro' : 'escuro'); }

  if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (preferencia() === 'auto') aplicar('auto'); });

  UI.tema = { atual: () => efetivo(preferencia()), preferencia, definir, alternar, aplicar: () => aplicar(preferencia()) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => aplicar(preferencia()));
  else aplicar(preferencia());
})();
