# Mesas reivindicáveis no escritório virtual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o admin defina espaços de mesa no editor de mapa do escritório e que cada colaborador reivindique/abandone uma mesa clicando nela, com no máximo uma mesa por usuário.

**Architecture:** Segue à risca o padrão já existente para `meeting-room`/`OfficeRoom`: um novo tipo de objeto `desk` no `MapDocumentV1` (schema Zod em `@legends/shared`), materializado em `OfficeDesk` (Prisma) a cada publicação do mapa, com o claim guardado em `OfficeDeskClaim` (1:1 mesa↔usuário, garantido pelo schema). Claim/release são endpoints HTTP simples (não passam pelo WebSocket de movimento); o hub de escritório (`office-hub.ts`) faz o broadcast do evento para todo mundo atualizar a UI ao vivo. No client, a mesa é clicável na cena Phaser do mesmo jeito que um personagem (`setInteractive` + `pointerdown`), abrindo um pequeno painel de ação em React.

**Tech Stack:** TypeScript ESM, Zod (contrato `@legends/shared`), Fastify 4 + Prisma 5 + PostgreSQL (`apps/api`), Vite + React 18 + Phaser 3 + TanStack Query (`apps/web`), Vitest.

## Global Constraints

- Mensagens ao usuário em português.
- Rotas finas: lógica de negócio nos services (`apps/api/src/services/office-map-service.ts`), DTO em `@legends/shared`, sem lógica de negócio nas rotas.
- Contrato de tipos primeiro em `@legends/shared`, depois os dois lados (`apps/api`, `apps/web`).
- `pnpm db:up` precisa estar de pé para os testes da API (banco real, truncado a cada teste).
- Nunca editar uma migration já aplicada — gerar uma nova com `pnpm db:migrate`.
- Não misturar camadas: mesa não afeta posição/movimento do personagem (claim é só associação lógica).
- Fora de escopo (não implementar aqui): sprites de mobília, "sentar" o personagem, controle de acesso por mesa.

---

### Task 1: Schema do documento do mapa — tipo de objeto `desk`

**Files:**
- Modify: `packages/shared/src/office-map.ts`
- Test: `packages/shared/src/office-map.test.ts`

**Interfaces:**
- Produces: `DeskObjectV1Schema` (Zod), `type DeskObjectV1`, `"desk"` como membro de `MapObjectV1["type"]`, layer reservada `"desks"` em `RESERVED_MAP_LAYERS`/`ReservedMapLayerKey`.

- [ ] **Step 1: Escrever o teste que falha — objeto `desk` válido, layer, e duplicidade de `externalKey`**

Adicione ao final do arquivo de teste (junto aos outros `describe`/`it` que testam `meeting-room`), reaproveitando o helper `room(...)` já existente no arquivo como referência de estilo:

```ts
function desk(id: string, externalKey: string, x: number, y: number): DeskObjectV1 {
  return {
    id,
    layerKey: "desks",
    type: "desk",
    geometry: { kind: "point", x, y },
    properties: { externalKey, name: `Mesa ${externalKey}` },
  };
}

describe("objeto desk", () => {
  it("aceita um objeto desk válido na layer 'desks'", () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 });
    document.objects.push(desk("desk-1", "mesa-1", 64, 64));
    expect(validateMapDocumentV1(document)).toMatchObject({ valid: true });
  });

  it("rejeita duas mesas com a mesma externalKey", () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 });
    document.objects.push(desk("desk-1", "mesa-1", 64, 64));
    document.objects.push(desk("desk-2", "mesa-1", 96, 64));
    const result = validateMapDocumentV1(document);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: MAP_VALIDATION_CODES.duplicateExternalKey }),
    );
  });

  it("rejeita objeto desk na layer errada", () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 });
    const invalid = desk("desk-1", "mesa-1", 64, 64);
    invalid.layerKey = "interactive-objects";
    document.objects.push(invalid);
    const result = validateMapDocumentV1(document);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: MAP_VALIDATION_CODES.objectLayerMismatch }),
    );
  });
});
```

Import `DeskObjectV1` e `MAP_VALIDATION_CODES` no topo do arquivo de teste (adicione aos imports já existentes de `./office-map`).

Também ajuste o teste existente que fixa a contagem de layers (linha ~85 hoje): `expect(document.layers).toHaveLength(8)` deve virar `toHaveLength(9)`, já que `RESERVED_MAP_LAYERS` vai ganhar uma entrada nova.

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/shared test -- office-map.test.ts`
Expected: FAIL — `DeskObjectV1` não existe, `"desk"` não é membro de `MapObjectV1`, layer `desks` não existe (8 ≠ 9 no teste de contagem).

- [ ] **Step 3: Implementar o schema**

Em `packages/shared/src/office-map.ts`:

1. Adicione uma entrada em `RESERVED_MAP_LAYERS` (linhas 31-60), entre `meeting-rooms` e `interactive-objects`:

```ts
  {
    key: "meeting-rooms",
    name: "Salas de reunião",
    type: "object",
    zIndex: 130,
  },
  {
    key: "desks",
    name: "Mesas",
    type: "object",
    zIndex: 135,
  },
  {
    key: "interactive-objects",
    name: "Objetos interativos",
    type: "object",
    zIndex: 140,
  },
```

2. Logo após `MeetingRoomObjectV1Schema` (linha ~272), adicione:

```ts
export const DeskObjectV1Schema = z
  .object({
    ...ObjectBaseShape,
    type: z.literal("desk"),
    geometry: PointGeometryV1Schema,
    properties: z
      .object({
        externalKey: MapIdentifierSchema,
        name: HumanNameSchema,
      })
      .strict(),
  })
  .strict();
```

3. No union `MapObjectV1Schema` (linhas 343-352), adicione `DeskObjectV1Schema`:

```ts
export const MapObjectV1Schema = z.discriminatedUnion("type", [
  SpawnPointObjectV1Schema,
  CollisionObjectV1Schema,
  PrivateZoneObjectV1Schema,
  MeetingRoomObjectV1Schema,
  DeskObjectV1Schema,
  DoorObjectV1Schema,
  LinkObjectV1Schema,
  ActionPointObjectV1Schema,
  TileObjectV1Schema,
]);
```

4. No `OBJECT_LAYER_BY_TYPE` (linhas 446-457), adicione `"desk": "desks"`:

```ts
const OBJECT_LAYER_BY_TYPE: Record<
  Exclude<MapObjectV1["type"], "tile-object">,
  ReservedMapLayerKey
> = {
  "spawn-point": "spawn-points",
  collision: "collision",
  "private-zone": "private-zones",
  "meeting-room": "meeting-rooms",
  desk: "desks",
  door: "interactive-objects",
  link: "interactive-objects",
  "action-point": "interactive-objects",
};
```

5. Junto ao `export type MeetingRoomObjectV1 = ...` (linha ~379), adicione:

```ts
export type DeskObjectV1 = z.infer<typeof DeskObjectV1Schema>;
```

6. Na função de validação semântica, no bloco que registra `externalKey` para checar duplicidade (linhas ~1027-1034), adicione o branch de `desk`:

```ts
    let externalKey: string | undefined;
    if (object.type === "meeting-room") {
      externalKey = object.properties.externalKey;
      meetingRoomKeys.add(externalKey);
      meetingRooms.push({ object, index });
    } else if (object.type === "private-zone") {
      externalKey = object.properties.externalKey;
    } else if (object.type === "desk") {
      externalKey = object.properties.externalKey;
    }
```

7. Ajuste o teste de contagem de layers pré-existente (linha ~85 do `.test.ts`) para `toHaveLength(9)` (já incluído no Step 1).

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/shared test -- office-map.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck do pacote**

Run: `pnpm --filter @legends/shared exec tsc --noEmit`
Expected: sem erros (o `Record<Exclude<MapObjectV1["type"], "tile-object">, ReservedMapLayerKey>` força o compilador a acusar se `desk` faltar em algum switch exaustivo do próprio arquivo).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/office-map.ts packages/shared/src/office-map.test.ts
git commit -m "feat(shared): tipo de objeto 'desk' no documento do mapa do escritório"
```

---

### Task 2: DTOs e mensagens WS de mesa

