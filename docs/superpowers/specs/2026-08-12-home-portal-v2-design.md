# Home v2 — layout do portal, XP e navegação por assunto

## Problema

A Home de hoje é uma pilha vertical: banner de votação, banner do mural, humor do
dia, mural de feedbacks e, só no fim, uma grade com o mural da empresa e as datas
do time. Quem abre o portal não vê num relance nem quem é (nível, carteira,
emblemas), nem o que a empresa comunicou, nem quem está fora esta semana — precisa
rolar, e cada assunto está numa altura diferente da página.

O protótipo do portal (`portal-emr-source-v2`) resolve isso com três colunas:
identidade à esquerda, comunicação no centro, datas do time à direita. Este
documento traz esse desenho para o Legends, junto com o que ele pressupõe e o
Legends ainda não tem.

Três coisas o Legends não tem e o desenho exige:

1. **Nível e Pontos (XP).** Existe EMR Coins, que é saldo — sobe quando se ganha e
   **desce quando se gasta na loja**. Nível derivado de saldo cairia quando a
   pessoa comprasse algo, o que é o oposto de progressão.
2. **Férias na Home.** O dado existe (`Vacation`, calendário), mas não há bloco de
   visualização rápida nem página própria.
3. **Navegação por assunto.** A sidebar agrupa por Pessoas / Reconhecimento /
   Desenvolvimento / Cultura; o desenho pede Cultura / Comunicação / Engajamento /
   Desenvolvimento, mais uma aba de Liderança destacada.

Fora de escopo por decisão do solicitante: **Ranking / Top Engajamento**. O bloco
existe no protótipo e não entra aqui.

## Entrega

### 1. XP e níveis (novo domínio)

**XP é livro-razão próprio, separado dos coins.** `XpRule` + `XpTransaction`
espelham `CoinRule` / `CoinTransaction` — mesmo desenho de idempotência
(`dedupeKey` único por `(userId, dedupeKey)`), mesmo teto por janela sobre a
coluna `day` (dia civil de São Paulo), mesmo escopo por empresa.

A diferença que justifica o modelo separado: **XP só acumula**. Não há `SPEND` nem
`REFUND`, e nenhuma rota debita. `CoinTransactionKind` tem cinco valores porque a
loja precisa deles; `XpTransaction` não tem `kind` nenhum.

**As regras são do admin, não do código.** CRUD em Administração › Pontos (XP),
espelhando a seção de EMR Coins: evento, valor, teto por dia/semana/mês, ativa.
Empresa sem regra cadastrada não distribui XP — mesma postura de `CoinRule`, e o
motivo é o mesmo: valor de recompensa é decisão de RH de cada cliente, não
constante de produto.

Os eventos são os mesmos que já creditam coins (`XpEvent` espelha `CoinEvent`):
`VOTE_CAST`, `FEEDBACK_PUBLISHED`, `FEEDBACK_REACTION`, `MOOD_ANSWERED`,
`CHALLENGE_APPROVED`. Os call sites já existem — `routes/votes.ts`,
`routes/feedback.ts`, `routes/mood.ts` e `challenge-submission-service.ts` — e
ganham a chamada de XP ao lado da de coins, **best-effort pelo mesmo motivo**:
falha de recompensa não derruba a ação que a gerou.

**Níveis são constantes de `@legends/shared`,** com os cortes do protótipo:

| Nível | XP mínimo |
|---|---|
| Bronze | 0 |
| Prata | 500 |
| Ouro | 1.500 |
| Platina | 3.500 |
| Diamante | 7.500 |

`computeLevel(points)` devolve nível atual, próximo e progresso percentual dentro
da faixa. Diamante é topo: progresso 100%, próximo `null`. Cortes iguais aos do
protótipo de propósito — quem já tem nível lá não muda de nível aqui.

### 2. Termômetro de humor

Os rótulos passam a ficar **sempre visíveis** ao lado do ícone (hoje aparecem só
no hover do item ativo) e mudam para a escala do documento: Estressado(a),
Desanimado(a), Neutro(a), Bem, Excelente. É troca de `label` em `MOOD_OPTIONS`; os
valores do enum (`HARD`…`GREAT`) não mudam, então nada de histórico se move.

**O motivo vira obrigatório em humor negativo** (`LOW`, `HARD`), validado na API e
não só na tela. O comentário livre segue opcional.

Os sete motivos do documento não batem com os sete do banco. Dois entram
(`COMMUNICATION`, `TOOLS`) e dois saem da lista oferecida (`RECOGNITION`, `TEAM`),
que **continuam no enum como legado**: já existem respostas gravadas, e o painel
`/admin/clima` quebra a série histórica se elas sumirem. A separação é uma
constante: `MOOD_REASONS` (selecionáveis) e `MOOD_REASON_LEGACY` (só leitura, só
painel).

| Rótulo | Enum |
|---|---|
| Sobrecarga de demandas / Volume de trabalho | `WORKLOAD` |
| Problemas ou ruídos na comunicação interna | `COMMUNICATION` *(novo)* |
| Dificuldades técnicas / Ferramentas de trabalho | `TOOLS` *(novo)* |
| Fatores externos / Questões pessoais | `PERSONAL` |
| Falta de clareza nas metas ou processos | `PROCESSES` |
| Problemas com a liderança | `LEADERSHIP` |
| Outro motivo | `OTHER` |
| — | `RECOGNITION`, `TEAM` *(legado)* |

O motivo escolhido alimenta o analytics de produto (`mood_answered` ganha a
propriedade `reason`). É categoria fechada, não texto — o comentário livre da
pessoa **não** vai para o analytics, pela mesma regra de PII do resto do sink.

