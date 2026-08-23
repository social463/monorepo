# Mesa 3×2 com sala de chamada própria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No editor do admin, toda mesa nova nasce com 3×2 tiles e uma sala de chamada própria na mesma área; quando a mesa é reivindicada, o nome exibido dessa sala vira "Mesa de \<nome\>".

**Architecture:** A geometria e o par mesa+sala saem para um módulo puro (`deskPlacement.ts`) que o `MapCanvas` (Phaser, sem testes) apenas consome. O nome da sala **não** é persistido: helpers novos em `@legends/shared` derivam o nome exibido a partir das mesas reivindicadas, e os dois pontos de exibição (rótulo da zona no canvas do escritório e a MediaBar) passam a usá-los — no canvas, com atualização ao vivo pelos eventos WebSocket `desk-claimed`/`desk-released`, no mesmo caminho que já atualiza o rótulo da mesa.

**Tech Stack:** TypeScript strict ESM, monorepo pnpm (`@legends/shared`, `@legends/web`), Vitest, React 18, Phaser 3.

**Spec:** `docs/superpowers/specs/2026-07-28-mesa-3x2-sala-propria-design.md`

## Global Constraints

- Textos voltados ao usuário em **português** (produto pt-BR).
- Formatação por vizinhança, e ela **difere entre pastas**: `packages/shared/src/office-map.ts` e `apps/web/src/office/editor/*` usam aspas duplas + ponto e vírgula; `packages/shared/src/office-map-runtime.ts`, `apps/web/src/office/scenes/*`, `apps/web/src/office/*.ts(x)` e `apps/web/src/pages/*` usam aspas simples, sem ponto e vírgula. Copie o estilo do arquivo que você está editando.
- Mesas já publicadas **não** são migradas nem normalizadas. Nenhuma tarefa toca em mapas existentes, no banco, na API ou em migrations.
- O nome da sala no documento e no banco permanece inalterado — a derivação é só de exibição.
- Nome derivado exato: `` `Mesa de ${ownerName}` `` (casa com o `DeskHoverCard`, que já exibe "Mesa de Fulano").
- Tamanho da mesa: **3 tiles de largura × 2 de altura**, sempre.
- Durante a implementação rode **apenas os arquivos de teste tocados** (a suíte completa é lenta). Testes do `@legends/web` e do `@legends/shared` não precisam de Postgres.

---

### Task 1: Helpers de nome derivado no contrato compartilhado

**Files:**
- Modify: `packages/shared/src/office-map.ts` (adicionar constante após `MAP_LIMITS`, linha ~31)
- Modify: `packages/shared/src/office-map-runtime.ts` (imports no topo; funções novas após `claimedDeskInMeetingRoom`, linha ~99)
- Test: `packages/shared/src/office-map-runtime.test.ts` (novo `describe` no fim do arquivo)

**Interfaces:**
- Consumes: `claimedDeskInMeetingRoom`, `objectCenter`, `pointInObject`, `OfficeRuntimeZone` — já existem em `office-map-runtime.ts`.
- Produces (exportados pelo barril `@legends/shared`):
  - `OFFICE_DESK_SIZE_TILES: { readonly width: 3; readonly height: 2 }`
  - `meetingRoomForDeskKey(document: MapDocumentV1, deskExternalKey: string): MeetingRoomObjectV1 | null`
  - `deskRoomDisplayName(ownerName: string): string`
  - `officeZoneDisplayName(document: MapDocumentV1, desks: readonly OfficeDeskDTO[], zone: OfficeRuntimeZone): string`

- [ ] **Step 1: Escrever os testes que falham**

Adicione no fim de `packages/shared/src/office-map-runtime.test.ts` (o arquivo já importa de `./index`; acrescente `deskRoomDisplayName`, `meetingRoomForDeskKey`, `officeZoneDisplayName` e `OFFICE_DESK_SIZE_TILES` à lista de imports do topo):

