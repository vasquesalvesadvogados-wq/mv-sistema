-- 000-baseline — esquema completo do mv-sistema (CRM + Chat + usuários/alçadas). Aplicar UMA vez num projeto vazio.
-- Gerado em 19/10/2026 pela concatenação, na ordem provada, das migrações de origem; comentários limpos.

-- [origem: schema.sql]
-- ============================================================
-- Sistema — Estrutura do banco de dados (Supabase)
-- Cole este arquivo inteiro no SQL Editor do Supabase e execute.
-- ============================================================

-- ---------- Perfis dos usuários (time) ----------
create table if not exists perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  papel text not null default 'atendente' check (papel in ('admin', 'atendente')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- cria o perfil automaticamente quando um usuário é convidado/cadastrado
create or replace function criar_perfil()
returns trigger language plpgsql security definer as $$
begin
  insert into perfis (id, nome) values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function criar_perfil();

-- ---------- Leads ----------
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text not null default '',
  email text not null default '',
  empresa text not null default '',
  link text not null default '',            -- link da conversa (chat do CRM/WhatsApp)
  tags text[] not null default '{}',
  area text not null default '',            -- área do caso (Imobiliário, Trabalhista...)
  perfil text not null default '',          -- A / B / C
  origem text not null default '',
  etapa text not null default 'Novo',
  temperatura text not null default 'Morno',
  valor numeric not null default 0,         -- valor potencial
  dor text not null default '',
  notas text not null default '',
  motivo_perda text not null default '',
  dono uuid references perfis(id),          -- atendente responsável (preparado p/ multiatendente)
  ganho_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_leads_etapa on leads(etapa);
create index if not exists idx_leads_criado on leads(criado_em);
create index if not exists idx_leads_telefone on leads(telefone);

-- carimbo automático de atualização
create or replace function carimbar_atualizacao()
returns trigger language plpgsql as $$
begin
  new.atualizado_em = now();
  return new;
end $$;

drop trigger if exists ao_atualizar_lead on leads;
create trigger ao_atualizar_lead before update on leads
  for each row execute function carimbar_atualizacao();

-- ---------- Contratos (serviços contratados) ----------
create table if not exists contratos (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  servico text not null,
  data date not null default current_date,
  valor numeric not null default 0,
  forma_pagamento text not null default '',
  parcelas int not null default 1,
  desconto numeric not null default 0,
  obs text not null default '',
  criado_em timestamptz not null default now()
);

create index if not exists idx_contratos_lead on contratos(lead_id);
create index if not exists idx_contratos_data on contratos(data);

-- ---------- Follow-ups (agenda de cadências) ----------
create table if not exists followups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  cadencia_id text not null default '',
  cadencia_nome text not null default '',
  passo_index int not null default 0,
  dia int not null default 0,
  canal text not null default 'WhatsApp',
  titulo text not null default '',
  objetivo text not null default '',
  template text not null default '',
  due_date date not null,
  status text not null default 'pendente' check (status in ('pendente', 'feito', 'pulado', 'cancelado')),
  feito_em timestamptz,
  motivo text not null default '',
  criado_em timestamptz not null default now()
);

create index if not exists idx_followups_due on followups(status, due_date);
create index if not exists idx_followups_lead on followups(lead_id);

-- ---------- Análises de atendimento ----------
-- o resultado completo da análise (scores, findings, respostas) vai em JSON
create table if not exists analises (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete set null,
  score int,
  temperatura text not null default '',
  dados jsonb not null,
  criado_em timestamptz not null default now()
);

create index if not exists idx_analises_lead on analises(lead_id);

-- ---------- Cadências (modelos de follow-up editáveis) ----------
create table if not exists cadencias (
  id text primary key,
  nome text not null,
  cenario text not null default '',
  ref text not null default '',
  passos jsonb not null default '[]'
);

-- ---------- Configurações do escritório ----------
create table if not exists config (
  chave text primary key,
  valor jsonb not null
);

-- ============================================================
-- Segurança (RLS): só usuários logados e ativos acessam os dados
-- ============================================================
alter table perfis enable row level security;
alter table leads enable row level security;
alter table contratos enable row level security;
alter table followups enable row level security;
alter table analises enable row level security;
alter table cadencias enable row level security;
alter table config enable row level security;

create or replace function usuario_ativo()
returns boolean language sql security definer stable as $$
  select exists (select 1 from perfis where id = auth.uid() and ativo);
$$;

-- base compartilhada: todo o time ativo vê e edita os mesmos dados
do $$
declare t text;
begin
  foreach t in array array['leads', 'contratos', 'followups', 'analises', 'cadencias', 'config'] loop
    execute format('drop policy if exists acesso_time on %I', t);
    execute format('create policy acesso_time on %I for all to authenticated using (usuario_ativo()) with check (usuario_ativo())', t);
  end loop;
end $$;

-- perfis: cada um vê todos (para exibir nomes), edita só o próprio; admin edita todos
drop policy if exists perfis_ver on perfis;
create policy perfis_ver on perfis for select to authenticated using (usuario_ativo());
drop policy if exists perfis_editar_proprio on perfis;
create policy perfis_editar_proprio on perfis for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- [origem: schema-ajustes.sql]
-- ============================================================
-- Sistema — AJUSTES (rodar DEPOIS do schema.sql)
-- Cole tudo no SQL Editor do Supabase e execute (Run).
-- ============================================================

-- 1) E-mail visível no perfil (para a tela de Equipe)
alter table public.perfis add column if not exists email text not null default '';

-- 2) Correção do gatilho de criação de perfil
--    (precisa de search_path fixo para funcionar no Supabase)
create or replace function public.criar_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (id, nome, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.criar_perfil();

-- 3) Segurança: novos usuários entram DESATIVADOS
--    (o administrador libera o acesso na tela Equipe do sistema)
alter table public.perfis alter column ativo set default false;

-- 4) Funções auxiliares com search_path fixo
create or replace function public.usuario_ativo()
returns boolean language sql security definer stable
set search_path = public
as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo);
$$;

create or replace function public.eh_admin()
returns boolean language sql security definer stable
set search_path = public
as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo and papel = 'admin');
$$;

-- 5) Administrador pode gerenciar a equipe (ativar/desativar, mudar papel)
drop policy if exists perfis_admin_gerencia on public.perfis;
create policy perfis_admin_gerencia on public.perfis
  for update to authenticated
  using (public.eh_admin())
  with check (public.eh_admin());

-- cada usuário pode criar o próprio perfil (reserva, caso o gatilho não rode)
drop policy if exists perfis_criar_proprio on public.perfis;
create policy perfis_criar_proprio on public.perfis
  for insert to authenticated
  with check (id = auth.uid());

-- usuário consegue ver o próprio perfil mesmo antes de ser ativado
drop policy if exists perfis_ver_proprio on public.perfis;
create policy perfis_ver_proprio on public.perfis
  for select to authenticated
  using (id = auth.uid());

-- 6) Preenche e-mails de usuários já existentes (se houver)
update public.perfis p set email = u.email
from auth.users u where u.id = p.id and p.email = '';

-- [origem: atendimento.sql]
-- ============================================================
-- Sistema — Módulo ATENDIMENTO (Fase 1)
-- Cole tudo no SQL Editor do Supabase e execute (Run).
-- Cria: departamentos, conversas, mensagens, respostas rápidas
-- e o estado do motor WhatsApp (para a Fase 2).
-- ============================================================

-- ---------- Departamentos ----------
create table if not exists departamentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cor text not null default '#5e8ab4',
  criado_em timestamptz not null default now()
);

-- ---------- Conversas (1 por número de WhatsApp) ----------
create table if not exists conversas (
  id uuid primary key default gen_random_uuid(),
  telefone text not null unique,          -- só dígitos, com DDI (5511...)
  nome text not null default '',
  foto_url text not null default '',
  lead_id uuid references leads(id) on delete set null,
  departamento_id uuid references departamentos(id) on delete set null,
  responsavel uuid references perfis(id) on delete set null,
  status text not null default 'aberto'
    check (status in ('aberto', 'em_atendimento', 'aguardando', 'resolvido', 'fechado')),
  tags text[] not null default '{}',
  nao_lidas int not null default 0,
  ultima_msg text not null default '',
  ultima_msg_em timestamptz,
  arquivada boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_conversas_ordem on conversas(arquivada, ultima_msg_em desc);
create index if not exists idx_conversas_status on conversas(status);

drop trigger if exists ao_atualizar_conversa on conversas;
create trigger ao_atualizar_conversa before update on conversas
  for each row execute function carimbar_atualizacao();

-- ---------- Mensagens ----------
create table if not exists mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references conversas(id) on delete cascade,
  direcao text not null check (direcao in ('entrada', 'saida')),
  tipo text not null default 'texto'
    check (tipo in ('texto', 'imagem', 'audio', 'video', 'arquivo', 'anotacao')),
  texto text not null default '',
  midia_url text not null default '',
  autor uuid references perfis(id) on delete set null,   -- null = mensagem do cliente
  agendada_para timestamptz,                             -- envio programado
  status text not null default 'pendente'
    check (status in ('recebida', 'pendente', 'agendada', 'enviando', 'enviada', 'entregue', 'lida', 'erro')),
  erro text not null default '',
  externo_id text not null default '',                   -- id da mensagem no WhatsApp (Fase 2)
  criado_em timestamptz not null default now()
);

create index if not exists idx_mensagens_conversa on mensagens(conversa_id, criado_em);
create index if not exists idx_mensagens_fila on mensagens(status) where status in ('pendente', 'agendada');

-- ---------- Respostas rápidas (compartilhadas ou pessoais) ----------
create table if not exists respostas_rapidas (
  id uuid primary key default gen_random_uuid(),
  atalho text not null,                                  -- ex.: /pagamento
  titulo text not null default '',
  texto text not null,
  dono uuid references perfis(id) on delete cascade,     -- null = do time inteiro
  criado_em timestamptz not null default now()
);

-- ---------- Estado do motor WhatsApp (Fase 2: QR code e sessão) ----------
create table if not exists motor_estado (
  id text primary key default 'principal',
  situacao text not null default 'desconectado'
    check (situacao in ('desconectado', 'aguardando_qr', 'conectado', 'erro')),
  qr text not null default '',
  numero text not null default '',
  detalhe text not null default '',
  atualizado_em timestamptz not null default now()
);

create table if not exists motor_sessao (
  chave text primary key,
  valor jsonb not null,
  atualizado_em timestamptz not null default now()
);

-- ---------- Segurança (mesma regra do resto: time ativo) ----------
alter table departamentos enable row level security;
alter table conversas enable row level security;
alter table mensagens enable row level security;
alter table respostas_rapidas enable row level security;
alter table motor_estado enable row level security;
alter table motor_sessao enable row level security;

do $$
declare t text;
begin
  foreach t in array array['departamentos', 'conversas', 'mensagens', 'respostas_rapidas', 'motor_estado', 'motor_sessao'] loop
    execute format('drop policy if exists acesso_time on %I', t);
    execute format('create policy acesso_time on %I for all to authenticated using (usuario_ativo()) with check (usuario_ativo())', t);
  end loop;
