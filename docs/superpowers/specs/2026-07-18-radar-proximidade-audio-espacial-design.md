# Radar de proximidade + áudio espacial — design

Data: 2026-07-18
Branch: `feat/radar-proximidade`

## Objetivo

No escritório virtual (espaço aberto), adicionar:

1. **Radar de proximidade** — miniatura no canto inferior esquerdo mostrando, como
   bolinhas verdes, quem está dentro do raio de proximidade (estilo Gather: painel
   escuro, círculo tracejado, ponto central = você).
2. **Áudio espacial** — volume e pan estéreo por posição relativa, para quem está
   dentro do raio (estilo Gather, sem depender de rotação de câmera).
3. **Melhoria pequena na `MediaBar`**: botão de microfone fica **vermelho** quando
   está mudo, para visibilidade melhor de que o mic está desligado.

## Contexto

O escritório já tem proximidade real: `PROXIMITY_RADIUS = 3` tiles (distância de
Chebyshev), `isWithinProximity(ax, ay, bx, by)` em `packages/shared/src/office-media.ts`.
`useOfficeMedia.ts` (`apps/web/src/office/media/`) já usa essa função em
`applyProximity()` para assinar/desassinar a track de áudio de cada participante remoto
conforme a distância — mas só no espaço aberto (`office-map-${mapId}-open`); dentro de
zonas (salas de reunião/copa) a sala LiveKit já é isolada e usa `autoSubscribe`.

Não existe hoje nenhum radar/minimap nem áudio espacial (pan) — o áudio remoto é tocado
via `<audio>` simples (`RemoteAudio.tsx`, `track.attach(el)`), sem Web Audio API.

Posições dos ocupantes (`x`, `y` em tiles) já chegam ao cliente via WS
(`OfficeOccupant` em `useOfficeSession`/`OfficeBridge`) e já alimentam `useOfficeMedia`.
Não é necessária nenhuma mudança de contrato ou de backend — tudo é client-side,
derivado de dados já sincronizados.

## Abordagem

### 1. Radar — `ProximityRadar.tsx`

Novo componente em `apps/web/src/office/media/ProximityRadar.tsx`, montado em
`OfficePage.tsx` como:

```tsx
<div className="absolute bottom-4 left-4 z-20">
  <ProximityRadar you={you} occupants={occupants} micEnabled={media.micEnabled} />
</div>
```

- **Visibilidade**: só renderiza quando `media.roomName === officeOpenRoom(mapId)`
  (checagem feita em `OfficePage.tsx`, que já tem `mapId` e `media.roomName`). Dentro de
  zonas, `null`.
- **Estilo**: painel `rounded-xl border border-white/10 bg-[#2f2f2f]/95 shadow-2xl
  backdrop-blur`, mesmo padrão do `RaiseHandQueue`/`MediaBar`. Área quadrada interna
  (~96px) com círculo tracejado (`border-dashed`) representando o raio de proximidade.
- **Cálculo**: para cada `occupant` em `isWithinProximity(you.x, you.y, occupant.x,
  occupant.y)`, projeta `dx = occupant.x - you.x`, `dy = occupant.y - you.y`,
  normalizado por `PROXIMITY_RADIUS` e escalado ao raio do círculo em px. Renderiza uma
  bolinha verde (`bg-green-500`) nessa posição (`position: absolute`, `transform:
  translate(...)`, componente puramente derivado — sem estado próprio além de props).
- **Ponto central** (você): sempre no centro. Cor **cinza** (`bg-white/40`) quando
  `micEnabled === false`; **verde preenchido** (`bg-green-500`) quando `micEnabled ===
  true` — reproduz a diferença entre os dois prints (mic mudo vs. mic aberto).
- Sem novo estado global, sem WS: `occupants` e `youId` já fluem para `OfficePage` via
  `useOfficeSession()`; `media.micEnabled` já vem de `useOfficeMedia`.

### 2. Áudio espacial — só no espaço aberto

Hoje o remoto é tocado assim (`RemoteAudio.tsx`):

```tsx
track.attach(audioEl) // <audio autoPlay>
```

