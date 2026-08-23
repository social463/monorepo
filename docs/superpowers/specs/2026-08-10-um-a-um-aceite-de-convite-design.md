# 1:1 — aceite de convite e contraproposta de horário

## Problema

Marcar um 1:1 hoje é fato consumado. Quem marca escolhe data e hora, e o encontro
nasce na agenda das duas pessoas; o outro lado só descobre pela notificação, e não
tem como responder. Se não puder no horário — está de férias, tem outro compromisso,
aquele dia da semana simplesmente não funciona — a única saída pela interface é
remarcar por conta própria o encontro que a outra pessoa marcou, ou cancelar. Nenhuma
das duas diz "não posso nesse horário, mas posso às 14:30".

O resultado prático é 1:1 que ninguém cancela e ninguém comparece — e que continua
gerando lembrete, pauta em branco e ação pendente.

## Entrega

O convidado responde ao convite: **aceita** ou **recusa**, e ao recusar pode
**sugerir outro horário**. Quem marcou vê a resposta e, se houver sugestão, aceita
com um clique — só naquele encontro ou movendo a série junto.

Três decisões moldam o resto:

- **Só o convidado responde.** Quem marcou já disse que quer; um "aceitar" para ele
  seria clique burocrático. O pendente aparece só de um lado.
- **A resposta é da SÉRIE; a ocorrência apenas sobrescreve.** É o que impede uma
  série semanal de virar 52 pendências (ver *Modelo de dados*).
- **Recusar não cancela.** O encontro fica na agenda, marcado como recusado, e quem
  marcou decide. Cancelar automaticamente jogaria fora a pauta já escrita e tiraria
  das duas pessoas a chance de negociar o horário — que é justamente o que faltava.

## Modelo de dados

Nada de model novo: colunas em `OneOnOneSeries` e `OneOnOneMeeting`.

A resposta **não cabe no `status`** do encontro. `SCHEDULED | DONE | CANCELED` é o
estado do encontro para os dois; aceite é de **uma pessoa**. Misturar os dois criaria
estados sem sentido ("recusado e realizado") e quebraria toda consulta que hoje filtra
por `status`.

### A resposta mora na série

```
OneOnOneSeries.inviteeResponse    PENDING | ACCEPTED | DECLINED   ← a resposta
OneOnOneMeeting.inviteeResponse   nullable                        ← exceção daquela ocorrência

resposta efetiva = override da ocorrência ?? resposta da série
```

Uma linha responde pela série inteira. A coluna da ocorrência só é preenchida quando a
pessoa diz algo **diferente** para aquele encontro — "aceito a série, mas na semana do
dia 20 não consigo".

Pôr a resposta em cada ocorrência, como um convite de calendário faria, criaria 52
pendências para uma série semanal de um ano. A alternativa seria escondê-las na tela
(mostrar só a próxima), mas isso é paliativo de UI sobre um modelo errado: a pendência
continuaria existindo em 52 linhas, e qualquer consulta nova teria de reimplementar o
mesmo esconde-esconde.

| Coluna | Onde | Para quê |
|---|---|---|
| `inviteeResponse` | série | A resposta que vale por padrão (default `PENDING`) |
| `inviteeRespondedAt` | série | Quando respondeu |
| `inviteeResponse` | encontro | Exceção daquela ocorrência; `null` = segue a série |
| `inviteeRespondedAt` | encontro | Quando respondeu a exceção |
| `proposedStartsAt` | encontro | A contraproposta de horário, quando a recusa vem com uma |
| `declineNote` | encontro | Motivo em texto livre, opcional (teto de 200) |

A contraproposta e o motivo são **sempre da ocorrência**, mesmo quando a recusa vale
para a série: o que se propõe é um horário concreto, e horário é de um encontro.

Quem é o convidado sai do que já existe: `OneOnOneSeries.createdById` diz quem marcou,
e o convidado é o outro do par. Não há coluna nova para isso.

## Máquina de estados

```
                    ┌──────────────────────────────────────────┐
                    │                                          │
  cria série        ▼                recusa                    │
  ──────────►  PENDING  ──────────────────────────►  DECLINED  │
                    │                                     │    │
                    │ aceita                              │    │ remarcar
                    ▼                                     │    │ (qualquer lado)
               ACCEPTED  ◄─────────────────────────────────┘   │
                    │        criador aceita a contraproposta   │
                    └──────────────────────────────────────────┘
```

Três transições e uma regra que amarra tudo:

1. **Responder** (só o convidado): `PENDING → ACCEPTED | DECLINED`, com escopo.
   Recusar pode carregar `proposedStartsAt` e `declineNote`.
2. **Aceitar a contraproposta** (só quem marcou): remarca o encontro para
   `proposedStartsAt` e grava `ACCEPTED` — quem propôs o horário já concordou com ele;
   pedir um aceite depois seria pedir duas vezes a mesma coisa.