**Files:**
- Modify: `packages/shared/src/office-map.ts`
- Modify: `packages/shared/src/office.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores além do schema da Task 1.
- Produces: `OfficeDeskDTO`, `ActiveOfficeMapDTO.desks: OfficeDeskDTO[]`, variantes `"desk-claimed"`/`"desk-released"` em `OfficeServerMessage`. Usadas pelas Tasks 4, 5, 6, 9 e 10.

- [ ] **Step 1: Adicionar `OfficeDeskDTO` e estender `ActiveOfficeMapDTO`**

Este arquivo (`office-map.ts`) não tem testes unitários dedicados para essas interfaces (são só tipos), então não há passo de teste-que-falha aqui — a validação é o `tsc --noEmit` ao final. Logo após `OfficeRoomDTO` (linhas ~1394-1403), adicione:

```ts
export interface OfficeDeskDTO {
  id: string;
  name: string;
  externalKey: string;
  claimedBy: { id: string; name: string } | null;
}
```

E adicione o campo `desks` em `ActiveOfficeMapDTO`:

```ts
export interface ActiveOfficeMapDTO {
  map: { id: string; name: string };
  publication: OfficeMapPublicationDTO;
  document: MapDocumentV1;
  assets: OfficeMapAssetDTO[];
  rooms: OfficeRoomDTO[];
  desks: OfficeDeskDTO[];
}
```

- [ ] **Step 2: Adicionar as mensagens WS de mesa**

Em `packages/shared/src/office.ts`, no union `OfficeServerMessage` (linhas 145-187), adicione dois membros novos antes do fechamento do union (depois de `room-chat-history`, antes de `map-changed`):

```ts
  /** Uma mesa foi reivindicada — todo mundo atualiza o indicador de ocupação. */
  | { type: 'desk-claimed'; deskId: string; externalKey: string; user: { id: string; name: string } }
  /** Uma mesa foi liberada (pelo dono ou por um admin). */
  | { type: 'desk-released'; deskId: string; externalKey: string }
  | { type: 'map-changed'; publicationId: string }
```

- [ ] **Step 3: Atualizar fixtures existentes que constroem `ActiveOfficeMapDTO` (campo `desks` agora obrigatório)**

Adicionar `desks` a `ActiveOfficeMapDTO` quebra a compilação de todo lugar que hoje monta esse objeto por extenso sem esse campo. Adicione `desks: []` (ou `desks: [...]` quando fizer sentido) nos três pontos abaixo:

1. `apps/api/src/lib/office-hub-map.test.ts`, função `runtime()` (retorno do objeto, ao lado de `rooms: [...]`): adicione `desks: []`.
2. `apps/api/src/test/office-map-fixture.ts`, função `legacyOfficeRuntimeFixture()` (retorno final, ao lado de `rooms: OFFICE_ZONES.map(...)`): adicione `desks: []`.
3. `apps/web/src/pages/OfficePage.test.tsx`, os dois fixtures `activeMap` e `meetingRoomMap` (ambos têm `rooms: [...]`, linhas ~95 e ~119): adicione `desks: []` em cada um.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @legends/shared exec tsc --noEmit && pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros — se algum outro ponto do código construir `ActiveOfficeMapDTO` por extenso e o compilador acusar campo faltante, adicione `desks: []` lá também.

- [ ] **Step 5: Rodar as suítes afetadas**

Run: `pnpm --filter @legends/api test -- office-hub-map.test.ts` e `pnpm --filter @legends/web test -- OfficePage.test.tsx`
Expected: PASS (nenhum comportamento mudou, só o shape do fixture).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/office-map.ts packages/shared/src/office.ts apps/api/src/lib/office-hub-map.test.ts apps/api/src/test/office-map-fixture.ts apps/web/src/pages/OfficePage.test.tsx
git commit -m "feat(shared): DTO de mesa e eventos WS desk-claimed/desk-released"
```

---

### Task 3: Modelos Prisma `OfficeDesk`/`OfficeDeskClaim`

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: migration gerada por `pnpm db:migrate` em `apps/api/prisma/migrations/`

**Interfaces:**
- Produces: models Prisma `OfficeDesk` (campos: `id`, `mapPublicationId`, `name`, `externalKey`, `createdAt`, `updatedAt`; relation `claim`) e `OfficeDeskClaim` (`deskId` como `@id`, `userId` como `@unique`, `createdAt`; relations `desk`/`user`). Consumidos pela Task 4.

- [ ] **Step 1: Adicionar os models ao schema**

Em `apps/api/prisma/schema.prisma`, logo após o bloco de `OfficeRoomAccessGrant` (linhas 761-771), adicione:

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

E adicione a relation reversa em `OfficeMapPublication` (perto de `rooms OfficeRoom[]`, linha 723):

```prisma
  rooms        OfficeRoom[]
  desks        OfficeDesk[]
```

E em `User` (perto de `officeRoomGrants`, linha 125), adicione a relation reversa de claim:

```prisma
  officeRoomGrants OfficeRoomAccessGrant[]
  officeDeskClaim  OfficeDeskClaim?
```

- [ ] **Step 2: Gerar a migration**

Run: `pnpm db:up` (garante o Postgres de pé), depois `pnpm db:migrate` (dentro do prompt, nomeie a migration `add_office_desk_claim`).
Expected: uma nova pasta em `apps/api/prisma/migrations/<timestamp>_add_office_desk_claim/migration.sql`, criando as tabelas `OfficeDesk` e `OfficeDeskClaim` com as constraints acima; comando termina sem erro e regenera o Prisma Client.

- [ ] **Step 3: Confirmar que o client gerado expõe os novos models**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros (o Prisma Client já foi regenerado pelo `db:migrate`; se o editor reclamar de tipos desatualizados, rode `pnpm db:generate`).

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): models OfficeDesk e OfficeDeskClaim"
```

---

### Task 4: Service — materialização de mesas na publicação + CRUD de claim

**Files:**
- Modify: `apps/api/src/services/office-map-service.ts`
- Test: `apps/api/src/routes/office-maps.test.ts` (o service não tem teste unitário isolado hoje — segue o padrão do repo de testar via rota HTTP; a Task 6 adiciona as rotas que exercitam este código)

Esta task só implementa as funções do service; o teste que as exercita fim-a-fim entra na Task 6 (rotas), pois publicar/claim/release só fazem sentido através do fluxo HTTP completo (create → draft → lock → save → publish → claim). Aqui validamos com `tsc` e deixamos as funções prontas.

**Interfaces:**
- Consumes: `OfficeDeskDTO` (Task 2), models `OfficeDesk`/`OfficeDeskClaim` (Task 3), `fail`/`OfficeMapError`/`activePublicationId`/`officeHub` já existentes no arquivo.
- Produces: `listActiveOfficeDesks(): Promise<OfficeDeskDTO[]>`, `claimOfficeDesk(deskId: string, userId: string): Promise<OfficeDeskDTO>`, `releaseOfficeDesk(deskId: string, userId: string): Promise<OfficeDeskDTO>`, `adminReleaseOfficeDesk(deskId: string): Promise<OfficeDeskDTO>`. Consumidas pela Task 6 (rotas). `getActiveOfficeMap`/`publishOfficeMap` passam a materializar/retornar `desks`.

- [ ] **Step 1: Materializar `OfficeDesk` ao publicar (espelhando `meeting-room`/`OfficeRoom`)**

Em `publishOfficeMap` (linhas 453-529), ao lado da consulta de `previousRooms`/`previousByKey` (linhas 468-474), adicione a consulta análoga para mesas:

```ts
    const previousDesks = setting?.activeMapPublicationId
      ? await tx.officeDesk.findMany({
          where: { mapPublicationId: setting.activeMapPublicationId },
          include: { claim: true },
        })
      : []
    const previousDeskByKey = new Map(previousDesks.map((desk) => [desk.externalKey, desk]))
```

E, dentro do `for (const object of validation.document.objects)` que hoje só trata `meeting-room` (linhas 491-511), adicione o branch de `desk` (mesmo loop, outro `if`):

```ts
    let roomsCreated = 0
    let desksCreated = 0
    for (const object of validation.document.objects) {
      if (object.type === 'meeting-room') {
        const previous = previousByKey.get(object.properties.externalKey)
        const room = await tx.officeRoom.create({
          data: {
            mapPublicationId: publication.id,
            externalKey: object.properties.externalKey,
            name: object.properties.name,
            status: previous?.status ?? object.properties.status,
            capacity: previous?.capacity ?? object.properties.capacity ?? null,
            voiceEnabled: previous?.voiceEnabled ?? object.properties.voiceEnabled,
            accessPolicy: previous?.accessPolicy ?? object.properties.accessPolicy,
          },
        })
        if (previous?.accessGrants.length) {
          await tx.officeRoomAccessGrant.createMany({
            data: previous.accessGrants.map(({ userId: grantedUserId }) => ({ roomId: room.id, userId: grantedUserId })),
          })
        }
        roomsCreated += 1
        continue
      }
      if (object.type === 'desk') {
        const previous = previousDeskByKey.get(object.properties.externalKey)
        const desk = await tx.officeDesk.create({
          data: {
            mapPublicationId: publication.id,
            externalKey: object.properties.externalKey,
            name: object.properties.name,
          },
        })
        if (previous?.claim) {
          await tx.officeDeskClaim.create({
            data: { deskId: desk.id, userId: previous.claim.userId },
          })
        }
        desksCreated += 1
      }
    }
