# Termômetro de humor (visão de liderança)

**Data:** 2026-07-31
**Status:** implementado
**Tarefa:** 22271

## Contexto

O Legends já coleta humor diário: `MoodEntry` (um registro por pessoa/dia, com
nota livre de até 280 caracteres) e `GET|PUT /me/mood/today`. A única leitura
agregada até aqui era `squad-mood-service.ts`, que mostra o humor **nominal** do
integrante para `LEAD` (sua squad) e `MANAGER` (sua área).

Gente e Gestão não tinha visão de empresa/setor, não sabia a causa dos dias
ruins (a nota é texto livre, sem categoria) e não conseguia olhar clima sem
expor quem escreveu o quê.

A referência de produto é a tela `/app/admin/clima` do portal EMR: média de 7
dias, participação do dia, total do período, série de 30 dias, distribuição por
carinha, causas de alerta e comentários anônimos.

## Objetivo

Dar a Gente e Gestão uma leitura agregada e **anônima por construção** do clima,
com o motivo estruturado do mal-estar, sem tocar na visão nominal que
`LEAD`/`MANAGER` já têm.

## Regras de negócio

- **Motivo estruturado.** Ao registrar humor negativo (`LOW`/`HARD`), a pessoa
  escolhe opcionalmente uma categoria: Carga de trabalho, Liderança,
  Reconhecimento, Processos, Time, Pessoal, Outro. O motivo persiste no dia.
- **Motivo só vale em humor negativo.** Regravar o dia com humor positivo limpa
  o motivo escolhido antes — regra do service, não da UI.
- **Upsert por dia mantido.** `@@unique([userId, day])` continua valendo:
  regravar o humor no mesmo dia atualiza o registro, não cria um segundo.
- **Piso de anonimato.** Nenhum recorte (dia, janela de 7 dias, setor) com menos
  de `MOOD_ANONYMITY_MIN` (3) respostas é exibido nem devolvido pela API. No dia
  suprimido nem a contagem sai — só a marca `suppressed`, que a UI traduz em
  "poucas respostas para exibir".
- **Comentário só de dia que atinge o piso.** Numa data com uma única resposta,
  o comentário seria atribuível a quem registrou naquele dia.
- **Média de 7 dias ponderada** pelo nº de registros de cada dia (soma das notas
  ÷ total de registros). Média de médias daria o mesmo peso a um dia com 1
  registro e a um com 40. Dia sem registro não entra na conta.
- **Datas em America/Sao_Paulo.** Todo recorte de dia usa `lib/sao-paulo-date.ts`
  — registro às 23h de SP conta no dia civil de SP, não no dia UTC que já virou.
  (O portal usa `toISOString().slice(0,10)` e erra o dia no fim da noite.)
- **Acesso.** `ADMIN` vê a empresa e filtra por setor; `SUBADMIN` fica preso ao
  próprio setor e recebe 403 se pedir outro explicitamente. `LEAD`/`MANAGER`
  seguem com a visão nominal de sempre, sem regressão.
- **Denominador da participação** exclui `ADMIN`/`SUBADMIN`/`SUPER_ADMIN`: quem
  nunca registra humor não afunda o percentual.

## Anonimato como garantia técnica

O `MoodOverviewDTO` **não carrega `userId` em campo nenhum**. Isso é propriedade
do formato, não escolha de UI: as agregações saem de `groupBy` (que
estruturalmente não devolve identificador) e a lista de comentários usa um
`select` explícito de `id/day/mood/reason/note`. Há teste de service e de rota
varrendo a resposta serializada atrás de qualquer id de usuário.

## Modelo de dados

Enum novo e uma coluna opcional em `MoodEntry` — sem backfill, registros antigos
ficam nulos e caem em "Não informado":

```prisma
enum MoodReason {
  WORKLOAD
  LEADERSHIP
  RECOGNITION
  PROCESSES
  TEAM
  PERSONAL
  OTHER
}

model MoodEntry {
  // …
  reason MoodReason?
  @@index([companyId, day]) // recorte da janela dentro da empresa
}
```

Migration: `20260731230000_add_mood_reason`.

## Contrato (`@legends/shared`)

- `mood.ts`: `MOOD_REASONS`, `MoodReason`, `MOOD_REASON_LABELS`,
  `MOOD_REASON_UNSET_LABEL`, `MOOD_SCORES` (HARD=1 … GREAT=5),
  `NEGATIVE_MOOD_LEVELS`, `isNegativeMood`, `MOOD_ANONYMITY_MIN`.
  `TodayMoodDTO` ganha `reason`.
- `mood-analytics.ts` (novo): `MoodOverviewDTO` (`weekAverage`,
  `participationToday`, `totalEntries`, `trend[]`, `todayDistribution[]`,
  `reasons[]`, `comments[]`), mais os DTOs de fatia e `MoodOverviewResponse`.

## API

- `PUT /me/mood/today` aceita `reason` opcional (`routes/mood.ts` →
  `setTodayMood`).
- `GET /admin/mood/overview?days=30&sectorId=` em `routes/squad-mood.ts`, sob
  `onRequest: [app.authenticate, app.requireAdminOrSubadmin]`. `days` entre 7 e
  90. Agregações em `services/mood-analytics-service.ts` via
  `scopedPrisma(companyId).moodEntry.groupBy`.

Leitura pura: não há mutação de admin, então não há `recordAuditLog`.

## Web

- `pages/admin/MoodOverviewSection.tsx`, rota `/admin/clima`, item
  "Termômetro de humor" no grupo "Gente e Gestão" do `AdminSidebar`.
- Gráficos desenhados à mão em SVG (o projeto não tem lib de charts): série de
  tendência com área + linha, crosshair e tooltip no hover, e a linha
  **interrompida** em dia sem registro ou suprimido — ligar os pontos por cima
  inventaria uma tendência que o dado não tem.
- Distribuição do dia e ranking de motivos como barras rotuladas.
- Escala de cor **divergente** (vermelho → laranja → cinza neutro → verde), não
  categórica: a ordem carrega significado. Toda marca colorida vem com emoji e
  rótulo, então a identidade nunca depende só da cor.
- O seletor de motivo entra no `MoodOfDay` já existente, e só aparece quando a
  carinha escolhida é negativa.

## Fora de escopo

Alerta ativo (e-mail/Teams) por queda de clima e cruzamento humor × desempenho
individual.
