-- ============================================================
-- conferir-esquema — consultas somente-leitura para comparar dois bancos
-- Uso: rodar este arquivo no banco de referência (produção de origem) e no banco novo,
-- salvar a saída de cada bloco e comparar com `diff`. Cada consulta é precedida de
-- `-- bloco: <nome>` e devolve texto simples, já ordenado, para o diff ser estável.
-- A lista de diferenças esperadas entre dois ambientes é registrada no RUNBOOK.md (seção banco).
-- ============================================================

-- bloco: colunas
select table_name, column_name, data_type, udt_name, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
order by table_name, column_name;

-- bloco: constraints
select t.relname, c.conname, pg_get_constraintdef(c.oid) as definicao
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
order by t.relname, c.conname;

-- bloco: indices
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;

-- bloco: funcoes
select p.proname, pg_get_function_identity_arguments(p.oid) as argumentos, md5(pg_get_functiondef(p.oid)) as hash_definicao
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname, argumentos;

-- bloco: triggers
select t.relname, tg.tgname, pg_get_triggerdef(tg.oid) as definicao
from pg_trigger tg
join pg_class t on t.oid = tg.tgrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname in ('public', 'auth') and not tg.tgisinternal
order by t.relname, tg.tgname;

-- bloco: policies
select schemaname, tablename, policyname, cmd, roles::text as papeis, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;

-- bloco: grants_funcoes
select routine_name, grantee, privilege_type
from information_schema.role_routine_grants
where specific_schema = 'public' and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
order by routine_name, grantee, privilege_type;

-- bloco: rls
select c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;

-- bloco: grants_tabelas
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
order by 1, 2, 3;

-- bloco: buckets
select id, public, file_size_limit
from storage.buckets
order by id;

-- bloco: publication
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by schemaname, tablename;
