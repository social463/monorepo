# Ajustes do Documento 3 — Lote B (People Analytics) — design

**Origem:** `Ajustes_Portal_EMR_Documento_3.md` (G&G, 3ª rodada), seções 3, 4.1,
4.2, 4.3 (2ª frase), 4.4, 4.6 e 4.7.

Continuação do Lote A (`2026-08-24-ajustes-doc3-lote-a-design.md`), que já
entregou a separação das abas Clima e Engajamento (4.5) e a desduplicação do
termômetro (6). Este lote é o núcleo do documento: o filtro de período, a Ficha &
Perfil tabular, a aba Dashboard e o conteúdo novo das abas Clima e Engajamento.

## Estrutura final de People Analytics

Cinco abas, na ordem do documento:

| # | Aba | O que muda neste lote |
|---|---|---|
| 1 | Dashboard | **Nova.** KPIs e gráficos, no lugar do resumo por setor em texto (seção 3) |
| 2 | Visão geral | Cards e legendas dinâmicas, mapa de calor com filtro próprio, análise de feedback por competência (4.1, 4.2, 4.3) |
| 3 | Ficha & Perfil | Listagem tabular com filtro por coluna e desativação por planilha (4.4) |
| 4 | Clima | Filtro personalizável e comentários identificados em duas caixas (4.6) |
| 5 | Engajamento | Recebe o painel que vive em `/admin/engajamento` (4.7) |

E **People Analytics passa a ser a primeira tela do Admin**: `/admin` redireciona
para `/admin/pessoas?aba=dashboard`.

O redirecionamento é condicional. `/admin` é a porta de entrada de **todo**
administrador, e People Analytics é bloco de `gente-gestao`: um SUBADMIN de
Desenvolvimento de Produto cairia numa tela que ele não tem permissão de ver. Para
quem não tem o bloco, `/admin` continua sendo o resumo operacional por setor —
que, para ele, é a informação útil.

## 4.1 — Filtro de período personalizável e legendas dinâmicas

### O problema

`PeopleAnalyticsRange` só tem `7d | 30d | 90d`, e os quatro cards do topo não
respeitam nem isso: `uniqueUsers7d` e `uniqueUsers30d` são calculados com
`trailingSince(7)` e `trailingSince(30)` **fixos**, ignorando o filtro. As
legendas ("Únicos em 7 dias") são literais na tela.

### O contrato novo

`range` ganha `hoje` e `ano`, e ganha `custom` com `from`/`to`:

```
GET /admin/people/overview?range=30d
GET /admin/people/overview?range=custom&from=2026-06-01&to=2026-07-10
```

`from`/`to` são datas civis (`YYYY-MM-DD`) em São Paulo, como o resto do módulo.
`resolveWindow` passa a receber a janela resolvida em vez de derivar de um enum.

Teto de **366 dias** na janela personalizada: `accessSeries` devolve um ponto por
dia e o mapa de calor varre a janela inteira; sem teto, um `from` de 2020 monta
uma resposta de milhares de pontos que nenhuma tela desenha.

### Os quatro cards

Os dois cards de "únicos" viram números diferentes — repetir o mesmo valor em
duas caixas é pior do que a legenda errada de hoje:

| Card | Valor | Legenda |
|---|---|---|
| Pessoas ativas | cadastros ativos no recorte | "Cadastros ativos no recorte" |
| Únicos no período | pessoas distintas que acessaram na janela | dinâmica: "Nos últimos 40 dias" |
| Acessos no período | total de acessos (não distintos) | dinâmica |
| Adesão | únicos ÷ pessoas ativas | "X de Y pessoas acessaram" |

`DateRangeLabel` (em `@legends/shared`) monta o texto a partir da janela — a
legenda deixa de ser literal na tela, que é o que a G&G apontou.

O filtro de **setor** já era aplicado no service; o que não era é o recorte dos
dois cards fixos, corrigido pela mesma mudança.

## 4.2 — Mapa de calor com filtro próprio e tempo médio

### Filtro do bloco

O mapa de calor ganha seletores próprios de período e setor, que **nascem** com o
valor do cabeçalho e se soltam dele quando alguém mexe. Vira endpoint próprio,
`GET /admin/people/heatmap`, porque o bloco passa a ter recorte independente do
resto da tela.

### Tempo médio na plataforma

A pergunta do documento ("a captura de tempo de sessão já existe?") tem resposta:
**não**. `AccessLog` grava `(userId, path, createdAt)` e nada mais — não há
duração, nem início e fim de sessão.

O número é **derivado** do `AccessLog`, sem telemetria nova: acessos consecutivos
da mesma pessoa formam uma sessão enquanto o intervalo entre eles for menor que
**30 minutos**; a duração é do primeiro ao último acesso da sessão.

