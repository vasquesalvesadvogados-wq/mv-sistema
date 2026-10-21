/* ============ MAIN — inicialização ============ */

/* versão publicada — precisa bater com versao.json e com o ?v= do index.html */
const APP_VERSAO = '1.0.9';

/* ---------- rede de segurança: nenhum erro some em silêncio ----------
   Antes, uma exceção num pulso ou numa ação deixava a tela parada sem aviso.
   Agora vai para o console com contexto e o atendente vê um aviso discreto
   (no máximo um a cada 30 s, para não virar enxurrada). */
(function () {
  let ultimoAviso = 0;
  const ignorar = msg => /ResizeObserver loop|Script error\.?$/i.test(String(msg || ''));
  function avisar(origem, err) {
    const msg = (err && (err.message || err.reason)) || String(err || '');
    if (ignorar(msg)) return;
    console.error(ESCRITORIO.log + ' erro não tratado (' + origem + '):', err);
    if (Date.now() - ultimoAviso < 30000 || typeof UI === 'undefined' || !UI.toast) return;
    ultimoAviso = Date.now();
    UI.toast('Algo deu errado nesta tela. Se continuar, recarregue a página (F5).', 'err');
  }
  window.addEventListener('error', ev => {
    // erros de extensões do navegador e de outros sites não são nossos
    if (ev.filename && !ev.filename.startsWith(location.origin)) return;
    avisar('error', ev.error || ev.message);
  });
  window.addEventListener('unhandledrejection', ev => avisar('promise', ev.reason));
})();

/* ---------- nova versão publicada ----------
   js/ e css/ ficam em cache por 1 ano: sem este aviso, quem deixa a aba aberta
   rodaria o código antigo por dias — e, depois de uma mudança no banco, a aba
   velha pararia de sincronizar. */
async function conferirVersao() {
  try {
    const r = await fetch('versao.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const v = (await r.json()).versao;
    if (!v || v === APP_VERSAO || document.getElementById('versao-aviso')) return;
    const el = document.createElement('div');
    el.id = 'versao-aviso';
    el.setAttribute('role', 'status');
    el.innerHTML = `${ICO('refresh-cw')} Há uma versão nova do sistema.
      <button type="button" onclick="location.reload()">Recarregar agora</button>`;
    document.body.appendChild(el);
  } catch (e) { /* sem rede: tenta na próxima */ }
}

(async function init() {
  try {
    loadState();
    Cadence.all(); // garante cadências padrão no estado
    UI.hydrateIcons(document);
    UI.aplicarMarca();
    window.addEventListener('hashchange', UI.navegar);
    if (!location.hash) location.hash = '#/inicio';

    // modo nuvem: exige login antes de abrir o app
    if (typeof Cloud !== 'undefined' && Cloud.configurado()) {
      setInterval(conferirVersao, 5 * 60000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) conferirVersao(); });
      Cloud.prepararGate();
      const ok = await Cloud.iniciar(); // retoma sessão salva, se houver
      if (!ok) { Cloud.mostrarGate(); return; }
    }
    UI.navegar();
  } catch (e) {
    console.error(ESCRITORIO.log + ' falha ao iniciar:', e);
    const g = document.getElementById('auth-gate');
    if (g && typeof Cloud !== 'undefined') Cloud.mostrarGate('Não foi possível abrir o sistema: ' + (e.message || e) + ' — recarregue a página.');
  }
})();