```ts
describe('nome exibido da sala da mesa', () => {
  // Sala 'aurora' em (96,96)–(224,192); a mesa 3×2 (96×64px) cabe dentro dela.
  const documentWithDeskInRoom = () => {
    const document = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 32 })
    document.objects.push(
      {
        id: 'room-1', layerKey: 'meeting-rooms', type: 'meeting-room',
        geometry: { kind: 'rectangle', x: 96, y: 96, width: 128, height: 96 },
        properties: {
          externalKey: 'aurora', name: 'Aurora', status: 'OPEN',
          voiceEnabled: true, accessPolicy: 'OPEN',
        },
      },
      {
        id: 'desk-1', layerKey: 'desks', type: 'desk',
        geometry: { kind: 'rectangle', x: 96, y: 96, width: 96, height: 64 },
        properties: { externalKey: 'mesa-1', name: 'Nova mesa' },
      },
      {
        id: 'desk-solta', layerKey: 'desks', type: 'desk',
        geometry: { kind: 'rectangle', x: 320, y: 320, width: 96, height: 64 },
        properties: { externalKey: 'mesa-solta', name: 'Mesa solta' },
      },
    )
    return document
  }
  const zoneOf = (document: MapDocumentV1, id: string) =>
    document.objects.find((object) => object.id === id) as OfficeRuntimeZone

  it('a mesa tem 3 tiles de largura por 2 de altura', () => {
    expect(OFFICE_DESK_SIZE_TILES).toEqual({ width: 3, height: 2 })
  })

  it('deskRoomDisplayName monta o nome a partir do dono', () => {
    expect(deskRoomDisplayName('Ana')).toBe('Mesa de Ana')
  })

  it('meetingRoomForDeskKey acha a sala que contém o centro da mesa', () => {
    const document = documentWithDeskInRoom()
    expect(meetingRoomForDeskKey(document, 'mesa-1')?.properties.externalKey).toBe('aurora')
    expect(meetingRoomForDeskKey(document, 'mesa-solta')).toBeNull()
    expect(meetingRoomForDeskKey(document, 'mesa-inexistente')).toBeNull()
  })

  it('sala com mesa reivindicada exibe o nome do dono', () => {
    const document = documentWithDeskInRoom()
    const desks = [{ id: 'd1', name: 'Nova mesa', externalKey: 'mesa-1', claimedBy: { id: 'u1', name: 'Ana' } }]
    expect(officeZoneDisplayName(document, desks, zoneOf(document, 'room-1'))).toBe('Mesa de Ana')
  })

  it('mesa livre, sala sem mesa e zona privada mantêm o nome próprio', () => {
    const document = documentWithDeskInRoom()
    const livre = [{ id: 'd1', name: 'Nova mesa', externalKey: 'mesa-1', claimedBy: null }]
    expect(officeZoneDisplayName(document, livre, zoneOf(document, 'room-1'))).toBe('Aurora')
    expect(officeZoneDisplayName(document, [], zoneOf(document, 'room-1'))).toBe('Aurora')

    document.objects.push({
      id: 'silencio-1', layerKey: 'private-zones', type: 'private-zone',
      geometry: { kind: 'rectangle', x: 320, y: 320, width: 96, height: 64 },
      properties: { name: 'Silêncio', accessPolicy: 'OPEN' },
    })
    const comDono = [{ id: 'd2', name: 'Mesa solta', externalKey: 'mesa-solta', claimedBy: { id: 'u1', name: 'Ana' } }]
    expect(officeZoneDisplayName(document, comDono, zoneOf(document, 'silencio-1'))).toBe('Silêncio')
  })

  it('sala em polígono também reconhece a mesa dentro dela', () => {
    const document = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 32 })
    document.objects.push(
      {
        id: 'room-poly', layerKey: 'meeting-rooms', type: 'meeting-room',
        geometry: {
          kind: 'polygon',
          points: [{ x: 96, y: 96 }, { x: 256, y: 96 }, { x: 256, y: 224 }, { x: 96, y: 224 }],
        },
        properties: {
          externalKey: 'poligonal', name: 'Poligonal', status: 'OPEN',
          voiceEnabled: true, accessPolicy: 'OPEN',
        },
      },
      {
        id: 'desk-poly', layerKey: 'desks', type: 'desk',
        geometry: { kind: 'rectangle', x: 128, y: 128, width: 96, height: 64 },
        properties: { externalKey: 'mesa-poly', name: 'Nova mesa' },
      },
    )
    expect(meetingRoomForDeskKey(document, 'mesa-poly')?.properties.externalKey).toBe('poligonal')
  })
})
```

Ajuste também os imports do topo do arquivo de teste para incluir `type MapDocumentV1` e `type OfficeRuntimeZone`.

- [ ] **Step 2: Rodar os testes e ver falhar**

```bash
pnpm --filter @legends/shared exec vitest run src/office-map-runtime.test.ts
```

Esperado: FAIL — `deskRoomDisplayName is not a function` / `OFFICE_DESK_SIZE_TILES` indefinido.

- [ ] **Step 3: Adicionar a constante em `office-map.ts`**

Logo depois de `export const MAP_LIMITS = MAP_DOCUMENT_V1_LIMITS;` (linha ~31), no estilo do arquivo (aspas duplas, ponto e vírgula):

```ts
/**
 * Tamanho fixo de toda mesa criada pelo editor: 3 tiles de largura por 2 de
 * altura — o mesmo footprint da sala de chamada que nasce junto com ela.
 * Mesas publicadas antes desta regra mantêm o tamanho que têm.
 */
export const OFFICE_DESK_SIZE_TILES = { width: 3, height: 2 } as const;
```

- [ ] **Step 4: Adicionar os helpers em `office-map-runtime.ts`**