end $$;

-- ---------- Tempo real (a aba de atendimento assina novidades) ----------
do $$
begin
  begin
    alter publication supabase_realtime add table mensagens;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table conversas;
  exception when duplicate_object then null;
  end;
end $$;

-- [origem: chat-v2.sql]
-- ============================================================
-- CHAT v2 — plataforma de atendimento completa
-- Cole tudo no SQL Editor do Supabase e execute (Run).
-- Habilita: mídias (fotos/vídeos/áudios/documentos), grupos,
-- tags, notificações, menções, transcrição, comandos do motor
-- e permissões por departamento.
-- É seguro rodar mais de uma vez.
-- ============================================================

-- ---------- 1. Conversas: grupos e foto ----------
alter table conversas add column if not exists tipo text not null default 'individual';
alter table conversas add column if not exists grupo_jid text not null default '';
alter table conversas add column if not exists participantes jsonb not null default '[]';

do $$ begin
  alter table conversas add constraint conversas_tipo_check check (tipo in ('individual','grupo'));
exception when duplicate_object then null; end $$;

create index if not exists idx_conversas_grupo on conversas(grupo_jid) where grupo_jid <> '';

-- ---------- 2. Mensagens: mídia, menções, transcrição ----------
alter table mensagens drop constraint if exists mensagens_tipo_check;
alter table mensagens add constraint mensagens_tipo_check
  check (tipo in ('texto','imagem','audio','video','arquivo','figurinha','anotacao'));

alter table mensagens add column if not exists midia_mime text not null default '';
alter table mensagens add column if not exists midia_nome text not null default '';
alter table mensagens add column if not exists midia_tamanho bigint not null default 0;
alter table mensagens add column if not exists midia_ptt boolean not null default false;   -- áudio gravado (voice note)
alter table mensagens add column if not exists transcricao text not null default '';
alter table mensagens add column if not exists mencoes uuid[] not null default '{}';       -- perfis marcados em anotações
alter table mensagens add column if not exists remetente text not null default '';         -- quem falou (grupos)

-- ---------- 3. Perfis: departamento do atendente ----------
alter table perfis add column if not exists departamento_id uuid references departamentos(id) on delete set null;

-- ---------- 4. Tags (gerenciadas pelo painel de tags) ----------
create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  cor text not null default '#5e8ab4',
  criado_em timestamptz not null default now()
);

-- ---------- 5. Notificações internas (menções e avisos) ----------
create table if not exists notificacoes (
  id uuid primary key default gen_random_uuid(),
  perfil_id uuid not null references perfis(id) on delete cascade,
  tipo text not null default 'mencao',           -- mencao | delegacao | aviso
  conversa_id uuid references conversas(id) on delete cascade,
  texto text not null default '',
  lida boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists idx_notif_perfil on notificacoes(perfil_id, lida, criado_em desc);

-- ---------- 6. Comandos para o motor (grupos, fotos...) ----------
create table if not exists motor_comandos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,                            -- criar_grupo | grupo_add | grupo_remover | grupo_membros | atualizar_foto
  payload jsonb not null default '{}',
  autor uuid references perfis(id) on delete set null,
  status text not null default 'pendente'
    check (status in ('pendente','processando','ok','erro')),
  resultado jsonb,
  erro text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_comandos_fila on motor_comandos(status, criado_em) where status = 'pendente';

-- ---------- 7. Storage: bucket de mídias ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('midias', 'midias', true, 62914560)     -- 60 MB por arquivo
on conflict (id) do update set public = true, file_size_limit = 62914560;

drop policy if exists midias_upload on storage.objects;
create policy midias_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'midias' and usuario_ativo());

drop policy if exists midias_leitura on storage.objects;
create policy midias_leitura on storage.objects
  for select to authenticated
  using (bucket_id = 'midias');

-- ---------- 8. Permissões por departamento ----------
-- admin vê tudo; atendente vê conversas do seu departamento,
-- sem departamento ou delegadas diretamente a ele.
create or replace function meu_departamento() returns uuid
language sql stable security definer set search_path = public as
$$ select departamento_id from perfis where id = auth.uid() $$;

create or replace function sou_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select papel = 'admin' from perfis where id = auth.uid()), false) $$;

drop policy if exists acesso_time on conversas;
drop policy if exists acesso_depto on conversas;
create policy acesso_depto on conversas for all to authenticated
using (
  usuario_ativo() and (
    sou_admin()
    or departamento_id is null
    or departamento_id = meu_departamento()
    or responsavel = auth.uid()
  )
)
with check (usuario_ativo());

-- mensagens seguem a visibilidade da conversa
drop policy if exists acesso_time on mensagens;
drop policy if exists acesso_depto_msg on mensagens;
create policy acesso_depto_msg on mensagens for all to authenticated
using (usuario_ativo() and exists (select 1 from conversas c where c.id = conversa_id))
with check (usuario_ativo() and exists (select 1 from conversas c where c.id = conversa_id));

-- tags e comandos: time ativo inteiro
alter table tags enable row level security;
alter table motor_comandos enable row level security;
alter table notificacoes enable row level security;

drop policy if exists acesso_time on tags;
create policy acesso_time on tags for all to authenticated
using (usuario_ativo()) with check (usuario_ativo());

drop policy if exists acesso_time on motor_comandos;
create policy acesso_time on motor_comandos for all to authenticated
using (usuario_ativo()) with check (usuario_ativo());

-- notificações: cada um lê/atualiza as suas; qualquer ativo pode criar (menções)
drop policy if exists notif_minhas on notificacoes;
create policy notif_minhas on notificacoes for select to authenticated
using (usuario_ativo() and perfil_id = auth.uid());

drop policy if exists notif_criar on notificacoes;
create policy notif_criar on notificacoes for insert to authenticated
with check (usuario_ativo());

drop policy if exists notif_marcar on notificacoes;
create policy notif_marcar on notificacoes for update to authenticated
using (usuario_ativo() and perfil_id = auth.uid())
with check (usuario_ativo() and perfil_id = auth.uid());

-- [origem: chat-v3.sql]
-- ============================================================
-- CHAT v3 — reações de mensagens (como no WhatsApp)
-- Cole no SQL Editor do Supabase e execute (Run).
-- É seguro rodar mais de uma vez.
-- ============================================================

-- reações recebidas/enviadas: [{"emoji":"👍","de":"5521...","nome":"Maria","minha":false}]
alter table mensagens add column if not exists reacoes jsonb not null default '[]';

-- jid de quem enviou a mensagem em grupos (necessário para reagir à mensagem certa)
alter table mensagens add column if not exists participante text not null default '';

-- [origem: chat-v4.sql]
-- ============================================================
-- CHAT v4 — responder/citar e encaminhar mensagens
-- Cole no SQL Editor do Supabase e execute (Run).
-- É seguro rodar mais de uma vez.
-- ============================================================

-- mensagem citada (snapshot): {"id":"...","externoId":"...","texto":"...","remetente":"...","minha":false,"participante":"","tipo":"texto"}
alter table mensagens add column if not exists citado jsonb;

-- marca mensagens encaminhadas (mostra "Encaminhada" aqui e no WhatsApp)
alter table mensagens add column if not exists encaminhada boolean not null default false;

-- [origem: chat-v5.sql]
-- ============================================================
-- CHAT v5 — AUTOMAÇÕES (quando → se → então)
-- Cole no SQL Editor do Supabase e execute (Run).
-- É seguro rodar mais de uma vez.
-- ============================================================

create table if not exists automacoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativa boolean not null default true,
  gatilho text not null default 'mensagem_recebida'
    check (gatilho in ('mensagem_recebida', 'conversa_criada')),
  cooldown_horas numeric not null default 12,   -- não repete p/ a mesma conversa dentro deste prazo
  condicoes jsonb not null default '[]',        -- [{"tipo":"contem_texto","valor":"boleto, pagamento"}, ...]
  acoes jsonb not null default '[]',            -- [{"tipo":"enviar_mensagem","valor":"Olá {{nome}}!"}, ...]
  criado_em timestamptz not null default now()
);

create table if not exists automacao_log (
  id uuid primary key default gen_random_uuid(),
  automacao_id uuid not null references automacoes(id) on delete cascade,
  conversa_id uuid references conversas(id) on delete cascade,
  detalhe text not null default '',
  executado_em timestamptz not null default now()
);
create index if not exists idx_autolog on automacao_log(automacao_id, conversa_id, executado_em desc);

alter table automacoes enable row level security;
alter table automacao_log enable row level security;

drop policy if exists acesso_time on automacoes;
create policy acesso_time on automacoes for all to authenticated
using (usuario_ativo()) with check (usuario_ativo());

drop policy if exists acesso_time on automacao_log;
create policy acesso_time on automacao_log for all to authenticated
using (usuario_ativo()) with check (usuario_ativo());

-- [origem: chat-v6.sql]
-- ============================================================
-- CHAT v6 — ENQUETES CLICÁVEIS (o cliente toca na opção)
-- Cole no SQL Editor do Supabase e execute (Run).
-- É seguro rodar mais de uma vez.
-- ============================================================

alter table mensagens drop constraint if exists mensagens_tipo_check;
alter table mensagens add constraint mensagens_tipo_check
  check (tipo in ('texto','imagem','audio','video','arquivo','figurinha','anotacao','enquete'));

-- dados da enquete: {"pergunta":"...","opcoes":["Comercial","Jurídico"],
--   "tipo":"departamentos","secret":"<chave p/ decifrar votos>","votos":{"5522...":"Jurídico"}}
alter table mensagens add column if not exists enquete jsonb;

-- [origem: chat-v7.sql]
-- ============================================================
-- CHAT v7 — SYNC INCREMENTAL (escala para o time inteiro)
-- Cole no SQL Editor do Supabase e execute (Run).
-- É seguro rodar mais de uma vez.
-- Depois de rodar, o app passa a baixar SÓ o que mudou
-- (em vez do histórico inteiro a cada pulso).
-- ============================================================

-- carimbo de última alteração em cada mensagem (o cursor do sync)
alter table mensagens add column if not exists atualizado_em timestamptz not null default now();

drop trigger if exists ao_atualizar_mensagem on mensagens;
create trigger ao_atualizar_mensagem before update on mensagens
  for each row execute function carimbar_atualizacao();

-- índices para o delta e para a paginação de histórico por conversa
create index if not exists idx_msg_atualizado on mensagens(atualizado_em);
create index if not exists idx_msg_conversa_criado on mensagens(conversa_id, criado_em desc);

-- [origem: chat-v8.sql]
-- ============================================================
-- CHAT v8 — GESTÃO DE ALÇADAS (permissões por usuário e
-- por departamento, assinatura, modo espião, horário de acesso)
-- Cole no SQL Editor do Supabase e execute (Run).
-- É seguro rodar mais de uma vez.
-- ============================================================