Isso não permite pan. Nova abordagem: grafo Web Audio API, ativo **apenas** quando
`roomName === openRoom` (dentro de zonas, mantém `RemoteAudio` como está hoje, sem pan
— confirmado que não vale o custo/risco ali).

Novo módulo `apps/web/src/office/media/spatialAudio.ts`:

- `AudioContext` **singleton**, criado/retomado (`resume()`) no mesmo gesto de usuário
  que já dispara `createLocalAudioTrack()` em `useOfficeMedia.connectTo` (não pede
  permissão nova nem depende de autoplay sem gesto).
- Por participante remoto: `MediaStreamAudioSourceNode` a partir do
  `RemoteAudioTrack.mediaStreamTrack` → `GainNode` → `StereoPannerNode` →
  `context.destination`.
- Novo componente `SpatialRemoteAudio.tsx` (substitui `RemoteAudio` no open room):
  monta o grafo no mount, atualiza `gain.value`/`pan.value` a cada mudança de posição
  (props `you`, `occupant`), desconecta os nós no unmount.
- **Fórmula** (tiles, mesma unidade de `PROXIMITY_RADIUS`):
  - `dist = Math.hypot(dx, dy)` (euclidiana, mais suave que Chebyshev pra falloff)
  - `gain = clamp(1 - dist / PROXIMITY_RADIUS, 0, 1)` — cai a zero suavemente perto da
    borda do raio, evitando o "estalo" do corte binário de assinatura que já existe hoje
  - `pan = clamp(dx / PROXIMITY_RADIUS, -1, 1)` — só posição relativa na tela; **não**
    depende de `dir` (direção do avatar). A câmera do Phaser não gira, então "esquerda/
    direita" na tela não muda com a direção que o avatar está olhando — introduzir
    rotação aqui seria uma regra artificial sem contrapartida visual.
- Quem monta `SpatialRemoteAudio`/`RemoteAudio` (atualmente o componente que itera
  `media.remotes`) passa a decidir qual usar conforme `roomName === openRoom`.

### 3. Botão de mic vermelho quando mudo (`MediaBar.tsx`)

Hoje o botão de mic usa `toolButtonCls(media.micEnabled)`, que quando `false` cai no
estilo neutro compartilhado por todos os botões inativos (`border-white/5 bg-white/5
text-white/80`). Só o botão de **mic** ganha uma variante vermelha nesse estado —
os demais botões (câmera, tela, reações etc.) continuam usando `toolButtonCls` sem
mudança:

```tsx
className={`${
  media.micEnabled
    ? toolButtonCls(true)
    : 'border-error/60 bg-error/20 text-error shadow-[0_0_0_1px_rgb(var(--color-error)/0.15)]'
} disabled:cursor-not-allowed disabled:opacity-45 ${media.localSpeaking ? 'mic-speaking' : ''}`}
```

Continua desabilitado (`disabled:opacity-45`) nos casos já existentes (`micDisabled`:
sala não conectada, alto-falante ligado, área de silêncio) — o vermelho não se aplica
quando desabilitado (opacidade reduzida já sinaliza "indisponível" e evita confundir
com "mudo, mas disponível").

## Testes

- `ProximityRadar.test.tsx`: renderiza bolinha só para ocupantes dentro do raio;
  não renderiza fora do open room; ponto central muda de cor com `micEnabled`.
- `spatialAudio.test.ts`: fórmulas de `gain`/`pan` para posições conhecidas (mesma
  posição → gain 1/pan 0; borda do raio → gain ~0; metade do raio à direita → pan
  positivo).
- `MediaBar.test.tsx`: classe vermelha aplicada quando `micEnabled === false` e não
  desabilitado; classe padrão nos demais casos.

## Fora de escopo

- Miniatura real do mapa (paredes/móveis renderizados) no radar — fica o painel
  abstrato (círculo + bolinhas), sem segunda câmera Phaser.
- Atenuação de volume por "de costas" (cone de visão do avatar) — o pan não depende de
  `dir`.
- Áudio espacial dentro de zonas/salas fechadas — permanece sem pan, como hoje.