Derivar, e não instrumentar, porque o painel tem filtro de período: heartbeat só
mede daqui para frente, e a G&G ficaria sem número nenhum para qualquer mês
passado. O histórico que já existe responde hoje.

A conta tem um limite conhecido, e ele aparece na tela: **a última página da
sessão não é medida** (não há acesso seguinte para fechar o intervalo), então
sessão de um acesso só conta zero. O número é piso, não média exata — e é o
mesmo limite que qualquer analytics baseado em pageview tem.

## 4.3 (2ª frase) — Analisar feedbacks por competência

O bloco "Feedbacks no período" ganha a distribuição do que foi escrito:

- **Por competência** — as `RecognitionCategory` do catálogo da empresa, contadas
  por `FeedbackRecognitionCategory` na janela;
- **Por tag** — as `customCategory`, o texto livre que quem escreve digita. É o
  que a G&G chama de "tags": categoria que não estava no catálogo.

A contagem é por **vínculo**, não por feedback: um feedback com três competências
conta uma vez em cada. Somar as fatias dá mais que o total de feedbacks, e a
legenda diz isso — senão o número parece errado.

## 4.4 — Ficha & Perfil tabular

### Listagem

Sai o acordeão por setor (`groupBySector` + `SectorAccordion`), entra **uma linha
por pessoa** numa tabela com as colunas do documento: Nome, Setor, Cargo, Líder,
Tags (público-alvo) e Status. Editar continua abrindo a linha, como hoje.

**Tags (público-alvo) são derivadas, não um campo novo.** É o mesmo vocabulário
que o calendário já usa para casar evento com pessoa (`viewerAudienceTags`):
"Todos", o nome do setor, "G&G" para quem tem a feature, "Líder" para papel de
liderança e "CEO" pelo cargo. Guardar isso numa coluna criaria uma segunda fonte
de verdade que sairia do ar assim que alguém trocasse de setor.

### Busca e filtros

Busca global mantida e ampliada para **líder** (hoje cobre nome, e-mail, cargo e
squad). Filtro por coluna: setor, cargo, líder, tag e status — os de squad e papel
que já existem continuam.

**CPF fica de fora, e não por esquecimento.** O documento pede busca por CPF, mas
`User` não tem esse campo, o template de importação não tem essa coluna e o dado
é PII de outra ordem — guardar CPF de todo colaborador exige decisão sobre
finalidade e retenção, não um `ALTER TABLE`. Registrado nas pendências.

### Desativação por planilha

Hoje a importação **reconhece e ignora** as colunas `Situação` e `Desligado em`,
de propósito ("a importação nunca desliga nem reativa ninguém"). O documento pede
o contrário, e é uma inversão deliberada:

- `Situação` = "Desligado" (ou "Inativo") → a pessoa é **desativada**
  (`active: false`), com `leftAt` vindo de `Desligado em` ou da data de hoje;
- `Situação` = "Ativo" **não reativa ninguém**. Reativar por upload devolveria
  acesso a quem saiu da empresa sem nenhuma etapa de revisão, e o risco dos dois
  sentidos não é simétrico: desligar alguém por engano custa um clique para
  desfazer, reabrir acesso indevido não se desfaz.

Isso responde a ATENÇÃO do documento: a planilha vira fonte da verdade **sem
apagar histórico** — desativar não é apagar. Pontos, EMR Coins, feedbacks e selos
ficam onde estão; a pessoa some das listagens e não entra mais.

A ação nova (`DEACTIVATE`) aparece na **prévia** antes do commit, como
`CREATE`/`UPDATE` já aparecem: nenhuma desativação acontece sem alguém ver a lista
primeiro.

Nota de leitura: o documento pede para "manter os botões existentes de Exportar
CSV, **Importar planilha** e **Sincronizar planilha**". Existem dois botões, não
três — Exportar CSV e Importar planilha. Não há "Sincronizar planilha", e a
importação já é upsert (cria quem não existe, atualiza quem existe), que é o que
"sincronizar" descreveria.

## 4.6 — Aba Clima

### Filtro de período

O mesmo filtro personalizável da seção 4.1, agora valendo para o termômetro:
`GET /admin/mood/overview` passa a aceitar `from`/`to` além de `days`.

### Card "Distribuição de hoje"

**Já existe.** O `MoodOverviewSection`, que o Lote A mudou de lugar, sempre teve o
painel "Distribuição de hoje" — ele só não estava na aba de People Analytics, que
é a tela da Figura 9. Nada a fazer.

### Comentários identificados

O `MoodCommentDTO` passa a carregar o autor. É uma reversão de política, e o
arquivo de contrato dizia o oposto:

> Regra que atravessa o arquivo inteiro: **nenhum campo carrega `userId`**. O
> anonimato aqui é garantia técnica do formato, não escolha de UI.