-- ---------- 1. Perfis: configurações e permissões individuais ----------
alter table perfis add column if not exists permissoes jsonb not null default '{}';          -- {"msg_enviar":true,...}
alter table perfis add column if not exists assinatura text not null default '';             -- nome visível p/ o cliente
alter table perfis add column if not exists exibir_assinatura boolean not null default false;
alter table perfis add column if not exists modo_espiao boolean not null default false;      -- abre chat sem zerar não-lidas
alter table perfis add column if not exists espiao_zera_ao_enviar boolean not null default true;
alter table perfis add column if not exists horario_ativo boolean not null default false;
alter table perfis add column if not exists horario text not null default 'seg-sex 08:00-18:00';
alter table perfis add column if not exists departamento_ids uuid[] not null default '{}';   -- múltiplos departamentos

-- migra o vínculo antigo (1 departamento) para a lista
update perfis set departamento_ids = array[departamento_id]
where departamento_id is not null and departamento_ids = '{}';

-- ---------- 2. Departamentos: permissões do grupo ----------
alter table departamentos add column if not exists permissoes jsonb not null default '{}';

-- ---------- 3. Visibilidade por MÚLTIPLOS departamentos ----------
create or replace function meus_departamentos() returns uuid[]
language sql stable security definer set search_path = public as
$$ select case
     when departamento_ids <> '{}' then departamento_ids
     when departamento_id is not null then array[departamento_id]
     else '{}'::uuid[]
   end
   from perfis where id = auth.uid() $$;

-- usuário (ou algum departamento dele) tem a permissão?
create or replace function tem_permissao(chave text) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select (permissoes->>chave)::boolean from perfis where id = auth.uid()), false)
   or exists (
     select 1 from departamentos d
     where d.id = any(meus_departamentos())
       and (d.permissoes->>chave)::boolean
   ) $$;

drop policy if exists acesso_depto on conversas;
create policy acesso_depto on conversas for all to authenticated
using (
  usuario_ativo() and (
    sou_admin()
    or departamento_id is null
    or departamento_id = any(meus_departamentos())
    or responsavel = auth.uid()
    or tem_permissao('conversas_todas')
  )
)
with check (usuario_ativo());

-- [origem: chat-v9.sql]
-- ============================================================
-- CHAT v9 — APAGAR MENSAGENS (revogação como no WhatsApp)
-- Cole no SQL Editor do Supabase e execute (Run).
-- É seguro rodar mais de uma vez.
-- Mensagens apagadas pelo CONTATO ficam preservadas no CRM
-- com o selo "apagada pelo contato" (o conteúdo não se perde).
-- ============================================================

alter table mensagens add column if not exists apagada boolean not null default false;

-- [origem: chat-v10.sql]
-- ============================================================
-- chat-v10 — endurecimento da fila de comandos do motor
-- (rode no SQL Editor do Supabase; leva 1 segundo)
--
-- 1) Um comando só pode ser criado em nome do PRÓPRIO usuário
--    logado (autor = auth.uid()) — fecha a brecha teórica de um
--    atendente forjar autor=admin direto pela API e usar o
--    comando criar_usuario.
-- 2) A leitura da fila fica restrita ao autor do comando e aos
--    admins — ninguém mais enxerga payloads alheios (ex.: a
--    janela breve em que a senha provisória existe no payload).
--
-- O motor não é afetado (usa a service key, que ignora RLS).
-- O front não é afetado (sempre grava autor = usuário logado e
-- só consulta comandos que ele mesmo criou).
-- ============================================================

drop policy if exists acesso_time on motor_comandos;
drop policy if exists comandos_criar on motor_comandos;
drop policy if exists comandos_ler on motor_comandos;

create policy comandos_criar on motor_comandos
  for insert to authenticated
  with check (usuario_ativo() and autor = auth.uid());

create policy comandos_ler on motor_comandos
  for select to authenticated
  using (usuario_ativo() and (autor = auth.uid() or sou_admin()));

-- [origem: chat-v11.sql]
-- ============================================================
-- chat-v11 — identidade dupla na conversa (ANTI-DUPLICATA)
-- (rode no SQL Editor do Supabase; 1 segundo. O motor ativa
--  sozinho em até 1 minuto, sem reiniciar.)
--
-- O WhatsApp dá a cada contato duas identidades: o número real
-- e um código de privacidade ("lid"). Até aqui a conversa só
-- guardava UMA delas — mensagens chegando pela outra identidade
-- criavam um contato duplicado, que era fundido depois (ruim).
-- Com as DUAS identidades gravadas na própria conversa, qualquer
-- mensagem encontra a conversa certa de primeira e a duplicata
-- simplesmente não nasce.
-- ============================================================

alter table conversas add column if not exists lid text;
create index if not exists idx_conversas_lid on conversas(lid);

-- [origem: crm-v1.sql]
-- ============================================================
-- crm-v1 — CRM v6: timeline do lead + campos jurídicos
-- (rode no SQL Editor do Supabase; 1 segundo. O front detecta
--  sozinho no próximo login/pulso — sem ela, tudo continua
--  funcionando, só sem sincronizar os campos novos.)
--
-- eventos          → linha do tempo do lead (etapas, notas,
--                    contratos, respostas, cadências)
-- etapa_historico  → quando o lead entrou em cada etapa
--                    (alimenta conversão e "tempo parado")
-- numero_processo, comarca_vara, prazo_limite → campos
--                    jurídicos da ficha
-- ============================================================

alter table leads add column if not exists eventos jsonb not null default '[]'::jsonb;
alter table leads add column if not exists etapa_historico jsonb not null default '[]'::jsonb;
alter table leads add column if not exists numero_processo text not null default '';
alter table leads add column if not exists comarca_vara text not null default '';
alter table leads add column if not exists prazo_limite date;

-- [origem: crm-v2.sql]
-- ============================================================
-- crm-v2 — conserta o cancelamento de cadência
-- (rode no SQL Editor do Supabase; 1 segundo. O front detecta
--  sozinho no próximo login/pulso — sem ela, tudo continua
--  funcionando exatamente como antes.)
--
-- O PROBLEMA QUE ISTO RESOLVE
-- Quando uma cadência agenda uma mensagem de WhatsApp, o
-- follow-up guardava o id dessa mensagem só na MEMÓRIA do
-- navegador (followups.msgId). Como a coluna não existia, o
-- vínculo se perdia na primeira recarga (~4 min). Depois disso
-- "cancelar a cadência" marcava o follow-up como cancelado mas
-- NÃO tirava a mensagem da fila — e o motor enviava assim mesmo.
-- Era por isso que lead que respondia continuava recebendo.
--
-- msg_id → a mensagem agendada casada com este follow-up.
--          on delete set null: se a mensagem for enviada e
--          depois apagada, o follow-up continua íntegro.
-- ============================================================

alter table followups add column if not exists msg_id uuid;

-- o índice serve ao motor, que busca os follow-ups pendentes de
-- um lead para cancelar os envios quando ele responde
create index if not exists idx_followups_msg on followups(msg_id) where msg_id is not null;
create index if not exists idx_followups_lead_status on followups(lead_id, status) where status = 'pendente';

-- [origem: chat-v12a.sql]
-- ============================================================
-- chat-v12a — Onda 0, parte ADITIVA (não muda o que ninguém vê ou faz)
-- Rodar ANTES de publicar o front da Onda 0. É seguro rodar mais de uma vez.
--
-- 1) Limpa as cópias repetidas de mensagens (mesmo id do WhatsApp) e
--    impede que voltem a nascer (índice único).
-- 2) Índices que faltavam (recepção do motor, carga inicial, delta de
--    conversas e chaves estrangeiras).
-- 3) Funções novas que o front e o motor da Onda 0 passam a usar:
--    marcar_lida, registrar_entrada, motor_qr.
-- 4) Fila de mensagens que o motor não conseguiu gravar (motor_pendentes).
-- 5) Status 'cancelada' para agendamentos (cancelar deixa de APAGAR a linha).
-- 6) Higiene apontada pelo Supabase: funções sem acesso anônimo,
--    search_path fixo, auth.uid() avaliado uma vez por consulta.
-- ============================================================

-- ---------- 1. Mensagens repetidas ----------
-- Conferido em 01/10/2026: 32 pares, todos com a mesma conversa e o mesmo
-- texto. Fica a mais antiga. Só apaga cópias idênticas: se sobrar algum
-- par diferente, o índice abaixo falha e avisa (nada é apagado às cegas).
with r as (
  select id, conversa_id, texto,
         first_value(conversa_id) over w as conversa0,
         first_value(texto)       over w as texto0,
         row_number()             over w as n
  from mensagens
  where externo_id <> ''
  window w as (partition by externo_id order by criado_em, id)
)
delete from mensagens m
using r
where m.id = r.id and r.n > 1 and r.conversa_id = r.conversa0 and r.texto = r.texto0;

-- o mesmo id do WhatsApp não entra duas vezes (o motor trata o erro 23505
-- como "já gravada"); o índice comum serve às buscas por externo_id
create unique index if not exists uq_mensagens_externo on mensagens(externo_id) where externo_id <> '';
create index if not exists idx_msg_externo on mensagens(externo_id);

-- ---------- 2. Índices de desempenho ----------
create index if not exists idx_msg_criado          on mensagens(criado_em desc);       -- janela inicial do login
create index if not exists idx_msg_autor           on mensagens(autor);
create index if not exists idx_conversas_atualizado on conversas(atualizado_em);        -- delta de 3 s
create index if not exists idx_conversas_depto     on conversas(departamento_id);
create index if not exists idx_conversas_resp      on conversas(responsavel);
create index if not exists idx_conversas_lead      on conversas(lead_id);
create index if not exists idx_notif_conversa      on notificacoes(conversa_id);
create index if not exists idx_autolog_conversa    on automacao_log(conversa_id);
create index if not exists idx_leads_dono          on leads(dono);
create index if not exists idx_rr_dono             on respostas_rapidas(dono);
create index if not exists idx_comandos_autor      on motor_comandos(autor);
create index if not exists idx_perfis_depto        on perfis(departamento_id);

-- ---------- 3. Funções novas ----------

-- Zera as não lidas de UMA conversa sem regravar a linha inteira (antes o
-- front subia a conversa toda e desfazia delegação/status de colegas).
-- security invoker: vale a regra de visibilidade de quem chama.
create or replace function public.marcar_lida(cid uuid) returns void
language sql security invoker set search_path = public as $$
  update conversas set nao_lidas = 0 where id = cid and nao_lidas <> 0
$$;
revoke execute on function public.marcar_lida(uuid) from public, anon;
grant execute on function public.marcar_lida(uuid) to authenticated;

