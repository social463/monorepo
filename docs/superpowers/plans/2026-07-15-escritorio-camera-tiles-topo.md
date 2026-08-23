# Escritório — câmeras no topo, com modo expandido — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover a faixa de câmeras/telas (`MediaTiles`) do rodapé pro topo da tela e adicionar um modo expandido (grade em tela cheia), sem tocar na `MediaBar` nem no fluxo próprio de expandir tela compartilhada.

**Architecture:** `MediaTiles` ganha um estado controlado `expanded`/`onToggleExpanded` (dono em `OfficePage`, como `zoom`/`peopleSidebarOpen` já são) que alterna entre a faixa fina atual e uma grade `fixed inset-0` reaproveitando o mesmo `VideoTile` interno (com uma `className` maior). `OfficePage` divide o antigo container único (`MediaTiles` + `MediaBar` juntos embaixo) em dois: câmeras no topo, controles embaixo — inalterados um em relação ao outro. `BroadcastBanner` ganha uma prop `pushDown` pra descer quando a faixa de câmeras estiver visível, evitando sobreposição.

**Tech Stack:** React 18, TypeScript strict, Tailwind 3, Vitest + Testing Library (`jsdom`).

## Global Constraints

- TypeScript strict, ESM puro — sem `any`.
- O overlay de clique-pra-expandir da **tela compartilhada** (`role="dialog"`, `aria-label="Tela compartilhada em destaque"`) não muda de comportamento, inclusive dentro da grade expandida.
- Sem persistir o estado expandido/recolhido entre sessões — nasce sempre recolhido (`expanded = false`).
- `MediaBar` e `SelfCameraPreview` não são tocados por este plano.
- `pnpm --filter @legends/web exec tsc --noEmit` deve ficar limpo (o `build`/Vitest não fazem typecheck completo do projeto).
- Rode `pnpm --filter @legends/web test` antes de considerar cada task concluída.

---

## Task 1: `MediaTiles` — alternar entre faixa fina e grade expandida

**Files:**
- Modify: `apps/web/src/office/media/MediaTiles.tsx`
- Test: `apps/web/src/office/media/MediaTiles.test.tsx`

