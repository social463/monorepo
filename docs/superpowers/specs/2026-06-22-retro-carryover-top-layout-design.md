# Design — Carry-over fixo no topo do quadrante "Ações" + arrastar as ações da sala

Data: 2026-06-22
Branch: `feat/retro-board`
Depende de: `2026-06-22-retro-carryover-cards-design.md` (implementado).

## Problema

Os cards de carry-over (vencida / a validar) hoje são posicionados **abaixo** das ações da
própria sala (`startRow = ceil(ownAções/4) + 1`), então "ficam pra baixo" e, sendo um overlay,
podem **cobrir** os cards da sala e **bloquear o arraste** deles.

Queremos: carry-over **fixo no topo** da região "Ações" (não arrastável); as ações da **própria
sala** abaixo dele e **arrastáveis** (em sala aberta), sem o overlay bloquear.

## Decisões tomadas

- **Carry-over fixo no topo**: renderizado numa faixa no topo da região "Ações", read-only,
  não arrastável, sempre lá. Não tem posição persistida (é referência calculada).
- **Ações da própria sala abaixo da faixa**: os card-espelho criados nesta sala nascem **abaixo**
  de uma faixa reservada no topo, para não surgirem sobrepostos ao carry-over.
- **Arrastar "o resto"**: os cards de ação da própria sala já arrastam em sala **aberta**; com o
  carry-over numa faixa separada (não sobreposto), o arraste deixa de ser bloqueado. Sem código
  novo de arraste. Carry-over continua não-arrastável.
- **Escopo**: sala **aberta** (onde o carry-over aparece). Arrastar em sala **concluída** segue
  travado (fora deste escopo).
- Sem migração; sem mudança de contrato.

## Frontend (`apps/web/src/pages/RetroRoomPage.tsx`)

- No bloco que renderiza os cards de carry-over na região "Ações": **remover** o `startRow`
  baseado em `ownInActions` e posicionar a partir do topo:
  - `x = actionsRegion.x + 40 + (i % 4) * 240`
  - `y = actionsRegion.y + 80 + Math.floor(i / 4) * 240`
  Ordem mantida: `[...overdue, ...toValidate]`.
- Nenhuma mudança no `room.cards.map` (os cards reais seguem com drag/hit-test pelas próprias
  coordenadas). O arraste das ações próprias em sala aberta permanece como está.

## Backend (`apps/api/src/services/retro-service.ts` — `upsertActionCard`)

- Ao **criar** um novo card-espelho na região "Ações", reservar uma faixa no topo para o carry-over:
  - hoje: `y = actions.y + 80 + Math.floor(actionCount / 4) * 220`
  - novo: `y = actions.y + 80 + RESERVED_TOP + Math.floor(actionCount / 4) * 220`, com
    `RESERVED_TOP = 2 * 240` (≈ 2 linhas de carry-over).
  - `x` inalterado.
- Espelhos já existentes mantêm posição (o usuário reposiciona arrastando). Se o carry-over passar
  de ~8 itens (2 linhas), pode haver leve sobreposição — aceitável (o usuário arrasta).

## Testes

- **Web** (`RetroRoomPage.test.tsx`): com carry-over presente, o card renderiza numa posição de
  topo (ex.: `top` ≤ `actionsRegion.y + 80 + 240` no estilo do wrapper), acima da faixa reservada.
- **API** (`retro-card-service.test.ts` ou onde o `upsertActionCard` é exercido): ao criar um
  action card, o espelho gerado tem `y >= actions.y + 80 + RESERVED_TOP` (nasce abaixo da faixa).

## Fora de escopo (YAGNI)

- Persistir posição dos cards de carry-over (são referências; ficam fixos no topo).
- Arrastar em sala concluída.
- Reserva dinâmica exata pela contagem de carry-over (faixa fixa de 2 linhas basta).
