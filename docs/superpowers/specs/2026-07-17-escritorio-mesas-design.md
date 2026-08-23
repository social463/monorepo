# Mesas reivindicáveis no escritório virtual

**Data:** 2026-07-17
**Status:** proposto

## Objetivo

Permitir que o administrador defina espaços de mesa no mapa do escritório
(via editor visual existente) e que cada colaborador reivindique uma mesa
livre como "sua", trocando de mesa quando quiser. Sem sprites de mobília
customizáveis, sem "sentar" o personagem, sem controle de acesso por mesa —
apenas identidade e propriedade de um objeto do mapa. Personalização visual
(computador, cadeira, acessórios, troca de mesa) fica para uma etapa futura.

## Regras de negócio

- Uma mesa pertence a no máximo um usuário; um usuário ocupa no máximo uma
  mesa.
- Para trocar de mesa, o usuário precisa abandonar a atual antes de
  reivindicar outra (sem troca implícita/automática).
- A ocupação é permanente até ser liberada — não depende de presença/online
  do usuário — e fica sempre visível a todos no mapa (nome de quem ocupa),
  mesmo se a pessoa estiver offline.
- Administrador pode liberar a mesa de qualquer usuário (ex.: colaborador que
  saiu da empresa).
- Reivindicar/liberar é uma ação de clique na mesa no mapa (como no Gather),
  não posicional nem por painel/lista.

## Modelo de dados

### Documento do mapa (`@legends/shared`, `office-map.ts`)

Novo tipo de objeto `desk`, com geometria de ponto (mesa é um único tile, não
uma área), seguindo o mesmo padrão de `spawn-point`:

```ts
DeskObjectV1Schema: {
  ...ObjectBaseShape,
  type: "desk",
  geometry: PointGeometryV1Schema,
  properties: { externalKey: MapIdentifierSchema, name: HumanNameSchema },
}
```

Nova camada reservada `desks` (`type: "object"`), adicionada a
`RESERVED_MAP_LAYERS` e ao mapa `objectTypeToLayerKey`. `desk` entra no
discriminated union `MapObjectV1Schema`.

Ao contrário de `meeting-room`, mesa não tem `status`/`accessPolicy`/
`capacity`/`voiceEnabled` — não há controle de acesso, só ocupação exclusiva.

### Prisma (`apps/api/prisma/schema.prisma`)

Dois models novos, espelhando o par `OfficeRoom`/`OfficeRoomAccessGrant`:

```prisma
model OfficeDesk {
  id               String   @id @default(cuid())
  mapPublicationId String
  name             String
  externalKey      String
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  mapPublication OfficeMapPublication @relation(fields: [mapPublicationId], references: [id], onDelete: Cascade)
  claim          OfficeDeskClaim?

  @@unique([mapPublicationId, externalKey])
  @@index([mapPublicationId])
}

model OfficeDeskClaim {
  deskId    String   @id
  userId    String   @unique
  createdAt DateTime @default(now())

  desk OfficeDesk @relation(fields: [deskId], references: [id], onDelete: Cascade)
  user User       @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

`deskId` como chave primária de `OfficeDeskClaim` garante no máximo um claim
por mesa; `userId @unique` garante no máximo uma mesa por usuário — as duas
invariantes de negócio ficam garantidas pelo banco, não só por lógica de
service.

### Publicação do mapa

`publishOfficeMap` (`apps/api/src/services/office-map-service.ts`) passa a
tratar objetos `desk` como já trata `meeting-room`: dentro da mesma
transação, para cada objeto `desk` do documento cria um `OfficeDesk` na nova
`OfficeMapPublication`; se existia mesa de mesmo `externalKey` na publicação
anterior **e ela tinha claim**, o claim é recriado apontando para a nova
mesa. Isso evita que republicar o mapa (para uma mudança não relacionada)
libere todas as mesas ocupadas. Remover uma mesa do editor simplesmente não a
recria na nova publicação; o claim dela é removido em cascata.

## API

Novo service `apps/api/src/services/office-desk-service.ts` com erro de
domínio tipado `DeskError` (padrão `VoteError`, com `status` HTTP).

- `GET /office/map` (já existe) — passa a incluir `desks` na resposta:
  `{ id, externalKey, name, claimedBy: PublicUser | null }[]`.
- `POST /office/desks/:id/claim` — autenticado. 404 se a mesa não existe na
  publicação ativa, 409 se já está ocupada ou se o usuário já tem outra mesa.
- `POST /office/desks/:id/release` — autenticado; 403 se quem chama não é o
  dono.
- `GET /admin/office-desks` — admin-only, lista mesas da publicação ativa
  com ocupante (se houver).
- `DELETE /admin/office-desks/:id/claim` — admin-only, libera a mesa de
  qualquer usuário.

Contratos DTO (`DeskDTO`, request/response de claim/release) entram em
`@legends/shared`, ao lado de `RoomDTO`/`office.ts`.

## Tempo real

Hoje não existe broadcast dedicado para mudança de sala (só `map-changed`
geral ao trocar publicação). Para mesa, dois eventos novos em
`OfficeServerMessage` (`packages/shared/src/office.ts`):

- `desk-claimed: { deskId, user: PublicUser }`
- `desk-released: { deskId }`

Emitidos pelo `office-hub` (`apps/api/src/lib/office-hub.ts`) via `broadcast`
logo após o service persistir o claim/release, para que o indicador de
ocupação atualize em todos os clients conectados sem precisar de refresh ou
esperar o próximo movimento.

## Frontend

- **Editor de mapa** (`MapEditor.tsx`/`MapCanvas.tsx`): nova ferramenta
  "Mesa" na toolbar de objetos, mesmo fluxo de colocar um `spawn-point`
  (clique no canvas, formulário de nome/`externalKey`).
- **OfficeScene**: hoje só personagens respondem a clique
  (`useOfficeInteractions`, `emitCharacterClick`). Adiciona hit-test nos
  objetos `desk` renderizados na cena, abrindo um painel de ação contextual:
  - mesa livre → "Reivindicar mesa"
  - mesa própria → "Sua mesa — Abandonar"
  - mesa de outro usuário → nome de quem ocupa, sem ação
- **Indicador visual**: nome (ou inicial) sobre a mesa ocupada, renderizado a
  partir de `claimedBy` do snapshot (`GET /office/map`) e atualizado ao vivo
  pelos eventos `desk-claimed`/`desk-released`. Independe de o ocupante estar
  online.
- **Admin**: nova aba/lista simples (padrão de `/admin/office-rooms`) para
  visualizar mesas e liberar a de qualquer usuário.

## Fora de escopo

Sprites de mobília (computador, cadeira, acessórios), troca de aparência da
mesa, "sentar" o personagem na mesa (claim é só associação lógica, não afeta
posição/movimento), controle de acesso por mesa, notificação/histórico de
quem já ocupou uma mesa.
