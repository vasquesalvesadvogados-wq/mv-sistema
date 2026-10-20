/* ============ AI — IA do escritório, pelo motor ============
   A chave da Anthropic fica SÓ no motor (variável ANTHROPIC_API_KEY no Railway).
   Este módulo não fala com a Anthropic: grava um comando ia_* em motor_comandos
   com os DADOS (conversa em texto, pergunta, lead, pedido) e espera o motor
   responder, do mesmo jeito que a transcrição de áudio. Prompts, esquemas de
   saída e contexto do escritório moram em motor/ia.js; alçada, visibilidade da
   conversa e limite por pessoa são conferidos lá também.
   Fora da nuvem (?semnuvem, uso local) não há motor: a IA não existe.
   Spec: nuvem/PLANO-IA-ESCRITORIO.md
================================================================================ */

const AI = (() => {

  /* mesma lista do motor; o admin escolhe em Configurações e vale para todos (config.geral.modeloIA) */
  const MODELOS = [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (recomendado)' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (rápido e mais barato)' }
  ];
  const ESPERA_S = 120;   // a análise profunda pode levar perto de um minuto

  const nuvem = () => typeof Cloud !== 'undefined' && Cloud.ativo();
  const admin = () => nuvem() && Cloud.admin();

  /* "configurada" = modo nuvem. Se a chave faltar no motor, o erro diz isso na hora. */
  function configurado() { return nuvem(); }

  /* erros do motor na linguagem de quem usa; o admin recebe o detalhe técnico */
  function traduzirErro(e) {
    const m = String((e && e.message) || e || '');
    if (/comando desconhecido/.test(m)) return new Error('O motor ainda não foi atualizado para a IA do escritório. Avise o administrador.');
    if (/não configurada/.test(m)) return new Error(admin() ? m : 'IA do escritório não configurada. Avise o administrador.');
    if (e && e.prazoEsgotado) return new Error('A IA demorou demais. Tente de novo em instantes.');
    return e instanceof Error ? e : new Error(m);
  }

  async function executar(tipo, payload) {
    if (!nuvem()) throw new Error('A IA do escritório funciona só no sistema publicado (modo nuvem).');
    try {
      const cmd = await Cloud.enviarComando(tipo, payload);
      const r = await Cloud.aguardarComando(cmd.id, ESPERA_S);
      return r.resultado || {};
    } catch (e) { throw traduzirErro(e); }
  }

  /* Configurações → IA do escritório → Testar. Devolve { ok, modelo, uso }. */
  async function testar() { return executar('ia_teste', {}); }

  /* CRM: análise profunda da conversa (devolve o JSON do SCHEMA do motor). Sem conversaId: a
     análise não carrega a conversa, e o texto já está na ficha de quem pede. */
  async function analisarConversa(analise, lead) {
    const r = await executar('ia_analise', {
      conversaTexto: analise.conversaTexto,
      atendente: analise.atendente,
      lead: lead ? { nome: lead.nome, empresa: lead.empresa, dor: lead.dor, valor: lead.valor, etapa: lead.etapa } : null
    });
    return r.dados;
  }

  /* Chat: resumo e busca na conversa. conversaId permite ao motor conferir que quem pede enxerga a conversa. */
  async function resumirConversa(transcript, nomeContato, conversaId) {
    const r = await executar('ia_resumo', { conversaId, transcript, nomeContato });
    return r.texto;
  }

  async function perguntarConversa(transcript, pergunta, nomeContato, conversaId) {
    const r = await executar('ia_pergunta', { conversaId, transcript, pergunta, nomeContato });
    return r.texto;
  }

  /* Automações: pedido em linguagem natural → automação quando→se→então (JSON do motor) */
  async function gerarAutomacao(pedido, contexto) {
    const r = await executar('ia_automacao', { pedido, contexto });
    return r.dados;
  }

  return { MODELOS, configurado, testar, analisarConversa, resumirConversa, perguntarConversa, gerarAutomacao };
})();