No import do topo do arquivo, acrescente `DeskObjectV1` à lista de tipos vindos de `./index`. Depois de `claimedDeskInMeetingRoom` (que termina na linha ~99), no estilo do arquivo (aspas simples, sem ponto e vírgula):

```ts
/**
 * Sala de chamada que contém uma mesa — o inverso de
 * `claimedDeskInMeetingRoom`, com a mesma regra geométrica: a mesa pertence à
 * sala cujo retângulo/polígono contém o CENTRO da mesa.
 */
export function meetingRoomForDeskKey(
  document: MapDocumentV1,
  deskExternalKey: string,
): MeetingRoomObjectV1 | null {
  const desk = document.objects.find(
    (object): object is DeskObjectV1 =>
      object.type === 'desk' && object.properties.externalKey === deskExternalKey,
  )
  if (!desk) return null
  const center = objectCenter(desk)
  return (
    document.objects.find(
      (object): object is MeetingRoomObjectV1 =>
        object.type === 'meeting-room' && pointInObject(center.x, center.y, object),
    ) ?? null
  )
}

/** Nome de sala derivado do dono da mesa que ela contém. */
export function deskRoomDisplayName(ownerName: string): string {
  return `Mesa de ${ownerName}`
}

/**
 * Nome a EXIBIR para uma zona. Uma sala de chamada com mesa reivindicada passa
 * a se chamar "Mesa de <dono>" enquanto durar a ocupação — derivado, nunca
 * persistido: liberar a mesa devolve o nome próprio sem republicar o mapa.
 */
export function officeZoneDisplayName(
  document: MapDocumentV1,
  desks: readonly OfficeDeskDTO[],
  zone: OfficeRuntimeZone,
): string {
  if (zone.type !== 'meeting-room') return zone.properties.name
  const desk = claimedDeskInMeetingRoom(document, desks, zone.properties.externalKey)
  return desk?.claimedBy ? deskRoomDisplayName(desk.claimedBy.name) : zone.properties.name
}
```

- [ ] **Step 5: Rodar os testes e ver passar**

```bash
pnpm --filter @legends/shared exec vitest run src/office-map-runtime.test.ts
```

Esperado: PASS (inclusive os testes que já existiam no arquivo).

- [ ] **Step 6: Checar tipos do pacote**

```bash
pnpm --filter @legends/shared exec tsc --noEmit -p tsconfig.json
```

Esperado: sem erros. (Use o binário direto como acima; `npx tsc` é interceptado por proxy neste ambiente.)

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/office-map.ts packages/shared/src/office-map-runtime.ts packages/shared/src/office-map-runtime.test.ts
git commit -m "feat(shared): nome exibido da sala derivado da mesa reivindicada"
```

---

### Task 2: Módulo puro de posicionamento da mesa

**Files:**
- Create: `apps/web/src/office/editor/deskPlacement.ts`
- Test: `apps/web/src/office/editor/deskPlacement.test.ts`

**Interfaces:**
- Consumes (Task 1): `OFFICE_DESK_SIZE_TILES`.
- Produces:
  - `interface DeskAnchorCell { column: number; row: number }`
  - `deskPlacementGeometry(document: MapDocumentV1, anchor: DeskAnchorCell): RectangleGeometryV1`
  - `deskPlacementObjects(document: MapDocumentV1, anchor: DeskAnchorCell, token: string, options?: { withRoom?: boolean }): MapObjectV1[]` — devolve `[desk]` ou `[desk, meetingRoom]`, sempre com a mesa em `[0]`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `apps/web/src/office/editor/deskPlacement.test.ts` (estilo do diretório: aspas duplas, ponto e vírgula):

```ts
import { describe, expect, it } from "vitest";
import { createEmptyMapDocumentV1, type MapDocumentV1 } from "@legends/shared";
import { deskPlacementGeometry, deskPlacementObjects } from "./deskPlacement";

function emptyDocument(): MapDocumentV1 {
  return createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 32 });
}

describe("deskPlacementGeometry", () => {
  it("sempre gera 3x2 tiles ancorados na célula", () => {
    expect(deskPlacementGeometry(emptyDocument(), { column: 4, row: 5 })).toEqual({
      kind: "rectangle",
      x: 128,
      y: 160,
      width: 96,
      height: 64,
    });
  });

  it("empurra a âncora pra dentro do mapa nas bordas", () => {
    const document = emptyDocument();
    expect(deskPlacementGeometry(document, { column: 19, row: 19 })).toEqual({
      kind: "rectangle",
      x: 17 * 32,
      y: 18 * 32,
      width: 96,
      height: 64,
    });
    expect(deskPlacementGeometry(document, { column: -3, row: -1 })).toEqual({
      kind: "rectangle",
      x: 0,
      y: 0,
      width: 96,
      height: 64,
    });
  });
});