-- Motor: registra a chegada de uma mensagem na conversa com incremento
-- atômico (antes: ler + somar + gravar, perdia contagem em rajada).
-- A prévia e a ordem só mudam se a mensagem for a mais recente (mensagens
-- reentregues depois de uma queda não bagunçam a lista).
create or replace function public.registrar_entrada(cid uuid, previa text, quando timestamptz, entrada boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'registrar_entrada é exclusiva do motor' using errcode = '42501';
  end if;
  update conversas set
    nao_lidas     = nao_lidas + case when entrada then 1 else 0 end,
    status        = case when entrada and status in ('resolvido', 'fechado') then 'aberto' else status end,
    ultima_msg    = case when ultima_msg_em is null or quando >= ultima_msg_em then left(coalesce(previa, ''), 120) else ultima_msg end,
    ultima_msg_em = greatest(coalesce(ultima_msg_em, quando), quando)
  where id = cid;
end $$;
revoke execute on function public.registrar_entrada(uuid, text, timestamptz, boolean) from public, anon, authenticated;

-- QR do pareamento: só para administrador (a coluna qr sai da leitura geral
-- no chat-v12b). O front da Onda 0 já lê o QR por aqui.
create or replace function public.motor_qr() returns text
language sql stable security definer set search_path = public as $$
  select case when eh_admin() then (select qr from motor_estado where id = 'principal') else null end
$$;
revoke execute on function public.motor_qr() from public, anon;
grant execute on function public.motor_qr() to authenticated;

-- ---------- 4. Mensagens que o motor não conseguiu gravar ----------
-- Antes, uma falha do banco na hora da recepção perdia a mensagem (só ia
-- para o log). Agora o motor guarda aqui e tenta de novo a cada 30 s.
create table if not exists motor_pendentes (
  externo_id   text primary key,
  payload      jsonb not null,
  tentativas   int  not null default 0,
  erro         text not null default '',
  status       text not null default 'pendente' check (status in ('pendente', 'ok', 'descartada')),
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_motor_pendentes_status on motor_pendentes(status, criado_em) where status = 'pendente';
alter table motor_pendentes enable row level security;
drop policy if exists pendentes_admin_ler on motor_pendentes;
create policy pendentes_admin_ler on motor_pendentes for select to authenticated using ((select eh_admin()));
-- (sem policy de escrita: só o motor, com a service key, grava)

-- ---------- 5. Status 'cancelada' ----------
alter table mensagens drop constraint if exists mensagens_status_check;
alter table mensagens add constraint mensagens_status_check check (status in
  ('recebida', 'pendente', 'agendada', 'enviando', 'enviada', 'entregue', 'lida', 'erro', 'cancelada'));

-- ---------- 6. Higiene (advisors do Supabase) ----------
alter function public.carimbar_atualizacao() set search_path = public;

-- funções de apoio às regras: o login anônimo não precisa delas
do $$
declare f text;
begin
  foreach f in array array['eh_admin()', 'sou_admin()', 'usuario_ativo()', 'meu_departamento()',
                           'meus_departamentos()', 'tem_permissao(text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  -- funções de gatilho: ninguém chama pela API
  execute 'revoke execute on function public.criar_perfil() from public, anon, authenticated';
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- auth.uid() avaliado uma vez por consulta (mesmo significado de antes).
-- ATENÇÃO: perfis_ver_proprio NÃO entra aqui — com (select auth.uid()) ela vira
-- subconsulta e a regra antiga perfis_editar_proprio (que lê a própria perfis)
-- passa a dar "recursão infinita" em todo UPDATE de perfis. As duas são refeitas
-- juntas no chat-v12b, depois que o gatilho perfis_blindar assume a trava.

drop policy if exists perfis_criar_proprio on perfis;
create policy perfis_criar_proprio on perfis for insert to authenticated
  with check (id = (select auth.uid()) and papel = 'atendente' and ativo = false);

drop policy if exists notif_minhas on notificacoes;
create policy notif_minhas on notificacoes for select to authenticated
  using ((select usuario_ativo()) and perfil_id = (select auth.uid()));

drop policy if exists notif_marcar on notificacoes;
create policy notif_marcar on notificacoes for update to authenticated
  using ((select usuario_ativo()) and perfil_id = (select auth.uid()))
  with check ((select usuario_ativo()) and perfil_id = (select auth.uid()));

drop policy if exists comandos_criar on motor_comandos;
create policy comandos_criar on motor_comandos for insert to authenticated
  with check ((select usuario_ativo()) and autor = (select auth.uid()));

drop policy if exists comandos_ler on motor_comandos;
create policy comandos_ler on motor_comandos for select to authenticated
  using ((select usuario_ativo()) and (autor = (select auth.uid()) or (select sou_admin())));

-- conferência: deve devolver 0
select count(*) as externo_id_repetidos
from (select externo_id from mensagens where externo_id <> '' group by externo_id having count(*) > 1) x;

-- [origem: chat-v12b.sql]
-- ============================================================
-- chat-v12b — Onda 0, parte RESTRITIVA (fecha os furos de segurança)
-- Rodar DEPOIS de publicar o front da Onda 0 (v6.10) e de todas as abas
-- abertas terem recarregado (o aviso "versão nova" pede isso). É seguro
-- rodar mais de uma vez.
--
-- 1) perfis: ninguém altera as PRÓPRIAS alçadas, departamentos, horário,
--    espião ou assinatura (antes um atendente se dava "ver todas as
--    conversas" por um PATCH na API). O último admin não pode ser rebaixado.
-- 2) departamentos: só o admin cria, edita ou apaga.
-- 3) Sessão do WhatsApp (motor_sessao): fora do alcance do time — só o motor.
--    QR do pareamento: só o admin (função motor_qr, do chat-v12a).
-- 4) Mídias: ninguém lista o bucket (antes qualquer login listava todos os
--    arquivos de clientes). O download por link continua.
-- 5) conversas e mensagens: regras separadas por ação. Apagar conversa só o
--    admin; apagar mensagem só o admin ou o autor de uma que ainda não saiu.
--    Travas silenciosas: telefone, prévia e campos do motor não mudam pela
--    API; mensagem já enviada não volta a "pendente" (evita envio em dobro)
--    nem tem o texto reescrito.
-- 6) automações, tags e respostas rápidas do time: só quem tem a alçada
--    (automacoes_editar, tags_gerir, rr_editar) ou o admin.
-- 7) Cores de tag e departamento só em formato hex (eram injetáveis na tela).
-- ============================================================

-- ---------- 0. "Quem está chamando" ----------
-- o motor (service key) e o SQL Editor passam por todas as travas
create or replace function public.chamada_de_servico() returns boolean
language sql stable set search_path = public as $$
  select coalesce(auth.role(), '') = 'service_role' or auth.uid() is null
$$;
revoke execute on function public.chamada_de_servico() from public, anon;
grant execute on function public.chamada_de_servico() to authenticated, service_role;

-- ---------- 1. perfis ----------
create or replace function public.perfis_blindar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if chamada_de_servico() then return new; end if;

  if tg_op = 'INSERT' then
    -- perfil criado pela própria pessoa nasce sem nenhuma alçada
    if not eh_admin() then
      new.papel := 'atendente'; new.ativo := false; new.permissoes := '{}'::jsonb;
      new.departamento_id := null; new.departamento_ids := '{}';
      new.modo_espiao := false; new.horario_ativo := false;
      new.assinatura := ''; new.exibir_assinatura := false;
    end if;
    return new;
  end if;

  if not eh_admin() then
    if new.papel is distinct from old.papel or new.ativo is distinct from old.ativo
       or new.permissoes is distinct from old.permissoes
       or new.departamento_id is distinct from old.departamento_id
       or new.departamento_ids is distinct from old.departamento_ids
       or new.horario_ativo is distinct from old.horario_ativo or new.horario is distinct from old.horario
       or new.modo_espiao is distinct from old.modo_espiao
       or new.espiao_zera_ao_enviar is distinct from old.espiao_zera_ao_enviar
       or new.assinatura is distinct from old.assinatura
       or new.exibir_assinatura is distinct from old.exibir_assinatura
       or new.email is distinct from old.email then
      raise exception 'Só o administrador altera alçadas, departamentos, horário e assinatura.'
        using errcode = '42501';
    end if;
  end if;

  -- o sistema nunca fica sem administrador ativo
  if old.papel = 'admin' and old.ativo and (new.papel <> 'admin' or not new.ativo)
     and not exists (select 1 from perfis p where p.papel = 'admin' and p.ativo and p.id <> old.id) then
    raise exception 'Este é o último administrador ativo: promova outra pessoa antes.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.perfis_blindar() from public, anon, authenticated;

drop trigger if exists perfis_blindar on perfis;
create trigger perfis_blindar before insert or update on perfis
  for each row execute function public.perfis_blindar();

-- a trava de papel/ativo saiu da regra (que lia a própria perfis numa subconsulta)
-- e foi para o gatilho acima: a regra fica só com "é a minha linha". Sem isso,
-- com perfis_ver_proprio usando (select auth.uid()), todo UPDATE de perfis dava
-- "infinite recursion detected in policy" (aconteceu em produção em 01/10/2026).
drop policy if exists perfis_editar_proprio on perfis;
create policy perfis_editar_proprio on perfis for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
drop policy if exists perfis_ver_proprio on perfis;
create policy perfis_ver_proprio on perfis for select to authenticated
  using (id = (select auth.uid()));

-- ---------- 2. departamentos ----------
drop policy if exists acesso_time on departamentos;
drop policy if exists dept_ver on departamentos;
drop policy if exists dept_admin on departamentos;
create policy dept_ver on departamentos for select to authenticated using ((select usuario_ativo()));
create policy dept_admin on departamentos for all to authenticated
  using ((select eh_admin())) with check ((select eh_admin()));

-- ---------- 3. motor ----------
drop policy if exists acesso_time on motor_sessao;
revoke all on motor_sessao from anon, authenticated;            -- sem policy e sem grant: só o motor

drop policy if exists acesso_time on motor_estado;
drop policy if exists motor_estado_ver on motor_estado;
revoke all on motor_estado from anon, authenticated;
grant select (id, situacao, numero, detalhe, atualizado_em) on motor_estado to authenticated;  -- sem a coluna qr
create policy motor_estado_ver on motor_estado for select to authenticated using ((select usuario_ativo()));

-- ---------- 4. mídias ----------
-- a política de leitura liberava LISTAR o bucket a qualquer login (até inativo);
-- o download por link público continua (não depende dela) e o motor usa a service key
drop policy if exists midias_leitura on storage.objects;

-- ---------- 5. conversas ----------
drop policy if exists acesso_depto on conversas;
drop policy if exists conversas_ler on conversas;
drop policy if exists conversas_criar on conversas;
drop policy if exists conversas_editar on conversas;
drop policy if exists conversas_apagar on conversas;

create policy conversas_ler on conversas for select to authenticated using (
  (select usuario_ativo()) and (
    (select sou_admin())
    or departamento_id is null
    or departamento_id = any((select meus_departamentos())::uuid[])
    or responsavel = (select auth.uid())
    or (select tem_permissao('conversas_todas'))
  )
);
create policy conversas_criar on conversas for insert to authenticated
  with check ((select usuario_ativo()));
-- WITH CHECK fica só em usuario_ativo(): delegar para outro departamento tira a
-- conversa da vista de quem delega e precisa continuar permitido
create policy conversas_editar on conversas for update to authenticated using (
  (select usuario_ativo()) and (
    (select sou_admin())
    or departamento_id is null
    or departamento_id = any((select meus_departamentos())::uuid[])
    or responsavel = (select auth.uid())
    or (select tem_permissao('conversas_todas'))
  )
) with check ((select usuario_ativo()));
create policy conversas_apagar on conversas for delete to authenticated using ((select eh_admin()));

