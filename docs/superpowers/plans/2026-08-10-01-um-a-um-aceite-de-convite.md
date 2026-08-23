# Plan — 1:1: aceite de convite e contraproposta

Spec: [2026-08-10-um-a-um-aceite-de-convite-design.md](../specs/2026-08-10-um-a-um-aceite-de-convite-design.md)

Depende de `feat/1-1-lembrete-10min` (!10789): o lembrete de 10 minutos é o que
passa a ignorar encontro recusado, e ele não existe na `main` ainda.

## Tarefas

1. **Schema e migration** — enum `OneOnOneInviteResponse`; `inviteeResponse` +
   `inviteeRespondedAt` na série e (nulável) na ocorrência; `proposedStartsAt` e
   `declineNote` na ocorrência; três tipos de notificação. Migration escrita à mão
   (o `.env` de dev aponta para HML, e `migrate dev` propõe reset em banco
   compartilhado). Séries que já existem entram como `ACCEPTED` — tratá-las como
   pendentes encheria a tela de convite a responder para encontro combinado meses
   atrás. ✅
2. **Contrato** — `ONE_ON_ONE_INVITE_RESPONSES`, `ONE_ON_ONE_DECLINE_NOTE_MAX_LENGTH`,
   `RespondToOneOnOneRequest`, e os quatro campos novos no `OneOnOneMeetingSummaryDTO`
   (`inviteeResponse` já **efetivo**, `viewerIsInvitee`, `proposedStartsAt`,
   `declineNote`). ✅
3. **`effectiveInviteResponse`** no serialize — override da ocorrência ?? resposta da
   série. Uma função só: serialize e scheduler leem a mesma regra. ✅
4. **Service** — `respondToInvite`, `acceptProposal`, `declineProposal` e o helper
   `aplicarResposta` (que decide entre gravar na série ou no override). Remarcar
   devolve a `PENDING`, e a chamada precisa vir **antes** do deslocamento: o recorte
   "esta e as seguintes" é definido pelos horários atuais. ✅
5. **Rotas** — `POST /response`, `/proposal/accept`, `/proposal/decline`. ✅
6. **Notificações** — `ONE_ON_ONE_RESPONDED` (com a sugestão no título),
   `ONE_ON_ONE_PROPOSAL_ACCEPTED`, `ONE_ON_ONE_PROPOSAL_DECLINED`. ✅
7. **Lembrete** — ignora encontro com resposta efetiva `DECLINED`. ✅
8. **Front** — `InvitePanel` no topo do detalhe (dois donos, nunca ao mesmo tempo);
   selos na lista; o selo de pauta some enquanto o convite está pendente. ✅
9. **Testes** — 15 de service, 4 de rota (com o convidado autenticado), 2 de
   scheduler, 11 do painel. ✅

## Fora de escopo

Ping-pong de contrapropostas, prazo de resposta e bloqueio de pauta por convite
pendente — os três justificados no spec.
