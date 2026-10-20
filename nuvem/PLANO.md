# Marques e Vasques · Sistema: plano

## O que é
Um sistema só, em três partes:
- **Chat**: o WhatsApp do escritório no computador, com departamentos, tags, respostas rápidas, notas internas e mensagens agendadas.
- **CRM**: leads, etapas de venda, agenda de follow-ups, cadências, contratos e dashboard.
- **Usuários e alçadas**: o administrador cria os acessos e define o que cada pessoa vê e faz.

Para 9 a 15 usuários, no computador, na primeira fase.

## Entregue na versão 1.0.x
- Início, Chat, CRM, Usuários e alçadas e Configurações, com a identidade e as cores do escritório.
- Banco pronto para criar (`000`, `001`, `002`), com departamentos, tags e respostas rápidas iniciais.
- Motor do WhatsApp com alerta de queda por e-mail.
- Roteiro de ativação (`ATIVACAO.md`), guia de uso (`LEIA-ME.md`) e runbook de operação (`RUNBOOK.md`).
- Testes automáticos passando.

## O que falta para entrar no ar
O sistema ainda não está ligado à nuvem. Os passos, com o detalhe no `ATIVACAO.md`:
1. O escritório abre as contas (e-mail, GitHub, Vercel, Supabase, Railway, Anthropic, Healthchecks.io), cria o CNAME `sistema` e separa o chip de WhatsApp.
2. O Arca monta o banco, configura o painel do Supabase, publica o front e sobe o motor.
3. Pareamento do QR, testes de envio e recebimento, criação dos usuários e alçadas.
4. Aceite em conjunto e entrega do arquivo de chaves.

Dependem de resposta do escritório: domínio, e-mails dos sócios e da equipe, número do WhatsApp, plano da Vercel e se logo e IA entram já.

## Próximas melhorias possíveis
- Logo do escritório no sistema.
- Assistente de IA e transcrição de áudios.
- SMTP próprio para os e-mails de senha, se o volume crescer.
- Relatórios mais completos.
- Uso no celular.
- Cópia periódica das mídias do Chat.

## Andamento
| Data | O que aconteceu | Próximo passo |
|---|---|---|
| | | |
