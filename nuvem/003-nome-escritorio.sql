-- ============================================================
-- 003 — Nome do escritório (Vasques Alves Advogados) e cores da identidade na seed (aditiva; segura para rodar mais de uma vez)
-- O 001-mv-seed.sql gravou config.geral.empresa com o nome provisório. Corrige só essa chave.
-- ============================================================
update config
   set valor = jsonb_set(coalesce(valor, '{}'::jsonb), '{empresa}', '"Vasques Alves Advogados"'::jsonb)
 where chave = 'geral'
   and coalesce(valor->>'empresa', '') <> 'Vasques Alves Advogados';

-- Cores da seed (001) trocadas pelas da identidade Vasques Alves, só onde ninguém mudou a cor
update departamentos set cor = '#556B5E' where nome = 'Comercial'      and lower(cor) = '#5c7f9e';  -- sálvia escura
update departamentos set cor = '#041650' where nome = 'Jurídico'       and lower(cor) = '#2e333b';  -- marinho
update departamentos set cor = '#4F6AA5' where nome = 'Administrativo' and lower(cor) = '#d9a441';  -- marinho claro
update tags          set cor = '#556B5E' where nome = 'Lead'           and lower(cor) = '#5c7f9e';  -- sálvia escura
