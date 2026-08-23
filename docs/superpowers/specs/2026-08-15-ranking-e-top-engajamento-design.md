# Ranking e Top 5 engajamento

## Problema

O Legends distribui XP desde a Home v2 (`XpRule` / `XpTransaction`, níveis Bronze→
Diamante) e mostra o resultado disso em exatamente **um** lugar: o card de perfil
da própria pessoa. Ninguém consegue ver onde está em relação ao time, e o admin
que configura as regras em `/admin/xp` não tem como saber o que elas produziram —
quanto foi distribuído, por qual caminho, para quem, e quem ficou de fora.

O spec da Home v2 (`2026-08-12-home-portal-v2-design.md`) registrou **Ranking /
Top Engajamento como fora de escopo por decisão do solicitante**. Este documento
reverte essa decisão e entrega o bloco, a tela e a visão do admin, seguindo o
protótipo do portal (`portal-emr-source-v2`).

## O que o protótipo tem

- `leaderboard-widget.tsx` — bloco de 5 na coluna direita da Home: posição,
  avatar com bolinha de presença, nome, setor e pontuação, mais "Ver ranking
  completo".
- `app.ranking.tsx` — tela com duas abas: **Ranking Geral** (pódio dos três
  primeiros + tabela com nível, busca por nome e paginação) e **Ranking de
  Consistência** (sequência de dias seguidos).
- `use-presence.tsx` + `online-indicator.tsx` — presença por canal do Supabase,
  que o Legends não tem.

O protótipo materializa `profiles.total_points` e mantém a sequência em
`profiles.current_streak`. O Legends **não vai fazer isso** — ver abaixo.

## Entrega

### 1. Pontuação: sem coluna nova

O ranking soma `XpTransaction`, exatamente como `getXpPoints` já faz para o card
de perfil. Uma coluna `totalPoints` materializada seria mais rápida e seria uma
**segunda verdade**: na primeira vez que divergisse do livro-razão, ninguém
saberia qual das duas está certa. Com o time no tamanho atual, o custo são duas
queries fixas (usuários + `groupBy` de XP), independentemente de quantas pessoas
existem.

O recorte é **acumulado de sempre**, e não do mês. Nível e ranking precisam
contar a mesma história: quem é Ouro no perfil não pode aparecer atrás de um
Bronze no ranking porque o mês virou.

**Quem disputa** é o mesmo recorte dos aniversariantes (`celebration-service`):
ativo, sem `leftAt`, e fora `ADMIN` / `SUBADMIN` / `THIRD_PARTY`. São as duas
listas da Home que atravessam setores, e "o time" precisa significar a mesma
coisa nas duas. Conta de administração não vota, não recebe feedback e não teria
como pontuar — ficaria eternamente com zero no fim da tabela.

### 2. Presença: `User.lastSeenAt` + heartbeat

A regra do bloco pede círculo verde para quem está **on-line na plataforma** e
cinza para inativo. O Legends só tinha presença dentro do Escritório virtual
(`office-hub`, WebSocket), que marcaria como offline a maior parte do time mesmo
usando o portal.

Coluna `User.lastSeenAt`, carimbada por dois caminhos:

| Caminho | Quando | Por quê |
|---|---|---|
| `POST /access-logs` | Troca de rota (ping que já existia) | Quem navegou está ali; seria desperdício exigir outro sinal |
| `POST /me/presence` | A cada 2 min, só com a aba visível | Quem fica parado lendo o mural continua usando a plataforma |

On-line = visto nos últimos **5 minutos** (`PRESENCE_ONLINE_WINDOW_MINUTES`).
Cinco e não dois porque o heartbeat bate a cada dois: dá margem para uma batida
perdida sem apagar a bolinha de quem está ali.

**Não virou tabela de sessão** de propósito: o que a bolinha precisa é do ÚLTIMO
sinal, nunca da série. Série de navegação é `AccessLog`, que continua sendo
gravada em paralelo e para outro fim (People Analytics). O heartbeat **não** grava
`AccessLog` — inflar a telemetria com "vinte telas" de quem visitou uma só
estragaria o dado de tela mais vista.

### 3. Bloco na Home

`TopEngagementCard` fecha a coluna da direita, depois de Aniversariantes,
Aniversários de empresa e Férias — as datas do time são informação do dia, o
placar é o que fecha a coluna, como no protótipo.

Cada linha: posição (medalha nos três primeiros, número depois), avatar com
bolinha de presença, nome, **setor** e pontos. Quem está fora dos cinco vê a
própria posição numa linha abaixo da lista; quem está dentro não vê, para não
repetir a linha logo acima.

