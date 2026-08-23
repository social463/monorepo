# 1:1 — ritual de conversa entre duas pessoas

## Problema

O 1:1 é o ritual de gestão mais frequente da empresa e o único que não deixa rastro
nenhum no Legends. A conversa é marcada no calendário pessoal de cada um, a pauta
vive num bloco de notas, o combinado se perde entre um encontro e outro e ninguém
lembra o que ficou pendente do mês passado. Quando o combinado é de desenvolvimento,
ele morre longe do PDI — que existe na plataforma desde o
[spec de Desenvolvimento](2026-07-31-desenvolvimento-colaborador-design.md) e é
exatamente o lugar onde ele deveria ser cobrado.

O Legends já tem as duas pontas: calendário com filtros derivados e PDI com validação
do líder. Falta o meio — o encontro em si.

## Entrega

Uma área de 1:1 onde duas pessoas quaisquer da empresa marcam o encontro (com ritmo
fixo, se quiserem), montam a pauta a partir de um catálogo de tópicos da empresa,
registram observações **privadas de cada lado** e combinam **ações compartilhadas**
que reaparecem em todo encontro do par até serem concluídas. Quando o par é
líder↔liderado, a tela mostra o PDI do liderado e ele pode promover uma ação do 1:1
a ação do plano.

O encontro aparece no calendário como um quinto filtro derivado, visível **só para
os dois participantes**.

## Modelo de dados

Cinco models novos. Nenhum reaproveita `OfficeMeeting`: aquele model é reunião de
**sala do escritório virtual**, com participantes N, sequência de `.ics` e
visibilidade de empresa. 1:1 é privado por construção e tem ciclo de vida próprio
(pauta, notas, ações que atravessam encontros); enxertar os dois no mesmo model
misturaria duas regras de visibilidade opostas.

### `OneOnOneSeries` — o par e o ritmo

`userAId`/`userBId` guardados **normalizados** (ordenados pelo id), de modo que "o par
A↔B" seja uma consulta direta, e não duas com `OR`. Guarda `recurrence`
(`NONE | WEEKLY | BIWEEKLY | MONTHLY`), `recurrenceUntil` **ou** `recurrenceCount`
(exclusivos, como em `CalendarEvent`), hora local e duração padrão, `createdById`,
`companyId`.

A normalização é o que faz o carryover de ações funcionar sem um sexto model de
"par": ação pendente pertence ao par, então qualquer encontro entre as duas pessoas
a enxerga, inclusive se a série for encerrada e outra começar depois.

### `OneOnOneMeeting` — cada ocorrência

Ocorrências são **materializadas** na criação, e não expandidas em tempo de consulta
como as de `CalendarEvent`. A diferença é deliberada: ocorrência de evento de
calendário é só uma data, enquanto cada 1:1 carrega pauta, notas e ações próprias —
precisa de linha no banco com id estável para ser alvo de FK.

`seriesId`, `startsAt`, `endsAt`, `status` (`SCHEDULED | DONE | CANCELED`).

A materialização é **limitada**: no máximo `MAX_ONE_ON_ONE_OCCURRENCES` (52) por
série, e nunca além de `recurrenceUntil`. Série sem fim declarado gera o teto e
oferece prorrogar — melhor que gerar linhas até 2099.

### `OneOnOneTopic` — pauta do encontro

`meetingId`, `text`, `origin` (`TEMPLATE | CUSTOM`), `createdById`, `discussed`,
`sortOrder`. Visível aos dois participantes; qualquer um dos dois adiciona, marca
como discutido e remove.

Tópico vindo do catálogo é **copiado como texto**, não referenciado por FK: o
catálogo muda com o tempo e a pauta de um encontro que já aconteceu é registro
histórico. `origin` fica só para analytics futura e para o rótulo na tela.

### `OneOnOnePrivateNote` — a observação privada

`@@unique([meetingId, authorId])`, corpo em `@db.Text`. Uma nota por pessoa por
encontro, upsert.

**A privacidade é do service, não da tela.** A nota do outro participante nunca entra
no DTO — a consulta filtra por `authorId = viewer`. Não existe endpoint que devolva a
nota alheia, nem para ADMIN.

### `OneOnOneAction` — o combinado

Presa à **série** (logo, ao par): `seriesId`, `createdInMeetingId`, `description`,
`ownerId` (obrigatoriamente um dos dois), `dueDate?`, `status`
(`OPEN | DONE | PROMOTED`), `completedById`/`completedAt`, `promotedPdiActionId?`,
`companyId`.

