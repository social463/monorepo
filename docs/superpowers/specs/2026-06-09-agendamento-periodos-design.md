# Agendamento de períodos de votação com janela definida pelo admin

**Data:** 2026-06-09
**Status:** Aprovado (pré-plano)

## Problema

Hoje um período de votação é criado já `OPEN` e abrange o **mês inteiro**
(`openVotingPeriod` deriva `startsAt` = dia 1 e `endsAt` = último dia do mês a
partir de `monthRef`). Não dá para programar um período futuro nem controlar por
quanto tempo a votação fica aberta — o admin abre na hora e a janela é sempre o
mês cheio. Queremos que o admin **agende o destaque de um mês com uma janela de
votação customizada** (1 dia, 2 dias, 1 semana, 2 semanas…) e que o período
**abra e feche sozinho** pela data, sem nenhum job/cron.

## Decisões de produto (confirmadas)

1. **Um período por mês** — o "destaque do mês". `monthRef` continua único.
2. **Mês escolhido pelo admin** — o admin seleciona explicitamente o mês do
   destaque (`monthRef`), o que facilita agendar votações futuras.
3. **Janela definida pelo admin** — o admin escolhe `startsAt` e `endsAt`; não é
   mais o mês inteiro.
4. **Ativação automática por data** — sem cron. "Aberto para votar" é *computado*
   da janela `[startsAt, endsAt]`, não de um flag virado por um humano.
5. **Cancelar período** (agendado ou em andamento) o marca como `CLOSED`, sem
   apagar a linha (um caminho de código só, histórico preservado).

## Modelo de estados

Estado efetivo de um período, derivado de `now` + `status`:

| Estado (computado) | Condição                                              |
|--------------------|-------------------------------------------------------|
| `SCHEDULED`        | `status != CLOSED` e `now < startsAt`                 |
| `ACTIVE`           | `status != CLOSED` e `startsAt <= now <= endsAt`      |
| `ENDED`            | `status == CLOSED` **ou** `now > endsAt`              |

`status` (coluna do banco) continua `OPEN | CLOSED`. `CLOSED` significa
cancelado/encerrado manualmente. `SCHEDULED` não é armazenado — é derivado.

**Período ativo agora** (`getCurrentOpenPeriod`): a linha com `status = OPEN`
cuja janela contém `now`. Como é um por mês, sobreposição só pode acontecer em
janelas que cruzam a virada do mês; desempate pelo `startsAt` mais recente
(`orderBy startsAt desc`, `take 1`).

## Schema (Prisma)

**Nenhuma mudança estrutural.** O modelo `VotingPeriod` já possui `monthRef`
(`@unique`), `startsAt`, `endsAt`, `status`. Só muda quem preenche `startsAt`/
`endsAt` (a janela do admin) e como "atual" é calculado. Sem migration.

## DTO

`VotingPeriodDTO` ganha um campo computado `state`:

```ts
export const VOTING_PERIOD_STATE = ['SCHEDULED', 'ACTIVE', 'ENDED'] as const
export type VotingPeriodState = (typeof VOTING_PERIOD_STATE)[number]

export interface VotingPeriodDTO {
  id: string
  monthRef: string
  startsAt: string
  endsAt: string
  status: VotingPeriodStatus   // OPEN | CLOSED (intenção do admin)
  state: VotingPeriodState     // SCHEDULED | ACTIVE | ENDED (derivado de now)
}
```

`toPeriodDTO(period, now)` calcula `state`. O `enum VotingPeriodStatus` do banco
permanece `OPEN | CLOSED`.

## API