-- campos que não são da tela: preservados em silêncio (a linha inteira ainda
-- chega pelo sync de abas antigas; lançar erro travaria o lote)
create or replace function public.conversas_blindar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if chamada_de_servico() then return new; end if;
  new.telefone      := old.telefone;        -- respostas iriam para outro número
  new.grupo_jid     := old.grupo_jid;
  new.tipo          := old.tipo;
  new.lid           := old.lid;
  new.foto_url      := old.foto_url;
  new.participantes := old.participantes;
  new.ultima_msg    := old.ultima_msg;      -- prévia e ordem são do motor
  new.ultima_msg_em := old.ultima_msg_em;
  return new;
end $$;
revoke execute on function public.conversas_blindar() from public, anon, authenticated;
drop trigger if exists a_blindar_conversa on conversas;
create trigger a_blindar_conversa before update on conversas
  for each row execute function public.conversas_blindar();

-- ---------- 5b. mensagens ----------
drop policy if exists acesso_depto_msg on mensagens;
drop policy if exists msg_ler on mensagens;
drop policy if exists msg_criar on mensagens;
drop policy if exists msg_editar on mensagens;
drop policy if exists msg_apagar on mensagens;

create policy msg_ler on mensagens for select to authenticated
  using ((select usuario_ativo()) and exists (select 1 from conversas c where c.id = conversa_id));
create policy msg_criar on mensagens for insert to authenticated
  with check ((select usuario_ativo()) and exists (select 1 from conversas c where c.id = conversa_id));
create policy msg_editar on mensagens for update to authenticated
  using ((select usuario_ativo()) and exists (select 1 from conversas c where c.id = conversa_id))
  with check ((select usuario_ativo()) and exists (select 1 from conversas c where c.id = conversa_id));
create policy msg_apagar on mensagens for delete to authenticated using (
  (select eh_admin())
  or (autor = (select auth.uid()) and status in ('pendente', 'agendada', 'erro', 'cancelada'))
);

create or replace function public.mensagens_blindar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if chamada_de_servico() then return new; end if;
  -- quem é a mensagem nunca muda
  new.direcao    := old.direcao;
  new.conversa_id := old.conversa_id;
  new.autor      := old.autor;
  new.externo_id := old.externo_id;
  -- campos gravados só pelo motor
  new.reacoes    := old.reacoes;
  new.enquete    := old.enquete;
  new.apagada    := old.apagada;
  new.transcricao := old.transcricao;
  new.participante := old.participante;
  new.remetente  := old.remetente;
  -- status não regride: o que já saiu (ou está saindo) não volta para a fila
  if old.status in ('enviando', 'enviada', 'entregue', 'lida', 'recebida')
     and new.status in ('pendente', 'agendada', 'enviando', 'cancelada') then
    new.status := old.status;
  end if;
  if old.status = 'cancelada' and new.status in ('pendente', 'agendada') then
    new.status := old.status;
  end if;
  -- conteúdo só muda antes do envio (depois disso é histórico do atendimento)
  if old.status not in ('pendente', 'agendada') then
    new.texto := old.texto; new.midia_url := old.midia_url; new.midia_mime := old.midia_mime;
    new.midia_nome := old.midia_nome; new.midia_tamanho := old.midia_tamanho; new.tipo := old.tipo;
    new.criado_em := old.criado_em;
  end if;
  return new;
end $$;
revoke execute on function public.mensagens_blindar() from public, anon, authenticated;
drop trigger if exists a_blindar_mensagem on mensagens;
create trigger a_blindar_mensagem before update on mensagens
  for each row execute function public.mensagens_blindar();

-- ---------- 6. automações, tags, respostas rápidas ----------
drop policy if exists acesso_time on automacoes;
drop policy if exists auto_ver on automacoes;
drop policy if exists auto_editar on automacoes;
create policy auto_ver on automacoes for select to authenticated using ((select usuario_ativo()));
create policy auto_editar on automacoes for all to authenticated
  using ((select eh_admin()) or (select tem_permissao('automacoes_editar')))
  with check ((select eh_admin()) or (select tem_permissao('automacoes_editar')));

drop policy if exists acesso_time on automacao_log;
drop policy if exists autolog_ver on automacao_log;
create policy autolog_ver on automacao_log for select to authenticated using ((select usuario_ativo()));
-- (sem escrita para o time: o log é do motor)

drop policy if exists acesso_time on tags;
drop policy if exists tags_ver on tags;
drop policy if exists tags_gerir on tags;
create policy tags_ver on tags for select to authenticated using ((select usuario_ativo()));
create policy tags_gerir on tags for all to authenticated
  using ((select eh_admin()) or (select tem_permissao('tags_gerir')))
  with check ((select eh_admin()) or (select tem_permissao('tags_gerir')));

drop policy if exists acesso_time on respostas_rapidas;
drop policy if exists rr_ver on respostas_rapidas;
drop policy if exists rr_editar on respostas_rapidas;
create policy rr_ver on respostas_rapidas for select to authenticated using ((select usuario_ativo()));
-- as pessoais (dono = eu) cada um edita; as do time, quem tem rr_editar
create policy rr_editar on respostas_rapidas for all to authenticated
  using ((select usuario_ativo()) and (dono = (select auth.uid()) or (select eh_admin()) or (select tem_permissao('rr_editar'))))
  with check ((select usuario_ativo()) and (dono = (select auth.uid()) or (select eh_admin()) or (select tem_permissao('rr_editar'))));

-- ---------- 7. cores ----------
update tags set cor = '#5e8ab4' where cor !~* '^#[0-9a-f]{3,8}$';
update departamentos set cor = '#5e8ab4' where cor !~* '^#[0-9a-f]{3,8}$';
alter table tags drop constraint if exists tags_cor_hex;
alter table tags add constraint tags_cor_hex check (cor ~* '^#[0-9a-f]{3,8}$');
alter table departamentos drop constraint if exists departamentos_cor_hex;
alter table departamentos add constraint departamentos_cor_hex check (cor ~* '^#[0-9a-f]{3,8}$');

-- [origem: chat-v13a.sql]
-- ============================================================
-- chat-v13a — "Marcar como não lida" (aditivo)
-- Cole no SQL Editor do Supabase e execute (Run). É seguro rodar mais de
-- uma vez. Pode rodar antes ou depois de publicar o front v6.12: sem esta
-- função o front cai num PATCH só da coluna nao_lidas.
--
-- Espelho da marcar_lida (chat-v12a): devolve a conversa à fila de "não
-- lidas" de todo o time sem regravar a linha inteira. security invoker:
-- vale a regra conversas_editar de quem chama (admin, departamento,
-- responsável ou alçada conversas_todas). O gatilho conversas_blindar não
-- toca em nao_lidas, então a atualização passa.
-- ============================================================
create or replace function public.marcar_nao_lida(cid uuid) returns void
language sql security invoker set search_path = public as $$
  update conversas set nao_lidas = greatest(nao_lidas, 1) where id = cid
$$;
revoke execute on function public.marcar_nao_lida(uuid) from public, anon;
grant execute on function public.marcar_nao_lida(uuid) to authenticated;

-- [origem: chat-v14a.sql]
-- ============================================================
-- CHAT v14a — vários departamentos por conversa (triagem manual: o caso
-- pode ser de mais de um). Cole no SQL Editor do Supabase e execute (Run).
-- É seguro rodar mais de uma vez (sem DROP: o conector do Supabase barra
-- DDL destrutivo; create or replace / if not exists em tudo).
--
-- conversas.departamento_ids uuid[]  → a LISTA de departamentos (verdade nova).
-- conversas.departamento_id          → continua existindo como ESPELHO do 1º da
--                                      lista: abas antigas do front, o motor
--                                      antigo e as automações já gravadas só
--                                      conhecem a coluna antiga.
-- Gatilho b_espelhar_departamentos   → mantém os dois campos coerentes, venha
--                                      a escrita de onde vier (front novo
--                                      manda a lista; front/motor antigos
--                                      mandam só o id).
-- Gatilho ao apagar departamento     → tira o id das listas de conversas e
--                                      perfis ANTES de a FK agir (senão a FK
--                                      zerava a lista inteira ou deixava um
--                                      id órfão escondendo a conversa).
-- RPC conversa_departamento          → liga/desliga UM departamento de forma
--                                      atômica (o drawer usa; não leva a lista
--                                      da aba, que pode estar velha).
-- Policies conversas_ler/_editar     → passam a olhar a lista (interseção com
--                                      meus_departamentos()). Como o espelho
--                                      garante id nulo ⇔ lista vazia, a regra
--                                      é equivalente à antiga: pode ir ANTES do
--                                      front (publicação: SQL → front → motor).
--
-- O front funciona ANTES desta migração: sonda a coluna e, sem ela, segue
-- com um departamento só (o drawer avisa para rodar este arquivo).
-- ============================================================

-- ---------- 1. coluna + backfill ----------
alter table conversas add column if not exists departamento_ids uuid[] not null default '{}';

-- o backfill passa pelo carimbo (ao_atualizar_conversa) e poria o mesmo
-- atualizado_em em todas as linhas: cada aba puxaria 300 pelo delta e o resto
-- só na recarga de 4 min. Carimbo desligado só durante o backfill.
alter table conversas disable trigger ao_atualizar_conversa;
update conversas set departamento_ids = array[departamento_id]
where departamento_id is not null and departamento_ids = '{}';
alter table conversas enable trigger ao_atualizar_conversa;

create index if not exists idx_conversas_depts on conversas using gin (departamento_ids);

-- ---------- 2. espelho lista ⇄ id ----------
-- SEM a saída antecipada chamada_de_servico() que conversas_blindar tem: o
-- motor (service key) antigo grava só departamento_id e é justamente quem o
-- espelho precisa corrigir. security definer para a leitura de departamentos
-- não depender da RLS de quem grava.
create or replace function public.conversas_espelhar_departamentos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.departamento_ids := array_remove(coalesce(new.departamento_ids, '{}'), null);  -- '{NULL}' não é '{}'
  -- só ids que existem: não há FK em elemento de array, e uma aba com a lista
  -- velha (offline, janela do delta) ressuscitaria um departamento já apagado
  new.departamento_ids := coalesce((
    select array_agg(u.d order by u.o)
    from unnest(new.departamento_ids) with ordinality as u(d, o)
    where exists (select 1 from departamentos x where x.id = u.d)), '{}');
  if tg_op = 'INSERT' then
    if new.departamento_ids = '{}' and new.departamento_id is not null then
      new.departamento_ids := array[new.departamento_id];
    end if;
  elsif new.departamento_ids is distinct from old.departamento_ids then
    null;                                                        -- a lista manda (front novo / motor novo)
  elsif new.departamento_id is distinct from old.departamento_id then
    if new.departamento_id is null then                          -- FK on delete set null / aba antiga limpou
      new.departamento_ids := array_remove(old.departamento_ids, old.departamento_id);
    elsif new.departamento_id = any(old.departamento_ids) then   -- espelho atrasado de aba antiga: só reordena
      new.departamento_ids := array_prepend(new.departamento_id, array_remove(old.departamento_ids, new.departamento_id));
    else                                                         -- delegação de aba/motor antigo: substitui (semântica de sempre)
      new.departamento_ids := array[new.departamento_id];
    end if;
  end if;
  new.departamento_id := new.departamento_ids[1];                -- sempre; NULL se vazio
  return new;
