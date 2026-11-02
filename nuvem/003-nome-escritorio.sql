-- ============================================================
-- 003 — Nome do escritório: Vasques Alves Advogados (aditiva; segura para rodar mais de uma vez)
-- O 001-mv-seed.sql gravou config.geral.empresa com o nome provisório. Corrige só essa chave.
-- ============================================================
update config
   set valor = jsonb_set(coalesce(valor, '{}'::jsonb), '{empresa}', '"Vasques Alves Advogados"'::jsonb)
 where chave = 'geral'
   and coalesce(valor->>'empresa', '') <> 'Vasques Alves Advogados';