describe("deskPlacementObjects", () => {
  it("cria a mesa e a sala de chamada com a mesma geometria", () => {
    const [desk, room] = deskPlacementObjects(emptyDocument(), { column: 2, row: 2 }, "abc");

    expect(desk).toEqual({
      id: "desk-abc",
      layerKey: "desks",
      type: "desk",
      geometry: { kind: "rectangle", x: 64, y: 64, width: 96, height: 64 },
      properties: { externalKey: "desk-abc", name: "Nova mesa" },
    });
    expect(room).toEqual({
      id: "meeting-room-abc",
      layerKey: "meeting-rooms",
      type: "meeting-room",
      geometry: { kind: "rectangle", x: 64, y: 64, width: 96, height: 64 },
      properties: {
        externalKey: "room-abc",
        name: "Nova mesa",
        status: "OPEN",
        voiceEnabled: true,
        accessPolicy: "OPEN",
      },
    });
  });

  it("dentro de uma sala existente cria só a mesa (salas não podem se sobrepor)", () => {
    const document = emptyDocument();
    document.objects.push({
      id: "room-1",
      layerKey: "meeting-rooms",
      type: "meeting-room",
      geometry: { kind: "rectangle", x: 0, y: 0, width: 320, height: 320 },
      properties: {
        externalKey: "aurora",
        name: "Aurora",
        status: "OPEN",
        voiceEnabled: true,
        accessPolicy: "OPEN",
      },
    });

    const objects = deskPlacementObjects(document, { column: 2, row: 2 }, "abc");

    expect(objects).toHaveLength(1);
    expect(objects[0]!.type).toBe("desk");
  });

  it("mesa encostada na sala vizinha, sem invadir, continua ganhando a própria sala", () => {
    const document = emptyDocument();
    document.objects.push({
      id: "room-1",
      layerKey: "meeting-rooms",
      type: "meeting-room",
      geometry: { kind: "rectangle", x: 0, y: 0, width: 64, height: 64 },
      properties: {
        externalKey: "aurora",
        name: "Aurora",
        status: "OPEN",
        voiceEnabled: true,
        accessPolicy: "OPEN",
      },
    });

    expect(deskPlacementObjects(document, { column: 2, row: 0 }, "abc")).toHaveLength(2);
  });

  it("com a layer de salas indisponível cria só a mesa", () => {
    const objects = deskPlacementObjects(emptyDocument(), { column: 2, row: 2 }, "abc", {
      withRoom: false,
    });

    expect(objects).toHaveLength(1);
    expect(objects[0]!.type).toBe("desk");
  });
});
```

- [ ] **Step 2: Rodar os testes e ver falhar**

```bash
pnpm --filter @legends/web exec vitest run src/office/editor/deskPlacement.test.ts
```

Esperado: FAIL — não existe o módulo `./deskPlacement`.

- [ ] **Step 3: Implementar o módulo**

Crie `apps/web/src/office/editor/deskPlacement.ts`:

```ts
import {
  OFFICE_DESK_SIZE_TILES,
  type MapDocumentV1,
  type MapObjectV1,
  type RectangleGeometryV1,
} from "@legends/shared";

/** Nome inicial da mesa e da sala que nasce com ela. */
const DEFAULT_DESK_NAME = "Nova mesa";

