-- ============================================================
-- 001-mv-seed — dados iniciais genéricos do escritório
-- Rodar UMA vez, depois do 000-baseline.sql. É idempotente: cada bloco só insere
-- quando a tabela está vazia (ou, no caso da config, quando a chave não existe),
-- então rodar de novo não duplica nem sobrescreve o que o time já ajustou.
-- ============================================================

-- ---------- Departamentos ----------
insert into departamentos (nome, cor, permissoes)
select * from (values
  ('Comercial',      '#5C7F9E', '{"cadencias_aplicar": true}'::jsonb),
  ('Jurídico',       '#2E333B', '{}'::jsonb),
  ('Financeiro',     '#4C9673', '{}'::jsonb),
  ('Administrativo', '#D9A441', '{}'::jsonb)
) as v(nome, cor, permissoes)
where not exists (select 1 from departamentos);

-- Bancos em que os departamentos já existiam: o Comercial também ganha a alçada de aplicar cadências.
update departamentos
set permissoes = coalesce(permissoes, '{}'::jsonb) || '{"cadencias_aplicar": true}'::jsonb
where nome ilike 'comercial%'
  and not coalesce((permissoes->>'cadencias_aplicar')::boolean, false);

-- ---------- Tags ----------
insert into tags (nome, cor, ordem)
select * from (values
  ('Cliente', '#4C9673', 1),
  ('Lead',    '#5C7F9E', 2),
  ('Urgente', '#C2564B', 3),
  ('Prazo',   '#D9A441', 4)
) as v(nome, cor, ordem)
where not exists (select 1 from tags);

-- ---------- Respostas rápidas do time (dono nulo = de todos) ----------
insert into respostas_rapidas (atalho, titulo, texto)
select * from (values
  ('/oi',        'Saudação',        'Olá, {{nome}}! Aqui é do escritório {{empresa}}. Como posso ajudar?'),
  ('/recebido',  'Recebido',        'Recebemos sua mensagem, {{nome}}. Vamos analisar e retornamos em breve.'),
  ('/docs',      'Documentos',      'Para seguirmos, {{nome}}, precisamos dos seguintes documentos: '),
  ('/agenda',    'Agendamento',     'Podemos agendar uma conversa? Me diga os melhores dias e horários para você.'),
  ('/ausente',   'Fora do horário', 'Olá, {{nome}}. No momento estamos fora do horário de atendimento; retornamos no próximo dia útil.'),
  ('/encerrar',  'Encerramento',    'Obrigado pelo contato, {{nome}}. Ficamos à disposição.')
) as v(atalho, titulo, texto)
where not exists (select 1 from respostas_rapidas);

-- ---------- Configuração geral ----------
insert into config (chave, valor)
values ('geral', '{"empresa": "Marques e Vasques Advogados", "janelaEnvio": "09:00-18:00", "esfriandoHoras": 6, "inatividadeHoras": 6, "autoCriarLead": true, "analiseAutomatica": true}'::jsonb)
on conflict (chave) do nothing;