A G&G pediu a identificação duas vezes (no corpo da 4.6 e no checklist da seção
14) e decidiu aplicá-la **também ao histórico**. Consequência registrada aqui
porque é permanente: os comentários já escritos foram deixados quando a tela dizia
"seu retorno entra no clima do time de forma confidencial", e passam a mostrar o
nome de quem escreveu.

O que muda junto, e não é opcional:

1. **A copy do colaborador deixa de prometer confidencialidade.** "Seu retorno
   entra no clima do time de forma confidencial" vira um texto que diz o que
   passa a ser verdade: o time de Gente e Gestão lê o comentário com o nome de
   quem escreveu. Manter a frase antiga seria coletar o comentário sob uma
   promessa que o painel não cumpre mais.
2. **O piso de anonimato continua valendo para os agregados.** `MOOD_ANONYMITY_MIN`
   segue suprimindo média, tendência e distribuição de recorte pequeno — essa
   regra protege o recorte, não o comentário, e nada no documento pede para tirá-la.
3. **A leitura continua sendo do bloco de G&G.** Líder não passa a ver comentário
   identificado de terceiro; a tabela de permissões da seção 4.6 é explícita.

### Duas caixas

| Caixa | Conteúdo |
|---|---|
| **Causas de alerta** | Só comentários de **Estressado(a)** e **Desanimado(a)** |
| **Comentários** | Todos, de toda a escala, do mais negativo ao mais positivo |

Hoje o painel busca comentários **só de humor negativo** (`negativeWhere`), então
a Caixa 2 precisa de uma consulta nova — não é filtro de tela. E o que hoje ocupa
a primeira caixa é o ranking de **motivos declarados**, não comentários; ele
continua na tela, abaixo das duas caixas, porque responde outra pergunta ("de que
tipo é o mal-estar", não "o que a pessoa escreveu").

## 4.7 — Painel de Engajamento na aba

`EngagementSection` (Pessoas no ranking, Pontuaram no mês, Pontos no mês, Fora do
jogo, "Por onde os pontos entram", distribuição por setor) sai de
`/admin/engajamento` e passa a ser renderizado dentro da aba Engajamento, acima do
alcance do Feed Corporativo que já está lá.

A rota antiga vira redirecionamento e o item some do menu — mesmo tratamento que
`/admin/clima` recebeu no Lote A, e pelo mesmo motivo: link em favorito não pode
virar 404.

O painel é `adminOnly` hoje (regra de recompensa é da empresa, não do setor), e a
aba é do bloco `gente-gestao`. Como o conteúdo passa a conviver com o alcance do
Feed, que o SUBADMIN de G&G já vê, o painel de pontos aparece **só para o ADMIN
pleno** dentro da aba — o recorte não afrouxa por ter mudado de lugar.

## Seção 3 — Aba Dashboard

KPIs no topo e gráficos abaixo, no padrão da referência (Painel RH):

| KPI | Definição |
|---|---|
| Usuários ativos | pessoas distintas que acessaram na janela |
| Publicações | comunicados do Feed publicados na janela |
| Feedbacks | feedbacks escritos na janela |
| Adesão | únicos ÷ pessoas ativas |

Gráficos: **atividade** (acessos por dia, a série que a Visão geral já tem) e
**engajamento** (feedbacks, reações e comentários por dia).

Sem endpoint novo para os KPIs: `GET /admin/people/overview` já devolve três dos
quatro; entra só a contagem de publicações. A série de engajamento é o que falta,
e vai junto no mesmo overview — outra ida ao servidor para desenhar um gráfico ao
lado do primeiro não se paga.

## Permissões

Nada afrouxa:

| Tela | Quem vê |
|---|---|
| People Analytics (todas as abas) | ADMIN pleno e SUBADMIN de setor com `gente-gestao` |
| Painel de pontos dentro da aba Engajamento | **só ADMIN pleno** (era `adminOnly` em `/admin/engajamento`) |
| Comentários identificados do termômetro | ADMIN pleno e SUBADMIN de G&G — nunca líder, nunca colaborador |
| `/admin` para quem não tem `gente-gestao` | resumo operacional por setor, como hoje |

## Pendências

1. **CPF na busca (4.4)** — não entregue. Exige campo novo em `User`, coluna nova
   no template de importação e decisão sobre guardar CPF de todo colaborador.
2. **Precisão do tempo médio (4.2)** — o número derivado é piso. Se a G&G precisar
   de exatidão, o caminho é instrumentar heartbeat, e aí o dado só existe a partir
   da virada.
3. **"Sincronizar planilha" (4.4)** — o documento cita um botão que não existe.
   Confirmar se "sincronizar" é a importação atual (upsert) ou outra coisa.
4. **Comentários identificados (4.6)** — decidido aplicar ao histórico. Vale a
   G&G avisar o time de que o termômetro deixou de ser anônimo, já que a mudança
   alcança o que foi escrito antes.
