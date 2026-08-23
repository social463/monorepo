# Destaques do Mês (curados pela G&G) — Design Spec

- **Data:** 2026-08-17
- **Autor:** lucca.secco
- **Status:** implementado

## Resumo

Item 3.4 do documento do Portal EMR. Hoje o "Destaque do Mês" do Legends é
**derivado da votação**: `VotingPeriod` guarda `winnerId`, `highlightText` e o
card gerado por IA, e `/destaques` lista um vencedor por setor por mês.

A G&G pediu outra coisa: um destaque **curado por ela**, com uma ou várias
pessoas por grupo, filtro de mês e ano, e uma aba onde cada pessoa vê os
reconhecimentos que recebeu (hoje isso circula por fora, em template e
justificativa enviados no e-mail).

**Nada da votação é removido.** Este é um mecanismo **novo**, ao lado do que já
existe — decisão explícita do time, que também vale para o item 3.5 (a página
"Faça seu reconhecimento" e o botão no organograma **ficam como estão**).

## Decisões

### 1. Modelo novo, não uma coluna no período de votação

`MonthlyHighlight` é uma linha por (mês, pessoa). Pendurar isso no
`VotingPeriod` amarraria o destaque curado ao ciclo da votação: o período tem
janela, status, um `winnerId` só e uma unique por `(sectorId, monthRef)` — três
restrições que existem para a votação e que não fazem sentido para uma escolha
editorial da G&G, que quer **N pessoas por grupo** e não depende de período
aberto.

Consequência boa: quem hoje usa a votação continua usando, sem tocar em uma
linha do fluxo dela.

### 2. O agrupamento é por SETOR, não por diretoria

O documento pede o template da EMR, que agrupa por diretoria (Operações,
Receita, Produto, Ensino). O time optou por **reaproveitar o setor** em vez de
criar a entidade "diretoria" — o agrupamento sai de `Sector`, que já existe.

Registrado aqui porque é uma divergência consciente da figura 26: enquanto os
setores da empresa não espelharem as diretorias, o agrupamento da tela não vai
ser igual ao do template. Se um dia isso incomodar, o caminho é adicionar
`Directorate` e apontar cada setor para uma — o DTO desta entrega já entrega o
grupo como `{ id, name }`, então a troca não mexe na web.

### 3. Setor é SNAPSHOT na linha do destaque

`MonthlyHighlight.sectorId` é gravado no cadastro, e não lido do usuário na
hora de exibir. Quem mudou de setor em março não pode reescrever o quadro de
janeiro: o destaque é um fato histórico, e é assim que o `AnalyticsEvent` já
trata setor neste repo.

### 4. Cadastro é em lote, e a pessoa vem do banco

O formulário busca o colaborador (`/users/company`) e **grava só o id**: nome,
foto e setor saem do cadastro na hora de exibir, então não há nome digitado
errado nem foto desatualizada — que é exatamente o que o pedido descreve.

`POST /monthly-highlights` aceita **uma lista** de pessoas para o mesmo mês, e
usa `createMany({ skipDuplicates })` com a unique `(companyId, monthRef, userId)`
resolvendo o repique: cadastrar duas vezes a mesma pessoa no mesmo mês não
duplica, e o admin não precisa conferir antes.

### 5. A justificativa mora no destaque, opcional

`message String?` — é o texto que hoje a G&G manda por fora. Opcional porque o
quadro do mês costuma sair antes de a justificativa individual ficar pronta, e
travar o cadastro nisso atrasaria o reconhecimento inteiro.

### 6. A tela ganha abas em vez de substituir a que existe

`/destaques` passa a ter **Destaques do mês** (o novo, curado), **Meus
reconhecimentos** (o que a pessoa recebeu) e **Da votação** (a listagem atual,
intacta). Uma rota nova duplicaria o item de menu para a mesma pergunta ("quem
foi destaque?"), e a antiga é a que está nos links já enviados.

## Modelo de dados (Prisma)

```prisma
model MonthlyHighlight {
  id        String   @id @default(cuid())
  monthRef  String                     // "AAAA-MM"
  userId    String
  sectorId  String                     // snapshot do setor no cadastro
  message   String?                    // justificativa, opcional
  createdById String
  companyId String   @default("company-emr")

  @@unique([companyId, monthRef, userId])
  @@index([companyId, monthRef])
  @@index([userId])
}
```

Entra em `TENANT_SCOPED_MODELS`.

## Contrato (`packages/shared`)

`monthly-highlight.ts` — `MonthlyHighlightDTO` (pessoa, grupo, mês,
justificativa), `MonthlyHighlightGroupDTO` (`{ group: {id,name}, people: [] }`),
`MonthlyHighlightsResponse`, `CreateMonthlyHighlightsRequest` (lista de ids +
`monthRef`), `MAX_HIGHLIGHTS_PER_REQUEST`, e `canManageMonthlyHighlights`.

## Backend

- `monthly-highlight-service`: `listByMonth` (agrupado), `listForUser`
  (aba "Meus reconhecimentos"), `createMany`, `update` (justificativa),
  `remove` — os três últimos com auditoria.
- Rotas: `GET /monthly-highlights?monthRef=`, `GET /monthly-highlights/mine`,
  `POST/PATCH/DELETE` sob guard de administração.

## Frontend

- `HighlightsPage` em abas, com os textos oficiais do documento.
- `MonthlyHighlightsTab`: filtro de mês e ano, grupos com um ou vários nomes,
  vazio com "+ Adicionar o primeiro" (só admin).
- `NewMonthlyHighlightDialog`: busca de colaborador, seleção múltipla,
  mês/ano, justificativa opcional.
- `MyRecognitionsTab`: o que a pessoa recebeu, com filtro de mês e ano.

## Testes

- API: agrupa por setor; snapshot do setor sobrevive à mudança de setor da
  pessoa; lote não duplica; colaborador não cadastra (403); "minhas" só traz as
  do próprio usuário; escopo por empresa.
- Web: abas; vazio com a copy oficial; admin vê o botão e o colaborador não;
  cadastro em lote manda a lista de ids.

## O que a implementação acrescentou ao desenho

- **`GET /monthly-highlights/months`** — os meses que já têm destaque. Sem isso
  o seletor teria de chutar um intervalo, e a pessoa ficaria trocando de mês no
  escuro para achar onde tem conteúdo.
- **`canManage` no corpo da listagem**, como o feed já faz: a web decide se
  mostra "+ Adicionar destaque" sem duplicar a regra de papel, e o servidor
  segue sendo a autoridade (403 no POST).
- **A justificativa do cadastro em lote vale para todas as pessoas do lote**, e
  é editável uma a uma depois (`PATCH`). Pedir uma justificativa por pessoa na
  hora de montar o quadro travaria justamente o que o pedido quer acelerar.
- **`MonthPicker` com ano em lista curta**, não `<input type="number">`:
  destaque é sempre de um mês que já aconteceu, então 1998 é sempre erro de
  digitação.
- **A aba "Da votação" preserva o seletor de setor e o card com IA** exatamente
  como estavam — o teste que existia continua valendo, com um clique de aba a
  mais.

## Fora de escopo

Criar a entidade "diretoria" (decisão 2), gerar card de imagem para o destaque
curado (o card com IA continua sendo o da votação) e qualquer mudança no fluxo
de votação — inclusive as remoções do item 3.5, que o time pediu para não fazer.
