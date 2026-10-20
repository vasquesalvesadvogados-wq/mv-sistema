# Marques e Vasques · Sistema: runbook de operação

Este guia serve a quem opera o sistema, o Arca e os administradores do escritório. As chaves e senhas ficam no `MV-CHAVES.md`, guardado fora do repositório.

## 1. Publicar
Ordem sempre: **SQL aditivo → front → SQL restritivo → motor.** Publicar só com confirmação do escritório.

- **Testes antes:** `node testes/testes-front.js` e `node testes/testes-motor.js`, com 0 falha.
- **Versão:** toda mudança em `js/` ou `css/` pede `python3 nuvem/versao.py X.Y.Z`, que troca os três lugares (`?v=` no `index.html`, `APP_VERSAO` em `js/main.js`, `versao.json`). A Vercel guarda o cache por 1 ano; sem a troca, o time continua com o código velho.
- **Front:** `python3 nuvem/publicar.py`. O script mostra time e projeto e pede Enter; confira que é o do escritório. Token em `~/.mv-vercel-token`.
- **Motor:** `nuvem/publicar-motor.sh`. Token de projeto em `~/.mv-railway-token`. **Uma réplica só.**
- Depois da publicação, as abas abertas mostram o aviso de nova versão. Espere o time recarregar antes de aplicar SQL que restringe permissões.
- Mensagens que ficaram em "enviando" nunca são reenviadas sozinhas: viram erro visível e o atendente confere no celular.

### Variáveis do motor (Railway, serviço `mv-motor`)
- `SUPABASE_URL`: endereço do projeto Supabase.
- `SUPABASE_SERVICE_KEY`: chave de serviço, com acesso total ao banco.
- `HC_URL`: URL de ping do Healthchecks.io (alerta de queda por e-mail).
- `ANTHROPIC_API_KEY`: chave do assistente de IA.
- `GROQ_API_KEY` (opcional): transcrição de áudio.
- `NOME_SISTEMA`: "Marques e Vasques"; sem ela o alerta sai "Motor do Chat de Sistema".
- `RESETAR_SESSAO`: só quando preciso; veja a seção 2.

## 2. Parear o WhatsApp (QR)
Quando a situação for "aguardando QR":
1. Em Configurações → Motor WhatsApp, o QR aparece (só para administrador).
2. No celular do escritório: WhatsApp → Aparelhos conectados → Conectar aparelho → ler o QR.
3. O QR não aparece em 1 minuto: no Railway, mude `RESETAR_SESSAO` para um valor novo e reinicie o serviço.
4. Peça a alguém que mande "teste" e confirme que chegou.
5. **Depois de parear, remova `RESETAR_SESSAO`.** Cada valor novo dispara uma limpeza do pareamento; a variável não deve ficar permanente, para ninguém mexer nela sem querer.

A sessão fica salva na tabela `motor_sessao` do Supabase.

## 3. Alerta de queda por e-mail
Healthchecks.io, com um check de período de 1 minuto e tolerância de 3 minutos. Os e-mails do sócio administrador e do reserva recebem o alerta. A URL de ping vai na variável `HC_URL` do Railway.

O motor envia o sinal a cada 60 segundos **só quando o WhatsApp está aberto e o banco responde**. Sem sinal por 3 minutos, chega e-mail. Quando o motor pede QR ou suspeita de bloqueio, ele avisa na hora (envio de `/fail` com o motivo).

## 4. Incidentes
- **Erro 440 em laço:** há duas réplicas usando a mesma sessão. Deixe uma só no Railway. Um único 440 no log durante um redeploy é normal.
- **Erros 403 ou 411:** o número foi recusado ou bloqueado, e o motor espera 30 minutos antes de tentar de novo, de modo que reiniciar em laço só atrapalha; confira se o celular mostra "número banido".
- **"Não é possível conectar novos dispositivos":** bloqueio temporário do WhatsApp. Espere 1 a 2 horas e refaça o QR.
- **Sessão do usuário caiu sozinha:** depois de 6 horas sem uso a sessão encerra (mouse, teclado e rolagem contam; mensagens chegando não). O administrador muda as horas em Configurações → Sessão; 0 desliga.
- **"O Supabase recusou o arquivo por tamanho":** em Storage → Settings, o limite de upload precisa ser de pelo menos 500 MB.
- **"Esqueci minha senha" não leva ao sistema:** o endereço de onde o pedido saiu precisa estar nas Redirect URLs do Supabase (Authentication → URL Configuration), com `/**` no fim. A Site URL é `https://sistema.<domínio>`.
- **E-mail de senha não chega:** o envio padrão do Supabase tem limite baixo. Se o volume pedir, o caminho é configurar SMTP próprio.
- **Mídia sem backup:** o banco tem backup diário no plano Pro, mas os arquivos de mídia (bucket `midias`) não. Se a mídia ficar importante, combine uma cópia periódica.

## 5. Banco
- Migrações novas viram `003-…sql`, `004-…sql`, em ordem. Nunca edite uma já aplicada.
- Para comparar dois ambientes, rode `nuvem/conferir-esquema.sql` nos dois (só leitura) e compare as saídas. A lista de diferenças esperadas entre dois ambientes é registrada aqui; ao comparar com outro ambiente, só diferenças explicadas (tabelas que não existem no MV) são aceitáveis.
- Cadastro público fica desligado. Usuários novos nascem pela tela Usuários.

## 6. Onde ficam as chaves
No `MV-CHAVES.md`, fora do repositório, com permissão só do dono. Nunca no git nem em pasta compartilhada. Se uma chave vazar, gere outra no painel do serviço e atualize o arquivo.