end $$;
revoke execute on function public.conversas_espelhar_departamentos() from public, anon, authenticated;
-- "b_" para rodar depois de a_blindar_conversa (ordem alfabética) e antes do carimbo
create or replace trigger b_espelhar_departamentos before insert or update on conversas
  for each row execute function public.conversas_espelhar_departamentos();

-- ---------- 3. apagar departamento limpa as listas ----------
-- BEFORE DELETE: quando a FK (on delete set null) chegar, nenhuma linha
-- referencia mais o departamento; o espelho recalcula departamento_id.
create or replace function public.departamentos_limpar_listas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update conversas set departamento_ids = array_remove(departamento_ids, old.id)
  where departamento_ids @> array[old.id];
  update perfis set departamento_ids = array_remove(departamento_ids, old.id)
  where departamento_ids @> array[old.id];
  return old;
end $$;
revoke execute on function public.departamentos_limpar_listas() from public, anon, authenticated;
create or replace trigger a_limpar_listas before delete on departamentos
  for each row execute function public.departamentos_limpar_listas();

-- ---------- 4. liga/desliga um departamento (atômico) ----------
-- security DEFINER de propósito: num UPDATE comum o Postgres aplica o USING de
-- conversas_ler também à linha NOVA (WHERE/RETURNING leem a tabela), então
-- tirar a conversa da minha própria vista seria recusado com 42501. Aqui a
-- alçada é conferida na linha ANTIGA, com o mesmo predicado de conversas_editar,
-- e o UPDATE roda sem RLS. Devolve a lista como ficou (já espelhada pelo gatilho).
create or replace function public.conversa_departamento(cid uuid, did uuid, ligar boolean)
returns uuid[] language plpgsql security definer set search_path = public as $$
declare novo uuid[];
begin
  if not usuario_ativo() or not exists (
       select 1 from conversas c where c.id = cid and (
         sou_admin() or cardinality(c.departamento_ids) = 0
         or c.departamento_ids && (meus_departamentos())::uuid[]
         or c.responsavel = auth.uid() or tem_permissao('conversas_todas'))) then
    raise exception 'conversa não encontrada ou sem acesso' using errcode = '42501';
  end if;
  if ligar and not exists (select 1 from departamentos where id = did) then
    raise exception 'departamento não encontrado' using errcode = '23503';
  end if;
  update conversas
     set departamento_ids = case
       when ligar then (case when did = any(departamento_ids) then departamento_ids else array_append(departamento_ids, did) end)
       else array_remove(departamento_ids, did) end
   where id = cid
   returning departamento_ids into novo;
  if novo is null then
    raise exception 'conversa não encontrada' using errcode = '42501';
  end if;
  return novo;
end $$;
revoke execute on function public.conversa_departamento(uuid, uuid, boolean) from public, anon;
grant execute on function public.conversa_departamento(uuid, uuid, boolean) to authenticated;

-- ---------- 5. policies pela lista ----------
-- ALTER POLICY (sem DROP). Só o USING muda; o WITH CHECK de conversas_editar
-- continua usuario_ativo() (delegar para fora da minha vista segue permitido).
alter policy conversas_ler on conversas using (
  (select usuario_ativo()) and (
    (select sou_admin())
    or cardinality(departamento_ids) = 0
    or departamento_ids && (select meus_departamentos())::uuid[]
    or responsavel = (select auth.uid())
    or (select tem_permissao('conversas_todas'))
  )
);
alter policy conversas_editar on conversas using (
  (select usuario_ativo()) and (
    (select sou_admin())
    or cardinality(departamento_ids) = 0
    or departamento_ids && (select meus_departamentos())::uuid[]
    or responsavel = (select auth.uid())
    or (select tem_permissao('conversas_todas'))
  )
);

-- [origem: chat-v14b.sql]
-- ============================================================
-- CHAT v14b — histórico de mensagens EDITADAS pelo contato (ou por nós, no celular)
-- Cole no SQL Editor do Supabase e execute (Run). Seguro rodar mais de uma vez
-- (sem DROP: o conector do Supabase barra DDL destrutivo).
--
-- mensagens.edicoes jsonb → versões ANTERIORES do texto, da mais antiga para a
--                           mais nova: [{"texto": "...", "em": "2026-10-02T21:00:00Z"}].
--                           O texto atual fica em `texto`, sem o sufixo "(editada)".
--                           Só o motor grava (mensagens_blindar preserva).
--
-- O front e o motor funcionam ANTES desta migração: sem a coluna, o motor volta
-- ao comportamento antigo (texto novo + " (editada)") e o front mostra o selo
-- sem a versão anterior.
-- ============================================================
alter table mensagens add column if not exists edicoes jsonb not null default '[]';

-- mensagens_blindar (chat-v12b) ganha o campo: o front nunca grava edicoes
create or replace function public.mensagens_blindar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if chamada_de_servico() then return new; end if;
  -- quem é a mensagem nunca muda
  new.direcao    := old.direcao;
  new.conversa_id := old.conversa_id;
  new.autor      := old.autor;
  new.externo_id := old.externo_id;
  -- campos gravados só pelo motor
  new.reacoes    := old.reacoes;
  new.enquete    := old.enquete;
  new.apagada    := old.apagada;
  new.transcricao := old.transcricao;
  new.participante := old.participante;
  new.remetente  := old.remetente;
  new.edicoes    := old.edicoes;
  -- status não regride: o que já saiu (ou está saindo) não volta para a fila
  if old.status in ('enviando', 'enviada', 'entregue', 'lida', 'recebida')
     and new.status in ('pendente', 'agendada', 'enviando', 'cancelada') then
    new.status := old.status;
  end if;
  if old.status = 'cancelada' and new.status in ('pendente', 'agendada') then
    new.status := old.status;
  end if;
  -- conteúdo só muda antes do envio (depois disso é histórico do atendimento)
  if old.status not in ('pendente', 'agendada') then
    new.texto := old.texto; new.midia_url := old.midia_url; new.midia_mime := old.midia_mime;
    new.midia_nome := old.midia_nome; new.midia_tamanho := old.midia_tamanho; new.tipo := old.tipo;
    new.criado_em := old.criado_em;
  end if;
  return new;
end $$;
revoke execute on function public.mensagens_blindar() from public, anon, authenticated;

-- [origem: chat-v14c.sql]
-- ============================================================
-- CHAT v14c — segredo das mensagens recebidas (para decifrar EDIÇÕES)
-- Cole no SQL Editor do Supabase e execute (Run). Seguro rodar mais de uma vez.
--
-- O WhatsApp novo manda a edição de uma mensagem como secretEncryptedMessage:
-- o texto novo vem cifrado (AES-GCM) com uma chave derivada do messageSecret da
-- mensagem ORIGINAL. Esse segredo chega junto com cada mensagem recebida e só
-- serve para isso; sem guardá-lo, a edição aparecia na conversa como
-- "[mensagem de tipo não suportado: secretEncryptedMessage]".
--
-- mensagens_segredos → só o MOTOR (service key) lê e grava. Sem policy e sem
--                      grant para anon/authenticated: ninguém do time enxerga.
--                      O motor apaga o que tem mais de 30 dias.
-- ============================================================
create table if not exists mensagens_segredos (
  externo_id text primary key,                 -- id da mensagem no WhatsApp
  segredo text not null,                       -- messageSecret em base64 (32 bytes)
  remetente text not null default '',          -- jid de quem mandou (participa da derivação da chave)
  criado_em timestamptz not null default now()
);
create index if not exists idx_msg_segredos_criado on mensagens_segredos(criado_em);

alter table mensagens_segredos enable row level security;
revoke all on mensagens_segredos from anon, authenticated;

-- [origem: chat-v15a.sql]
-- ============================================================
-- CHAT v15a — resolvido/fechado arquivam; mensagem nova reabre e desarquiva
-- Cole no SQL Editor do Supabase e execute (Run). Seguro rodar mais de uma vez
-- (sem DROP: o conector do Supabase barra DDL destrutivo).
--
-- Regra do escritório (05/10/2026): ao marcar Resolvido ou Fechado a conversa "some"
-- da caixa de entrada (fica em Arquivadas; a busca a encontra lá). Qualquer
-- status em aberto a devolve à caixa. Mensagem nova do contato reabre a conversa
-- (status aberto) e a tira do arquivo, na caixa do(s) departamento(s) dela.
--
-- 1) gatilho c_status_arquiva  → vale para o front, o motor, automações e abas antigas
-- 2) registrar_entrada          → além de reabrir, desarquiva (o motor chama a cada mensagem)
-- 3) backfill                   → o que já está resolvido/fechado sai da caixa agora
-- ============================================================

-- ---------- 1. status ⇄ arquivada ----------
create or replace function public.conversas_status_arquiva() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status in ('resolvido', 'fechado') then
      new.arquivada := true;
    elsif new.status in ('aberto', 'em_atendimento', 'aguardando') then
      new.arquivada := false;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.conversas_status_arquiva() from public, anon, authenticated;
-- "c_" para rodar depois de a_blindar_conversa e b_espelhar_departamentos
create or replace trigger c_status_arquiva before update on conversas
  for each row execute function public.conversas_status_arquiva();

