# Mesa 3×2 com sala de chamada própria

**Data:** 2026-07-28
**Status:** proposto

## Contexto

No editor de mapas do admin, a ferramenta **Mesa** cria um objeto `desk` por
gesto de retângulo livre: um clique simples produz uma mesa de 1×1 tile, e cada
mesa sai de um tamanho diferente. A mesa também nasce solta — nada garante que
exista uma sala de chamada (`meeting-room`) sobre ela.

Essa associação mesa↔sala, porém, já é significativa no runtime:
`claimedDeskInMeetingRoom` (`packages/shared/src/office-map-runtime.ts`) dá ao
dono da mesa o controle exclusivo do cadeado da sala que a contém. Hoje isso só
funciona quando o admin lembra de desenhar a sala manualmente por cima.

O nome exibido da mesa já é derivado em runtime: o rótulo no canvas mostra o
nome do dono quando ela está reivindicada (`OfficeScene`), voltando ao nome
próprio quando liberada. O nome da sala, ao contrário, vem cru do documento — o
rótulo verde da zona no mapa e o "Você está em: X" da MediaBar mostram sempre
`zone.properties.name`.

## Objetivo

1. Toda mesa nova tem o mesmo tamanho: **3 tiles de largura × 2 de altura**.
2. Toda mesa nova nasce com uma **sala de chamada própria**, na mesma área.
3. Quando a mesa é reivindicada, o nome exibido dessa sala vira **"Mesa de
   \<nome\>"**, no mesmo modelo derivado que o rótulo da mesa já usa.

## Fora de escopo

- **Mesas já publicadas** (1 tile, muitas sem sala) ficam como estão. Não há
  migração nem normalização ao abrir o editor: mexer em mapas em uso arriscaria
  colidir com salas já desenhadas, e a validação proíbe salas sobrepostas.
- **Vínculo permanente entre mesa e sala.** Elas nascem juntas e, a partir daí,
  são dois objetos comuns do documento — mover, duplicar ou apagar um não afeta
  o outro.

## Desenho

### 1. Tamanho fixo da mesa

`OFFICE_DESK_SIZE_TILES = { width: 3, height: 2 }` passa a viver em
`@legends/shared`, junto do contrato do mapa — é o mesmo número usado pelo editor
e pelos testes.

No `MapCanvas`, o gesto de retângulo da ferramenta `desk` deixa de dimensionar: o
retângulo resultante é sempre 3×2 tiles ancorado na célula inicial do gesto,
clampado às bordas do mapa. Arrastar apenas reposiciona a âncora, e o preview do
rascunho mostra o mesmo footprint fixo que será criado. Colisão, zona privada e
sala de reunião mantêm o gesto livre de hoje.

A descrição da ferramenta no painel passa a dizer o tamanho, para o admin não
tentar arrastar esperando redimensionar.

### 2. Sala de chamada junto com a mesa

Criar uma mesa insere **dois** objetos no documento:

- o `desk` na layer `desks`, com `externalKey: desk-<token>` e nome "Nova mesa";
- um `meeting-room` na layer `meeting-rooms` com a **mesma geometria**,
  `externalKey: room-<token>`, nome igual ao da mesa, `status: OPEN`,
  `voiceEnabled: true`, `accessPolicy: OPEN` e sem `capacity` (campo opcional —
  não há número natural para uma sala de mesa individual).

A seleção após a criação continua sendo a mesa: é o objeto que o admin renomeia.

**Guarda de sobreposição.** A validação do documento rejeita salas de reunião
sobrepostas (`MEETING_ROOM_OVERLAP`), o que quebraria a publicação. Quando o
footprint 3×2 da nova mesa intersecta uma sala de reunião já existente, o editor
cria **apenas a mesa**: ela já está dentro de uma sala de chamada, e uma segunda
sala ali seria inválida. Mesas vizinhas encostadas continuam válidas — a
checagem de sobreposição usa comparação estrita, então bordas coladas não
conflitam.

A geometria e a decisão de quais objetos inserir ficam num módulo puro
(`apps/web/src/office/editor/deskPlacement.ts`), testável sem Phaser;
`MapCanvas.tsx` apenas chama a função e faz o commit no documento.

### 3. Nome derivado da sala

Nada é persistido: o nome real da sala no documento e no banco continua o que o
admin escreveu — o admin segue vendo e editando esse nome. O que muda é o **nome
exibido** no escritório, derivado da ocupação, exatamente como o rótulo da mesa
já funciona hoje. Ao liberar a mesa, o nome volta sozinho ao da sala; nenhuma
republicação é necessária.

Helpers novos em `@legends/shared`, ao lado de `claimedDeskInMeetingRoom`:

- `deskRoomDisplayName(ownerName)` → `` `Mesa de ${ownerName}` ``. O texto casa
  com o que o `DeskHoverCard` já exibe ("Mesa de Fulano").
- `meetingRoomForDeskKey(document, deskExternalKey)` → a sala cujo polígono ou
  retângulo contém o centro daquela mesa, ou `null`. Mesma regra geométrica de
  `claimedDeskInMeetingRoom`, invertida.
- `officeZoneDisplayName(document, desks, zone)` → nome a exibir para uma zona:
  `Mesa de <nome>` quando a zona é uma sala de reunião que contém uma mesa
  reivindicada, senão `zone.properties.name`. Zonas privadas caem sempre no nome
  próprio.

Consumidores:

- `OfficePage` (`zoneName`) — a MediaBar passa a mostrar "Você está em: Mesa de
  Fulano".
- `OfficeScene` — o rótulo verde da zona no mapa, atualizado **ao vivo** nos
  eventos WebSocket `desk-claimed` / `desk-released`, no mesmo caminho em que o
  rótulo da mesa já é atualizado (`setDeskClaim`).

## Testes

- `@legends/shared`: `meetingRoomForDeskKey` (dentro/fora, retângulo e polígono,
  mesa sem sala) e `officeZoneDisplayName` (sala com mesa reivindicada, sala com
  mesa livre, sala sem mesa, zona privada).
- `deskPlacement`: tamanho sempre 3×2; âncora clampada nas quatro bordas; par
  mesa+sala com geometrias idênticas e chaves distintas; só a mesa quando há
  sobreposição com sala existente; mesas encostadas não disparam a guarda.
- `OfficeScene`/`OfficePage`: nome exibido da zona muda ao reivindicar e volta ao
  liberar.

## Critérios de aceite

- Criar uma mesa no editor produz sempre um retângulo de 3×2 tiles, mesmo com
  clique simples ou arrasto longo.
- A mesma ação cria uma sala de chamada cobrindo exatamente a mesa — exceto se o
  local já estiver dentro de outra sala de reunião, quando só a mesa é criada.
- O documento resultante publica sem erro de validação.
- Ao reivindicar a mesa, o rótulo da sala no mapa e o texto da MediaBar passam a
  mostrar "Mesa de \<nome\>", ao vivo, sem recarregar.
- Ao liberar a mesa, os dois voltam ao nome próprio da sala.
- O nome da sala no editor do admin e no banco permanece inalterado.