```

(Substitua o `for` existente inteiro por essa versão — note que o corpo do `if (object.type !== 'meeting-room') continue` original virou `if (object.type === 'meeting-room') { ... continue }` seguido do novo `if (object.type === 'desk')`, para os dois tipos conviverem no mesmo loop sem repetir a iteração.)

E no `return` da função (linhas 519-525), adicione `desksCreated`:

```ts
    return {
      publication: asPublication(publication, activate ? publication.id : setting?.activeMapPublicationId ?? null),
      version,
      roomsCreated,
      desksCreated,
      activated: activate,
      map,
    }
```

- [ ] **Step 2: Função `asDesk` + `listActiveOfficeDesks`**

Logo após `asRoom`/`listActiveOfficeRooms` (depois da linha 604), adicione:

```ts
function asDesk(desk: {
  id: string
  name: string
  externalKey: string
  claim: { user: { id: string; name: string } } | null
}): OfficeDeskDTO {
  return {
    id: desk.id,
    name: desk.name,
    externalKey: desk.externalKey,
    claimedBy: desk.claim?.user ?? null,
  }
}

export async function listActiveOfficeDesks(): Promise<OfficeDeskDTO[]> {
  const activeId = await activePublicationId()
  if (!activeId) return []
  const desks = await prisma.officeDesk.findMany({
    where: { mapPublicationId: activeId },
    orderBy: { name: 'asc' },
    include: { claim: { include: { user: { select: { id: true, name: true } } } } },
  })
  return desks.map(asDesk)
}
```

- [ ] **Step 3: `claimOfficeDesk`/`releaseOfficeDesk`/`adminReleaseOfficeDesk`**

Adicione logo abaixo:

```ts
export async function claimOfficeDesk(deskId: string, userId: string): Promise<OfficeDeskDTO> {
  const activeId = await activePublicationId()
  const desk = await prisma.officeDesk.findFirst({ where: { id: deskId, mapPublicationId: activeId ?? '__none__' } })
  if (!desk) fail('Mesa ativa não encontrada', 404, 'DESK_NOT_FOUND')
  const existingClaimOnDesk = await prisma.officeDeskClaim.findUnique({ where: { deskId } })
  if (existingClaimOnDesk) fail('Esta mesa já está ocupada', 409, 'DESK_ALREADY_CLAIMED')
  const existingClaimByUser = await prisma.officeDeskClaim.findUnique({ where: { userId } })
  if (existingClaimByUser) fail('Você já ocupa outra mesa — abandone-a antes de reivindicar outra', 409, 'DESK_USER_ALREADY_HAS_DESK')
  await prisma.officeDeskClaim.create({ data: { deskId, userId } })
  const updated = await prisma.officeDesk.findUniqueOrThrow({
    where: { id: deskId },
    include: { claim: { include: { user: { select: { id: true, name: true } } } } },
  })
  return asDesk(updated)
}

export async function releaseOfficeDesk(deskId: string, userId: string): Promise<OfficeDeskDTO> {
  const activeId = await activePublicationId()
  const desk = await prisma.officeDesk.findFirst({
    where: { id: deskId, mapPublicationId: activeId ?? '__none__' },
    include: { claim: true },
  })
  if (!desk) fail('Mesa ativa não encontrada', 404, 'DESK_NOT_FOUND')
  if (!desk.claim) fail('Esta mesa não está ocupada', 409, 'DESK_NOT_CLAIMED')
  if (desk.claim.userId !== userId) fail('Você não ocupa esta mesa', 403, 'DESK_NOT_OWNER')
  await prisma.officeDeskClaim.delete({ where: { deskId } })
  return asDesk({ ...desk, claim: null })
}

export async function adminReleaseOfficeDesk(deskId: string): Promise<OfficeDeskDTO> {
  const activeId = await activePublicationId()
  const desk = await prisma.officeDesk.findFirst({
    where: { id: deskId, mapPublicationId: activeId ?? '__none__' },
    include: { claim: true },
  })
  if (!desk) fail('Mesa ativa não encontrada', 404, 'DESK_NOT_FOUND')
  if (!desk.claim) fail('Esta mesa não está ocupada', 409, 'DESK_NOT_CLAIMED')
  await prisma.officeDeskClaim.delete({ where: { deskId } })
  return asDesk({ ...desk, claim: null })
}
```

- [ ] **Step 4: Incluir `desks` em `getActiveOfficeMap`**

Em `getActiveOfficeMap` (linhas 644-670), adicione `desks` ao `include` e ao retorno:

```ts
export async function getActiveOfficeMap(_userId?: string): Promise<ActiveOfficeMapDTO> {
  const setting = await prisma.officeSetting.findUnique({
    where: { id: 1 },
    include: {
      activeMapPublication: {
        include: {
          createdBy: { select: { id: true, name: true } },
          map: { select: { id: true, name: true } },
          assetLinks: { include: { asset: true } },
          rooms: {
            include: { accessGrants: { include: { user: { select: { id: true, name: true } } } } },
          },
          desks: {
            include: { claim: { include: { user: { select: { id: true, name: true } } } } },
          },
        },
      },
    },
  })
  const publication = setting?.activeMapPublication
  if (!publication) fail('Nenhum mapa foi publicado para o escritório', 404, 'ACTIVE_MAP_NOT_FOUND')
  const rooms = publication.rooms.map(asRoom)
  const desks = publication.desks.map(asDesk)
  return {
    map: publication.map,
    publication: asPublication(publication, publication.id),
    document: publication.mapData as unknown as MapDocumentV1,
    assets: publication.assetLinks.map(({ asset }) => asAsset(asset)),
    rooms,
    desks,
  }
}
```

- [ ] **Step 5: Import de `OfficeDeskDTO`**

No topo do arquivo, junto ao import de `OfficeRoomDTO` de `@legends/shared`, adicione `OfficeDeskDTO`.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/office-map-service.ts
git commit -m "feat(api): materializa mesas na publicação e implementa claim/release"
```

---

### Task 5: Broadcast WS de claim/release no hub

**Files:**
- Modify: `apps/api/src/lib/office-hub.ts`
- Test: `apps/api/src/lib/office-hub-map.test.ts`

**Interfaces:**
- Consumes: `OfficeServerMessage` variantes `desk-claimed`/`desk-released` (Task 2).
- Produces: métodos públicos `officeHub.broadcastDeskClaimed(deskId: string, externalKey: string, user: { id: string; name: string }): void` e `officeHub.broadcastDeskReleased(deskId: string, externalKey: string): void`. Consumidos pela Task 6.

- [ ] **Step 1: Escrever o teste que falha**

Adicione a `apps/api/src/lib/office-hub-map.test.ts`, dentro do `describe('OfficeHub com publicação de mapa', ...)` já existente, reaproveitando os helpers `user(id)` e `socket()` já definidos no topo do arquivo (linhas 33-43) e o padrão `hub.join(socket, user(id), map)` já usado nos testes vizinhos:

```ts
it('broadcastDeskClaimed e broadcastDeskReleased notificam todos os sockets conectados', () => {
  const hub = new OfficeHub()
  const map = runtime()
  const anaSocket = socket()
  const brunoSocket = socket()
  hub.join(anaSocket, user('ana'), map)
  hub.join(brunoSocket, user('bruno'), map)

  hub.broadcastDeskClaimed('desk-1', 'mesa-1', { id: 'ana', name: 'ana' })
  expect(brunoSocket.messages).toContainEqual({
    type: 'desk-claimed', deskId: 'desk-1', externalKey: 'mesa-1', user: { id: 'ana', name: 'ana' },
  })

  hub.broadcastDeskReleased('desk-1', 'mesa-1')
  expect(brunoSocket.messages).toContainEqual({ type: 'desk-released', deskId: 'desk-1', externalKey: 'mesa-1' })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/api test -- office-hub-map.test.ts`
Expected: FAIL — `hub.broadcastDeskClaimed`/`broadcastDeskReleased` não existem.

