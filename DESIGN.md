# Padrão visual — Marques e Vasques · Sistema

Paleta grafite, aço, âmbar e off-white; DM Sans e DM Mono. Feito para ficar horas na tela sem cansar.

## 1. Tokens são a única fonte
`css/tokens.css` declara toda cor, sombra, raio e tamanho. Nenhum outro arquivo escreve hex, sombra ou raio:
usa `var(--…)`. Exceções, e só estas:
- cores que são dado (departamentos e status padrão), marcadas `/* cor-dado */` em `js/store.js`;
- ícones e emojis (`js/icones.js`, `js/emojis.js`);
- o favicon em `index.html`.
Os testes quebram se aparecer valor literal fora disso.

## 2. Duas superfícies por tela
- A página é off-white (`--surface-app`); o conteúdo vive em cards brancos. Nada de terceira camada.
- Grafite (`--surface-nav`) é cromo: sidebar, toast e login. Não vira fundo de conteúdo.
- Âmbar é racionado: selo "hoje", avisos e destaques raros. Nunca em botão de rotina.

## 3. Tipografia
- DM Sans para tudo, pesos 400 e 500. Sem negrito pesado.
- DM Mono para números em coluna, rótulos em caixa alta e badges.
- Fontes self-hosted em `fonts/` (woff2); nada de CDN.

## 4. Contraste
Meta WCAG AA. O teste automático em `testes/testes-front.js` mede os pares críticos (texto sobre
superfície, badge, botão, foco). Decisões herdadas:
- `--warning-600` escurecido para o texto de aviso passar em AA;
- score em duas escalas: 400 para fundo/barra, 600 para texto;
- `--check-borda` em ink-400, para a caixa de seleção aparecer no off-white;
- anel de foco sólido (sem transparência), visível em qualquer superfície.
Ao mexer na paleta, rode os testes: eles dizem qual par caiu.

## 5. Movimento
- Durações só por `--dur-fast`, `--dur-base` e `--dur-slow`.
- Nada quica nem balança; entradas são fade/slide curtos.
- Sob `prefers-reduced-motion` tudo colapsa para sem animação.

## 6. Arquivos
Ordem de import no `index.html`: `css/tokens.css` → `css/styles.css` → `css/chat.css`.
`tokens` define, `styles` aplica ao sistema todo, `chat` só cuida do Chat. Regra nova de cor
vai primeiro para o token; só depois é usada.
