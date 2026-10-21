# Ativação, passo a passo por painel (operador: Arca)

Complementa o `ATIVACAO.md` com onde entrar e onde clicar. Vale para o cenário em que as contas
Vercel, GitHub e Railway são usadas direto com o e-mail do escritório (sem convite), e o Supabase
foi compartilhado por convite. Nomes de menu podem variar um pouco com o tempo: procure o termo
entre aspas.

Regras: cada conta nasce no e-mail do escritório; nenhum token de outra operação é reutilizado;
tokens ficam nesta máquina em `~/.mv-*` com permissão 600 e os valores vão para
`~/Documents/MV-CHAVES.md` (nunca para o Drive, nunca para o git).

Para gravar um token em arquivo: `printf '%s' 'VALOR' > ~/.mv-vercel-token && chmod 600 ~/.mv-vercel-token`.
Ou cole o valor na conversa com o Claude, que ele grava do mesmo jeito.

Ordem de subida: Supabase → GitHub → Vercel → primeiro admin → Railway → QR → Healthchecks → domínio.

---

## 1. Supabase (banco)

1. **Aceitar o convite.** Na caixa de `klinger.campos@arcajuridico.com.br`, abra o e-mail
   "You have been invited to join … on Supabase" e clique em aceitar; entre no
   supabase.com com esse e-mail. A organização do escritório passa a aparecer no seletor do canto
   superior esquerdo.
2. **Conector do Claude.** Se, depois de aceitar, o Claude ainda não enxergar a organização:
   claude.ai → Configurações → Conectores → Supabase → Desconectar → Conectar de novo, autorizando
   todas as organizações. Avise o Claude para conferir.
3. **Criar o projeto** (na organização do escritório): botão "New project" → Name `mv-sistema` →
   Database Password: clique em "Generate a password", copie para o MV-CHAVES.md → Region
   "South America (São Paulo)" → "Create new project". Espera de 1 a 3 minutos. O plano é da
   organização: em Organization → Billing, o plano precisa estar em **Pro** (cartão do escritório).
4. **Chaves.** Project Settings (ícone de engrenagem no menu esquerdo) → "API" (em versões novas,
   "API Keys"): copie "Project URL", a chave "anon public" (vai no front) e a "service_role"
   (secreta, só o motor). Passe as três ao Claude; a service_role vai para `~/.mv-supabase-service`.
5. **SQL.** O Claude aplica `000-baseline.sql` e `001-mv-seed.sql` pelo conector (pede confirmação)
   e roda `conferir-esquema.sql`. Alternativa manual: SQL Editor → "New query" → colar o arquivo →
   "Run", na ordem 000 e 001.
6. **Cadastro público desligado.** Authentication → "Sign In / Providers" → Email → desligar
   "Allow new users to sign up" (em versões antigas: Authentication → Settings → "Enable sign ups")
   → Save.
7. **Endereços de retorno.** Authentication → "URL Configuration": Site URL =
   `https://mv-sistema.vercel.app` (troca para o domínio na etapa 8); Redirect URLs → "Add URL" →
   `https://mv-sistema.vercel.app/**`. Quando o domínio existir, acrescente `https://sistema.<domínio>/**`.
8. **Senha vazada.** Authentication → "Attack Protection" (ou Settings → Security): ligar
   "Leaked password protection" → Save.
9. **Storage.** Storage → "Settings" (ou Project Settings → Storage): "Upload file size limit" =
   500 MB → Save. Os buckets `midias` e `midias-grandes` já vêm do baseline.
10. **Max rows.** Project Settings → API → "Max rows": deve estar em 1000 (é o padrão).
11. **Primeiro admin** (pode ser agora; o login só funciona depois do front publicado):
    Authentication → Users → "Add user" → "Create new user": e-mail do sócio, senha provisória,
    marcar "Auto Confirm User" → "Create user". Avise o e-mail ao Claude: ele aplica o
    `002-primeiro-admin.sql` com esse e-mail. Repita para o admin reserva depois, pela tela
    Usuários e alçadas do próprio sistema.

## 2. GitHub (código)

1. github.com, logado com o e-mail do escritório → "+" (canto superior direito) → "New repository":
   Owner = a conta do escritório, Repository name `mv-sistema`, **Private**, não marque README,
   .gitignore nem license → "Create repository". Deixe a página aberta: a URL é
   `https://github.com/<conta>/mv-sistema.git`.
2. **Token só para este repositório.** Foto de perfil → Settings → "Developer settings" (fim do menu
   esquerdo) → "Personal access tokens" → "Fine-grained tokens" → "Generate new token": Token name
   `mv-sistema push`, Expiration 90 dias (ou custom), Resource owner = a conta do escritório,
   Repository access = "Only select repositories" → `mv-sistema`, Permissions → Repository
   permissions → **Contents: Read and write** (Metadata fica Read sozinho) → "Generate token" →
   copie (só aparece uma vez) → `~/.mv-github-token`.
3. Passe ao Claude o nome da conta (`<conta>`). Ele faz o push só do branch `main`, usando o token
   na URL do push sem gravá-lo no repositório.

## 3. Vercel (front)

1. vercel.com → "Sign Up" → "Continue with Email" com o e-mail do escritório → plano Hobby
   (o Pro, US$20/mês, é o adequado para uso comercial; decisão do escritório, pode ser depois).
