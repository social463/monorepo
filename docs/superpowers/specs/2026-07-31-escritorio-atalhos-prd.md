# PRD — Atalhos do escritorio

**Data:** 2026-07-31
**Task:** 22288
**Branch:** `feat/22288-atalhos-escritorio`
**Status:** Planned

## Problema

O escritorio virtual ja possui varios atalhos de teclado e mouse, mas eles sao
pouco descobriveis. Algumas acoes importantes ficam escondidas atras de botoes
ou menus, e pelo menos uma acao esperada pelo produto, levantar a mao com `H`,
ainda nao existe como hotkey.

Isso reduz a velocidade de uso em reunioes e cria uma experiencia inconsistente:
usuarios descobrem alguns atalhos por tentativa, outros por tooltip, e outros
nao aparecem em lugar nenhum.

## Objetivos

- Expor uma area de configuracoes no rail esquerdo do escritorio.
- Criar a aba ou tela "Atalhos" com a lista dos atalhos disponiveis.
- Adicionar indicacoes visuais compactas de atalhos perto das acoes relevantes.
- Implementar o atalho `H` para levantar ou abaixar a mao quando a acao estiver
  disponivel.
- Documentar `E` como atalho geral de interacao no escritorio.
- Manter a UI limpa, sem transformar a barra inferior ou os menus em uma lista
  extensa de instrucoes.

## Fora de Escopo

| Item | Motivo |
| --- | --- |
| Personalizar atalhos | A task pede descoberta e funcionamento, nao remapeamento. |
| Persistir preferencias de atalhos | Nao ha requisito de configuracao por usuario. |
| Reescrever o sistema de input do Phaser | Os atalhos atuais funcionam em pontos diferentes e devem ser preservados. |
| Alterar atalhos do editor de mapa admin | Eles podem ser listados separadamente, mas nao fazem parte do uso comum do escritorio. |
| Resolver conflitos de PRs ativos | A task deve seguir mesmo com PRs de escritorio em paralelo. |

## Usuarios

- **Colaborador no escritorio:** usa teclado/mouse para se mover, interagir,
  reagir, falar, trancar sala e levantar a mao.
- **Convidado no escritorio:** ve atalhos aplicaveis ao seu contexto, sem acoes
  indisponiveis para convidado.
- **Pessoa em sala de reuniao:** precisa descobrir rapido `H`, `L`, `M`, Espaco,
  reacoes, chat e controles de sala.

## Historias

### P1: Ver atalhos disponiveis no escritorio

**User Story:** Como usuario do escritorio, quero abrir uma area de atalhos para
entender rapidamente quais teclas e gestos posso usar.

**Criterios de aceite:**

1. WHEN o usuario esta no escritorio THEN o rail esquerdo SHALL mostrar um botao
   de configuracoes/atalhos.
2. WHEN o usuario abre esse botao THEN o sistema SHALL exibir uma aba ou painel
   "Atalhos".
3. WHEN a lista aparece THEN ela SHALL agrupar atalhos por contexto, por exemplo
   movimentacao, interacoes, audio/reuniao e tela.
4. WHEN uma acao nao se aplica ao contexto atual THEN a lista pode continuar
   mostrando o atalho como referencia, desde que o texto deixe claro o contexto.

**Independent Test:** Abrir `/escritorio`, clicar no botao de configuracoes no
rail esquerdo e confirmar que a aba "Atalhos" lista atalhos de teclado e mouse.

### P1: Levantar a mao com `H`

**User Story:** Como participante de sala ou zona onde levantar a mao e permitido,
quero apertar `H` para levantar ou abaixar a mao sem abrir menus.

**Criterios de aceite:**

1. WHEN `raisedHands.canRaise` e true e o usuario aperta `H` fora de campos de
   texto THEN o sistema SHALL chamar a mesma acao do botao "Levantar a mao".
2. WHEN a mao ja esta levantada THEN `H` SHALL abaixar a mao.
3. WHEN `raisedHands.canRaise` e false THEN `H` SHALL nao fazer nada.
4. WHEN o foco esta em `input`, `textarea`, `select` ou `contenteditable` THEN
   `H` SHALL nao interceptar a digitacao.

**Independent Test:** Renderizar a pagina com `canRaise=true`, disparar `H` e
confirmar chamada a `raisedHands.toggle`; repetir com foco em input e confirmar
que nada e chamado.

### P1: Mostrar dicas compactas perto das acoes

**User Story:** Como usuario, quero ver o atalho perto do botao para descobrir a
tecla sem abrir tutorial.

**Criterios de aceite:**

1. WHEN uma acao de menu possui atalho THEN o item SHALL mostrar um marcador
   compacto, por exemplo `H`, `L`, `E`, `P`, sem quebrar layout.
2. WHEN o usuario passa o mouse por um botao com tooltip THEN o tooltip SHALL
   mencionar o atalho quando existir.
3. WHEN a UI esta em viewport pequeno THEN os marcadores SHALL manter texto e
   icones dentro dos seus containers.

**Independent Test:** Abrir o menu "Mais opcoes" e confirmar que acoes com
atalho exibem marcadores compactos alinhados a direita.

## Atalhos Base

| Atalho | Acao | Contexto |
| --- | --- | --- |
| `W`, `A`, `S`, `D` / setas | Mover personagem | Escritorio |
| `Shift` + movimento | Sprint | Escritorio |
| `Ctrl/Cmd + D` | Ir para minha mesa | Escritorio |
| `Enter` | Abrir chat por perto | Escritorio |
| `E` | Interagir | Kart, links e interacoes proximas |
| `F` | Soltar confete | Escritorio |
| `R` | Girar personagem | Escritorio |
| `1` a `8` | Enviar reacao | MediaBar |
| `M` | Ligar/desligar microfone | Audio conectado |
| `Espaco` segurado | Push-to-talk | Audio conectado |
| `H` | Levantar/abaixar mao | Sala ou zona com mao disponivel |
| `L` | Trancar/destrancar sala | Sala travavel |
| `P` | Riscar/parar de riscar tela | Quando anotacao esta disponivel |
| Mouse direito | Andar ate o ponto clicado | Mapa do escritorio |
| Mouse esquerdo arrastando | Mover o mapa | Mapa do escritorio |
| `Escape` | Fechar painel/modal/card | Quando houver camada aberta |

## Requisitos Rastreaveis

| ID | Requisito | Prioridade | Status |
| --- | --- | --- | --- |
| SHORTCUTS-01 | Adicionar entrada de configuracoes/atalhos no rail esquerdo. | P1 | Pending |
| SHORTCUTS-02 | Criar aba/painel "Atalhos" com lista agrupada por contexto. | P1 | Pending |
| SHORTCUTS-03 | Implementar hotkey `H` para levantar/abaixar mao. | P1 | Pending |
| SHORTCUTS-04 | Mostrar marcadores compactos de atalho em itens de menu e botoes relevantes. | P1 | Pending |
| SHORTCUTS-05 | Preservar guards de foco em campos de texto e modificadores. | P1 | Pending |
| SHORTCUTS-06 | Cobrir comportamento novo com testes de web focados. | P1 | Pending |

## Metricas de Sucesso

- Usuario encontra a lista de atalhos em ate um clique a partir do escritorio.
- Acoes principais exibem dica de tecla sem aumentar muito a densidade visual.
- `H` funciona com a mesma regra de disponibilidade do botao de levantar a mao.
- Testes de `OfficePage`/componentes do rail e menu cobrem a nova descoberta.

## Duvidas Pendentes

Nenhuma no momento.