### 3. Home em três colunas

```
┌──────────────┬─────────────────────────────┬──────────────────┐
│ Card de      │ Feed Corporativo (texto     │ Aniversariantes  │
│ perfil       │ completo + imagem)          │ do dia           │
│  · foto      ├─────────────────────────────┤                  │
│  · nível +   │ Termômetro de humor         │ Aniversariantes  │
│    progresso ├─────────────────────────────┤ de empresa       │
│  · carteira  │ Mural de feedbacks          │                  │
│  · 4 emblemas│                             │ Férias do mês    │
└──────────────┴─────────────────────────────┴──────────────────┘
```

O termômetro fica **ao lado do feed, no topo** — some assim que a pessoa registra
o humor do dia, como já faz hoje, e a coluna do meio se fecha sobre o feed.

**Comunicado inteiro, não recorte.** Cada card do feed mostra autor, primeira
linha em destaque e o corpo completo, quebrando linha; a imagem anexada aparece
na largura da coluna. Cortar em reticências obrigaria a abrir outra tela para ler
duas frases — e é justamente o comunicado que a Home existe para entregar. O que
continua sendo da página `/mural-corporativo` é a **interação**: composer,
reações, comentários e scroll infinito.

**Card de perfil** (coluna esquerda): foto, nome, cargo, nível com barra de
progresso, carteira lado a lado (EMR Coins = saldo atual; Pontos = XP acumulado) e
os **4 primeiros emblemas** conquistados, com "ver todos" para `/engajamento`.

**Bloco de férias** (coluna direita), no mesmo formato dos aniversariantes: quem
está de férias no mês, com o intervalo de datas, e link para a página Férias do
Mês.

### 4. Foto padrão em vez do personagem

`Avatar` resolve hoje **personagem LPC → `photoUrl` → iniciais**. A ordem inverte:
**`photoUrl` → personagem LPC → iniciais**, em toda a plataforma. O Escritório
Virtual não usa `Avatar` — desenha o personagem direto no Phaser — então continua
com o avatar customizável, que é a exceção que o documento pede.

Impacto assumido: é mudança visual grande, porque quem tem personagem montado hoje
aparece como personagem em toda tela. A regra do documento é que a identificação
da pessoa é a foto do banco, e o personagem é do jogo.

### 5. Busca global

A `ColleagueSearch` passa a `GlobalSearch`: continua achando colegas e passa a
achar **páginas, recursos e ferramentas** por palavra-chave, em duas seções no
mesmo dropdown.

O catálogo de destinos sai da própria navegação (`buildNavItems`), acrescido de
palavras-chave por destino — assim um item novo no menu já nasce buscável, e o
filtro por feature vem de graça: **a busca nunca mostra destino que a pessoa não
poderia abrir**.

### 6. Navegação por assunto

| Grupo | Itens |
|---|---|
| Cultura | Manifesto cultural, Galeria de eventos, Manuais, Kit visual, Benefícios, Resenha |
| Comunicação | Feed Corporativo, Férias do Mês, Calendário, Aniversariantes, Destaques do Mês, Organograma |
| Engajamento | Mural de Feedbacks, Lojinha EMR, Desafios do Time, Meus Emblemas, Manual do Game, Votar, Lendas |
| Desenvolvimento | Aprendizado, Meu PDI, 1:1, Quinta de Dev, Retrospectivas, Avaliações e Pesquisas (ImpulseUP) |
| — | Liderança |

Home e Escritório seguem soltos no topo, sem cabeçalho, como hoje.

Os itens que só o Legends tem (Votar, Lendas, Resenha, 1:1, Quinta de Dev,
Retrospectivas, Escritório) entram nos grupos acima em vez de sumir — o documento
descreve o portal do protótipo, que não os tem.

**Liderança** é aba de cor própria (container terciário da marca, não o primário),
visível para papéis de liderança (`isLeaderRole`: LEAD, MANAGER, HEAD) e para quem
tem o bloco de Gente & Gestão. Ranking fica de fora.

### 7. Páginas novas

- **Férias do Mês** (`/ferias`) — quem está de férias agora e no resto do mês,
  a partir da API de vacations que já existe.
- **Aniversariantes** (`/aniversariantes`) — calendário de aniversários de
  nascimento e de empresa. Hoje `/aniversarios` só redireciona para o calendário
  com filtros; vira tela própria e o redirect antigo aponta para ela.
- **Kit visual** (`/cultura/kit-visual`) — logo, paleta e tipografia da empresa,
  para download. Consome o branding que o SUPER_ADMIN já cadastra.
- **Manual do Game** (`/manual-game`) — como se ganha XP, coins e emblemas.
  Alimentado pelas regras ativas de XP e de coins, não por texto fixo.
- **Liderança** (`/lideranca`) — hub do líder reunindo o que já existe: time
  direto, 1:1 agendados, PDI dos liderados e humor do time. Não reimplementa
  nenhuma dessas features; agrega e aponta.

## Riscos

**A inversão do avatar toca a plataforma inteira.** É uma linha em `Avatar.tsx`,
mas muda toda tela com gente. Os testes que hoje afirmam "mostra o personagem"
passam a afirmar "mostra a foto".

**Duas moedas na mesma tela confundem.** Coins e XP aparecem lado a lado na
carteira e são números diferentes com regras diferentes. Mitigação: rótulo
explícito ("EMR COINS" / "PONTOS") e o Manual do Game explicando cada um.

**Empresa sem regra de XP mostra nível Bronze zerado.** É consequência de deixar a
regra com o admin. Mitigação: o seed cadastra regras de XP espelhando as de coins,
então ambiente novo já nasce com progressão.
