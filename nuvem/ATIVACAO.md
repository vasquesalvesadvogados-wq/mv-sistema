# Marques e Vasques · Sistema: roteiro de ativação

Regra permanente: **nenhuma conta ou token de outra operação é reutilizada.** Tudo nasce no e-mail corporativo do escritório. O Arca entra em cada serviço como membro convidado, nunca como dono. Os tokens do Arca ficam em `~/.mv-*`.

O sistema já funciona em modo local (sem nuvem). Cada fase abaixo liga uma camada.

## Fase 1: O escritório faz
Pode começar já, em paralelo.
1. [ ] **E-mail corporativo** para abrir as contas, e um cartão de crédito para Supabase Pro e Railway.
2. [ ] **GitHub**: conta e repositório privado `mv-sistema`. Convide o Arca como colaborador.
3. [ ] **Vercel**: conta e time do escritório. Convide o Arca como Member.
4. [ ] **Supabase**: conta e organização. Convide o Arca (Developer basta). Crie o projeto no plano **Pro**, região **São Paulo**. Guarde a senha do banco.
5. [ ] **Railway**: conta e workspace. Convide o Arca. Crie o projeto `mv-sistema` com um serviço chamado `mv-motor` (o `publicar-motor.sh` usa `--service mv-motor`) e gere um **token de projeto**; envie ao Arca por canal seguro.
6. [ ] **Anthropic** (console): crie a conta e uma chave de API. **Healthchecks.io**: crie a conta (gratuita).
7. [ ] **DNS**: quando a Vercel informar o destino, crie o CNAME `sistema` no registrador do domínio.
8. [ ] **Chip de WhatsApp do escritório** (o número que será o Chat) e um celular para ler o QR.
9. [ ] **Planilha** com os usuários (nome e e-mail), os departamentos e quem é administrador (um sócio e um reserva).

## Fase 2: O Arca faz
1. [ ] Aplicar no banco os arquivos `000-baseline.sql` e `001-mv-seed.sql`, cada um com confirmação do escritório.
2. [ ] Painel do Supabase:
   - [ ] desligar o cadastro público (Authentication → Sign In / Providers);
   - [ ] preencher Site URL e Redirect URLs (`https://sistema.<domínio>` e a reserva `https://mv-sistema.vercel.app`, com `/**`);
   - [ ] ligar a proteção contra senha vazada;
   - [ ] conferir **Max rows = 1000** no PostgREST;
   - [ ] Storage → limite de upload **≥ 500 MB**;
   - [ ] criar o usuário do sócio em Authentication → Users → Add user (**Auto Confirm**).
3. [ ] Preencher `js/cloud-config.js`, conferir `dominioEmail` em `js/escritorio.js` e (opcional) o `preconnect` do Supabase no `index.html`; publicar o front.
4. [ ] Trocar o e-mail em `002-primeiro-admin.sql`, aplicar (com confirmação) e entrar no sistema como administrador.
5. [ ] Subir o motor no Railway com as variáveis abaixo, **1 réplica**, healthcheck em `/` e reinício ALWAYS (configurados pelo painel).
   - `SUPABASE_URL` e `SUPABASE_SERVICE_KEY`: acesso do motor ao banco.
   - `HC_URL`: URL de ping do Healthchecks.io.
   - `ANTHROPIC_API_KEY`: chave do assistente de IA.
   - `GROQ_API_KEY` (opcional): transcrição de áudio.
   - `NOME_SISTEMA` = "Marques e Vasques": sem ela o alerta sai "Motor do Chat de Sistema".
   - `RESETAR_SESSAO`: só quando preciso refazer o pareamento.
6. [ ] Parear o QR com o chip do escritório.
7. [ ] Testar envio e recebimento: texto, mídia e grupo.
8. [ ] Criar usuários (tela Usuários), departamentos e alçadas.
9. [ ] Entregar o `MV-CHAVES.md` preenchido por canal seguro.

## Fase 3: Ordem do primeiro deploy
banco → painel do Supabase → front → 1º administrador → login → motor → QR → teste → usuários e alçadas → domínio.

## Fase 4: Aceite
- [ ] Os dois sócios entram com seus e-mails.
- [ ] Um atendente sem "Acesso ao CRM" não vê o CRM.
- [ ] Mensagem recebida aparece em menos de 10 segundos.
- [ ] Mídia recebida abre.
- [ ] Lead criado a partir de uma conversa.
- [ ] Follow-up aparece na agenda.
- [ ] Parando o motor por 5 minutos, o alerta chega por e-mail.
- [ ] "Esqueci minha senha" entrega o e-mail.
- [ ] Depois de uma publicação, o sistema avisa que há versão nova.

## Pendências a confirmar com o escritório
- Domínio e quem mexe no DNS.
- E-mails dos sócios, lista de usuários e departamentos.
- Número de WhatsApp que será o Chat.
- Plano da Vercel: Hobby ou Pro.
- Logo do escritório já na primeira versão?
- Assistente de IA (chave Anthropic) e transcrição de áudio desde o início?


> Git: ao publicar o código no GitHub do escritório, suba **só o branch `main`**. O branch local `historico-derivacao` é arquivo interno do Arca e não deve ser enviado.