2. **Team ID.** Na conta nova, o escopo pessoal já é um "time". Menu do avatar → "Team Settings"
   (ou o seletor de escopo no canto superior esquerdo → Settings) → aba "General" → campo
   **Team ID** (`team_…`) → copie e passe ao Claude. Alternativa: o Claude descobre pela API com o token.
3. **Token.** Avatar → "Account Settings" → "Tokens" → "Create": Token name `mv-sistema publicar`,
   Scope = a conta/time do escritório, Expiration (1 ano) → "Create" → copie → `~/.mv-vercel-token`.
4. O Claude preenche `TEAM_ID` em `nuvem/publicar.py` e `js/cloud-config.js` com a URL e a anon do
   Supabase, roda os testes e publica com `python3 nuvem/publicar.py`. O projeto `mv-sistema` é
   criado pela própria API no primeiro deploy. Endereço de reserva: `https://mv-sistema.vercel.app`
   (se o nome já existir na Vercel, ela acrescenta um sufixo; o Claude informa o endereço real).
5. **Primeiro login.** Abra o endereço, entre com o e-mail do sócio e a senha provisória. Troque a
   senha em Configurações. Se o login recusar, o Claude confere o `002` e o `ativo` do perfil.

## 4. Railway (motor do WhatsApp)

1. railway.com → "Login" com o e-mail do escritório → plano Hobby (US$5/mês + uso; pede cartão).
2. "New Project" → "Empty project". Depois: Settings do projeto (engrenagem) → General → Name
   `mv-sistema`.
3. Dentro do projeto: "+ Create" (ou "+ New") → "Empty Service" → clique no serviço → Settings →
   "Service Name" `mv-motor`.
4. **Variáveis.** Serviço `mv-motor` → aba "Variables" → "+ New Variable" (ou "Raw Editor"):
   `SUPABASE_URL` (Project URL do Supabase), `SUPABASE_SERVICE_KEY` (service_role),
   `NOME_SISTEMA` = `Marques e Vasques`, `HC_URL` (etapa 6), `ANTHROPIC_API_KEY` (etapa 7, opcional),
   `GROQ_API_KEY` (opcional). Ou passe os valores ao Claude, que grava pelo CLI.
5. **Saúde e reinício.** Serviço → Settings → Deploy: "Healthcheck Path" = `/`; "Restart Policy" =
   Always; Replicas = 1 (não aumente nunca: duas réplicas derrubam o WhatsApp uma da outra).
   Settings → Networking → "Generate Domain" é opcional (só para ver o status em `GET /`).
6. **Token de projeto.** Settings do projeto → "Tokens" → "Create token": nome `deploy mv-motor`,
   Environment `production` → copie → `~/.mv-railway-token`.
7. O Claude roda `nuvem/publicar-motor.sh` (faz `railway up` no serviço `mv-motor`). O log mostra
   "aguardando configuração" até as variáveis existirem e depois "aguardando QR".
8. **Parear o WhatsApp.** No sistema, logado como admin: Configurações → "Motor WhatsApp" → o QR
   aparece. No celular com o chip do escritório: WhatsApp → Configurações → "Aparelhos conectados"
   → "Conectar aparelho" → escanear. O status vira "conectado". Teste: mande uma mensagem de outro
   número e veja chegar no Chat; responda pelo Chat e veja chegar no celular.

## 5. Healthchecks.io (alerta de queda por e-mail)

1. healthchecks.io → "Sign Up" com o e-mail do escritório (gratuito).
2. "Add Check": Name `mv-motor`, Period `1 minute`, Grace time `3 minutes` → Save. Copie a
   "Ping URL" (`https://hc-ping.com/…`) → é o valor de `HC_URL` no Railway (etapa 4.4).
3. Integrations → "Email": o e-mail da conta já recebe; "Add Integration" → Email →
   `klinger.campos@arcajuridico.com.br` → confirme pelo link do e-mail. Volte ao check e deixe as
   duas integrações ligadas.
4. Depois do motor no ar, o check fica verde. Teste combinado: pausar o serviço no Railway por
   5 minutos e ver o e-mail chegar; retomar.

## 6. Anthropic (IA do escritório, opcional)

console.anthropic.com → conta com o e-mail do escritório → Billing → crédito pré-pago →
"API Keys" → "Create Key" → copie → `~/.mv-anthropic-key` e `ANTHROPIC_API_KEY` no Railway.
Sem a chave, os botões de IA avisam "IA não configurada" e todo o resto funciona.

## 7. Domínio

1. Na Vercel: projeto `mv-sistema` → Settings → "Domains" → "Add" → `sistema.<domínio>` → a
   Vercel mostra o registro a criar (um CNAME para `cname.vercel-dns.com` ou valor parecido).
2. No painel do DNS do escritório (registrador ou hospedagem): criar CNAME `sistema` → valor
   mostrado pela Vercel. Propagação: minutos a algumas horas. A Vercel emite o certificado sozinha.
3. No Supabase: Authentication → URL Configuration → Site URL = `https://sistema.<domínio>` e
   acrescente `https://sistema.<domínio>/**` em Redirect URLs (mantenha a `.vercel.app` como reserva).

## 8. Aceite

Login dos dois sócios; um atendente sem `acesso_crm` não vê o CRM; mensagem recebida aparece em
menos de 10 segundos; mídia abre; lead criado a partir de uma conversa; follow-up na agenda;
alerta de queda chega por e-mail ao pausar o motor por 5 minutos; "Esqueci minha senha" entrega o
e-mail; aviso de versão nova aparece após uma publicação. Entregue o `MV-CHAVES.md` ao escritório
por canal seguro.