- `POST /admin/periods` — corpo `{ monthRef: "YYYY-MM", startsAt: ISODate,
  endsAt: ISODate }`.
  - O admin escolhe o mês do destaque (`monthRef`) explicitamente — facilita
    agendar votações futuras. A janela `[startsAt, endsAt]` é independente do
    mês (pode ser curta, e até cruzar a virada do mês). Cria com `status = OPEN`.
  - Validações:
    - `monthRef` no formato `YYYY-MM` → `400` se inválido.
    - `endsAt > startsAt` → `400`.
    - `endsAt > now` (não agendar período inteiramente no passado) → `400`.
    - `monthRef` já existente → `409` (já tratado via `P2002`): "Já existe um
      período para esse mês."
  - Retorna `201 { period: VotingPeriodDTO }`.
  - *(Substitui o corpo antigo `{ monthRef? }` que abria o mês inteiro
    automaticamente.)*
- `GET /admin/periods` — **novo**. Lista todos os períodos (`orderBy startsAt
  desc`) para a tela de gestão (agendados + em andamento + encerrados).
- `POST /admin/periods/:id/close` — inalterado na rota; marca `CLOSED`
  (cancela/encerra). Funciona para `SCHEDULED` e `ACTIVE`. `404` se não existir.
- `GET /periods/current` — inalterado na assinatura; agora retorna o período
  **ativo por janela** (ou `null`).

`createVote` não muda: chama `getCurrentOpenPeriod()` (agora por janela), então o
`409 "Nenhum período de votação aberto no momento."` dispara corretamente fora de
qualquer janela ativa.

## Web (Admin)

O painel "Período de votação" vira um gerenciador:

- **Formulário de agendamento:** um input de mês (`type="month"`, gera
  `YYYY-MM`) + dois inputs `type="date"` (início e fim) + botão "Agendar
  período". Ao escolher o mês, início/fim são pré-preenchidos com o 1º e o último
  dia daquele mês (atalho; o admin pode ajustar livremente). Erro inline para
  validações (fim ≤ início, data no passado, mês já existente — mensagem do
  servidor).
- **Lista agrupada** (de `GET /admin/periods`):
  - **Em andamento** (`state ACTIVE`) — intervalo + botão "Fechar".
  - **Agendados** (`state SCHEDULED`) — intervalo + botão "Cancelar".
  - **Encerrados** (`state ENDED`) — intervalo, sem ação.
- O selo "Aberta" na sidebar e o gating da rota `/votar` (já implementados) leem
  `/periods/current` e continuam funcionando sem alteração.

`AdminPage` passa a usar `GET /admin/periods` (queryKey `['admin','periods']`)
para a lista; `/periods/current` (`['period']`) segue para o indicador.

## Tratamento de erros

- `endsAt <= startsAt` → `400 "A data de fim deve ser depois do início."`
- `endsAt <= now` → `400 "Não é possível agendar um período no passado."`
- Mês já com período → `409 "Já existe um período para esse mês."`
- Fechar período inexistente → `404`.
- Voto fora de janela ativa → `409` (já existe).

## Testes

- **voting-service** (`getCurrentOpenPeriod`): retorna período cuja janela contém
  `now`; ignora agendado (futuro), encerrado (passado) e `CLOSED`; desempate por
  `startsAt` desc.
- **admin routes**: cria período com mês + janela customizada (201 + `state`
  correto); `400` para `monthRef` inválido, fim≤início e data no passado; `409`
  para mês repetido; `GET /admin/periods` lista todos; close marca `CLOSED`.
- **toPeriodDTO**: deriva `state` corretamente nos três casos.
- **AdminPage** (web): formulário de agendamento dispara POST; lista renderiza
  grupos Em andamento / Agendados / Encerrados.
- Testes existentes (período/badge/VotePage/AppLayout) permanecem verdes.

## Fora de escopo (YAGNI)

- Cron/scheduler real (ativação é lazy por data).
- Mais de um período por mês (decisão de produto: um destaque por mês).
- Nome/título livre por período (mantemos `monthRef` como rótulo).
- Edição de datas de um período já criado (cancelar + recriar resolve).
- Forçar a janela a ficar dentro do mês de `monthRef` (a janela é independente; o
  mês é escolhido pelo admin e serve como competência/rótulo do destaque).
