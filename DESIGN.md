# Padrão visual — Vasques Alves · Sistema

Paleta da identidade Vasques Alves: azul-marinho `#041650`, verde-sálvia `#758C7F`, cinza de apoio `#D2D3D1`
e o papel derivado dele; DM Sans e DM Mono. Feito para ficar horas na tela sem cansar.

## 1. Tokens são a única fonte
`css/tokens.css` declara toda cor, sombra, raio e tamanho. Nenhum outro arquivo escreve hex, sombra ou raio:
usa `var(--…)`. Exceções, e só estas:
- cores que são dado (departamentos e status padrão), marcadas `/* cor-dado */` em `js/store.js`;
- ícones e emojis (`js/icones.js`, `js/emojis.js`);
- o favicon em `index.html` (símbolo `#758C7F` sobre `#041650`, em data-URI com `%23`: favicon não lê variável CSS).
Os testes quebram se aparecer valor literal fora disso.

## 2. Duas superfícies por tela
- A página é papel (`--surface-app`, `#F3F4F2`); o conteúdo vive em cards brancos. Nada de terceira camada.
- Marinho (`--surface-nav`) é cromo: barra lateral, toast, login e botão primário. Não vira fundo de conteúdo.
- Sálvia é o acento racionado e a cor do símbolo: selo "hoje", contador de não lidas, botão de destaque,
  bolha enviada, séries de gráfico. Nunca em botão de rotina.
- Sálvia pura não carrega texto: `#758C7F` dá 3,61:1 sobre branco e 4,70:1 sobre o marinho. Texto em sálvia
  usa `--text-accent` (salvia-700); botão verde com texto usa `--btn-accent-bg` (salvia-600, 5,75:1 com branco).
- Interação e informação (link, foco, chip informativo) ficam no marinho; aviso (`--warning-*`) é estado,
  não marca, e tem valores próprios.

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
- anel de foco sólido em marinho-500 (sem transparência), visível em qualquer superfície;
- símbolo do logo ≥ 3:1 sobre o fundo em que está, nos dois temas (o teste mede claro e escuro).
Ao mexer na paleta, rode os testes: eles dizem qual par caiu.

## 5. Movimento
- Durações só por `--dur-fast`, `--dur-base` e `--dur-slow`.
- Nada quica nem balança; entradas são fade/slide curtos.
- Sob `prefers-reduced-motion` tudo colapsa para sem animação.

## 6. Arquivos
Ordem de import no `index.html`: `css/tokens.css` → `css/styles.css` → `css/chat.css`.
`tokens` define, `styles` aplica ao sistema todo, `chat` só cuida do Chat. Regra nova de cor
vai primeiro para o token; só depois é usada.

## 7. Logo e tela de entrada
- Dois desenhos em `js/escritorio.js`, vetor do manual da marca e sem cor própria: `logoSVG` (só o símbolo VA,
  em `currentColor`) e `logoCompletoSVG` (símbolo, VASQUES ALVES e ADVOGADOS, com as cores de `--logo-marca`
  e `--logo-texto`). Nenhum outro arquivo desenha o logo.
- Símbolo: barra lateral (`--marca-logo`) e bloco do trilho do Chat (`--marca-logo-inverso`, que no modo
  noturno vai para salvia-600 porque ali o bloco fica claro). Ao lado dele vai o nome escrito, por isso é
  decorativo (`aria-hidden`).
- Logo completo: só na tela de entrada, sobre o marinho; 180px de altura no convite e 128px no formulário.
  Abaixo de 120px o ADVOGADOS não se lê: nesse tamanho, use o símbolo.
- Cores: o símbolo é sempre sálvia; as palavras são marinho sobre fundo claro ou papel sobre o marinho.
  Não recolorir, não esticar, não pôr sobre foto.
- Área livre: em volta do logo, no mínimo a altura do V de VASQUES (cerca de 1/8 da altura do logo) sem
  outro elemento.
- A tela de entrada é a única superfície com gradiente e movimento contínuo: a seda em WebGL nas cores
  `--abertura-seda-1..3` (marinho-950, marinho-600, sálvia-500), escurecida atrás da marca pelo véu
  `--abertura-veu`. Sem WebGL não há seda nem véu; fica o marinho liso.