-- ---------- 2. mensagem nova: não lidas + reabre + desarquiva ----------
create or replace function public.registrar_entrada(cid uuid, previa text, quando timestamptz, entrada boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'registrar_entrada é exclusiva do motor' using errcode = '42501';
  end if;
  update conversas set
    nao_lidas     = nao_lidas + case when entrada then 1 else 0 end,
    status        = case when entrada and status in ('resolvido', 'fechado') then 'aberto' else status end,
    arquivada     = case when entrada then false else arquivada end,
    ultima_msg    = case when ultima_msg_em is null or quando >= ultima_msg_em then left(coalesce(previa, ''), 120) else ultima_msg end,
    ultima_msg_em = greatest(coalesce(ultima_msg_em, quando), quando)
  where id = cid;
end $$;
revoke execute on function public.registrar_entrada(uuid, text, timestamptz, boolean) from public, anon, authenticated;

-- ---------- 3. backfill (OPCIONAL — não aplicado em 05/10/2026, decisão do escritório) ----------
-- As conversas já resolvidas/fechadas continuam na caixa até alguém mexer no status
-- delas (ou até a seleção em lote → Status). Para tirá-las de uma vez, rode:
-- update conversas set arquivada = true where status in ('resolvido', 'fechado') and not arquivada;

-- [origem: chat-v15b.sql]
-- ============================================================
-- CHAT v15b — conversa SEM departamento só o admin vê (restritiva)
-- Cole no SQL Editor do Supabase e execute (Run). Seguro rodar mais de uma vez.
--
-- Até aqui a regra era "sem departamento = visível a todo o time" (fila de
-- triagem). Com 613 conversas do histórico sem departamento, qualquer atendente
-- via quase tudo (05/10/2026: Ana, do Imobiliário, via 670 conversas). Agora:
--   admin | algum departamento da conversa é meu | sou o responsável | alçada conversas_todas
-- Sem departamento fica com o admin até ser distribuída (seleção em lote →
-- Departamento). Contato novo já cai no Comercial Prospecção pela automação.
--
-- Publicação: front v6.19.4 (espelho em podeVerConversa) ANTES desta migração.
-- ============================================================
alter policy conversas_ler on conversas using (
  (select usuario_ativo()) and (
    (select sou_admin())
    or departamento_ids && (select meus_departamentos())::uuid[]
    or responsavel = (select auth.uid())
    or (select tem_permissao('conversas_todas'))
  )
);
alter policy conversas_editar on conversas using (
  (select usuario_ativo()) and (
    (select sou_admin())
    or departamento_ids && (select meus_departamentos())::uuid[]
    or responsavel = (select auth.uid())
    or (select tem_permissao('conversas_todas'))
  )
);

-- [origem: chat-v16a.sql]
-- ============================================================
-- CHAT v16a — presença do time: quem está online e horários de acesso (aditivo)
-- Cole no SQL Editor do Supabase e execute (Run). Seguro rodar mais de uma vez.
--
-- Cada aba aberta do sistema manda um pulso por minuto (rpc registrar_presenca).
-- O pulso cria ou prorroga um "acesso": linha em `acessos` com entrou_em e
-- visto_em. Mais de 10 min sem pulso (aba fechada, computador dormiu, almoço)
-- → o próximo pulso abre um acesso novo. Assim a tabela vira o histórico de
-- entradas e saídas de cada pessoa (90 dias; a própria RPC faz a faxina).
--
--   acessos              → admin lê tudo (Configurações → Equipe: horários de
--                          acesso de hoje); cada um lê só o próprio. Ninguém
--                          grava direto: só a RPC (security definer).
--   registrar_presenca() → o pulso; devolve o id do acesso em curso da aba.
--   equipe_presenca()    → todo o time vê quem está online: só id + último
--                          pulso, sem histórico.
--
-- Publicação: esta migração ANTES do front v6.19.7 (sem ela o front só não
-- mostra a presença — a RPC responde 404 e o pulso se desliga).
-- ============================================================
create table if not exists acessos (
  id uuid primary key default gen_random_uuid(),
  perfil_id uuid not null references perfis(id) on delete cascade,
  entrou_em timestamptz not null default now(),   -- primeiro pulso do acesso
  visto_em timestamptz not null default now()     -- último pulso (online = há menos de 3 min)
);
create index if not exists idx_acessos_perfil_visto on acessos(perfil_id, visto_em desc);

alter table acessos enable row level security;
revoke all on acessos from anon;
grant select on acessos to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'acessos' and policyname = 'acessos_ler') then
    create policy acessos_ler on acessos for select to authenticated
      using ((select usuario_ativo()) and ((select sou_admin()) or perfil_id = (select auth.uid())));
  end if;
end $$;

-- pulso de presença: prorroga o acesso em curso ou abre um novo
create or replace function registrar_presenca(sessao uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare atual uuid; ultimo timestamptz;
begin
  if not usuario_ativo() then return null; end if;
  if sessao is not null then
    select id, visto_em into atual, ultimo from acessos
     where id = sessao and perfil_id = auth.uid();
  end if;
  -- mais de 10 min sem pulso: é outro acesso (aba fechada, computador dormiu, almoço)
  if atual is null or ultimo < now() - interval '10 minutes' then
    insert into acessos (perfil_id) values (auth.uid()) returning id into atual;
    -- faxina do próprio histórico: 90 dias bastam para "horários de acesso"
    delete from acessos where perfil_id = auth.uid() and visto_em < now() - interval '90 days';
  else
    update acessos set visto_em = now() where id = atual;
  end if;
  return atual;
end $$;
revoke all on function registrar_presenca(uuid) from public, anon;
grant execute on function registrar_presenca(uuid) to authenticated;

-- quem está online (todo o time): id + último pulso de cada pessoa, nada mais
create or replace function equipe_presenca()
returns table (perfil_id uuid, visto_em timestamptz)
language sql stable security definer set search_path = public as $$
  select a.perfil_id, max(a.visto_em)
    from acessos a
   where usuario_ativo()
   group by a.perfil_id
$$;
revoke all on function equipe_presenca() from public, anon;
grant execute on function equipe_presenca() to authenticated;

-- [origem: chat-v16b.sql]
-- ============================================================
-- CHAT v16b — nome do usuário e configurações do escritório só o admin muda (restritivo)
-- Cole no SQL Editor do Supabase e execute (Run). Seguro rodar mais de uma vez.
--
-- Decisão do escritório (05/10/2026): quem não é admin não muda o próprio nome nem o
-- nome da empresa; metas, investimento, automações do CRM e contexto da IA
-- também são só do admin.
--
--   perfis_blindar  → ganha `nome` na lista do que só o admin altera (o admin
--                     muda o nome de cada um em Início → Usuários e alçadas).
--   config_blindar  → a linha `geral` da tabela config guarda tudo isso num
--                     jsonb só. A aba do atendente sobe a linha inteira no sync
--                     e podia devolver o valor velho por cima do que o admin
--                     acabou de salvar. Agora, quando quem grava não é admin,
--                     essas chaves ficam como estavam no banco.
--
-- Publicação: DEPOIS do front v6.19.7 (que já não deixa o atendente mexer
-- nesses campos). Sem o front novo, um atendente antigo veria "Só o
-- administrador altera…" ao salvar o perfil.
-- ============================================================
create or replace function perfis_blindar()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if chamada_de_servico() then return new; end if;
  if tg_op = 'INSERT' then
    if not eh_admin() then
      new.papel := 'atendente'; new.ativo := false; new.permissoes := '{}'::jsonb;
      new.departamento_id := null; new.departamento_ids := '{}';
      new.modo_espiao := false; new.horario_ativo := false;
      new.assinatura := ''; new.exibir_assinatura := false;
    end if;
    return new;
  end if;
  if not eh_admin() then
    if new.nome is distinct from old.nome
       or new.papel is distinct from old.papel or new.ativo is distinct from old.ativo
       or new.permissoes is distinct from old.permissoes
       or new.departamento_id is distinct from old.departamento_id
       or new.departamento_ids is distinct from old.departamento_ids
       or new.horario_ativo is distinct from old.horario_ativo or new.horario is distinct from old.horario
       or new.modo_espiao is distinct from old.modo_espiao
       or new.espiao_zera_ao_enviar is distinct from old.espiao_zera_ao_enviar
       or new.assinatura is distinct from old.assinatura
       or new.exibir_assinatura is distinct from old.exibir_assinatura
       or new.email is distinct from old.email then
      raise exception 'Só o administrador altera nome, alçadas, departamentos, horário e assinatura.'
        using errcode = '42501';
    end if;
  end if;
  if old.papel = 'admin' and old.ativo and (new.papel <> 'admin' or not new.ativo)
     and not exists (select 1 from perfis p where p.papel = 'admin' and p.ativo and p.id <> old.id) then
    raise exception 'Este é o último administrador ativo: promova outra pessoa antes.' using errcode = '42501';
  end if;
  return new;
end $$;

-- config.geral: chaves que só o admin muda ficam como estavam quando quem grava não é admin
create or replace function config_blindar()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  protegidas text[] := array['empresa', 'metaLeads', 'metaContratos', 'metaReceita', 'investimentoMkt',
    'investimentoPorMes', 'contextoIA', 'autoCriarLead', 'analiseAutomatica', 'janelaEnvio', 'esfriandoHoras',
    'inatividadeHoras'];  -- horas sem uso até a sessão encerrar sozinha (v6.19.8)
  k text;
begin
  if chamada_de_servico() or eh_admin() then return new; end if;
  if new.chave <> 'geral' then return new; end if;
  if tg_op = 'INSERT' then
    -- o upsert do front (on conflict do update) passa pelo UPDATE abaixo;
    -- criar a configuração geral do zero é só do admin
    if exists (select 1 from config where chave = 'geral') then return new; end if;
    raise exception 'Só o administrador define as configurações do escritório.' using errcode = '42501';
  end if;
  foreach k in array protegidas loop
    if old.valor ? k then
      new.valor := jsonb_set(coalesce(new.valor, '{}'::jsonb), array[k], old.valor -> k, true);
    else
      new.valor := coalesce(new.valor, '{}'::jsonb) - k;
    end if;
  end loop;
  return new;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'config_blindar' and tgrelid = 'public.config'::regclass) then
    create trigger config_blindar before insert or update on config
      for each row execute function config_blindar();
  end if;
end $$;

-- [origem: chat-v16c.sql]
-- ============================================================
-- CHAT v16c — arquivos grandes SOB DEMANDA (aditivo)
-- Cole no SQL Editor do Supabase e execute (Run). Seguro rodar mais de uma vez.
--
-- Pedido do escritório (05/10/2026): um .zip de 137 MB virou "[arquivo grande demais
-- para o sistema — veja no celular]" e ele quer uma solução que não ocupe
-- espaço à toa. Agora, acima do limite do bucket `midias` (60 MB), o motor NÃO
-- baixa: guarda só o que precisa para baixar depois (chave da mensagem e o nó
-- da mídia: url, directPath, mediaKey, hashes) em `midias_pendentes`, e a
-- mensagem entra com nome, tamanho e tipo. No Chat aparece "Baixar do WhatsApp
-- (137 MB)"; só quando alguém clica o motor baixa do WhatsApp, em fluxo (sem
-- segurar o arquivo inteiro na memória), e sobe para o bucket `midias-grandes`.
-- Sete dias depois o motor apaga o arquivo do bucket (o botão volta; dá para
-- baixar de novo enquanto o WhatsApp ainda tiver a mídia).
--
--   midias-grandes   → bucket público de leitura (como `midias`), 500 MB por
--                      arquivo; só o motor grava (chave de serviço), ninguém do
--                      time sobe nada aqui.
--   midias_pendentes → só o motor lê e grava. Sem policy e sem grant para
--                      anon/authenticated. Linhas com mais de 90 dias são
--                      apagadas (o WhatsApp já não teria mais a mídia).
--
-- ATENÇÃO (painel do Supabase, com o administrador): Storage → Settings → "Upload file
-- size limit" é o teto GLOBAL do projeto e precisa ser ≥ 500 MB, senão o
-- Storage recusa o arquivo mesmo com o bucket liberado.
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('midias-grandes', 'midias-grandes', true, 524288000)      -- 500 MB por arquivo
on conflict (id) do update set public = true, file_size_limit = 524288000;

