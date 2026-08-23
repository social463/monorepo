# Calendário: eventos de pessoa com avatar

**Data:** 2026-08-03
**Escopo:** `apps/web/src/pages/calendar` — nenhuma mudança de API ou de `@legends/shared`.

## Problema

Na grade do calendário, aniversário, tempo de casa e férias apareciam como chips de
texto iguais aos de reunião e aos dos tipos cadastrados pela empresa: ícone + nome
truncado. Três coisas se perdiam:

1. **Quem é a pessoa.** O produto inteiro identifica gente pelo personagem LPC; no
   calendário ela virava uma string.
2. **Dias com muita gente.** Férias coletivas geram um evento por pessoa **por dia**.
   Com teto de 3 chips na célula, cinco pessoas de férias viravam três nomes e um "+2".
3. **O painel do dia** empilhava eventos de tipos diferentes numa lista corrida, cada
   card repetindo o badge do tipo, sem afordância de que o card de pessoa é um link
   para o perfil.

## Decisões

### O dado carrega a pessoa

`CalendarEvent.userId: string | null` vira `CalendarEvent.user: PublicUser | null`.
Os DTOs das três fontes derivadas (`BirthdayDTO`, `WorkAnniversaryDTO`, `VacationDTO`)
já trazem o `PublicUser` inteiro — guardar só o id obrigava a buscar de novo o que já
estava em mãos. Nada muda no contrato.

Reunião **não** é evento de pessoa: `user` fica `null` e o organizador entra como
`organizerName`, porque `MeetingPersonDTO` só tem `{id, name}`. No painel ele aparece
com as iniciais (o `Avatar` cai no fallback), sem link para o perfil.

A legenda de férias deixa de ser a palavra "Férias" (redundante com o rótulo do tipo)
e passa a ser o período — `03/08 – 05/08` — com a nota do gestor anexada quando existe.
Num dia solto do meio das férias de alguém, é o que falta saber.

### Agrupamento por tipo

`groupEventsByKind` agrupa os eventos de um dia por `kind`, preservando a ordem em que
`buildEvents` os empurra (aniversários → tempo de casa → férias → tipos da empresa →
reuniões). Cada grupo carrega `people`: verdadeiro só quando **todos** os eventos dele
têm pessoa. É esse flag que decide o desenho nos dois lugares, e ele é conservador de
propósito — grupo misto cai para uma linha por evento em vez de virar um cluster que
esconderia metade do conteúdo.

### Grade

O teto da célula passa a ser de **linhas** (3), não de eventos:

- grupo de pessoas com 1 evento → ícone do tipo + avatar + primeiro nome;
- grupo de pessoas com 2+ → ícone + avatares sobrepostos (máx. 4) + `+N`, com os nomes
  todos no `title`;
- grupo sem pessoa → um chip de texto por evento, como antes.

O `+N` do rodapé da célula conta **eventos** escondidos, não linhas: quem lê a célula
quer saber quantas coisas ficaram de fora.

### Painel

Uma seção por tipo, com cabeçalho (ícone + rótulo + contagem quando > 1) e dois cards:

- **pessoa:** avatar 40px com anel do tipo, nome, cargo, legenda do evento e uma seta
  que torna visível o link para `/perfil/:id` — o link já existia, sem afordância;
- **comum:** hora/legenda em destaque, título, autoria (`organizerName` ou `addedBy`),
  **sem** o badge do tipo, que o cabeçalho da seção já dá.

### Cor

Nenhuma cor nova. `EVENT_TONE` sai de `CalendarGrid` para `calendar-tone.ts`, ganha o
par `EVENT_RING` (o mesmo mapa em forma de anel de avatar) e passa a ser importado
pela grade, pelo painel e pelos avatares. O módulo próprio existe para quebrar o ciclo
que apareceria se o mapa continuasse dentro da grade.

## Arquivos

| Arquivo | Papel |
|---|---|
| `calendar-events.ts` | `user` no evento, legenda de férias, `groupEventsByKind` |
| `calendar-tone.ts` | **novo** — `eventTone` / `eventRing` |
| `CalendarAvatars.tsx` | **novo** — `CalendarAvatar` e `CalendarAvatarCluster` |
| `CalendarGrid.tsx` | linhas por grupo, teto de 3 linhas, `+N` em eventos |
| `CalendarDayPanel.tsx` | seções por tipo, card de pessoa e card comum |

## Testes

`calendar-events.test.ts` cobre o dado (pessoa inteira no evento, legenda de férias,
reunião sem pessoa) e `groupEventsByKind` (ordem, grupo misto, dia vazio).
`CalendarGrid.test.tsx` e `CalendarDayPanel.test.tsx` cobrem o desenho: pessoa sozinha
com nome, cluster com `title` e corte em `+N`, célula mista com teto de linhas, seções
com contagem, card de pessoa como link para o perfil e reunião sem link.