- [ ] **Step 3: Implementar os métodos públicos**

Em `apps/api/src/lib/office-hub.ts`, logo após `sendToUser` (linhas 225-237), adicione dois métodos públicos que delegam ao `broadcast` privado já existente (linhas 397-409):

```ts
  /** Mesa reivindicada — todo mundo atualiza o indicador de ocupação no mapa. */
  broadcastDeskClaimed(deskId: string, externalKey: string, user: { id: string; name: string }): void {
    this.broadcast({ type: 'desk-claimed', deskId, externalKey, user })
  }

  /** Mesa liberada (pelo dono ou por um admin). */
  broadcastDeskReleased(deskId: string, externalKey: string): void {
    this.broadcast({ type: 'desk-released', deskId, externalKey })
  }
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/api test -- office-hub-map.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/office-hub.ts apps/api/src/lib/office-hub-map.test.ts
git commit -m "feat(api): broadcast de desk-claimed/desk-released no hub do escritório"
```

---

### Task 6: Rotas HTTP de mesa

**Files:**
- Modify: `apps/api/src/routes/office-maps.ts`
- Test: `apps/api/src/routes/office-maps.test.ts`

**Interfaces:**
- Consumes: `listActiveOfficeDesks`, `claimOfficeDesk`, `releaseOfficeDesk`, `adminReleaseOfficeDesk` (Task 4); `officeHub.broadcastDeskClaimed`/`broadcastDeskReleased` (Task 5).
- Produces: `GET /admin/office-desks`, `DELETE /admin/office-desks/:id/claim`, `POST /office/desks/:id/claim`, `POST /office/desks/:id/release`. `GET /office/map` passa a incluir `desks` na resposta (automático, via `getActiveOfficeMap`).

- [ ] **Step 1: Escrever o teste que falha — fluxo completo de mesa**

Adicione a `apps/api/src/routes/office-maps.test.ts` (mesmo arquivo, novo `describe`, reaproveitando `makeUser`/`auth` já definidos no topo):

```ts
describe('mesas reivindicáveis', () => {
  async function publishMapWithDesk(app: ReturnType<typeof buildApp>, admin: { token: string }) {
    const created = await app.inject({
      method: 'POST',
      url: '/admin/office-maps',
      headers: auth(admin.token),
      payload: { name: 'Mapa com mesa', width: 20, height: 16, tileSize: 32 },
    })
    const mapId = (created.json() as { map: { id: string } }).map.id

    const draftResponse = await app.inject({
      method: 'GET', url: `/admin/office-maps/${mapId}/draft`, headers: auth(admin.token),
    })
    const draft = draftResponse.json() as { revision: number; document: MapDocumentV1 }
    draft.document.objects.push({
      id: 'desk-1',
      layerKey: 'desks',
      type: 'desk',
      geometry: { kind: 'point', x: 64, y: 64 },
      properties: { externalKey: 'mesa-1', name: 'Mesa 1' },
    })

    const lockResponse = await app.inject({
      method: 'POST', url: `/admin/office-maps/${mapId}/lock`, headers: auth(admin.token),
    })
    const lock = lockResponse.json() as { lockToken: string }

    await app.inject({
      method: 'PUT',
      url: `/admin/office-maps/${mapId}/draft`,
      headers: auth(admin.token, { 'x-map-lock-token': lock.lockToken }),
      payload: { revision: draft.revision, document: draft.document },
    })

    const published = await app.inject({
      method: 'POST',
      url: `/admin/office-maps/${mapId}/publications`,
      headers: auth(admin.token),
      payload: { revision: draft.revision + 1, activate: true },
    })
    expect(published.statusCode).toBe(201)
  }

  it('permite reivindicar, impede reivindicar segunda mesa, e permite abandonar', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'admin-desk', 'ADMIN')
    const legend = await makeUser(app, 'legend-desk', 'LEGEND')
    await publishMapWithDesk(app, admin)

    const officeMap = await app.inject({ method: 'GET', url: '/office/map', headers: auth(legend.token) })
    const desks = (officeMap.json() as { desks: Array<{ id: string; externalKey: string; claimedBy: unknown }> }).desks
    expect(desks).toMatchObject([{ externalKey: 'mesa-1', claimedBy: null }])
    const deskId = desks[0]!.id

    const claimed = await app.inject({
      method: 'POST', url: `/office/desks/${deskId}/claim`, headers: auth(legend.token),
    })
    expect(claimed.statusCode).toBe(200)
    expect(claimed.json()).toMatchObject({ desk: { claimedBy: { id: legend.user.id } } })

    const secondClaimAttempt = await app.inject({
      method: 'POST', url: `/office/desks/${deskId}/claim`, headers: auth(legend.token),
    })
    expect(secondClaimAttempt.statusCode).toBe(409)
    expect(secondClaimAttempt.json()).toMatchObject({ code: 'DESK_ALREADY_CLAIMED' })

    const released = await app.inject({
      method: 'POST', url: `/office/desks/${deskId}/release`, headers: auth(legend.token),
    })
    expect(released.statusCode).toBe(200)
    expect(released.json()).toMatchObject({ desk: { claimedBy: null } })
    await app.close()
  })

  it('admin libera a mesa de qualquer usuário', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'admin-desk-3', 'ADMIN')
    const legend = await makeUser(app, 'legend-desk-3', 'LEGEND')
    await publishMapWithDesk(app, admin)
    const officeMap = await app.inject({ method: 'GET', url: '/office/map', headers: auth(legend.token) })
    const deskId = (officeMap.json() as { desks: Array<{ id: string }> }).desks[0]!.id

    await app.inject({ method: 'POST', url: `/office/desks/${deskId}/claim`, headers: auth(legend.token) })

    const forbidden = await app.inject({
      method: 'DELETE', url: `/admin/office-desks/${deskId}/claim`, headers: auth(legend.token),
    })
    expect(forbidden.statusCode).toBe(403)

    const released = await app.inject({
      method: 'DELETE', url: `/admin/office-desks/${deskId}/claim`, headers: auth(admin.token),
    })
    expect(released.statusCode).toBe(200)
    expect(released.json()).toMatchObject({ desk: { claimedBy: null } })

    const list = await app.inject({ method: 'GET', url: '/admin/office-desks', headers: auth(admin.token) })
    expect(list.json()).toMatchObject({ desks: [{ externalKey: 'mesa-1', claimedBy: null }] })
    await app.close()
  })

  it('impede reivindicar uma segunda mesa sem abandonar a primeira', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'admin-desk-2', 'ADMIN')
    const legend = await makeUser(app, 'legend-desk-2', 'LEGEND')

    const created = await app.inject({
      method: 'POST', url: '/admin/office-maps', headers: auth(admin.token),
      payload: { name: 'Mapa com 2 mesas', width: 20, height: 16, tileSize: 32 },
    })
    const mapId = (created.json() as { map: { id: string } }).map.id
    const draftResponse = await app.inject({ method: 'GET', url: `/admin/office-maps/${mapId}/draft`, headers: auth(admin.token) })
    const draft = draftResponse.json() as { revision: number; document: MapDocumentV1 }
    draft.document.objects.push(
      { id: 'desk-1', layerKey: 'desks', type: 'desk', geometry: { kind: 'point', x: 64, y: 64 }, properties: { externalKey: 'mesa-1', name: 'Mesa 1' } },
      { id: 'desk-2', layerKey: 'desks', type: 'desk', geometry: { kind: 'point', x: 128, y: 64 }, properties: { externalKey: 'mesa-2', name: 'Mesa 2' } },
    )
    const lockResponse = await app.inject({ method: 'POST', url: `/admin/office-maps/${mapId}/lock`, headers: auth(admin.token) })
    const lock = lockResponse.json() as { lockToken: string }
    await app.inject({
      method: 'PUT', url: `/admin/office-maps/${mapId}/draft`,
      headers: auth(admin.token, { 'x-map-lock-token': lock.lockToken }),
      payload: { revision: draft.revision, document: draft.document },
    })
    await app.inject({
      method: 'POST', url: `/admin/office-maps/${mapId}/publications`, headers: auth(admin.token),
      payload: { revision: draft.revision + 1, activate: true },
    })

    const officeMap = await app.inject({ method: 'GET', url: '/office/map', headers: auth(legend.token) })
    const desks = (officeMap.json() as { desks: Array<{ id: string; externalKey: string }> }).desks
    const desk1 = desks.find((d) => d.externalKey === 'mesa-1')!
    const desk2 = desks.find((d) => d.externalKey === 'mesa-2')!

    await app.inject({ method: 'POST', url: `/office/desks/${desk1.id}/claim`, headers: auth(legend.token) })
    const secondClaim = await app.inject({ method: 'POST', url: `/office/desks/${desk2.id}/claim`, headers: auth(legend.token) })
    expect(secondClaim.statusCode).toBe(409)
    expect(secondClaim.json()).toMatchObject({ code: 'DESK_USER_ALREADY_HAS_DESK' })
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/api test -- office-maps.test.ts`
Expected: FAIL — rotas `/office/desks/*` e `/admin/office-desks*` retornam 404 (não existem ainda).