3. **Remarcar volta para `PENDING`.** Horário novo, aceite novo — mesma regra que já
   vale para `remindedAt`. A exceção é a transição 2, que é remarcar *para* o horário
   que o convidado propôs.

### O escopo, e o padrão de cada ação

Escopo `this` (só esta ocorrência) ou `future` (esta e as seguintes) — o mesmo
vocabulário que remarcar e cancelar já usam, sem inventar um terceiro conceito.

- `future` grava na **série** e limpa os overrides das ocorrências à frente.
- `this` grava só o **override** daquela ocorrência.
- A ação mais recente vence: responder com `future` apaga as exceções que estavam
  adiante.

**O padrão muda conforme a ação**, e isso é deliberado:

| Ação | Padrão | Por quê |
|---|---|---|
| Aceitar | `future` | Quem topa o ritual topa o ritmo. Exigir 52 cliques para dizer sim é a fricção que a feature existe para remover. |
| Recusar | `this` | O caso comum é uma semana específica, não o fim do ritual. |

Note que isso é o **oposto** do padrão de cancelar, onde o conservador é `this` nos
dois casos. Conservador aqui não é "mexer no mínimo", é "não obrigar a repetir".

### A contraproposta também tem escopo

Quando o convidado sugere mover a terça das 10:30 para quinta às 14:30, quem marcou
tem duas saídas:

- **Aceitar só neste** — remarca aquela ocorrência.
- **Aceitar e mover a série** — aplica o **mesmo deslocamento** às seguintes, e a
  série quinzenal de terça vira quinzenal de quinta.

A segunda não precisa de máquina nova: `rescheduleMeeting` com escopo `future` já
desloca todas as ocorrências pelo mesmo intervalo, preservando o espaçamento. É o que
resolve numa rodada só o caso que mais geraria ida e volta — "esse dia da semana não
funciona para mim" —, em vez de obrigar o convidado a recusar 26 ocorrências uma a uma
ou a explicar em texto livre e torcer.

## Efeitos no que já existe

- **Lembrete de 10 minutos** não sai para encontro com resposta efetiva `DECLINED`.
  Avisar sobre um encontro que uma das pontas recusou é ruído — e avisar só o outro
  lado seria pior.
- **Lista e detalhe** ganham o estado: "Aguardando resposta" para quem marcou,
  "Responder" para o convidado, e "Recusado" com a sugestão quando houver.
- **Selo de pauta** (`Sem pauta` / `Pauta pronta`) some enquanto o convite está
  pendente: preparar pauta de encontro que talvez não aconteça é a ordem errada.
- **Cancelar e remarcar** continuam disponíveis para os dois lados, como hoje.

## API

| Rota | O quê |
|---|---|
| `POST /one-on-ones/:id/response?scope=this\|future` | Convidado aceita ou recusa; corpo leva `response`, e opcionalmente `proposedStartsAt` e `declineNote` |
| `POST /one-on-ones/:id/proposal/accept?scope=this\|future` | Quem marcou aceita a contraproposta: remarca (com escopo) e marca `ACCEPTED` |
| `POST /one-on-ones/:id/proposal/decline` | Quem marcou descarta a sugestão; volta a `PENDING` sem mexer no horário |

Terceiro que não é do par continua levando 404 em todas — a regra de visibilidade do
1:1 não muda.

## Notificações

Três tipos novos, in-app **e** no Teams (diferente do lembrete de 10 minutos, que é
in-app por ser momentâneo — estas são acionáveis e podem esperar):

- `ONE_ON_ONE_RESPONDED` — para quem marcou, quando o convidado responde. O título
  carrega a sugestão, quando existe: "Bruno não pode às 10:30 e sugeriu 14:30".
- `ONE_ON_ONE_PROPOSAL_ACCEPTED` — para o convidado, quando a sugestão dele é aceita.
- `ONE_ON_ONE_PROPOSAL_DECLINED` — para o convidado, quando não é.

## Riscos e o que fica de fora

- **Ping-pong de contrapropostas fica de fora.** O convidado sugere, quem marcou
  aceita (só neste ou movendo a série) ou descarta. Se a sugestão não serve, quem
  marcou remarca por conta própria e o convite volta a `PENDING` — uma rodada, não uma
  negociação aberta. Contraproposta da contraproposta é conversa, e conversa tem lugar
  melhor que um formulário.
- **Não há prazo de resposta.** Convite sem resposta continua valendo e o encontro
  acontece — a ausência de resposta não é recusa.
- **Ninguém é obrigado a responder.** Não há bloqueio de pauta nem de ação por causa
  de convite pendente; o estado é informativo, não um portão.