Ouro/prata/bronze são cores do **pódio**, não da marca — um tenant verde continua
com o primeiro lugar dourado. Idem a bolinha: verde/cinza é convenção universal
de presença, e derivá-la de `primary` deixaria "on-line" vermelho num tenant de
marca vermelha.

### 4. Tela `/ranking`

Duas abas, com a escolha na URL (`?aba=`) para o link ser compartilhável:

- **Ranking geral** — pódio dos três primeiros, aviso com a própria posição,
  busca por nome, tabela com nível e paginação no cliente.
- **Consistência** — dias **úteis** seguidos com humor registrado. Sai do mesmo
  `MoodEntry` do indicador de streak que já existe na barra superior, com a
  mesma regra (fim de semana é ponte, e o dia útil corrente ainda sem registro
  não quebra a sequência). Sem coluna nova aqui também.

A paginação é local porque a API já devolve no máximo `RANKING_MAX_ENTRIES`
(200, o mesmo teto do protótipo) — paginar no servidor obrigaria a refazer lá a
busca por nome, que aqui é instantânea.

**Sem gate de feature**, pela mesma razão do XP: a pontuação e o nível já
aparecem no card de perfil de qualquer pessoa logada, e esconder a leitura
pública desse número atrás de uma feature deixaria o número sem contexto. Empresa
sem regra de XP vê um ranking zerado, não uma rota quebrada.

Na navegação, **Ranking** entra no grupo **Engajamento** da barra superior — ao
lado justamente dos itens que distribuem os pontos que ele mostra (Votar, Mural
de Feedbacks, Desafios). O grupo passa a ter 8 itens, estourando a regra de bolso
de 6; espalhá-los por outros grupos custaria mais do que a linha a mais.

### 5. Administração › Engajamento

Seção nova em **Reconhecimento**, vizinha de Pontos (XP): ali se define quanto
cada ação vale, aqui se vê o que isso produziu.

- **Resumo** — pessoas no ranking, quantas pontuaram no mês (com % de adesão),
  XP do mês e acumulado, quantas ficaram fora.
- **Por onde os pontos entram** — XP, créditos e pessoas distintas por evento.
  Pessoas distintas é outra pergunta de "quantos créditos saíram": 240 créditos
  de humor podem vir de 7 pessoas.
- **Por setor** — pessoas, quantas pontuaram, média e total.
- **Ranking** — as primeiras posições, sem sair da tela.
- **Sem pontuar no mês** — o ponto da seção. Um ranking mostra os cinco de cima;
  é exatamente quem **não** aparece nele que o admin precisa enxergar para agir.
  Ordenado pelo acumulado (desc), para quem já participou e parou vir primeiro —
  esse é o caso que pede conversa, não quem nunca entrou no jogo.

**ADMIN global**, como o CRUD de regras: `XpRule` é única por `(companyId,
event)`, então não existe fatia legítima para o SUBADMIN de setor.

Não confundir com Administração › People Analytics, que mede humor, alcance do
mural e telas mais vistas — e cujo DTO já se chama `EngagementOverviewDTO`. Ali é
comportamento; aqui é pontuação. Por isso o DTO novo é `RankingOverviewDTO`.

## Contrato

`packages/shared/src/ranking.ts`: `RankingEntryDTO`, `RankingResponse`,
`StreakRankingEntryDTO`, `StreakRankingResponse`, `RankingOverviewDTO` e as
constantes de presença, teto e paginação.

| Rota | Quem | O quê |
|---|---|---|
| `GET /ranking?limit=` | Autenticado | Ranking geral. `limit` corta a lista; `total` e `me` continuam do ranking inteiro |
| `GET /ranking/streaks` | Autenticado | Ranking de consistência |
| `POST /me/presence` | Autenticado | Heartbeat, 204, sem `AccessLog` |
| `GET /admin/ranking/overview` | ADMIN | Panorama da economia de XP |

## Fora de escopo

- **Prêmios por faixa** ("1º ao 10º ganha X"), que o protótipo mostra como texto
  fixo. Sem mecanismo de premiação no Legends, seria promessa sem entrega.
- **Ranking por período/mês.** O recorte acumulado é o que casa com o nível; um
  recorte mensal é feature à parte, com pergunta própria.
- **Presença em tempo real** (WebSocket). A janela de 5 minutos resolve a bolinha
  sem abrir uma segunda infraestrutura de presença ao lado do `office-hub`.
