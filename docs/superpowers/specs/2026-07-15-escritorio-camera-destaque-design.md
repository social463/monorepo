# Escritório — modo de destaque na grade expandida de câmeras

**Data:** 2026-07-15
**Status:** design aprovado (aguardando review do spec)
**Depende de:** `2026-07-15-escritorio-camera-tiles-topo-design.md` (grade expandida
`MediaTiles`, estado `expanded`/`onToggleExpanded`)

## Problema

A grade expandida (tela cheia) mostra todos os tiles de câmera/tela do mesmo
tamanho, num grid uniforme. Numa reunião com várias câmeras ligadas, isso vira
um grid ruim de acompanhar — não dá pra saber pra quem prestar atenção, e
quem está sem câmera simplesmente não aparece (fica invisível, mesmo estando
na sala). Falta um jeito de destacar quem interessa, no estilo Google Meet:
um tile grande em foco e o resto em miniatura, com um quadrado de
avatar/iniciais pra quem não tem câmera ligada.

## Escopo do v1

**Dentro:**
- **Só a grade expandida.** A faixa fina do topo (`!expanded`) não muda em
  nada — continua só com quem tem câmera/tela ativa, do jeito que já é hoje.
- Na grade expandida, **todo participante da sala/proximidade vira um
  quadrado** — com câmera (se ligada), com tela compartilhada (se
  compartilhando), ou um quadrado de avatar/iniciais (se não tem nenhuma das
  duas). Isso inclui o próprio usuário (self tile).
- **Clicar em qualquer tile** (câmera, tela compartilhada ou avatar) o coloca
  em destaque: layout de duas colunas, tile grande à esquerda + coluna de
  miniaturas à direita com o resto.
- Clicar numa tela compartilhada dentro da grade expandida agora **destaca
  ela** (substitui o dialog separado de tela que existe hoje) — fora da grade
  expandida, esse dialog não muda.
- Destaque nasce automaticamente em cima da primeira tela compartilhada ativa,
  se houver uma quando a grade abre; senão nasce sem ninguém destacado (grid
  uniforme).
- Se quem está destacado perde toda mídia visível (desliga câmera, para de
  compartilhar tela, ou sai da sala/proximidade), o destaque troca sozinho pra
  outro tile com mídia ativa (tela compartilhada tem prioridade, depois
  câmera); se não sobrar nenhum, volta pro grid uniforme.

**Fora (deliberadamente):**
- Mudar a faixa fina do topo — continua só com câmera/tela, sem avatar e sem
  destaque.
- Persistir o destaque entre sessões ou sincronizar entre participantes — é
  estado 100% local de cada `MediaTiles` (`para ele`, como pedido), nasce sem
  pin toda vez que a grade expande.
- Redimensionar tiles individualmente fora do esquema destaque/miniatura, ou
  reordenar a coluna de miniaturas por quem está falando.
- Trocar a condição que abre o botão "Expandir câmeras" na faixa fina — segue
  gated em `hasVisible` (alguém com câmera/tela ativa), mesmo que dentro da
  grade agora apareçam avatares também.

## Decisões de design

- **Avatar por ausência de mídia, não por presença de mídia parcial.** Cada
  pessoa contribui com um tile por fonte de mídia que tem (câmera e/ou tela);
  só ganha o quadrado de avatar quando não tem nenhuma das duas. Ou seja,
  alguém compartilhando tela sem câmera ligada mostra só o tile de tela — não
  ganha avatar extra pra representar a câmera ausente.
- **Uma função de resolução única cobre abertura, escolha manual e perda do
  alvo:** dado o pin manual (se houver), (1) usa o pin se ainda for válido;
  (2) senão primeira tela compartilhada ativa; (3) senão primeira câmera ativa
  (local primeiro, depois remotos, na ordem que já existe no array); (4)
  senão `null` (grid uniforme). Aplicar essa mesma função tanto na abertura
  da grade (pin nasce `null`) quanto every vez que os dados mudam evita ter
  regras separadas pra "estado inicial" e "recuperação de foco perdido".
- **Pin manual em avatar é permitido, troca automática nunca pousa nele.**
  O usuário pode clicar num quadrado de avatar pra destacá-lo deliberadamente
  (útil pra "olhar" pra alguém specific mesmo sem câmera), mas a resolução
  automática (passos 2–3 acima) nunca escolhe um avatar sozinha — só mídia
  real. Evita que o destaque pouse arbitrariamente num quadrado estático
  quando ainda existe câmera/tela ativa em outro tile.