- [ ] **Step 3: Implementar as rotas**

Em `apps/api/src/routes/office-maps.ts`:

1. Adicione os imports das novas funções do service (junto ao bloco de import existente, linhas 4-26):

```ts
import {
  OfficeMapError,
  acquireOfficeMapLock,
  activateOfficeMapPublication,
  adminReleaseOfficeDesk,
  claimOfficeDesk,
  createOfficeMap,
  deleteOfficeMap,
  deleteOfficeMapAsset,
  getActiveOfficeMap,
  getOfficeMapDraft,
  getOfficeMapPublication,
  heartbeatOfficeMapLock,
  listActiveOfficeDesks,
  listActiveOfficeRooms,
  listOfficeMapAssets,
  listOfficeMapPublications,
  listOfficeMaps,
  publishOfficeMap,
  releaseOfficeDesk,
  releaseOfficeMapLock,
  renameOfficeMap,
  saveOfficeMapDraft,
  updateOfficeRoom,
  uploadOfficeMapAsset,
  validateOfficeMapDraft,
} from '../services/office-map-service'
import { officeHub } from '../lib/office-hub'
```

2. Adicione as rotas logo após as de `/admin/office-rooms`/`GET /office/map` (perto das linhas 198-208):

```ts
  app.get('/admin/office-desks', admin, async () => ({ desks: await listActiveOfficeDesks() }))

  app.delete('/admin/office-desks/:id/claim', admin, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const desk = await adminReleaseOfficeDesk(params.data.id)
    officeHub.broadcastDeskReleased(desk.id, desk.externalKey)
    return { desk }
  })

  app.post('/office/desks/:id/claim', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const desk = await claimOfficeDesk(params.data.id, request.user.sub)
    if (desk.claimedBy) officeHub.broadcastDeskClaimed(desk.id, desk.externalKey, desk.claimedBy)
    return { desk }
  })

  app.post('/office/desks/:id/release', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = idParams.safeParse(request.params)
    if (!params.success) return badInput(reply, params.error)
    const desk = await releaseOfficeDesk(params.data.id, request.user.sub)
    officeHub.broadcastDeskReleased(desk.id, desk.externalKey)
    return { desk }
  })
```

`officeHub.broadcastDeskClaimed`/`broadcastDeskReleased` já existem a partir da Task 5.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/api test -- office-maps.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/office-maps.ts apps/api/src/routes/office-maps.test.ts
git commit -m "feat(api): rotas de reivindicar/abandonar mesa e liberação por admin"
```

---

### Task 7: Cliente HTTP de mesas no frontend

**Files:**
- Create: `apps/web/src/lib/office-desk-api.ts`
- Test: `apps/web/src/lib/office-desk-api.test.ts`

**Interfaces:**
- Consumes: `apiFetch` (`apps/web/src/lib/api.ts`), `OfficeDeskDTO` (`@legends/shared`).
- Produces: `claimOfficeDesk(id: string): Promise<{ desk: OfficeDeskDTO }>`, `releaseOfficeDesk(id: string): Promise<{ desk: OfficeDeskDTO }>`, `listAdminOfficeDesks(): Promise<{ desks: OfficeDeskDTO[] }>`, `adminReleaseOfficeDesk(id: string): Promise<{ desk: OfficeDeskDTO }>`. Consumidas pelas Tasks 10 e 11.

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/web/src/lib/office-desk-api.test.ts`, seguindo o padrão de mock de `fetch` já usado em outros testes de `lib/*-api.test.ts` do repo (confira `retro-api.test.ts` se existir, para reaproveitar o mesmo setup de `vi.stubGlobal('fetch', ...)`; se não houver um teste equivalente para copiar, use este setup mínimo):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { claimOfficeDesk, releaseOfficeDesk, listAdminOfficeDesks, adminReleaseOfficeDesk } from './office-desk-api'