**Interfaces:**
- Produces: `MediaTiles({ remotes, local, expanded, onToggleExpanded })` — `expanded?: boolean` (default `false`), `onToggleExpanded?: () => void` (default no-op). Ambos opcionais com default pra não quebrar os 5 testes existentes que ainda não passam essas props.

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/web/src/office/media/MediaTiles.test.tsx`, o fim do arquivo:

```tsx
  it('`local` sozinho (sem ninguém com câmera/tela) já é suficiente pra mostrar a faixa', () => {
    const { container } = render(
      <MediaTiles remotes={[remote()]} local={{ track: fakeLocalVideoTrack(), name: 'Você' }} />,
    )
    expect(container.querySelector('.bg-surface-container')).not.toBeNull()
  })
})
```

vira (adiciona 6 testes novos antes do `})` final do `describe`):

```tsx
  it('`local` sozinho (sem ninguém com câmera/tela) já é suficiente pra mostrar a faixa', () => {
    const { container } = render(
      <MediaTiles remotes={[remote()]} local={{ track: fakeLocalVideoTrack(), name: 'Você' }} />,
    )
    expect(container.querySelector('.bg-surface-container')).not.toBeNull()
  })

  it('mostra o botão de expandir quando há algo visível e não está expandido; clicar chama onToggleExpanded', () => {
    const onToggleExpanded = vi.fn()
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    render(<MediaTiles remotes={remotes} expanded={false} onToggleExpanded={onToggleExpanded} />)

    fireEvent.click(screen.getByRole('button', { name: 'Expandir câmeras' }))
    expect(onToggleExpanded).toHaveBeenCalledOnce()
  })

  it('sem nada visível, o botão de expandir não aparece', () => {
    render(<MediaTiles remotes={[remote()]} expanded={false} onToggleExpanded={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Expandir câmeras' })).not.toBeInTheDocument()
  })

  it('expanded=true renderiza a grade em tela cheia com botão de recolher', () => {
    const onToggleExpanded = vi.fn()
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={onToggleExpanded} />)

    expect(screen.getByRole('region', { name: 'Câmeras em tela cheia' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Recolher câmeras' }))
    expect(onToggleExpanded).toHaveBeenCalledOnce()
  })

  it('Escape recolhe quando expandido; não faz nada quando já recolhido', () => {
    const onToggleExpanded = vi.fn()
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    const { rerender } = render(<MediaTiles remotes={remotes} expanded={false} onToggleExpanded={onToggleExpanded} />)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onToggleExpanded).not.toHaveBeenCalled()

    rerender(<MediaTiles remotes={remotes} expanded onToggleExpanded={onToggleExpanded} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onToggleExpanded).toHaveBeenCalledOnce()
  })

  it('auto-recolhe quando ninguém mais tem câmera/tela visível enquanto expandido', () => {
    const onToggleExpanded = vi.fn()
    const { rerender } = render(
      <MediaTiles remotes={[remote({ cameraTrack: fakeVideoTrack() })]} expanded onToggleExpanded={onToggleExpanded} />,
    )
    expect(onToggleExpanded).not.toHaveBeenCalled()

    rerender(<MediaTiles remotes={[remote()]} expanded onToggleExpanded={onToggleExpanded} />)
    expect(onToggleExpanded).toHaveBeenCalledOnce()
  })

  it('tela compartilhada dentro da grade expandida continua abrindo o overlay próprio', () => {
    const remotes = [remote({ screenTrack: fakeVideoTrack() })]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    fireEvent.click(screen.getByText('Tela de Ana'))
    expect(screen.getByRole('dialog', { name: 'Tela compartilhada em destaque' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaTiles.test.tsx`
Expected: FAIL — `MediaTiles` não aceita `expanded`/`onToggleExpanded` (TS) e nenhum botão "Expandir câmeras"/"Recolher câmeras" existe ainda.

- [ ] **Step 3: Implementar o estado expanded/collapsed em `MediaTiles.tsx`**

Substitua o conteúdo inteiro de `apps/web/src/office/media/MediaTiles.tsx` por:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client'
import type { RemoteMedia } from './useOfficeMedia'
import { RemoteAudio } from './RemoteAudio'
import { Icon } from '../../components/Icon'

function VideoTile({
  track,
  label,
  mirrored = false,
  onClick,
  className = 'w-40 shrink-0',
}: {
  track: RemoteVideoTrack | LocalVideoTrack
  label: string
  mirrored?: boolean
  onClick?: () => void
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])
  return (
    <figure className={`${className} cursor-pointer`} onClick={onClick}>
      <video
        ref={ref}
        autoPlay
        playsInline
        className={`w-full rounded-md bg-black ${mirrored ? 'scale-x-[-1]' : ''}`}
      />
      <figcaption className="truncate font-label text-label-sm text-on-surface-variant">{label}</figcaption>
    </figure>
  )
}

/**
 * Faixa com a mídia de quem você assina agora: áudios invisíveis, câmeras e
 * telas compartilhadas. Clicar numa tela expande num overlay. Dentro de uma
 * sala de reunião, `local` inclui seu próprio tile de câmera no grid.
 * `expanded` alterna entre a faixa fina (padrão) e uma grade em tela cheia.
 */
export function MediaTiles({
  remotes,
  local,
  expanded = false,
  onToggleExpanded = () => {},
}: {
  remotes: RemoteMedia[]
  local?: { track: LocalVideoTrack; name: string } | null
  expanded?: boolean
  onToggleExpanded?: () => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const expandedScreen = remotes.find((r) => r.userId === expandedId)?.screenTrack ?? null

  // Quem estava expandido parou de compartilhar (ou saiu): fecha de vez, senão
  // um novo compartilhamento da mesma pessoa reabriria o overlay sozinho.
  useEffect(() => {
    if (expandedId && !remotes.some((r) => r.userId === expandedId && r.screenTrack)) {
      setExpandedId(null)
    }
  }, [remotes, expandedId])

  const hasVisible = !!local || remotes.some((r) => r.cameraTrack || r.screenTrack)

  // Ninguém mais tem câmera/tela visível enquanto a grade está aberta: recolhe
  // sozinha, senão fica uma grade vazia ocupando a tela.
  useEffect(() => {
    if (expanded && !hasVisible) onToggleExpanded()
  }, [expanded, hasVisible, onToggleExpanded])

  // Esc fecha a grade em tela cheia, mesmo padrão usado no CharacterCard.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onToggleExpanded()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, onToggleExpanded])

  return (
    <div>
      {remotes.map((r) => r.audioTrack && <RemoteAudio key={`a-${r.userId}`} track={r.audioTrack} />)}

      {hasVisible && !expanded && (
        <div className="flex items-center gap-sm rounded-lg bg-surface-container p-md">
          <div className="flex flex-1 gap-md overflow-x-auto">
            {local && <VideoTile track={local.track} label={local.name} mirrored />}
            {remotes.map((r) => (
              <div key={r.userId} className="flex gap-md">
                {r.cameraTrack && <VideoTile track={r.cameraTrack} label={r.name} />}
                {r.screenTrack && (
                  <VideoTile
                    track={r.screenTrack}
                    label={`Tela de ${r.name}`}
                    onClick={() => setExpandedId(r.userId)}
                  />
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            aria-label="Expandir câmeras"
            onClick={onToggleExpanded}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest"
          >
            <Icon name="fullscreen" className="text-[20px]" />
          </button>
        </div>
      )}

      {expanded && hasVisible && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/90 p-lg"
          role="region"
          aria-label="Câmeras em tela cheia"
        >
          <button
            type="button"
            aria-label="Recolher câmeras"
            onClick={onToggleExpanded}
            className="fixed right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <Icon name="fullscreen_exit" className="text-[22px]" />
          </button>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-md">
            {local && <VideoTile track={local.track} label={local.name} mirrored className="w-full" />}
            {remotes.map((r) => (
              // display:contents: o wrapper não vira ele mesmo uma célula do
              // grid — câmera e tela da mesma pessoa entram como células
              // independentes, como qualquer outro tile.
              <div key={r.userId} className="contents">
                {r.cameraTrack && <VideoTile track={r.cameraTrack} label={r.name} className="w-full" />}
                {r.screenTrack && (
                  <VideoTile
                    track={r.screenTrack}
                    label={`Tela de ${r.name}`}
                    onClick={() => setExpandedId(r.userId)}
                    className="w-full"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {expandedScreen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-lg"
          onClick={() => setExpandedId(null)}
          role="dialog"
          aria-label="Tela compartilhada em destaque"
        >
          <VideoTile track={expandedScreen} label="Clique para fechar" />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaTiles.test.tsx`
Expected: PASS (todos os 11 testes: 5 já existentes + 6 novos).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/MediaTiles.tsx apps/web/src/office/media/MediaTiles.test.tsx
git commit -m "feat(office): alternar MediaTiles entre faixa fina e grade em tela cheia"
```

---

## Task 2: `BroadcastBanner` — descer quando a faixa de câmeras estiver visível

**Files:**
- Modify: `apps/web/src/office/media/BroadcastBanner.tsx`
- Test: `apps/web/src/office/media/BroadcastBanner.test.tsx` (novo — não existe ainda)

**Interfaces:**
- Produces: `BroadcastBanner({ speakers, tracks, pushDown })` — `pushDown?: boolean` (default `false`). Quando `true`, usa `top-28` em vez de `top-4`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/web/src/office/media/BroadcastBanner.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BroadcastBanner } from './BroadcastBanner'

describe('BroadcastBanner', () => {
  it('usa top-4 por padrão (pushDown ausente)', () => {
    render(<BroadcastBanner speakers={['Ana']} tracks={[]} />)
    expect(screen.getByRole('status')).toHaveClass('top-4')
    expect(screen.getByRole('status')).not.toHaveClass('top-28')
  })

  it('usa top-28 quando pushDown é true', () => {
    render(<BroadcastBanner speakers={['Ana']} tracks={[]} pushDown />)
    expect(screen.getByRole('status')).toHaveClass('top-28')
    expect(screen.getByRole('status')).not.toHaveClass('top-4')
  })

  it('sem speakers, não renderiza nada visível independente de pushDown', () => {
    const { container } = render(<BroadcastBanner speakers={[]} tracks={[]} pushDown />)
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/BroadcastBanner.test.tsx`
Expected: FAIL — `BroadcastBanner` não aceita `pushDown` (TS) e a classe é sempre `top-4`.

- [ ] **Step 3: Implementar `pushDown` em `BroadcastBanner.tsx`**

Substitua o conteúdo inteiro de `apps/web/src/office/media/BroadcastBanner.tsx` por:

```tsx
import type { RemoteAudioTrack } from 'livekit-client'
import { RemoteAudio } from './RemoteAudio'

/**
 * Aviso global de "alguém no alto-falante" + os áudios do broadcast.
 * `pushDown` desce o aviso (top-28 em vez de top-4) pra não sobrepor a faixa
 * de câmeras do MediaTiles quando ela estiver visível no topo da tela.
 */
export function BroadcastBanner({
  speakers,
  tracks,
  pushDown = false,
}: {
  speakers: string[]
  tracks: RemoteAudioTrack[]
  pushDown?: boolean
}) {
  return (
    <>
      {tracks.map((track, index) => (
        <RemoteAudio key={track.sid ?? index} track={track} />
      ))}
      {speakers.length > 0 && (
        <div
          role="status"
          className={`pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 rounded-full border border-primary/40 bg-surface-container/95 px-lg py-sm font-label text-label-md text-on-surface shadow-lg backdrop-blur ${pushDown ? 'top-28' : 'top-4'}`}
        >
          📢 {speakers.join(', ')} no alto-falante
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/BroadcastBanner.test.tsx`
Expected: PASS (todos os 3 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/BroadcastBanner.tsx apps/web/src/office/media/BroadcastBanner.test.tsx
git commit -m "feat(office): BroadcastBanner desce quando a faixa de câmeras está visível"
```

---

## Task 3: `OfficePage` — mover a faixa de câmeras pro topo

**Files:**
- Modify: `apps/web/src/pages/OfficePage.tsx`

**Interfaces:**
- Consumes: `MediaTiles`'s `expanded`/`onToggleExpanded` (Task 1); `BroadcastBanner`'s `pushDown` (Task 2).

- [ ] **Step 1: Adicionar o estado `camerasExpanded` em `OfficePage.tsx`**

O bloco de `useState`:

```tsx
  const [zoom, setZoom] = useState(INITIAL_ZOOM)
  const [nearbyChatOpen, setNearbyChatOpen] = useState(false)
  const [peopleSidebarOpen, setPeopleSidebarOpen] = useState(false)
  const [peopleSearch, setPeopleSearch] = useState('')
```

vira:

```tsx
  const [zoom, setZoom] = useState(INITIAL_ZOOM)
  const [nearbyChatOpen, setNearbyChatOpen] = useState(false)
  const [peopleSidebarOpen, setPeopleSidebarOpen] = useState(false)
  const [peopleSearch, setPeopleSearch] = useState('')
  const [camerasExpanded, setCamerasExpanded] = useState(false)
```

- [ ] **Step 2: Calcular `topMediaVisible` pro `BroadcastBanner`**

O bloco:

```tsx
  const you = occupants.find((o) => o.userId === youId) ?? null
  const zoneName = you ? (zoneAt(you.x, you.y)?.name ?? null) : null
  const inMeetingRoom = zoneName !== null
  const selfCamera =
    media.cameraEnabled && media.localCameraTrack
      ? { track: media.localCameraTrack, name: you?.name ?? 'Você' }
      : null
```

vira (adiciona `topMediaVisible` logo depois):

```tsx
  const you = occupants.find((o) => o.userId === youId) ?? null
  const zoneName = you ? (zoneAt(you.x, you.y)?.name ?? null) : null
  const inMeetingRoom = zoneName !== null
  const selfCamera =
    media.cameraEnabled && media.localCameraTrack
      ? { track: media.localCameraTrack, name: you?.name ?? 'Você' }
      : null
  // Mesma condição que o MediaTiles usa internamente pra decidir se a faixa
  // do topo aparece — calculada aqui só pra avisar o BroadcastBanner, sem
  // expor o hasVisible do MediaTiles pra fora dele.
  const topMediaVisible =
    !!(inMeetingRoom ? selfCamera : null) || media.remotes.some((r) => r.cameraTrack || r.screenTrack)
```

- [ ] **Step 3: Passar `pushDown` pro `BroadcastBanner`**

A linha:

```tsx
      <BroadcastBanner speakers={broadcast.speakers} tracks={broadcast.broadcastTracks} />
```

vira:

```tsx
      <BroadcastBanner
        speakers={broadcast.speakers}
        tracks={broadcast.broadcastTracks}
        pushDown={topMediaVisible}
      />
```

- [ ] **Step 4: Separar o container de câmeras (topo) do de controles (rodapé)**

O bloco:

```tsx
      {/* Mídia flutuante: tiles de vídeo/tela acima da barra de controles,
          centralizados embaixo — sem disputar espaço com o zoom (à direita). */}
      <div
        className="absolute bottom-3 left-1/2 z-10 flex w-full max-w-2xl -translate-x-1/2 flex-col gap-sm px-4"
        onWheel={(event) => event.stopPropagation()}
      >
        <MediaTiles remotes={media.remotes} local={inMeetingRoom ? selfCamera : null} />
        <MediaBar
          media={media}
          zoneName={zoneName}
          broadcast={broadcast}
          canBroadcast={canBroadcast}
          youName={you?.name}
          onLeave={() => navigate('/')}
          onChatOpenChange={setNearbyChatOpen}
          onNearbyMessage={(text, kind) => {
            bridge.emitClientMessage({ type: 'nearby-message', text, kind })
          }}
          onReaction={(reaction) => {
            bridge.emitClientMessage({ type: 'nearby-message', text: reaction, kind: 'speech' })
          }}
        />
      </div>
```

vira:

```tsx
      {/* Câmeras: faixa fina no topo (ou grade em tela cheia quando
          expandida) — fora do fluxo dos controles, sem competir por espaço
          embaixo. */}
      <div
        className="absolute top-3 left-1/2 z-10 flex w-full max-w-2xl -translate-x-1/2 flex-col gap-sm px-4"
        onWheel={(event) => event.stopPropagation()}
      >
        <MediaTiles
          remotes={media.remotes}
          local={inMeetingRoom ? selfCamera : null}
          expanded={camerasExpanded}
          onToggleExpanded={() => setCamerasExpanded((value) => !value)}
        />
      </div>

      {/* Controles: barra fixa embaixo, sempre acessível independente do
          estado das câmeras. */}
      <div
        className="absolute bottom-3 left-1/2 z-10 flex w-full max-w-2xl -translate-x-1/2 flex-col gap-sm px-4"
        onWheel={(event) => event.stopPropagation()}
      >
        <MediaBar
          media={media}
          zoneName={zoneName}
          broadcast={broadcast}
          canBroadcast={canBroadcast}
          youName={you?.name}
          onLeave={() => navigate('/')}
          onChatOpenChange={setNearbyChatOpen}
          onNearbyMessage={(text, kind) => {
            bridge.emitClientMessage({ type: 'nearby-message', text, kind })
          }}
          onReaction={(reaction) => {
            bridge.emitClientMessage({ type: 'nearby-message', text: reaction, kind: 'speech' })
          }}
        />
      </div>
```

- [ ] **Step 5: Rodar o typecheck e os testes do web**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: PASS — sem erros de tipo.

Run: `pnpm --filter @legends/web test`
Expected: PASS — toda a suíte do `apps/web` (incluindo `OfficePage.test.tsx`, que não precisa de mudanças: os mocks atuais de `useOfficeMedia`/`useOfficeBroadcast` nunca deixam `hasVisible` verdadeiro, então nenhuma asserção existente quebra).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/OfficePage.tsx
git commit -m "feat(office): mover a faixa de câmeras pro topo da tela"
```

- [ ] **Step 7: Verificação manual (dois navegadores/abas, com Postgres e LiveKit de dev no ar)**

1. `pnpm db:up` e `pnpm dev` na raiz.
2. Login com dois usuários (ou duas abas anônimas), entrar no escritório, aproximar as posições ou entrar na mesma sala de reunião.
3. Ligar a câmera nos dois → a faixa fina aparece no **topo** (não mais embaixo).
4. Clicar no botão de expandir (ícone de tela cheia) → grade cobrindo a tela, tiles maiores; o botão de recolher e a tecla Esc voltam pra faixa fina.
5. Desligar as duas câmeras enquanto expandido → a grade fecha sozinha.
6. Com alguém no alto-falante e a faixa de câmeras visível ao mesmo tempo → o aviso "no alto-falante" aparece abaixo da faixa, sem sobrepor.
7. Compartilhar tela dentro do modo expandido → clicar nela abre o overlay de tela por cima da grade, como já funcionava antes.

---

## Self-Review

**Cobertura do spec:** faixa de câmeras migrada pro topo (Task 3), alternância faixa fina/grade expandida com botão dedicado (Task 1), auto-recolhimento quando ninguém mais tem câmera/tela visível (Task 1), Escape fecha o modo expandido (Task 1), overlay de tela compartilhada inalterado inclusive dentro da grade (Task 1, testado), `BroadcastBanner` reposicionado pra não competir com a faixa (Task 2, Task 3). Nenhuma mudança na `MediaBar` nem no `SelfCameraPreview`, conforme "Fora" do escopo da spec.

**Placeholders:** nenhum `TBD`/`TODO`; todo passo de código tem o código completo.

**Consistência de tipos:** `expanded?: boolean` / `onToggleExpanded?: () => void` definidos em `MediaTiles` (Task 1) e consumidos com os mesmos nomes em `OfficePage` (Task 3); `pushDown?: boolean` definido em `BroadcastBanner` (Task 2) e consumido com o mesmo nome em `OfficePage` (Task 3, `pushDown={topMediaVisible}`).