Todo encontro lista as ações `OPEN` **do par**, não só as criadas naquele dia — é o
que faz o combinado sobreviver ao encontro. Ação com `dueDate` no passado ganha
destaque de vencida. `DONE` e `PROMOTED` saem da lista de pendentes e ficam no
encontro onde nasceram, para o histórico.

### `OneOnOneTopicTemplate` — catálogo da empresa

`theme`, `text`, `sortOrder`, `active`, `companyId`. Cadastrado em
**Administração › Gente e Gestão**, sob `requireSectorFeature('gente-gestao')` — o
1:1 é ritual de gestão de pessoas, e o catálogo é taxonomia da empresa, mesmo
argumento que mantém o catálogo de tipos de evento fora do alcance de cada líder.

Nasce com **seed** de ~15 tópicos clássicos agrupados por tema (carreira e
desenvolvimento, bloqueios e prioridades, feedback, bem-estar e carga, relação com o
time). Catálogo cadastrável que começa vazio vira campo de texto livre no primeiro
uso e ninguém volta para preencher.

## Autorização e privacidade

Regra única, no service, com teste por combinação:

| Quem | Pode |
| --- | --- |
| Os dois participantes | Ler e escrever tudo do 1:1 — exceto a nota privada do outro, que não existe para eles |
| Qualquer outra pessoa | **404** em tudo (nem confirma a existência) |
| ADMIN | **404 também** — sem bypass |
| Outra empresa | 404 |

