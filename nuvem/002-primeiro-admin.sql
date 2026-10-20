-- ============================================================
-- 002-primeiro-admin — torna o primeiro usuário administrador
-- Passo a passo (nesta ordem):
--   1) No painel do Supabase: Authentication → Users → Add user (informe e-mail e senha)
--      e marque Auto Confirm.
--   2) Troque <E-MAIL-DO-SOCIO> abaixo pelo e-mail criado no passo 1.
--   3) Execute este arquivo no SQL Editor. Se o e-mail não existir, o arquivo falha com
--      mensagem clara. Depois disso o administrador gere os demais usuários pela tela
--      de usuários do sistema.
-- ============================================================
do $$
declare n integer;
begin
  update public.perfis set papel = 'admin', ativo = true where lower(email) = lower('<E-MAIL-DO-SOCIO>');
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Nenhum perfil com o e-mail informado. Crie o usuário em Authentication → Users (Auto Confirm) antes de rodar este arquivo.';
  end if;
end $$;