- **`RemoteMedia` ganha campos de avatar em vez de o `MediaTiles` receber uma
  prop `occupants` separada.** `useOfficeMedia` já tem acesso a `occupants`
  (parâmetro do hook); casar por `userId` dentro de `syncRemotes` mantém o
  `MediaTiles` recebendo só o que ele já recebe hoje (`remotes`/`local`), sem
  duplicar a fonte de identidade de quem está na sala.
- **`local` passa a existir sempre que você está em sala, não só com câmera
  ligada.** Hoje `OfficePage` só monta `local` quando `cameraEnabled`. Pra o
  self tile aparecer com avatar quando a câmera está desligada, `local` passa
  a ser montado sempre que `inMeetingRoom`, com `track` opcional.

## Arquitetura

### 1. `useOfficeMedia.ts` — avatar em `RemoteMedia`

```ts
export interface RemoteMedia {
  userId: string
  name: string
  audioTrack: RemoteAudioTrack | null
  cameraTrack: RemoteVideoTrack | null
  screenTrack: RemoteVideoTrack | null
  photoUrl?: string | null
  avatarStyle?: AvatarStyleKey | null
  avatarSeed?: string | null
  avatarOptions?: AvatarOptions | null
}
```

Em `syncRemotes`, ao montar cada `media: RemoteMedia`, casar
`occupantsRef.current.find((o) => o.userId === participant.identity)` e
copiar os campos de avatar do occupant encontrado (ausente = tudo `null`,
cai pras iniciais via `Avatar`).

### 2. `OfficePage.tsx` — `local` sempre presente em sala

```ts
const local =
  inMeetingRoom && you
    ? {
        name: you.name,
        track: selfCamera?.track ?? null,
        photoUrl: you.photoUrl,
        avatarStyle: you.avatarStyle,
        avatarSeed: you.avatarSeed,
        avatarOptions: you.avatarOptions,
      }
    : null
```

`selfCamera` continua existindo só pra alimentar o `SelfCameraPreview` fora de
sala; dentro de sala, `local.track` é que decide se o self tile mostra vídeo
ou avatar.

### 3. `MediaTiles.tsx` — tile unificado + destaque

```ts
type TileKey = `local` | `cam:${string}` | `screen:${string}` | `avatar:${string}`

const [featuredPin, setFeaturedPin] = useState<TileKey | null>(null)

// reseta o pin toda vez que a grade expande de novo
useEffect(() => {
  if (expanded) setFeaturedPin(null)
}, [expanded])
```

Construção da lista de tiles (mesma pra local e remotos): pra cada
participante, se `cameraTrack` existe → tile de câmera (`cam:${id}`); se
`screenTrack` existe → tile de tela (`screen:${id}`), clicável e destacável
como qualquer outro; se nenhum dos dois → tile de avatar (`avatar:${id}`)
usando `<Avatar user={...} />` num wrapper quadrado (`aspect-square rounded-md
bg-surface-container-highest flex items-center justify-center`), mesmo
`figcaption` de nome que o `VideoTile`.

```ts
function resolveFeatured(tiles: Tile[], pin: TileKey | null): Tile | null {
  const valid = pin && tiles.find((t) => t.key === pin)
  if (valid) return valid
  return tiles.find((t) => t.kind === 'screen') ?? tiles.find((t) => t.kind === 'camera') ?? null
}
```

- **Grid uniforme** (`resolveFeatured(...) === null`): mesmo
  `grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-md` de hoje, agora
  iterando sobre a lista de tiles (vídeo ou avatar) em vez de só
  `cameraTrack`/`screenTrack`. Cada tile ganha `onClick={() =>
  setFeaturedPin(tile.key)}`.
- **Com destaque** (`resolveFeatured(...) !== null`): `flex gap-md` — tile
  destacado em `flex-1` à esquerda (vídeo grande ou avatar grande, mesmo
  componente em tamanho maior), coluna `flex w-56 shrink-0 flex-col gap-sm
  overflow-y-auto` à direita com o resto dos tiles (excluindo o destacado),
  cada um clicável pra trocar o pin.
