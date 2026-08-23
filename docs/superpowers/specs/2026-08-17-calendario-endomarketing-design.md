# Calendário Endomarketing 2026 — design

Data: 2026-08-17
Branch: `feat/calendario-endomarketing`

## Problema

O `/calendario` misturava seis fontes: aniversário, tempo de casa, férias, 1:1,
reunião de sala e evento cadastrado. Cada uma delas já tem a aba do seu assunto,
e juntas enchiam a grade de marcações de pessoa a ponto de esconder o que a área
de Gente e Gestão precisa ver ali — **ações, datas comemorativas, campanhas e
ritos institucionais**.

A tela também não tinha o que o Calendário Endomarketing exige: recorte por
período (dia/semana/mês), período de vários dias, público-alvo por tag, cor por
categoria e um lugar para a G&G registrar campanha que ainda não foi decidida
para divulgação geral.

## Decisão

### O calendário passa a ter uma fonte só

Sai tudo que é derivado de outra tabela; fica só `CalendarEvent`. Aniversário,
tempo de casa, férias e 1:1 continuam nas telas próprias.

**Reunião de sala saiu junto.** O texto da demanda lista quatro remoções e não
cita reunião, mas a legenda da Figura 13 a inclui em "itens a remover" e a
proposta é explícita: "este calendário contenha **apenas** eventos institucionais
e campanhas de endomarketing". Reunião de sala do escritório não é nem uma nem
outra, e ela continua no escritório. Rito de gestor entra aqui como **evento
cadastrado** na categoria "Reunião", que é o caso que a demanda descreve.
Reverter é trocar uma fonte no `useCalendarData`.

### Categoria é dado, não enum

As dez categorias (`CALENDAR_EVENT_CATEGORIES` em `@legends/shared`) são
semeadas como linhas de `CalendarEventType`, uma cópia por empresa. A alternativa
— enum fixo — obrigaria a migrar a FK de todo evento já cadastrado, jogaria fora
a tela de catálogo do admin e tiraria da empresa a possibilidade de ter uma
categoria a mais. Como a lista fechada é semeada, na prática o cadastro já abre
exatamente com as dez.

`color` mora no tipo, e não num mapa fixo no front, pelo mesmo motivo: o catálogo
é por empresa, e mapa fixo mentiria para quem tem uma categoria fora dele.

Cor igual à da categoria **não** vira sobrescrita no evento (`color: null`):
assim, repintar a categoria depois arrasta os eventos dela junto.

### Público-alvo por tag, somado ao público por setor

`audienceTags: String[]`. Vazio — ou contendo `Todos` — é a empresa inteira,
mesma convenção de `CalendarEventSector`. Os setores continuam valendo **em
paralelo**: as duas regras se somam, e quem já cadastrou evento por setor não
perde o recorte.

As tags de quem lê saem do que o produto já sabe da pessoa
(`viewerAudienceTags`): `Todos`, o nome do setor, `G&G` (bloco de Gente e
Gestão), `Líder` (papel de liderança) e `CEO` (cargo, com limite de palavra —
"Assessor do CEO" é CEO, "Ceonardo" não). A comparação é normalizada (sem
acento, caixa ou pontuação) porque a planilha de colaboradores não garante
grafia, e um acento a mais esconderia o evento de quem deveria vê-lo.

O filtro por tag é aplicado **em memória**, e não no SQL: a comparação
normalizada exigiria uma coluna espelho só para o `hasSome`, e o conjunto já
está limitado à janela pedida.

### Ação de Comunicação Interna

`isInternalComm: Boolean`. Enxerga quem é admin pleno **ou está no setor com a
feature `gente-gestao`** — o time inteiro, não só o subadmin dele: o registro é
o controle interno da área.

O recorte é do backend em três pontos: `GET /calendar/events`,
`GET /calendar/managed-events` e o lembrete do scheduler (que passaria por cima
da tela e notificaria a empresa inteira). Tentar editar um evento interno sem
poder vê-lo responde **404, não 403** — 403 confirmaria a existência do registro
que a G&G marcou justamente para não existir fora dela.

### Período de vários dias

`endDate`. A duração em dias é da REGRA, e acompanha cada ocorrência: evento de
3 dias que se repete todo mês ocupa 3 dias em cada mês. A ocorrência viaja com
`endIso`, e é o par (`iso`, `endIso`) que deixa a grade desenhar uma **barra
contínua** em vez de N marcações soltas.

A janela da expansão abre `duracao` dias antes do `from` pedido: a ocorrência
que começa fora da janela mas termina dentro precisa aparecer, senão o dia 1º de
outubro não mostraria a campanha que começou em 28 de setembro.

### Horário estruturado, duração derivada

`startTime`/`endTime` em `HH:MM`. **Vazio é o que joga o evento para a faixa
"DIA TODO"** no topo da grade.

A demanda pede "Duração" como texto livre ao lado de "Horário" também livre.
Aqui os dois são estruturados e a duração é **derivada** (`calendarDurationLabel`
→ "1h30", "45min", "3 dias", "Dia todo"): dois campos de texto sobre a mesma
coisa criam duas verdades, e a grade de horas precisa de um horário que ela
consiga posicionar sem adivinhar de "14h-15h30".

### O que continua

Recorrência e lembretes não estão no formulário da referência, mas já existem,
têm scheduler e dados. Removê-los quebraria comportamento em produção por uma
omissão que é do protótipo, não da demanda.

## Fora de escopo

- Importar a planilha do Calendário Endomarketing 2026 com os eventos do ano.
  A tela e o modelo estão prontos para recebê-los; o carregamento em si é uma
  carga de dados, não código.
- Ligar as tags do evento às tags que a planilha de colaboradores grava por
  pessoa: hoje as tags de quem lê são derivadas de setor/papel/cargo. Quando a
  planilha passar a gravar tag por usuário, o ponto de mudança é
  `viewerAudienceTags`, e só ele.

## Arquivos

| Camada | Arquivo |
|---|---|
| Contrato | `packages/shared/src/calendar-event.ts` |
| Banco | `apps/api/prisma/schema.prisma` + `migrations/20260817210000_calendario_endomarketing` |
| Service | `apps/api/src/services/calendar-event-service.ts` |
| Rotas | `apps/api/src/routes/calendar.ts`, `admin.ts` |
| Scheduler | `apps/api/src/scheduler/calendar-event-reminders.ts` |
| Tela | `apps/web/src/pages/calendar/*` |
| Formulário | `apps/web/src/components/CalendarEventForm.tsx` |