**ADMIN não lê 1:1.** Segue a mesma decisão já tomada para o PDI ("admin configura a
empresa, não lê o plano de ninguém"): 1:1 é conversa privada entre duas pessoas, e um
único caso de admin lendo nota de terceiro mata a feature — as pessoas param de
escrever de verdade e o registro perde o sentido. O admin gerencia o catálogo de
tópicos; conteúdo de encontro não tem porta de leitura administrativa.

Ações: as duas pessoas concluem e reabrem, com `completedById`/`completedAt` gravados
— combinado é dos dois, e travar a conclusão no dono só faz a lista apodrecer quando
ele esquece. Remarcar e cancelar: qualquer um dos dois, com escopo `this` (só esta
ocorrência) ou `future` (esta e as seguintes), nunca reescrevendo encontro passado.

## Seção de PDI

Aparece **só quando o par é líder↔liderado**, e o teste é o fato, não o papel:
existe um `PdiPlan` do outro participante cujo `leaderId` é o viewer (ou vice-versa).
Hierarquia de papel diria que dois `LEAD` do mesmo setor não têm relação; o plano diz
quem de fato valida quem.

Fora desse caso — mentoria, par técnico, RH com colaborador — a seção simplesmente
não é renderizada e a API não devolve o bloco.

Quando aparece: as ações do plano ativo do liderado, com status, prazo e progresso,
em **leitura**, respeitando a autorização do `pdi-service` de sempre.

### Promover ação do 1:1 para o PDI

O botão **"Adicionar ao PDI" só aparece para o dono do plano** — o liderado. O
`pdi-service` garante desde o spec anterior que só o dono escreve no próprio plano
(`assertEditablePlan`, `pdi-service.ts:125`), e essa é uma decisão de produto, não um
detalhe de implementação: o plano é da pessoa. O 1:1 não abre exceção nela; os dois
estão na conversa, e um clique do liderado resolve.

Ao promover:

1. Nasce uma `PdiAction` no plano ativo, herdando descrição e `dueDate`, com
   `type: OTHER` e `priority: MEDIUM` (o resto se ajusta no PDI).
2. A ação do 1:1 vira `PROMOTED` com `promotedPdiActionId` preenchido e **sai da
   lista de pendentes** do par.
3. O rastro fica: no encontro, a ação aparece marcada como "no PDI", com link.

Um dono só, um status só. A cobrança passa a ser do PDI, onde já existe validação do
líder — duplicar o acompanhamento nos dois lugares faria os dois divergirem.

Sem plano editável (nenhum plano, ou plano `DONE`/`ARCHIVED`), o botão explica em vez
de sumir: "Você ainda não tem um plano de PDI ativo", com link para `/pdi`.

## API

`routes/one-on-one.ts` (fina, Zod, `instanceof OneOnOneError`) →
`services/one-on-one-service.ts` → Prisma. DTOs em `lib/serialize-one-on-one.ts`,
contrato em `packages/shared/src/one-on-one.ts`.

| Rota | O que faz |
| --- | --- |
| `POST /one-on-ones` | Cria a série e materializa as ocorrências |
| `GET /one-on-ones?from&to` | Encontros do usuário na janela (alimenta calendário e lista) |
| `GET /one-on-ones/:id` | Detalhe: pauta, ações `OPEN` do par, **minha** nota, bloco PDI quando aplicável |
| `PATCH /one-on-ones/:id?scope=this\|future` | Remarcar |
| `POST /one-on-ones/:id/done` | Marcar o encontro como realizado |
| `DELETE /one-on-ones/:id?scope=this\|future` | Cancelar; com `future`, encerra a série a partir dali |
| `POST/PATCH/DELETE /one-on-ones/:id/topics[/:topicId]` | Pauta |
| `PUT /one-on-ones/:id/note` | Upsert da observação privada |
| `POST /one-on-ones/:id/actions` | Novo combinado |
| `PATCH /one-on-ones/actions/:actionId` | Editar, concluir, reabrir |
| `POST /one-on-ones/actions/:actionId/promote-to-pdi` | Promove (só o dono do plano) |
| `GET /one-on-ones/topic-templates` | Catálogo ativo da empresa |
| `/admin/one-on-one-topics` (CRUD) | Catálogo, sob `requireSectorFeature('gente-gestao')` |

Todas sob `app.authenticate` + a feature `um-a-um`.

## Calendário

Quinto filtro derivado: `um-a-um`, rótulo **"1:1"**, ícone `forum`, ao lado de
Aniversários, Tempo de casa, Férias e Reuniões em `CALENDAR_DERIVED_FILTERS`
(`apps/web/src/pages/calendar/calendar-events.ts`). A fonte é `GET /one-on-ones`, que
**já devolve só os encontros do próprio usuário** — a privacidade no calendário não
depende de o front filtrar direito. Clicar no evento abre `/1-1/:id`.

`buildEvents` ganha a nova fonte e `useCalendarData` a query correspondente, atrelada
ao filtro (filtro desligado não busca, como as outras três).

## Web

`apps/web/src/pages/one-on-one/`:

- **`OneOnOnePage.tsx`** — próximos encontros, ações pendentes do par e histórico.
- **`OneOnOneDetailPage.tsx`** — pauta (com sugestões do catálogo por tema), ações,
  minhas observações privadas e o bloco de PDI quando o par for líder↔liderado.
- **`NewOneOnOneModal.tsx`** — pessoa, data, hora, duração e ritmo.
- **`lib/one-on-one-api.ts`** — cliente.

Item de menu **no grupo Desenvolvimento**, ao lado de Meu PDI, com feature de
colaborador nova **`um-a-um`** em `COLLABORATOR_FEATURE_KEYS`. Cada item daquele
grupo já tem a sua (`pdi`, `aprendizado`, `quinta-desenvolvimento`); reusar `pdi`
amarraria o ritual de gestão ao plano de desenvolvimento, e empresa que quer 1:1 sem
PDI (ou o contrário) ficaria sem saída.

## Notificações

No mínimo, via `notification-service` existente: convite ao ser incluído numa série e
aviso ao virar dono de uma ação. Lembrete de véspera fica para depois — o calendário
já mostra o encontro.

## Testes

Vitest ao lado do código, Postgres real na API:

- **Autorização**: terceiro recebe 404 em todas as rotas; ADMIN também; outra empresa
  também; nota privada do outro nunca aparece no DTO.
- **Carryover**: ação `OPEN` criada no encontro 1 aparece no encontro 2 do mesmo par,
  inclusive em série diferente; `DONE` e `PROMOTED` não aparecem.
- **Recorrência**: `WEEKLY` com `recurrenceCount: 4` gera 4 ocorrências nas datas
  certas; teto de 52 respeitado; `scope=future` não toca ocorrência passada.
- **Promoção ao PDI**: dono do plano promove e a `PdiAction` nasce com os campos
  herdados; líder recebe 403; sem plano ativo, 400 com mensagem tratada; ação vira
  `PROMOTED` e some dos pendentes.
- **Bloco PDI**: aparece só quando existe `PdiPlan` com `leaderId` do outro lado.
- **Web**: pauta, conclusão de ação pelos dois lados, nota privada, e o filtro "1:1"
  no calendário.

## Fora deste recorte

- **Tópicos sugeridos por IA** a partir de PDI, feedbacks e humor do par — a infra de
  agente por empresa existe, mas o catálogo cadastrável entrega o ritual sem depender
  de a empresa ter chave.
- **Sala virtual e `.ics`** — é o território de `OfficeMeeting`; 1:1 aqui é registro
  de conversa, não convite de agenda externa.
- **Relatório de 1:1 para RH** (frequência por líder, ações vencidas por time) —
  colide de frente com a decisão de privacidade acima; se um dia entrar, entra como
  agregado sem conteúdo, e é decisão de produto própria.
- **Lembrete de véspera** e **reagendamento negociado** (propor nova data para o outro
  aceitar).
