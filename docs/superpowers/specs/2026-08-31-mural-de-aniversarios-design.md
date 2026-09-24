# Mural de Aniversários — Design Spec

- **Data:** 2026-08-31
- **Autor:** lucca.secco
- **Status:** implementado

## Resumo

Dar os parabéns no Legends abria o **`FeedbackComposer`** com um rascunho
("Parabéns, Victoria! "). O resultado: a felicitação nascia com **tipo**,
**categoria**, **coins** e peso de **selo**, exigia o mínimo de caracteres do
feedback — um "Parabéns!" solto era erro de validação — e ia parar no meio da
lista de feedbacks da pessoa, junto com o feedback de trabalho.

Este spec cria um lugar próprio para isso: o **mural de aniversário**, no
perfil, ao lado do feedback. Vale para as duas datas que o produto já conhece:
**aniversário de nascimento** e **de empresa** (tempo de casa).

## Decisões

### 1. Felicitação NÃO é feedback

É a decisão central, e ela contraria de propósito a unificação de
`2026-08-20-unificar-reconhecimento-em-feedback`. Aquela unificação juntou
**voto** e **feedback** porque os dois respondem à mesma pergunta ("o que essa
pessoa fez que valeu"). Felicitação não responde a essa pergunta: não tem
situação, comportamento nem impacto — o guia inteiro do feedback é ruído aqui.

Consequência prática: `BirthdayGreeting` é model próprio, não passa pelo
`feedback-service`, **não paga coins e não conta para selo**, e não aparece na
lista de feedbacks do perfil. O ❤️ do card de aniversariantes continua levando
ao perfil e ao `FeedbackComposer` de sempre — quem quer deixar feedback de
verdade num aniversário continua podendo.

### 2. O mural é (pessoa, tipo, ano)

`kind` (`BIRTH`/`WORK`) + `occurrenceYear` identificam um mural. O de 2026 não
se mistura com o de 2025, e o de nascimento não se mistura com o de casa —
senão o mural viraria um acumulado sem data, e reler "o que me escreveram nos 5
anos de casa" seria impossível.

O ano é **da ocorrência**, não do nascimento. A ocorrência é calculada pelos
mesmos helpers do `celebration-service`, extraídos para `lib/celebration-date.ts`
justamente para não ter duas regras de 29/02 no repo.

### 3. Uma assinatura por pessoa, editável

`@@unique([companyId, targetId, kind, occurrenceYear, authorId])`: assinar de
novo **reescreve** a própria mensagem em vez de empilhar. O mural é um cartão
coletivo assinado, não uma conversa — quem quis corrigir a frase não deveria
virar duas linhas no mural de outra pessoa.

### 4. A janela é do servidor

Aberto de `GREETING_WINDOW_BEFORE_DAYS` (3) antes até
`GREETING_WINDOW_AFTER_DAYS` (30) depois. Abre antes porque quem viaja no dia
adianta o recado; fecha depois porque parabéns atrasado ainda é parabéns. Fora
da janela o mural continua **visível, em leitura** — é o histórico.

Quem decide é o servidor (`canSign` na resposta), e a web só desenha: janela
calculada no cliente daria divergência de fuso entre quem abre no Brasil e quem
abre em outro lugar, e o relógio do navegador é editável.

A varredura olha **três anos civis** (anterior, corrente, seguinte) porque a
janela atravessa a virada do ano: em 2 de janeiro, o aniversário de 31 de
dezembro ainda está aberto — e é uma ocorrência do ano anterior.

### 5. Assinar é de todo mundo, menos de si mesmo

`canSignBirthdayWall` **não** reaproveita `canWriteFeedbackTo`, que barra o
ADMIN. Num mural de aniversário não faz sentido o admin não poder dar parabéns.
O que continua barrado é assinar o próprio mural.

### 6. Moderação apaga, não reescreve

ADMIN e SUBADMIN apagam qualquer felicitação (`canDelete`); **editar é só do
autor** (`canEdit`), inclusive para o admin. Moderar é tirar o que não cabe, não
reescrever o que o colega assinou com o nome dele em cima.

## Modelo de dados (Prisma)

```prisma
enum CelebrationKind { BIRTH  WORK }

model BirthdayGreeting {
  id             String          @id @default(cuid())
  targetId       String
  authorId       String
  kind           CelebrationKind
  occurrenceYear Int
  message        String
  companyId      String          @default("company-emr")
  @@unique([companyId, targetId, kind, occurrenceYear, authorId])
}

model BirthdayGreetingReaction { … @@unique([greetingId, userId, emoji]) }
```

Os dois entram em `TENANT_SCOPED_MODELS`. `NotificationType` ganha
`BIRTHDAY_GREETING_RECEIVED`.

## Contrato (`packages/shared`)

`birthday-greeting.ts` — `CelebrationKind`, `GREETING_SUGGESTIONS` (as frases
prontas, por tipo), `GREETING_MAX_LENGTH` (280), a janela,
`BirthdayWallOccurrenceDTO`, `BirthdayGreetingDTO`, `BirthdayWallResponse`,
`canSignBirthdayWall` e `celebrationWhenLabel`.

`UpcomingOccurrence` (celebration.ts) ganha `greetingCount`.

## Backend

- `birthday-greeting-service`: `occurrencesFor` (a aritmética dos murais),
  `getWall`, `signWall`, `updateGreeting`, `removeGreeting`, `toggleReaction`,
  `countGreetingsForToday`.
- Rotas: `GET/POST /users/:id/birthday-wall`,
  `PATCH/DELETE /birthday-greetings/:id`,
  `POST /birthday-greetings/:id/reactions`.
- Notificação na **primeira** assinatura (corrigir a própria frase não é
  notícia nova), best-effort como a avaliação de selo pós-voto.

## Frontend

- `BirthdayWallCard` no perfil, acima do "Deixar feedback". **Some sozinho**
  quando a pessoa não tem mural nenhum — um card de aniversário vazio 11 meses
  por ano é ruído.
- `CongratsDialog` (o 🎉 do card da Home e da tela de aniversariantes) virou
  casca em volta do mesmo `BirthdayWallCard`: dar parabéns sem sair da Home
  continua funcionando, agora no mural.
- `BirthdaysCard` mostra "3 pessoas já assinaram o mural" — só de quem comemora
  HOJE, porque é o único dia em que o número diz alguma coisa. Num aniversário
  de daqui a 12 dias, zero é o normal e pareceria abandono.

## O que a implementação acrescentou ao desenho

- **`greetingCount` só para hoje**, no servidor (`fillGreetingCounts`): contar
  as três datas próximas inteiras seria um groupBy por página de Home para
  mostrar zero.
- **As frases prontas são rascunho**: clicar preenche o campo e o texto
  continua editável. Botão que envia direto transformaria o mural em cinco
  "Parabéns!" idênticos.
- **`lib/celebration-date.ts`**, extraído do `celebration-service`: a regra de
  29/02 e a aritmética de ocorrência passaram a ter um dono só.

## Fora de escopo

Mural fora do perfil (uma página `/mural-de-aniversarios` própria), comentário
em assinatura, mural de outras datas (casamento, filho) e qualquer mudança no
fluxo de feedback — que continua inteiro, inclusive o ❤️ do card.