export interface DeskAnchorCell {
  column: number;
  row: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Retângulo de 3×2 tiles ancorado na célula. Perto das bordas a âncora é
 * empurrada pra dentro em vez de recortar a mesa: mesa de tamanho fixo nunca
 * pode nascer menor, e geometria fora dos limites reprova na validação.
 */
export function deskPlacementGeometry(
  document: MapDocumentV1,
  anchor: DeskAnchorCell,
): RectangleGeometryV1 {
  const { width, height, tileWidth, tileHeight } = document.map;
  const column = clamp(anchor.column, 0, width - OFFICE_DESK_SIZE_TILES.width);
  const row = clamp(anchor.row, 0, height - OFFICE_DESK_SIZE_TILES.height);
  return {
    kind: "rectangle",
    x: column * tileWidth,
    y: row * tileHeight,
    width: OFFICE_DESK_SIZE_TILES.width * tileWidth,
    height: OFFICE_DESK_SIZE_TILES.height * tileHeight,
  };
}

/**
 * Caixa envolvente de uma geometria de sala. Para polígonos isso é
 * conservador (pode acusar sobreposição em quase-encostado), o que é o lado
 * seguro: na dúvida, não criamos uma segunda sala — a mesa já fica dentro da
 * que existe.
 */
function boundingBox(geometry: MapObjectV1["geometry"]) {
  if (geometry.kind === "rectangle") {
    return {
      left: geometry.x,
      top: geometry.y,
      right: geometry.x + geometry.width,
      bottom: geometry.y + geometry.height,
    };
  }
  if (geometry.kind === "point") {
    return { left: geometry.x, top: geometry.y, right: geometry.x, bottom: geometry.y };
  }
  const xs = geometry.points.map((point) => point.x);
  const ys = geometry.points.map((point) => point.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

function overlapsMeetingRoom(
  document: MapDocumentV1,
  geometry: RectangleGeometryV1,
): boolean {
  const desk = boundingBox(geometry);
  return document.objects.some((object) => {
    if (object.type !== "meeting-room") return false;
    const room = boundingBox(object.geometry);
    // Comparação estrita: salas apenas encostadas não se sobrepõem.
    return (
      desk.left < room.right &&
      desk.right > room.left &&
      desk.top < room.bottom &&
      desk.bottom > room.top
    );
  });
}

/**
 * Objetos que a ferramenta "mesa" insere: a mesa e, junto, a sala de chamada
 * dela com a MESMA área. A sala é omitida quando a mesa cai dentro de uma sala
 * existente (a validação do documento proíbe salas sobrepostas) ou quando a
 * layer de salas está travada/oculta (`withRoom: false`). A mesa é sempre o
 * primeiro item — é ela que o editor seleciona depois de criar.
 */
export function deskPlacementObjects(
  document: MapDocumentV1,
  anchor: DeskAnchorCell,
  token: string,
  options: { withRoom?: boolean } = {},
): MapObjectV1[] {
  const geometry = deskPlacementGeometry(document, anchor);
  const desk: MapObjectV1 = {
    id: `desk-${token}`,
    layerKey: "desks",
    type: "desk",
    geometry,
    properties: { externalKey: `desk-${token}`, name: DEFAULT_DESK_NAME },
  };
  const withRoom = options.withRoom ?? true;
  if (!withRoom || overlapsMeetingRoom(document, geometry)) return [desk];

  const room: MapObjectV1 = {
    id: `meeting-room-${token}`,
    layerKey: "meeting-rooms",
    type: "meeting-room",
    geometry: { ...geometry },
    properties: {
      externalKey: `room-${token}`,
      name: DEFAULT_DESK_NAME,
      status: "OPEN",
      voiceEnabled: true,
      accessPolicy: "OPEN",
    },
  };
  return [desk, room];
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

```bash
pnpm --filter @legends/web exec vitest run src/office/editor/deskPlacement.test.ts
```

Esperado: PASS, 6 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/editor/deskPlacement.ts apps/web/src/office/editor/deskPlacement.test.ts
git commit -m "feat(web): módulo de posicionamento da mesa 3x2 com sala própria"
```

---

### Task 3: Ligar a ferramenta "Mesa" do editor ao novo posicionamento

**Files:**
- Modify: `apps/web/src/office/editor/MapCanvas.tsx` (`rectangleFromGesture` ~1339-1360; `createRectangleObject` ~1392-1450)
- Modify: `apps/web/src/office/editor/MapEditor.tsx` (descrição da ferramenta, ~197-202)

**Interfaces:**
- Consumes (Task 2): `deskPlacementGeometry`, `deskPlacementObjects`.
- Produces: nada novo — só comportamento do editor.

Contexto para quem não conhece o arquivo: `MapCanvas.tsx` monta uma cena Phaser dentro de um `useEffect`; os métodos citados são da classe interna da cena. `this.currentDocument` é o documento em edição, `randomToken()` gera o sufixo dos ids, e `propsRef.current` dá acesso às props atuais. Não há suíte de testes para esse arquivo (Phaser não roda sob jsdom) — a lógica testável já foi extraída na Task 2, e esta task é verificada manualmente no editor.

- [ ] **Step 1: Importar o módulo novo**

No bloco de imports de `MapCanvas.tsx` (topo do arquivo, depois do import de `@legends/shared`):

```ts
import { deskPlacementGeometry, deskPlacementObjects } from "./deskPlacement";
```

- [ ] **Step 2: Fixar o preview do gesto em 3×2**

Em `rectangleFromGesture`, antes de qualquer outra coisa no corpo do método:

```ts
private rectangleFromGesture(
  gesture: RectangleGesture,
): RectangleGeometryV1 {
  // Mesa tem tamanho fixo: arrastar só reposiciona a âncora (célula sob o
  // cursor agora), nunca redimensiona.
  if (gesture.tool === "desk") {
    return deskPlacementGeometry(this.currentDocument, {
      column: gesture.current.column,
      row: gesture.current.row,
    });
  }
  const { tileWidth, tileHeight } = this.currentDocument.map;
  // ...restante do método como está hoje
```

- [ ] **Step 3: Criar mesa + sala no fim do gesto**

Em `createRectangleObject`, logo depois da guarda `if (!this.canEditObjectLayer(gesture.tool)) return;`, insira o caminho da mesa e **remova** o antigo bloco `} else if (gesture.tool === "desk") { ... }` da cadeia if/else abaixo:

```ts
private createRectangleObject(gesture: RectangleGesture) {
  if (!this.canEditObjectLayer(gesture.tool)) return;

  if (gesture.tool === "desk") {
    const objects = deskPlacementObjects(
      this.currentDocument,
      { column: gesture.current.column, row: gesture.current.row },
      randomToken(),
      { withRoom: this.canEditObjectLayer("meeting-room") },
    );
    const nextDocument = cloneDocument(this.currentDocument);
    nextDocument.objects.push(...objects);
    this.commitDocument(nextDocument, "Criar desk");
    propsRef.current.onSelection({ kind: "object", objectId: objects[0]!.id });
    return;
  }

  const token = randomToken();
  // ...restante do método (collision / private-zone / meeting-room) como está hoje
```

Depois da remoção, a cadeia restante fica `if (collision) ... else if (private-zone) ... else { meeting-room }`.

- [ ] **Step 4: Atualizar a descrição da ferramenta**

Em `MapEditor.tsx`, no item `tool: "desk"` da lista de ferramentas:

```tsx
  {
    tool: "desk",
    icon: "▭",
    label: "Mesa",
    description: "Mesa de 3×2 tiles com sala de chamada própria.",
  },
```

- [ ] **Step 5: Checar tipos do app web**

```bash
pnpm --filter @legends/web exec tsc --noEmit -p tsconfig.json
```

Esperado: sem erros.

- [ ] **Step 6: Verificar no editor rodando**

Suba o ambiente (`pnpm db:up` e `pnpm dev`; ver a skill `verify` do projeto), entre como admin, abra o editor de mapas e confirme:

1. Clique simples com a ferramenta Mesa cria um retângulo de 3×2 tiles.
2. Arrastar não redimensiona — só move o preview, e a mesa nasce onde soltou.
3. O painel de objetos mostra a mesa **e** uma sala nova com a mesma área.
4. Criar uma mesa dentro de uma sala existente cria só a mesa.
5. Publicar o mapa não retorna erro de validação.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/office/editor/MapCanvas.tsx apps/web/src/office/editor/MapEditor.tsx
git commit -m "feat(web): ferramenta mesa cria 3x2 com sala de chamada"
```

---

### Task 4: Nome derivado da sala no escritório

**Files:**
- Modify: `apps/web/src/office/scenes/OfficeScene.ts` (campos da classe ~226; rótulo da zona em `renderDecoration` ~1157-1183; `setDeskClaim` ~425-435; início de `create()` ~1242)
- Modify: `apps/web/src/office/useOfficeInteractions.ts` (bloco `return {` ~449)
- Modify: `apps/web/src/pages/OfficePage.tsx:127` (mover o cálculo de `zoneName` para depois de `interactions`, ~208)
- Test: `apps/web/src/office/scenes/OfficeScene.test.ts` (novo `describe` no fim)
- Test: `apps/web/src/office/useOfficeInteractions.test.tsx` (novo teste)

**Interfaces:**
- Consumes (Task 1): `officeZoneDisplayName`, `deskRoomDisplayName`, `meetingRoomForDeskKey`.
- Produces: `useOfficeInteractions(...)` passa a devolver também `desks: OfficeDeskDTO[]` — a lista viva, já atualizada pelos eventos `desk-claimed`/`desk-released`.

- [ ] **Step 1: Escrever o teste da cena que falha**

Em `apps/web/src/office/scenes/OfficeScene.test.ts`, acrescente `setDeskClaim` ao bloco de tipos `scenePrivate` do topo:

```ts
  setDeskClaim(this: unknown, externalKey: string, ownerName: string | null): void
```

e adicione no fim do arquivo:

```ts
describe('OfficeScene.setDeskClaim — rótulo da sala da mesa', () => {
  function fakeSceneComMesaNaSala() {
    const document = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 32 })
    document.objects.push(
      {
        id: 'room-1', layerKey: 'meeting-rooms', type: 'meeting-room',
        geometry: { kind: 'rectangle', x: 96, y: 96, width: 96, height: 64 },
        properties: {
          externalKey: 'aurora', name: 'Aurora', status: 'OPEN',
          voiceEnabled: true, accessPolicy: 'OPEN',
        },
      },
      {
        id: 'desk-1', layerKey: 'desks', type: 'desk',
        geometry: { kind: 'rectangle', x: 96, y: 96, width: 96, height: 64 },
        properties: { externalKey: 'mesa-1', name: 'Nova mesa' },
      },
    )
    const deskLabel = { setText: vi.fn(), setColor: vi.fn(), setBackgroundColor: vi.fn() }
    const zoneLabel = { setText: vi.fn() }
    return {
      scene: {
        document,
        deskLabels: new Map([['mesa-1', deskLabel]]),
        zoneLabels: new Map([['room-1', zoneLabel]]),
        deskOwners: new Map<string, string | null>([['mesa-1', null]]),
      },
      deskLabel,
      zoneLabel,
    }
  }

  it('reivindicar renomeia a sala para "Mesa de <dono>"', () => {
    const { scene, deskLabel, zoneLabel } = fakeSceneComMesaNaSala()

    scenePrivate.setDeskClaim.call(scene, 'mesa-1', 'Ana')

    expect(deskLabel.setText).toHaveBeenCalledWith('Ana')
    expect(zoneLabel.setText).toHaveBeenCalledWith('Mesa de Ana')
  })

  it('liberar devolve o nome próprio da sala', () => {
    const { scene, zoneLabel } = fakeSceneComMesaNaSala()

    scenePrivate.setDeskClaim.call(scene, 'mesa-1', 'Ana')
    scenePrivate.setDeskClaim.call(scene, 'mesa-1', null)

    expect(zoneLabel.setText).toHaveBeenLastCalledWith('Aurora')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @legends/web exec vitest run src/office/scenes/OfficeScene.test.ts
```

Esperado: FAIL — `zoneLabel.setText` nunca é chamado (a cena ainda não mexe no rótulo da zona).

- [ ] **Step 3: Guardar rótulos de zona e donos de mesa na cena**

Em `OfficeScene.ts`, junto dos campos `deskLabels`/`deskPositions` (~linha 226):

```ts
  /** Rótulo de cada zona por id do objeto — permite renomear a sala ao vivo. */
  private zoneLabels = new Map<string, Phaser.GameObjects.Text>()
  /** Dono atual de cada mesa (null = livre), espelho vivo de `desks`. */
  private deskOwners = new Map<string, string | null>()
```

No import de `@legends/shared` do topo do arquivo, acrescente `deskRoomDisplayName` e `meetingRoomForDeskKey`.

- [ ] **Step 4: Usar o nome derivado no rótulo da zona**

Em `renderDecoration`, no laço que desenha zonas: limpe o mapa antes do laço (o método é chamado de novo em `applyMap`, quando os textos antigos já foram destruídos) e registre cada rótulo. Troque o texto por um método novo:

```ts
    this.zoneLabels.clear()
    for (const zone of this.document.objects.filter((object) => object.type === 'meeting-room' || object.type === 'private-zone')) {
      // ...restante igual até a criação do texto
      const zoneLabel = this.add.text(labelX, labelY, this.zoneLabelText(zone), {
```

e logo depois de `this.mapObjects.push(zoneLabel)`, dentro do mesmo laço:

```ts
      this.zoneLabels.set(zone.id, zoneLabel)
```

Adicione o método (perto de `setDeskClaim`):

```ts
  /**
   * Nome a exibir na zona: sala de chamada com mesa reivindicada mostra "Mesa
   * de <dono>". Lê de `deskOwners` (e não de `desks`) porque o snapshot do
   * construtor envelhece — quem manda é o estado vivo dos eventos de mesa.
   */
  private zoneLabelText(zone: OfficeRuntimeZone): string {
    if (zone.type !== 'meeting-room') return zone.properties.name
    for (const [deskExternalKey, ownerName] of this.deskOwners) {
      if (!ownerName) continue
      const room = meetingRoomForDeskKey(this.document, deskExternalKey)
      if (room?.properties.externalKey === zone.properties.externalKey) {
        return deskRoomDisplayName(ownerName)
      }
    }
    return zone.properties.name
  }
```

`OfficeRuntimeZone` também vem de `@legends/shared` — acrescente ao import de tipos.

- [ ] **Step 5: Popular `deskOwners` na entrada da cena e atualizar em `setDeskClaim`**

No começo de `create()`, **antes** de `this.renderDecoration()` (que já é a primeira linha do método):

```ts
  create(): void {
    for (const desk of this.desks) {
      this.deskOwners.set(desk.externalKey, desk.claimedBy?.name ?? null)
    }
    this.renderDecoration()
```

E em `setDeskClaim`, depois de atualizar o rótulo da mesa:

```ts
  private setDeskClaim(externalKey: string, ownerName: string | null): void {
    const label = this.deskLabels.get(externalKey)
    if (label) {
      const object = this.document.objects.find(
        (candidate) => candidate.type === 'desk' && candidate.properties.externalKey === externalKey,
      )
      label.setText(ownerName ?? (object?.type === 'desk' ? object.properties.name : ''))
      const style = deskLabelStyle(ownerName !== null)
      label.setColor(style.color)
      label.setBackgroundColor(style.backgroundColor)
    }
    // A sala que contém a mesa passa a se chamar "Mesa de <dono>" enquanto a
    // ocupação durar — atualizado aqui pra não depender de recarregar o mapa.
    this.deskOwners.set(externalKey, ownerName)
    const room = meetingRoomForDeskKey(this.document, externalKey)
    if (room) this.zoneLabels.get(room.id)?.setText(this.zoneLabelText(room))
  }
```

Note a mudança de guarda: o `if (!label) return` do começo virou `if (label) { ... }`, senão uma mesa sem rótulo renderizado abortaria a renomeação da sala.

- [ ] **Step 6: Rodar e ver passar**

```bash
pnpm --filter @legends/web exec vitest run src/office/scenes/OfficeScene.test.ts
```

Esperado: PASS (os testes que já existiam continuam passando).

- [ ] **Step 7: Escrever o teste do hook que falha**

Em `apps/web/src/office/useOfficeInteractions.test.tsx`, adicione dentro do `describe('useOfficeInteractions', ...)`:

```tsx
  it('expõe a lista viva de mesas: desk-claimed marca o dono', async () => {
    const bridge = new OfficeBridge()
    const desks = [{ id: 'd1', name: 'Nova mesa', externalKey: 'mesa-1', claimedBy: null }]
    const { result } = renderHook(
      () => useOfficeInteractionsRuntime(bridge, [occ('you')], 'you', testDocument, desks),
      { wrapper },
    )

    act(() =>
      bridge.emitServerMessage({
        type: 'desk-claimed',
        deskId: 'd1',
        externalKey: 'mesa-1',
        user: { id: 'ana', name: 'Ana' },
      }),
    )
    await waitFor(() => expect(result.current.desks[0]?.claimedBy?.name).toBe('Ana'))

    act(() => bridge.emitServerMessage({ type: 'desk-released', deskId: 'd1', externalKey: 'mesa-1' }))
    await waitFor(() => expect(result.current.desks[0]?.claimedBy).toBeNull())
  })
```

- [ ] **Step 8: Rodar e ver falhar**

```bash
pnpm --filter @legends/web exec vitest run src/office/useOfficeInteractions.test.tsx
```

Esperado: FAIL — `result.current.desks` é `undefined` (TS acusa a propriedade inexistente).

- [ ] **Step 9: Expor `desks` no retorno do hook**

Em `apps/web/src/office/useOfficeInteractions.ts`, no objeto retornado (~linha 449), acrescente como primeira propriedade:

```ts
  return {
    // Lista viva das mesas (claim/release chegam por WS) — a página usa pra
    // derivar o nome exibido da sala da mesa.
    desks: deskState,
    selected,
```

- [ ] **Step 10: Rodar e ver passar**

```bash
pnpm --filter @legends/web exec vitest run src/office/useOfficeInteractions.test.tsx
```

Esperado: PASS.

- [ ] **Step 11: Derivar o nome da zona na OfficePage**

Em `apps/web/src/pages/OfficePage.tsx`:

1. Acrescente `officeZoneDisplayName` ao import de `@legends/shared`.
2. **Remova** a linha 127 (`const zoneName = zone?.properties.name ?? null`).
3. Depois da linha que cria `interactions` (~208), adicione:

```ts
  // Sala com mesa reivindicada se apresenta como "Mesa de <dono>" — derivado
  // da lista viva de mesas do hook, não do documento publicado.
  const zoneName =
    zone && activeMap ? officeZoneDisplayName(activeMap.document, interactions.desks, zone) : null
```

Confira que `zoneName` só é usado depois disso (hoje o único consumo é o `zoneName={zoneName}` da MediaBar, ~linha 537).

- [ ] **Step 12: Checar tipos e rodar os testes tocados**

```bash
pnpm --filter @legends/web exec tsc --noEmit -p tsconfig.json
```

```bash
pnpm --filter @legends/web exec vitest run src/office/scenes/OfficeScene.test.ts src/office/useOfficeInteractions.test.tsx src/pages/OfficePage.test.tsx
```

Esperado: sem erros de tipo e todos os testes passando.

- [ ] **Step 13: Verificar no escritório rodando**

Com dois usuários (ou duas janelas), reivindique uma mesa que esteja dentro de uma sala e confirme, **sem recarregar**:

1. O rótulo verde da sala no mapa vira "Mesa de \<nome\>" nas duas janelas.
2. Entrando na sala, a MediaBar mostra "Você está em: Mesa de \<nome\>".
3. Ao liberar a mesa, os dois voltam ao nome próprio da sala.
4. No editor do admin, o nome da sala continua o original.

- [ ] **Step 14: Commit**

```bash
git add apps/web/src/office/scenes/OfficeScene.ts apps/web/src/office/scenes/OfficeScene.test.ts apps/web/src/office/useOfficeInteractions.ts apps/web/src/office/useOfficeInteractions.test.tsx apps/web/src/pages/OfficePage.tsx
git commit -m "feat(web): sala da mesa reivindicada exibe o nome do dono"
```

---

### Task 5: Verificação final

**Files:** nenhum (só execução)

- [ ] **Step 1: Rodar a suíte completa**

```bash
pnpm db:up
```

```bash
pnpm test
```

Esperado: tudo verde. (Os testes da API batem em Postgres real — sem `pnpm db:up` eles falham por conexão, não por regressão.)

- [ ] **Step 2: Build de todos os workspaces**

```bash
pnpm build
```

Esperado: sem erros.

- [ ] **Step 3: Se algo falhar**

Conserte na tarefa correspondente e refaça este passo. Não abra PR com suíte vermelha.