describe('office-desk-api', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      return new Response(JSON.stringify({ desk: { id: 'd1', name: 'Mesa 1', externalKey: 'mesa-1', claimedBy: null } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))
  })

  it('claimOfficeDesk chama POST /office/desks/:id/claim', async () => {
    await claimOfficeDesk('d1')
    const [url, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!
    expect(url).toBe('/api/office/desks/d1/claim')
    expect(init.method).toBe('POST')
  })

  it('releaseOfficeDesk chama POST /office/desks/:id/release', async () => {
    await releaseOfficeDesk('d1')
    const [url, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!
    expect(url).toBe('/api/office/desks/d1/release')
    expect(init.method).toBe('POST')
  })

  it('listAdminOfficeDesks chama GET /admin/office-desks', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ desks: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    await listAdminOfficeDesks()
    const [url] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!
    expect(url).toBe('/api/admin/office-desks')
  })

  it('adminReleaseOfficeDesk chama DELETE /admin/office-desks/:id/claim', async () => {
    await adminReleaseOfficeDesk('d1')
    const [url, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!
    expect(url).toBe('/api/admin/office-desks/d1/claim')
    expect(init.method).toBe('DELETE')
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web test -- office-desk-api.test.ts`
Expected: FAIL — módulo `./office-desk-api` não existe.

- [ ] **Step 3: Implementar o cliente**

Crie `apps/web/src/lib/office-desk-api.ts`:

```ts
import type { OfficeDeskDTO } from '@legends/shared'
import { apiFetch } from './api'

export function claimOfficeDesk(id: string) {
  return apiFetch<{ desk: OfficeDeskDTO }>(`/office/desks/${id}/claim`, { method: 'POST' })
}

export function releaseOfficeDesk(id: string) {
  return apiFetch<{ desk: OfficeDeskDTO }>(`/office/desks/${id}/release`, { method: 'POST' })
}

export function listAdminOfficeDesks() {
  return apiFetch<{ desks: OfficeDeskDTO[] }>('/admin/office-desks')
}

export function adminReleaseOfficeDesk(id: string) {
  return apiFetch<{ desk: OfficeDeskDTO }>(`/admin/office-desks/${id}/claim`, { method: 'DELETE' })
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web test -- office-desk-api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/office-desk-api.ts apps/web/src/lib/office-desk-api.test.ts
git commit -m "feat(web): cliente HTTP para reivindicar/abandonar/liberar mesas"
```

---

### Task 8: Editor de mapa — ferramenta "Mesa"

**Files:**
- Modify: `apps/web/src/office/editor/MapCanvas.tsx`
- Modify: `apps/web/src/office/editor/MapEditor.tsx`
- Test: `apps/web/src/office/editor/MapCanvas.test.ts` ou equivalente já existente (verifique o nome exato do arquivo de teste do editor antes de editar; se não houver teste de unidade para `createPointObject`/`objectLayerForTool` hoje, adicione um novo arquivo `MapCanvas.objectLayerForTool.test.ts` só para as funções puras exportadas, sem montar o Phaser)

Como `objectLayerForTool` e `objectLabel` não são exportadas hoje (são funções de módulo privadas do arquivo), o teste de unidade mais direto e barato é validar o schema/documento resultante via `packages/shared` (já coberto na Task 1) e um teste de integração leve deste arquivo. Se o repo não tiver testes de `MapCanvas.tsx`/`MapEditor.tsx` hoje (confirme com `find apps/web/src/office/editor -name "*.test.*"`), pule os steps de teste automatizado desta task e valide manualmente via `pnpm --filter @legends/web dev` — mas ainda assim rode o `tsc --noEmit` como rede de segurança de tipos.

**Interfaces:**
- Consumes: `DeskObjectV1`/`"desk"` (Task 1).
- Produces: ferramenta `"desk"` utilizável no editor, criando objetos `DeskObjectV1` no documento.

- [ ] **Step 1: Verificar se existe suíte de teste para o editor**

Run: `find apps/web/src/office/editor -name "*.test.*"`
Expected: relatório do que existe hoje — ajuste os próximos steps conforme o resultado (se existir, siga o padrão dela; senão, os steps de teste desta task viram validação manual + `tsc`).

- [ ] **Step 2: Adicionar `"desk"` ao tipo de ferramentas**

Em `apps/web/src/office/editor/MapCanvas.tsx`, no array `MAP_EDITOR_TOOLS` (linhas 17-31):

```ts
export const MAP_EDITOR_TOOLS = [
  "select",
  "free-select",
  "hand",
  "brush",
  "eraser",
  "fill",
  "eyedropper",
  "collision",
  "spawn",
  "private-zone",
  "meeting-room",
  "desk",
  "door",
  "link",
  "action-point",
] as const;
```

- [ ] **Step 3: `OBJECT_COLORS`, `objectLabel`, `objectLayerForTool`**

No mesmo arquivo:

```ts
const OBJECT_COLORS: Record<MapObjectV1["type"], number> = {
  collision: 0xef4444,
  "spawn-point": 0x22c55e,
  "private-zone": 0x8b5cf6,
  "meeting-room": 0x06b6d4,
  desk: 0xf97316,
  door: 0xf59e0b,
  link: 0x3b82f6,
  "action-point": 0xec4899,
  "tile-object": 0xfacc15,
};
```

```ts
function objectLabel(object: MapObjectV1): string {
  switch (object.type) {
    case "spawn-point":
      return object.properties.name;
    case "collision":
      return object.properties.name ?? "Colisão";
    case "private-zone":
    case "meeting-room":
    case "desk":
      return object.properties.name;
    case "door":
      return object.properties.label ?? "Porta";
    case "link":
    case "action-point":
      return object.properties.label;
    case "tile-object":
      return `Tile ${object.properties.tileIndex}`;
  }
}
```

```ts
function objectLayerForTool(tool: MapEditorTool): ReservedMapLayerKey | null {
  switch (tool) {
    case "collision":
      return "collision";
    case "spawn":
      return "spawn-points";
    case "private-zone":
      return "private-zones";
    case "meeting-room":
      return "meeting-rooms";
    case "desk":
      return "desks";
    case "door":
    case "link":
    case "action-point":
      return "interactive-objects";
    default:
      return null;
  }
}
```

- [ ] **Step 4: Tratar `"desk"` como ferramenta de ponto em `handlePointerDown`**

No `handlePointerDown` (linhas 784-860), a condição final já cobre qualquer ferramenta de ponto que não seja retângulo/interativa nomeada explicitamente:

```ts
            if (
              propsRef.current.tool === "spawn" ||
              propsRef.current.tool === "desk" ||
              INTERACTIVE_TOOLS.has(propsRef.current.tool)
            ) {
              this.createPointObject(propsRef.current.tool, cell);
            }
```

- [ ] **Step 5: Criar o objeto em `createPointObject`**

Em `createPointObject` (linhas 1261-1329), adicione um branch `else if (tool === "desk")` antes do `if (!object) return;` final:

```ts
            } else if (tool === "desk") {
              object = {
                id: `desk-${token}`,
                layerKey: "desks",
                type: "desk",
                geometry: { kind: "point", ...point },
                properties: { externalKey: `desk-${token}`, name: "Nova mesa" },
              };
            }

            if (!object) return;
```

- [ ] **Step 6: Toolbar e formulário de propriedades — `MapEditor.tsx`**

Na lista `tools` (linhas 116-210), adicione a entrada logo após `"meeting-room"`:

```ts
  {
    tool: "meeting-room",
    icon: "▣",
    label: "Sala de reunião",
    description: "Delimita uma sala para reuniões.",
  },
  {
    tool: "desk",
    icon: "▭",
    label: "Mesa",
    description: "Marca um espaço de mesa reivindicável.",
  },
```

E no switch de renderização do formulário de propriedades (mesmo padrão do bloco `spawn-point`, linhas ~1993-2014), adicione:

```tsx
  if (object.type === "desk") {
    return (
      <>
        <TextField
          disabled={disabled}
          label="Nome"
          onChange={(value) => onPatch("properties", "name", value)}
          value={object.properties.name}
        />
        <TextField
          disabled={disabled}
          label="Chave externa"
          onChange={(value) => onPatch("properties", "externalKey", value)}
          value={object.properties.externalKey}
        />
      </>
    );
  }
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros — os switches exaustivos sobre `MapObjectV1["type"]` (`OBJECT_COLORS`, `objectLabel`, e o form de propriedades em `MapEditor.tsx`) acusam em tempo de compilação se `"desk"` faltar em algum deles.

- [ ] **Step 8: Validação manual**

Run: `pnpm dev` (com `pnpm db:up` de pé), acesse `/admin/mapas/:mapId/editar` com um usuário admin, selecione a ferramenta "Mesa" na toolbar, clique no canvas e confirme que um objeto de mesa aparece, é selecionável, e o formulário de propriedades mostra "Nome"/"Chave externa".

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/office/editor/MapCanvas.tsx apps/web/src/office/editor/MapEditor.tsx
git commit -m "feat(web): ferramenta de mesa no editor de mapas do escritório"
```

---

### Task 9: Cena Phaser — mesa clicável e indicador de ocupação ao vivo

**Files:**
- Modify: `apps/web/src/office/OfficeBridge.ts`
- Modify: `apps/web/src/office/scenes/OfficeScene.ts`
- Modify: `apps/web/src/office/OfficeCanvas.tsx`
- Test: `apps/web/src/office/OfficeBridge.test.ts` (verifique se já existe; se sim, adicione os casos novos lá — se não, crie seguindo o padrão do arquivo)

**Interfaces:**
- Consumes: `OfficeDeskDTO` (Task 2), evento `desk-claimed`/`desk-released` no `OfficeServerMessage`.
- Produces: `bridge.onDeskClick(handler)`/`bridge.emitDeskClick(externalKey)` (espelhando `onCharacterClick`/`emitCharacterClick`); `OfficeScene` recebe `desks: readonly OfficeDeskDTO[]` no construtor, desenha cada mesa como um objeto clicável, e atualiza o rótulo de ocupação ao vivo ao receber `desk-claimed`/`desk-released`. Consumidas pela Task 10.

- [ ] **Step 1: Escrever o teste que falha — bridge**

Verifique primeiro se existe `apps/web/src/office/OfficeBridge.test.ts`:

Run: `find apps/web/src/office -maxdepth 1 -name "OfficeBridge.test.ts"`

Se existir, adicione (senão, crie o arquivo com este conteúdo mínimo mais os imports necessários, seguindo o padrão de teste do próprio `OfficeBridge.ts`):

```ts
it('emitDeskClick notifica os handlers assinados via onDeskClick', () => {
  const bridge = new OfficeBridge()
  const received: string[] = []
  const off = bridge.onDeskClick((externalKey) => received.push(externalKey))
  bridge.emitDeskClick('mesa-1')
  expect(received).toEqual(['mesa-1'])
  off()
  bridge.emitDeskClick('mesa-2')
  expect(received).toEqual(['mesa-1'])
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web test -- OfficeBridge.test.ts`
Expected: FAIL — `onDeskClick`/`emitDeskClick` não existem.

- [ ] **Step 3: Implementar no bridge**

Em `apps/web/src/office/OfficeBridge.ts`, adicione o campo (junto a `clickHandlers`, linha 37):

```ts
  private deskClickHandlers = new Set<Handler<string>>()
```

E os métodos (logo após `emitCharacterClick`, linhas 155-157):

```ts
  /** Cena → React: uma mesa foi clicada (externalKey da mesa no documento do mapa). */
  onDeskClick(handler: Handler<string>): () => void {
    this.deskClickHandlers.add(handler)
    return () => this.deskClickHandlers.delete(handler)
  }

  emitDeskClick(externalKey: string): void {
    for (const handler of this.deskClickHandlers) handler(externalKey)
  }
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web test -- OfficeBridge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit parcial**

```bash
git add apps/web/src/office/OfficeBridge.ts apps/web/src/office/OfficeBridge.test.ts
git commit -m "feat(web): bridge emite clique em mesa (onDeskClick/emitDeskClick)"
```

- [ ] **Step 6: Desenhar e tornar clicável cada objeto `desk` na cena**

Em `apps/web/src/office/scenes/OfficeScene.ts`:

1. Adicione o import de `OfficeDeskDTO` no topo (junto aos demais imports de `@legends/shared`).

2. Mude o construtor para aceitar `desks` (linhas 108-118):

```ts
  constructor(
    private readonly bridge: OfficeBridge,
    private readonly document: MapDocumentV1,
    private readonly assets: readonly OfficeMapAssetDTO[],
    private readonly desks: readonly OfficeDeskDTO[],
  ) {
    super('office')
    this.predictor = new MovementPredictor(this.document)
  }
```

3. Adicione um campo para guardar os textos de rótulo por `externalKey` (junto a `private characters`, linha 95):

```ts
  private deskLabels = new Map<string, Phaser.GameObjects.Text>()
```

4. No `create()`, logo após o loop que desenha `meeting-room`/`private-zone` (linhas 238-253), adicione o loop de mesas:

```ts
    const deskByExternalKey = new Map(this.desks.map((desk) => [desk.externalKey, desk]))
    for (const object of this.document.objects) {
      if (object.type !== 'desk') continue
      const { x, y } = object.geometry
      const marker = this.add.rectangle(x, y, 20, 20, 0xf97316, 0.5)
      marker.setInteractive(new Phaser.Geom.Rectangle(-10, -10, 20, 20), Phaser.Geom.Rectangle.Contains)
      marker.input!.cursor = 'pointer'
      marker.on('pointerdown', () => this.bridge.emitDeskClick(object.properties.externalKey))

      const claimedBy = deskByExternalKey.get(object.properties.externalKey)?.claimedBy ?? null
      const label = this.add.text(x, y + 14, claimedBy?.name ?? object.properties.name, {
        fontFamily: 'sans-serif',
        fontSize: '9px',
        color: claimedBy ? '#fbbf24' : '#9ca3af',
      })
      label.setOrigin(0.5, 0)
      this.deskLabels.set(object.properties.externalKey, label)
    }
```

5. Adicione um método público para atualizar o rótulo ao vivo (perto de `getScreenPosition`):

```ts
  /** Atualiza o rótulo de uma mesa ao vivo — chamado pelo próprio handler de WS abaixo. */
  private setDeskClaim(externalKey: string, ownerName: string | null): void {
    const label = this.deskLabels.get(externalKey)
    if (!label) return
    const object = this.document.objects.find(
      (candidate) => candidate.type === 'desk' && candidate.properties.externalKey === externalKey,
    )
    label.setText(ownerName ?? (object?.type === 'desk' ? object.properties.name : ''))
    label.setColor(ownerName ? '#fbbf24' : '#9ca3af')
  }
```

6. No `handle()` (switch de `OfficeServerMessage`, linhas 366+), adicione os dois casos novos antes do `case 'map-changed':` (linha ~113 do bridge, mas aqui é o handler da CENA, arquivo diferente — confirme a posição exata com `grep -n "case 'map-changed'" apps/web/src/office/scenes/OfficeScene.ts`):

```ts
      case 'desk-claimed':
        this.setDeskClaim(message.externalKey, message.user.name)
        break
      case 'desk-released':
        this.setDeskClaim(message.externalKey, null)
        break
```

- [ ] **Step 7: Threading do prop `desks` em `OfficeCanvas.tsx`**

Em `apps/web/src/office/OfficeCanvas.tsx`:

1. Import de `OfficeDeskDTO` no topo.
2. `desks: OfficeDeskDTO[]` na interface `OfficeCanvasProps` (linha 11-18).
3. Desestruture na assinatura do componente (linha 34): `{ bridge, zoom, inputLocked = false, focusUserId = null, document, assets, desks }`.
4. Passe para o construtor da cena (linha 80): `new OfficeScene(bridge, document, assets, desks)`.

Não é necessário adicionar `desks` ao array de dependências do `useEffect` (linha 116) — assim como `document`/`assets`, mudanças de claim chegam via WS dentro da própria cena (Step 6), não via recriação do jogo Phaser.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/office/scenes/OfficeScene.ts apps/web/src/office/OfficeCanvas.tsx
git commit -m "feat(web): mesas clicáveis na cena do escritório com ocupação ao vivo"
```

---

### Task 10: Painel de ação e wiring em `OfficePage`

**Files:**
- Create: `apps/web/src/office/DeskActionPanel.tsx`
- Modify: `apps/web/src/office/useOfficeInteractions.ts`
- Modify: `apps/web/src/pages/OfficePage.tsx`
- Test: `apps/web/src/office/useOfficeInteractions.test.ts` (verifique se existe; se sim, siga o padrão dela)

**Interfaces:**
- Consumes: `bridge.onDeskClick`/`emitDeskClick` (Task 9), `claimOfficeDesk`/`releaseOfficeDesk` (Task 7), `activeMap.desks: OfficeDeskDTO[]` (Task 2/4).
- Produces: `useOfficeInteractions` retorna também `selectedDesk: OfficeDeskDTO | null`, `closeDeskCard: () => void`, `claimSelectedDesk: () => void`, `releaseSelectedDesk: () => void`; componente `DeskActionPanel`.

- [ ] **Step 1: Verificar se existe suíte de teste do hook**

Run: `find apps/web/src/office -maxdepth 1 -name "useOfficeInteractions.test.ts"`

Se não existir hoje, esta task adiciona apenas validação manual + `tsc` para o hook (não introduza uma suíte nova do zero para um hook com tantas dependências de bridge/DOM — fora do escopo desta feature). Se existir, siga o padrão dela para os novos casos (`selectedDesk`, `claimSelectedDesk`, `releaseSelectedDesk`).

- [ ] **Step 2: Estender `useOfficeInteractions`**

Em `apps/web/src/office/useOfficeInteractions.ts`:

1. Import `OfficeDeskDTO` de `@legends/shared`, e `claimOfficeDesk`/`releaseOfficeDesk` de `../lib/office-desk-api`.

2. Assinatura do hook (linhas 25-30) ganha um parâmetro `desks: OfficeDeskDTO[]`:

```ts
export function useOfficeInteractions(
  bridge: OfficeBridge,
  occupants: OfficeOccupant[],
  youId: string | null,
  document?: MapDocumentV1 | null,
  desks: OfficeDeskDTO[] = [],
): OfficeInteractionsState {
```

3. Adicione estado local de mesas (para refletir claim/release otimisticamente sem esperar o round-trip do WS) e o id selecionado:

```ts
  const [deskState, setDeskState] = useState<OfficeDeskDTO[]>(desks)
  const [selectedDeskExternalKey, setSelectedDeskExternalKey] = useState<string | null>(null)

  useEffect(() => {
    setDeskState(desks)
  }, [desks])

  const selectedDesk = useMemo(
    () => deskState.find((desk) => desk.externalKey === selectedDeskExternalKey) ?? null,
    [deskState, selectedDeskExternalKey],
  )

  const closeDeskCard = useCallback(() => setSelectedDeskExternalKey(null), [])

  const claimSelectedDesk = useCallback(() => {
    if (!selectedDesk) return
    claimOfficeDesk(selectedDesk.id)
      .then(({ desk }) => setDeskState((current) => current.map((d) => (d.id === desk.id ? desk : d))))
      .catch((cause) => showToast(cause instanceof Error ? cause.message : 'Não foi possível reivindicar a mesa'))
  }, [selectedDesk, showToast])

  const releaseSelectedDesk = useCallback(() => {
    if (!selectedDesk) return
    releaseOfficeDesk(selectedDesk.id)
      .then(({ desk }) => setDeskState((current) => current.map((d) => (d.id === desk.id ? desk : d))))
      .catch((cause) => showToast(cause instanceof Error ? cause.message : 'Não foi possível abandonar a mesa'))
  }, [selectedDesk, showToast])
```

(`showToast` já existe no hook, linhas 56-59 — reuse-o.)

4. No `useEffect` que assina os handlers do bridge (linhas 129-173), adicione a assinatura de clique em mesa e os casos de mensagem WS:

```ts
    const offDeskClick = bridge.onDeskClick((externalKey) => setSelectedDeskExternalKey(externalKey))
```

(adicione `offDeskClick()` ao `return` de cleanup, junto a `offMove()`/`offClick()`/`offServer()`), e dentro do `switch (msg.type)` existente, adicione:

```ts
        case 'desk-claimed':
          setDeskState((current) =>
            current.map((d) => (d.externalKey === msg.externalKey ? { ...d, claimedBy: msg.user } : d)),
          )
          break
        case 'desk-released':
          setDeskState((current) =>
            current.map((d) => (d.externalKey === msg.externalKey ? { ...d, claimedBy: null } : d)),
          )
          break
```

5. Adicione os novos campos ao retorno do hook e à interface `OfficeInteractionsState` (linhas 11-23):

```ts
export interface OfficeInteractionsState {
  selected: OfficeOccupant | null
  selectedEntry: ShowcaseEntry | null
  selectedDesk: OfficeDeskDTO | null
  incomingCall: { userId: string; name: string } | null
  toast: string | null
  openCard: (userId: string) => void
  closeCard: () => void
  closeDeskCard: () => void
  claimSelectedDesk: () => void
  releaseSelectedDesk: () => void
  call: (userId: string) => void
  follow: (userId: string) => void
  viewProfile: (userId: string) => void
  acceptCall: () => void
  refuseCall: () => void
}
```

E no `return` final (linhas 192-204), adicione `selectedDesk, closeDeskCard, claimSelectedDesk, releaseSelectedDesk`.

- [ ] **Step 3: Componente `DeskActionPanel`**

Crie `apps/web/src/office/DeskActionPanel.tsx`, no mesmo estilo de `CharacterCard.tsx`:

```tsx
import type { OfficeDeskDTO } from '@legends/shared'
import { Icon } from '../components/Icon'

export function DeskActionPanel({
  desk,
  youId,
  onClaim,
  onRelease,
  onClose,
}: {
  desk: OfficeDeskDTO
  youId: string | null
  onClaim: () => void
  onRelease: () => void
  onClose: () => void
}) {
  const isMine = desk.claimedBy?.id === youId

  return (
    <div
      className="pointer-events-auto w-full rounded-lg border border-outline-variant/40 bg-surface-container/95 p-sm shadow-xl backdrop-blur"
      role="dialog"
      aria-label={`Ações para ${desk.name}`}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="mb-sm flex items-start justify-between gap-md">
        <h3 className="font-headline text-title-md text-on-surface">{desk.name}</h3>
        <button type="button" aria-label="Fechar" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface">
          <Icon name="close" className="text-[18px]" />
        </button>
      </div>

      {desk.claimedBy === null && (
        <button
          type="button"
          onClick={onClaim}
          className="w-full rounded-md bg-primary px-md py-sm font-label text-label-sm font-bold text-on-primary hover:bg-primary-container"
        >
          Reivindicar mesa
        </button>
      )}

      {isMine && (
        <button
          type="button"
          onClick={onRelease}
          className="w-full rounded-md border border-error/40 px-md py-sm font-label text-label-sm text-error"
        >
          Abandonar mesa
        </button>
      )}

      {desk.claimedBy && !isMine && (
        <p className="text-body-sm text-on-surface-variant">Ocupada por {desk.claimedBy.name}.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wiring em `OfficePage.tsx`**

1. Import `DeskActionPanel` (junto a `CharacterCard`, linha 16).
2. Passe `activeMap.desks` e o parâmetro `desks` para `useOfficeInteractions` (linha ~126):

```ts
  const interactions = useOfficeInteractions(bridge, occupants, youId, activeMap?.document, activeMap?.desks ?? [])
```

3. Passe `desks` para `<OfficeCanvas>` (linhas 198-206):

```tsx
      <OfficeCanvas
        ref={canvasRef}
        bridge={bridge}
        document={activeMap.document}
        assets={activeMap.assets}
        desks={activeMap.desks}
        zoom={zoom}
        inputLocked={nearbyChatOpen}
        focusUserId={interactions.selected?.userId ?? null}
      />
```

4. Renderize o painel logo após o bloco de `CharacterCard` (linhas 389-404):

```tsx
      {interactions.selectedDesk && (
        <div
          className="absolute right-3 top-3 z-30 w-[min(18rem,calc(100vw-1.5rem))] md:right-5 md:top-5"
          onWheel={(event) => event.stopPropagation()}
        >
          <DeskActionPanel
            desk={interactions.selectedDesk}
            youId={youId}
            onClaim={interactions.claimSelectedDesk}
            onRelease={interactions.releaseSelectedDesk}
            onClose={interactions.closeDeskCard}
          />
        </div>
      )}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Validação manual ponta a ponta**

Run: `pnpm dev` (com `pnpm db:up` de pé e ao menos uma mesa publicada — use o editor da Task 8). Abra o escritório com dois usuários (duas abas/sessões), clique na mesa em uma aba, reivindique, confirme que a outra aba mostra o nome ao vivo sem refresh; tente reivindicar outra mesa sem abandonar a primeira e confirme o erro; abandone e confirme que a mesa libera para o outro usuário.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/office/DeskActionPanel.tsx apps/web/src/office/useOfficeInteractions.ts apps/web/src/pages/OfficePage.tsx
git commit -m "feat(web): painel de reivindicar/abandonar mesa no escritório"
```

---

### Task 11: Admin — seção de mesas

**Files:**
- Modify: `apps/web/src/pages/admin/MapsSection.tsx`

**Interfaces:**
- Consumes: `listAdminOfficeDesks`, `adminReleaseOfficeDesk` (Task 7).
- Produces: nova seção "Mesas do mapa ativo" na aba "Mapas" do admin, com liberação da mesa de qualquer usuário.

- [ ] **Step 1: Adicionar a query e a mutation**

Em `apps/web/src/pages/admin/MapsSection.tsx`:

1. Import `OfficeDeskDTO` no bloco de tipos (linha 4-9) e `listAdminOfficeDesks`/`adminReleaseOfficeDesk` de `../../lib/office-desk-api`.
2. Adicione a chave de query e a query, junto a `ROOMS_KEY`/`roomsQuery` (linhas 13, 24-27):

```ts
const DESKS_KEY = ['admin', 'office-desks'] as const
```

```ts
  const desksQuery = useQuery({
    queryKey: DESKS_KEY,
    queryFn: listAdminOfficeDesks,
  })
```

3. Inclua `DESKS_KEY` no `refresh()` (linhas 33-37):

```ts
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: MAPS_KEY })
    void queryClient.invalidateQueries({ queryKey: ROOMS_KEY })
    void queryClient.invalidateQueries({ queryKey: DESKS_KEY })
    void queryClient.invalidateQueries({ queryKey: ['office', 'active-map'] })
  }
```

4. Adicione a mutation de liberação (junto a `updateRoom`, linhas 63-71):

```ts
  const releaseDesk = useMutation({
    mutationFn: (id: string) => adminReleaseOfficeDesk(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: DESKS_KEY }),
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível liberar a mesa'),
  })
```

5. Derive a lista (junto a `const rooms = ...`, linha 74):

```ts
  const desks = desksQuery.data?.desks ?? []
```

- [ ] **Step 2: Renderizar a seção**

Adicione uma nova `<section>` logo após a seção "Salas do mapa ativo" (depois da linha 251, antes do fechamento de `</div>` do componente):

```tsx
      <section className="rounded-lg bg-surface-container p-lg">
        <h3 className="font-headline text-headline-sm text-on-surface">Mesas do mapa ativo</h3>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          Cada mesa é reivindicada por, no máximo, um usuário por vez.
        </p>
        <div className="mt-lg grid gap-md lg:grid-cols-2">
          {desks.map((desk: OfficeDeskDTO) => (
            <article key={desk.id} className="flex items-center justify-between gap-md rounded-md border border-outline-variant/40 bg-surface-container-high p-md">
              <div>
                <h4 className="font-headline text-title-md">{desk.name}</h4>
                <code className="text-label-sm text-on-surface-variant">{desk.externalKey}</code>
                <p className="mt-1 text-body-sm text-on-surface-variant">
                  {desk.claimedBy ? `Ocupada por ${desk.claimedBy.name}` : 'Livre'}
                </p>
              </div>
              {desk.claimedBy && (
                <button
                  type="button"
                  onClick={() => releaseDesk.mutate(desk.id)}
                  disabled={releaseDesk.isPending}
                  className="rounded-md border border-error/40 px-md py-sm text-label-sm text-error disabled:opacity-50"
                >
                  Liberar
                </button>
              )}
            </article>
          ))}
          {!desksQuery.isLoading && desks.length === 0 && (
            <p className="text-body-sm text-on-surface-variant">A publicação ativa ainda não possui mesas.</p>
          )}
        </div>
      </section>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Validação manual**

Run: `pnpm dev`, acesse `/admin` → aba "Mapas", confirme que a seção "Mesas do mapa ativo" lista as mesas publicadas e que o botão "Liberar" funciona numa mesa ocupada.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/admin/MapsSection.tsx
git commit -m "feat(web): admin libera a mesa de qualquer usuário"
```

---

## Verificação final

- [ ] **Rodar a suíte completa**

Run: `pnpm db:up && pnpm test`
Expected: todos os workspaces (`@legends/shared`, `@legends/api`, `@legends/web`) passam.

- [ ] **Rodar typecheck completo**

Run: `pnpm -r exec tsc --noEmit`
Expected: sem erros em nenhum workspace.