create table if not exists midias_pendentes (
  externo_id text primary key,                 -- id da mensagem no WhatsApp (= mensagens.externo_id)
  conversa_id uuid not null,
  key jsonb not null,                          -- key da mensagem (remoteJid, id, fromMe, participant)
  no jsonb not null,                           -- nó da mídia (url, directPath, mediaKey, fileSha256, fileEncSha256, fileLength, mimetype, fileName), buffers em base64
  tipo text not null default 'arquivo',        -- arquivo | video | imagem | audio
  mime text not null default '',
  nome text not null default '',
  tamanho bigint not null default 0,
  caminho text,                                -- objeto no bucket midias-grandes depois de baixado
  baixado_em timestamptz,                      -- quando subiu para o bucket (faxina 7 dias depois)
  criado_em timestamptz not null default now()
);
create index if not exists idx_midias_pendentes_baixado on midias_pendentes(baixado_em);
create index if not exists idx_midias_pendentes_criado on midias_pendentes(criado_em);

alter table midias_pendentes enable row level security;
revoke all on midias_pendentes from anon, authenticated;

-- [origem: chat-v17a.sql]
-- ============================================================
-- chat-v17a — IA do escritório, parte ADITIVA (aplicado no baseline)
--
-- O motor passa a publicar em motor_estado o que tem ativo (transcrição,
-- IA do escritório e o modelo em uso), para o front mostrar em
-- Configurações → IA do escritório. Enquanto esta coluna não existir, o
-- motor grava o estado sem ela e segue (tolerância a 42703/PGRST204).
--
-- Só acrescenta uma coluna com padrão: nada quebra no front ou no motor
-- antigos. Spec: nuvem/PLANO-IA-ESCRITORIO.md
-- ============================================================

alter table motor_estado add column if not exists recursos jsonb not null default '{}'::jsonb;
comment on column motor_estado.recursos is 'O que o motor tem ativo: { transcricao, ia, modelo } (IA do escritório, 10/2026)';

-- conferência: deve devolver 1 linha
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'motor_estado' and column_name = 'recursos';

-- [origem: chat-v17b.sql]
-- ============================================================
-- chat-v17b — IA do escritório, parte RESTRITIVA (aplicado no baseline)
-- Cole no SQL Editor do Supabase e execute (Run). Seguro rodar mais de uma vez.
--
-- O modelo da IA do escritório (`modeloIA` na linha `geral` da tabela config)
-- vale para todo o time e só o admin escolhe. Como a aba do atendente sobe a
-- linha inteira no sync, sem esta blindagem ela devolveria o modelo velho por
-- cima do que o admin acabou de salvar. Mesmo corpo de config_blindar da
-- chat-v16b, com `modeloIA` acrescentada à lista de chaves protegidas.
-- O gatilho já existe (chat-v16b) e aponta para esta função.
-- Nada destrutivo: só `create or replace`. Spec: nuvem/PLANO-IA-ESCRITORIO.md
-- ============================================================

-- config.geral: chaves que só o admin muda ficam como estavam quando quem grava não é admin
create or replace function config_blindar()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  protegidas text[] := array['empresa', 'metaLeads', 'metaContratos', 'metaReceita', 'investimentoMkt',
    'investimentoPorMes', 'contextoIA', 'autoCriarLead', 'analiseAutomatica', 'janelaEnvio', 'esfriandoHoras',
    'inatividadeHoras',  -- horas sem uso até a sessão encerrar sozinha (v6.19.8)
    'modeloIA'];         -- modelo da IA do escritório (v6.21.0)
  k text;
begin
  if chamada_de_servico() or eh_admin() then return new; end if;
  if new.chave <> 'geral' then return new; end if;
  if tg_op = 'INSERT' then
    -- o upsert do front (on conflict do update) passa pelo UPDATE abaixo;
    -- criar a configuração geral do zero é só do admin
    if exists (select 1 from config where chave = 'geral') then return new; end if;
    raise exception 'Só o administrador define as configurações do escritório.' using errcode = '42501';
  end if;
  foreach k in array protegidas loop
    if old.valor ? k then
      new.valor := jsonb_set(coalesce(new.valor, '{}'::jsonb), array[k], old.valor -> k, true);
    else
      new.valor := coalesce(new.valor, '{}'::jsonb) - k;
    end if;
  end loop;
  return new;
end $$;

-- conferência: deve devolver true
select prosrc like '%modeloIA%' as modelo_ia_blindado from pg_proc where proname = 'config_blindar';

-- [origem: chat-v18a.sql]
-- ============================================================
-- chat-v18a — Campos personalizados do contato (ADITIVA)
-- Cole no SQL Editor do Supabase e execute (Run). Seguro rodar mais de uma vez.
--
-- Pedido do escritório (07/10/2026, modelo do ChatGuru): uma seção "Campos
-- personalizados" nos Dados do contato/grupo, com rótulo e valor por conversa
-- (Astrea, Drive, Canva, nº do processo, integrantes do grupo).
--
--   campos_personalizados  → a LISTA de campos do escritório (nome, tipo, ordem).
--                            Todo usuário ativo lê; cria/renomeia/apaga quem é
--                            admin ou tem a alçada campos_gerir (como tags_gerir).
--   conversas.campos       → os VALORES de cada conversa: { "<id do campo>": "<texto>" }.
--                            O front nunca envia esta coluna na linha inteira;
--                            só a função abaixo grava, uma chave por vez, para
--                            duas pessoas preenchendo campos diferentes não se
--                            atropelarem (mesma ideia de conversa_departamento).
--   conversa_campo()       → grava/apaga UMA chave, conferindo que quem pede
--                            enxerga a conversa (mesma regra da RLS conversas_ler)
--                            e que o campo existe. Vazio apaga a chave.
--
-- Nada destrutivo: create ... if not exists / create or replace.
-- Spec: nuvem/PLANO-CAMPOS-PERSONALIZADOS.md
-- ============================================================

-- ---------- 1. lista de campos do escritório ----------
create table if not exists campos_personalizados (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  tipo text not null default 'texto' check (tipo in ('texto', 'link')),
  ordem int not null default 0,
  criado_em timestamptz not null default now()
);
comment on table campos_personalizados is 'Campos personalizados do contato: lista única do escritório (valores ficam em conversas.campos)';

alter table campos_personalizados enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'campos_personalizados' and policyname = 'campos_ver') then
    create policy campos_ver on campos_personalizados for select to authenticated
      using ((select usuario_ativo()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'campos_personalizados' and policyname = 'campos_gerir') then
    create policy campos_gerir on campos_personalizados for all to authenticated
      using ((select eh_admin()) or (select tem_permissao('campos_gerir')))
      with check ((select eh_admin()) or (select tem_permissao('campos_gerir')));
  end if;
end $$;

-- ---------- 2. valores por conversa ----------
alter table conversas add column if not exists campos jsonb not null default '{}'::jsonb;
comment on column conversas.campos is 'Valores dos campos personalizados: { "<id do campo>": "<texto>" }; gravado só pela função conversa_campo';

-- ---------- 3. gravar uma chave por vez ----------
create or replace function public.conversa_campo(cid uuid, chave text, valor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare novo jsonb;
begin
  if not usuario_ativo() or not exists (
       select 1 from conversas c where c.id = cid and (
         sou_admin() or cardinality(c.departamento_ids) = 0
         or c.departamento_ids && (meus_departamentos())::uuid[]
         or c.responsavel = auth.uid() or tem_permissao('conversas_todas'))) then
    raise exception 'conversa não encontrada ou sem acesso' using errcode = '42501';
  end if;
  if not exists (select 1 from campos_personalizados where id::text = chave) then
    raise exception 'campo não encontrado' using errcode = '23503';
  end if;
  valor := btrim(coalesce(valor, ''));
  if length(valor) > 2000 then
    raise exception 'valor longo demais (máximo 2.000 caracteres)' using errcode = '22001';
  end if;
  update conversas
     set campos = case
       when valor = '' then coalesce(campos, '{}'::jsonb) - chave
       else jsonb_set(coalesce(campos, '{}'::jsonb), array[chave], to_jsonb(valor), true) end
   where id = cid
   returning campos into novo;
  if novo is null then
    raise exception 'conversa não encontrada' using errcode = '42501';
  end if;
  return novo;
end $$;
revoke execute on function public.conversa_campo(uuid, text, text) from public, anon;
grant execute on function public.conversa_campo(uuid, text, text) to authenticated;

-- ---------- conferência ----------
-- select count(*) from campos_personalizados;
-- select column_name from information_schema.columns where table_name = 'conversas' and column_name = 'campos';
-- select policyname from pg_policies where tablename = 'campos_personalizados';

-- [origem: chat-v19a.sql]
-- ============================================================
-- chat-v19a — Apagar anotações internas (ADITIVA)
-- Cole no SQL Editor do Supabase e execute (Run). Seguro rodar mais de uma vez.
--
-- Pedido do escritório (08/10/2026): "nas liberações, na parte de anotações internas,
-- gerar a opção de apagar as anotações internas e liberar para todos os usuários".
--
--   alçada notas_apagar  → chave nova da matriz (grupo Anotações internas). No front
--                          ela entra no padrão de atendente; aqui é ligada em todo perfil
--                          e departamento que já têm alçadas gravadas (quem tem alguma
--                          chave gravada não usa o padrão), para valer "para todos" desde
--                          o primeiro dia. O admin desliga quem quiser pela tela.
--   alcadas_padrao()     → "ninguém configurou alçadas para esta pessoa" (perfil e
--                          departamentos com {}): o mesmo nadaConfigurado do pode() do
--                          front. Com ela, a pessoa recém-criada também apaga.
--   msg_apagar (RLS)     → a política de DELETE em mensagens passa a aceitar anotação
--                          (tipo = 'anotacao') de quem tem a alçada, seja quem for o autor.
--                          A visibilidade da conversa continua valendo (política de SELECT).
--                          Mensagens do WhatsApp seguem como antes (admin / autor e status).
-- Sem DROP: alter policy / create or replace (o conector recusa DROP).
-- ============================================================

create or replace function public.alcadas_padrao() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select permissoes from perfis where id = auth.uid()), '{}'::jsonb) = '{}'::jsonb
     and not exists (
       select 1 from departamentos d
       where d.id = any(meus_departamentos()) and d.permissoes <> '{}'::jsonb
     )
$$;

alter policy msg_apagar on mensagens using (
  (select eh_admin())
  or (autor = (select auth.uid()) and status in ('pendente', 'agendada', 'erro', 'cancelada'))
  or (tipo = 'anotacao' and ((select tem_permissao('notas_apagar')) or (select alcadas_padrao())))
);

-- liga a alçada nova em quem já tem alçadas gravadas (perfis não-admin e departamentos);
-- quem está com {} continua no padrão de atendente, que já inclui notas_apagar
update perfis set permissoes = permissoes || '{"notas_apagar": true}'::jsonb
 where papel <> 'admin' and permissoes <> '{}'::jsonb
   and not coalesce((permissoes->>'notas_apagar')::boolean, false);
update departamentos set permissoes = permissoes || '{"notas_apagar": true}'::jsonb
 where permissoes <> '{}'::jsonb
   and not coalesce((permissoes->>'notas_apagar')::boolean, false);

-- [origem: chat-v19c.sql]
-- Tags com ordem de lista: posição na lista (painel Tags, seletor do drawer, chips das conversas). Nula = fim.

alter table tags add column if not exists ordem integer;
