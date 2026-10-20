# Marques e Vasques · Sistema — regras para o Claude

Sistema interno do escritório Marques e Vasques Advogados (sócios Thiago e Vanessa), feito pelo Arca:
**Início** (hub) + **Chat** (WhatsApp do escritório, `#/atendimento`) + **CRM** (dashboard, leads,
contratos, agenda, cadências, playbook) + **Usuários e alçadas** (`#/usuarios`, só admin) + Configurações.
Front em JS puro, sem build (`index.html` + `js/` + `css/`); motor Node/Baileys em `motor/` (Railway).
Tudo em português, inclusive código, comentários e commits.

## Onde está o quê
- Estado e próximos passos: `nuvem/PLANO.md`. Operação e incidentes: `nuvem/RUNBOOK.md`. Ativação: `nuvem/ATIVACAO.md`.
- Identidade (nomes, chaves de armazenamento): `js/escritorio.js`. Cor, sombra, raio, tamanho: `css/tokens.css`.
- Rotas e plataformas: `js/ui-core.js`. Alçadas: matriz `PERMISSOES` e `pode()` em `js/views-chat.js`.
- Banco: `nuvem/000-baseline.sql`, `001-mv-seed.sql`, `002-primeiro-admin.sql`; comparar ambientes com `nuvem/conferir-esquema.sql`.
- Padrão visual: `DESIGN.md`. Chaves e acessos: `~/Documents/MV-CHAVES.md` (fora do repositório).

## Regras que não se negociam
- **`css/tokens.css` é a única fonte de cor.** Exceções (cores que são dado) levam `/* cor-dado */`.
- **Toda mudança em `js/` ou `css/` sobe a versão:** `python3 nuvem/versao.py X.Y.Z` troca os 3 lugares
  (`?v=` no `index.html`, `APP_VERSAO` em `js/main.js`, `versao.json`). O cache da Vercel é imutável por 1 ano.
- **Testes antes de publicar:** `node testes/testes-front.js` e `node testes/testes-motor.js`, ambos com 0 falha.
- **Guarda de marca obrigatória:** nenhuma menção ao sistema de origem em arquivo publicado ou do motor.
- **Ordem de publicação:** SQL aditivo → front → SQL restritivo → motor.
- Migrações novas viram `003-…sql`, numeradas; nunca editar uma já aplicada.
- **Contas e tokens só do escritório (`~/.mv-*`), nunca de outra operação.**
- Publicar, aplicar SQL no banco real ou mexer no Railway só com confirmação do dono.

## Publicar
- Front: `python3 nuvem/publicar.py` (token em `~/.mv-vercel-token`, `TEAM_ID` do escritório).
- Motor: `nuvem/publicar-motor.sh` (token de projeto em `~/.mv-railway-token`). 1 réplica só.

## Decisões do escritório
9–15 usuários, só computador na 1ª fase · admins = um sócio + um reserva · alerta de queda só por e-mail.