- Tela compartilhada, **dentro da grade expandida**, deixa de abrir o
  `expandedScreen` (dialog `fixed inset-0 z-50` separado) — vira só mais um
  tile clicável que participa da resolução de destaque. O dialog separado
  (`expandedId`/`expandedScreen`) **continua existindo e sendo usado**, só
  que exclusivamente a partir de cliques na tela compartilhada da **faixa
  fina** (`!expanded`), que não muda em nada — o `onClick` do tile de tela
  na grade expandida passa a chamar `setFeaturedPin` em vez de
  `setExpandedId`.

## Fluxos

1. **Grade expandida abre com alguém compartilhando tela** → essa tela já
   nasce em destaque; miniaturas do resto (câmeras + avatares) na coluna da
   direita.
2. **Grade expandida abre sem tela compartilhada, com câmeras ligadas** →
   nasce em grid uniforme (nenhuma câmera "ganha" destaque sozinha);
   clicar numa câmera a destaca.
3. **Usuário clica no quadrado de avatar de alguém sem câmera** → esse avatar
   vira o tile grande à esquerda (mesmo sem vídeo).
4. **Pessoa destacada desliga a câmera** → resolução automática troca pra
   outra tela compartilhada ativa, senão outra câmera ativa, senão volta pro
   grid uniforme.
5. **Última pessoa com câmera/tela desliga tudo** (`hasVisible` vira `false`)
   → grade expandida fecha sozinha (comportamento já existente, inalterado).

## Erros e bordas

- **Ninguém tem câmera/tela e a grade nem chega a abrir** — inalterado: o
  botão "Expandir câmeras" na faixa fina só aparece com `hasVisible`, então
  o cenário "grade só com avatares" não acontece por essa via. Ele só existe
  como consequência de alguém desligar a própria câmera **depois** que a
  grade já está aberta (fluxo 4/5 acima).
- **`expandedId`/`expandedScreen` (dialog de tela separado) continua vivo,
  só que só alcançável pela faixa fina** — clique em tela compartilhada
  fora da grade expandida (`!expanded`) segue chamando `setExpandedId` e
  abrindo o dialog, exatamente como hoje; dentro da grade expandida,
  o mesmo clique agora chama `setFeaturedPin` em vez disso. Os dois estados
  (`expandedId` e `featuredPin`) coexistem, cada um só acionável a partir do
  seu contexto (`!expanded` vs `expanded`).
- **Pin aponta pra alguém que saiu da sala** — `resolveFeatured` já cobre:
  o tile some da lista, `valid` fica falsy, cai pra resolução automática.
- **Dois cliques rápidos em tiles diferentes** — `setFeaturedPin` é
  síncrono por render, último clique processado vence; sem debounce
  necessário.

## Testes

- **`MediaTiles.test.tsx`**:
  - Grid uniforme mostra quadrado de avatar pra quem não tem `cameraTrack`
    nem `screenTrack` (local e remoto).
  - Clicar num tile de câmera/tela/avatar muda o layout pra "com destaque"
    (tile grande + coluna de miniaturas) e o tile clicado é o que aparece
    grande.
  - Grade abre com uma `screenTrack` ativa entre os remotos → já nasce com
    essa tela destacada, sem clique nenhum.
  - Grade abre sem `screenTrack` nenhuma → nasce em grid uniforme.
  - Destacar alguém, depois remover a câmera dele de `remotes` (re-render sem
    `cameraTrack`) → destaque troca pra outra câmera/tela ativa que ainda
    exista, ou cai pro grid uniforme se não sobrar nenhuma.
  - Clicar numa tela compartilhada dentro da grade expandida **não** abre
    mais o dialog `role="dialog"` separado — ela vira o tile destacado.
  - Clicar numa tela compartilhada na **faixa fina** (`!expanded`) continua
    abrindo o dialog `role="dialog"` separado, sem nenhuma mudança.
- **`useOfficeMedia.test.ts`**: `syncRemotes` preenche os campos de avatar de
  `RemoteMedia` a partir do `occupants` correspondente (por `userId`); occupant
  sem avatar customizado deixa os campos `null`/`undefined` (cai pra iniciais).
- **Manual**: reunião com 2 câmeras + 1 tela compartilhada + 1 pessoa só de
  áudio → grid uniforme mostra os 4 quadrados (2 vídeo, 1 tela, 1 avatar);
  clicar na tela destaca; desligar a tela compartilhada troca o destaque pra
  uma das câmeras; desligar as duas câmeras também volta pro grid uniforme
  (avatar da pessoa só-áudio continua visível, sem destaque).
