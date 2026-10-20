/* ============ ESCRITÓRIO — identidade do sistema (única fonte de nomes) ============
   Tudo o que aparece com o nome do escritório ou do sistema lê daqui.
   Nenhum outro arquivo escreve nome de escritório, sistema ou plataforma.
   Carregado síncrono, antes de tudo: o <script> do tema no <head> lê a chave daqui. */
const ESCRITORIO = Object.freeze({
  nome: 'Marques e Vasques Advogados',
  sistema: 'Marques e Vasques · Sistema',   // <title>, "Sair do …?", abertura
  curto: 'MV',                              // brand-name, monograma, título de fallback
  subtitulo: 'Sistema',                     // brand-sub no hub e linha da abertura
  plataformas: Object.freeze({ chat: 'Chat', crm: 'CRM' }),
  dominioEmail: 'marquesevasques.adv.br',   // placeholders de e-mail (confirmar com o cliente)
  logoSVG: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor" opacity=".18"/><text x="12" y="16" text-anchor="middle" font-family="DM Mono, monospace" font-size="9.5" font-weight="500" fill="currentColor">MV</text></svg>',
  arquivo: 'mv',                            // prefixo dos arquivos exportados
  log: '[MV]',
  chaves: Object.freeze({ estado: 'mv_v1', sessao: 'mv_sessao', atividade: 'mv_atividade',
    motivoSaida: 'mv_motivo_saida', ia: 'mv_ia', tema: 'mv_tema', chatPrefs: 'mv_chat_prefs', emojis: 'mv_emojis_' }),
  evento: Object.freeze({ tema: 'mv:tema' })
});
document.title = ESCRITORIO.sistema;
