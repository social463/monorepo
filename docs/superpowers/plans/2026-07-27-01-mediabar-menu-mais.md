# MediaBar — menu "Mais" e realce visual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar a `MediaBar` do escritório ao vivo em barra principal enxuta + menu "Mais" (popover com as ações secundárias), e aplicar um realce visual pontual (glow verde-neon no indicador online, destaque nos botões-chave, hover com glow, fundo/borda do container migrados para os tokens de tema).

**Architecture:** Extrair um novo componente de apresentação `MediaBarMoreMenu` (mesmo padrão de `DeviceMenu`/`CameraBackgroundMenu`: recebe estado/handlers via props, fecha em outside-click/Esc). `MediaBar` reloca os botões secundários para dentro dele e mantém os mesmos handlers/condições de exibição de hoje — só muda onde renderizam. CSS novo fica em `apps/web/src/index.css`, seguindo o padrão de glow já usado ali (`emblem-glow`, `mic-speaking`).

**Tech Stack:** React 18, Tailwind 3, Vitest + Testing Library (jsdom).

## Global Constraints

- Nenhuma ação nova, nenhuma mudança de regra de negócio — só reorganização de layout e acabamento visual dos controles já existentes (spec `docs/superpowers/specs/2026-07-27-mediabar-menu-mais-design.md`).
- Fundo/borda do container principal migram para `bg-surface/70 backdrop-blur-xl border-primary-container/20`, mantendo `rounded-2xl` (não adota o `rounded-full` do mockup).
- Não tocar em nenhum outro componente flutuante do escritório (`OfficePipWindow`, `DeviceMenu`, `CameraBackgroundMenu`, `KnockRequestModal`, etc.) — a inconsistência visual temporária é aceita.
- Cores usam exclusivamente tokens já existentes no tema (`primary`, `primary-container`, `surface`) — nenhuma cor nova.
- Mensagens/labels voltados ao usuário em português (aria-labels e textos visíveis).
- Rodar só o(s) arquivo(s) de teste alterados durante a implementação; `pnpm test` completo só como verificação final.

---

### Task 1: Glow no indicador de presença "online"

**Files:**
- Modify: `apps/web/src/index.css:133-135` (inserir bloco novo entre o fim de `.mic-speaking` e o comentário de scrollbars)
- Modify: `apps/web/src/office/media/MediaBar.tsx:460-463` (bolinha de status sob o avatar)
- Test: `apps/web/src/office/media/MediaBar.test.tsx` (teste `'o ponto no avatar reflete a presença, não o estado do áudio'`, linhas 158-172)

**Interfaces:**
- Produces: classe CSS `presence-online-pulse`, aplicada condicionalmente (`status === 'online'`) na bolinha de presença do avatar.

- [ ] **Step 1: Atualizar o teste para esperar o glow só no status online**

Em `apps/web/src/office/media/MediaBar.test.tsx`, no teste `'o ponto no avatar reflete a presença, não o estado do áudio'` (linhas 158-172), troque o corpo por:

```tsx
  it('o ponto no avatar reflete a presença, não o estado do áudio, e só "online" tem o glow', () => {
    const dot = (chip: HTMLElement) => chip.querySelector('.absolute.bottom-0.right-0')

    // áudio conectado, mas ausente → ponto amarelo (presença), não verde (áudio), sem glow
    const away = renderMediaBar({ status: 'away', media: mediaState({ status: 'connected' }) })
    const awayDot = dot(away.getByRole('button', { name: 'Seu status e personagem' }))
    expect(awayDot).toHaveClass('bg-yellow-400')
    expect(awayDot).not.toHaveClass('presence-online-pulse')

    away.unmount()
    const brb = renderMediaBar({ status: 'brb', media: mediaState({ status: 'connected' }) })
    const brbDot = dot(brb.getByRole('button', { name: 'Seu status e personagem' }))
    expect(brbDot).toHaveClass('bg-blue-500')
    expect(brbDot).not.toHaveClass('presence-online-pulse')

    brb.unmount()
    const online = renderMediaBar({ status: 'online', media: mediaState({ status: 'connected' }) })
    const onlineDot = dot(online.getByRole('button', { name: 'Seu status e personagem' }))
    expect(onlineDot).toHaveClass('bg-green-500')
    expect(onlineDot).toHaveClass('presence-online-pulse')
  })
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaBar.test.tsx -t "o ponto no avatar reflete"`
Expected: FAIL — `onlineDot` não tem a classe `presence-online-pulse` (ainda não existe).

- [ ] **Step 3: Adicionar o CSS do glow em `index.css`**

Em `apps/web/src/index.css`, insira depois do bloco `.mic-speaking` (depois da linha 133, antes do comentário `/* Thin, technical scrollbars... */`):

```css
/* MediaBar — pulso neon sutil no indicador de presença "online" do avatar. */
.presence-online-pulse {
  animation: presence-online-pulse 2.4s ease-in-out infinite;
}
@keyframes presence-online-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(82, 251, 162, 0.45);
  }
  50% {
    box-shadow: 0 0 6px 2px rgba(82, 251, 162, 0.85);
  }
}
@media (prefers-reduced-motion: reduce) {
  .presence-online-pulse {
    animation: none;
    box-shadow: 0 0 4px 1px rgba(82, 251, 162, 0.6);
  }
}
```

- [ ] **Step 4: Aplicar a classe condicionalmente no avatar**

Em `apps/web/src/office/media/MediaBar.tsx`, troque (linhas 460-463):

```tsx
            <span
              aria-hidden
              className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#2f2f2f] ${presenceStatusDotCls[status]}`}
            />
```

por:

```tsx
            <span
              aria-hidden
              className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#2f2f2f] ${presenceStatusDotCls[status]} ${
                status === 'online' ? 'presence-online-pulse' : ''
              }`}
            />
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaBar.test.tsx -t "o ponto no avatar reflete"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/index.css apps/web/src/office/media/MediaBar.tsx apps/web/src/office/media/MediaBar.test.tsx
git commit -m "feat(web): glow neon no indicador de presença online da MediaBar"
```

---

### Task 2: Criar `MediaBarMoreMenu`

**Files:**
- Create: `apps/web/src/office/media/MediaBarMoreMenu.tsx`
- Test: `apps/web/src/office/media/MediaBarMoreMenu.test.tsx`

**Interfaces:**
- Consumes: `Icon` de `../../components/Icon` (`{ name: string, className?: string }` → renderiza glyph); `DeviceMenu` de `./DeviceMenu` (`{ label, devices, selectedDeviceId, onSelect, onClose, rootAttr }`); `MediaDeviceOption` de `./useMediaDevices` (`{ deviceId: string, label: string }`).
- Produces: componente `MediaBarMoreMenu(props)` — ver props abaixo — usado pela Task 3.

```ts
export function MediaBarMoreMenu(props: {
  onClose: () => void
  showReactions: boolean
  onToggleReactions: () => void
  showChat: boolean
  onToggleChat: () => void
  canRaiseHand: boolean
  raised: boolean
  onToggleRaiseHand?: () => void
  showRoomControls: boolean
  roomPanel: 'chat' | 'people' | null
  onToggleRoomPeople?: () => void
  canLockRoom: boolean
  roomLocked: boolean
  onToggleRoomLock?: () => void
  supportsAudioOutputSelection: boolean
  audioOutputs: MediaDeviceOption[]
  audioOutputDeviceId: string | null
  onSelectAudioOutput: (deviceId: string | null) => void
  canBroadcast: boolean
  broadcastAvailable: boolean
  speakerEnabled: boolean
  onToggleSpeaker?: () => void
}): JSX.Element
```

- [ ] **Step 1: Escrever o teste do componente isolado**

Crie `apps/web/src/office/media/MediaBarMoreMenu.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MediaBarMoreMenu } from './MediaBarMoreMenu'

function baseProps(overrides: Partial<Parameters<typeof MediaBarMoreMenu>[0]> = {}) {
  return {
    onClose: vi.fn(),
    showReactions: false,
    onToggleReactions: vi.fn(),
    showChat: false,
    onToggleChat: vi.fn(),
    canRaiseHand: false,
    raised: false,
    onToggleRaiseHand: vi.fn(),
    showRoomControls: false,
    roomPanel: null,
    onToggleRoomPeople: vi.fn(),
    canLockRoom: false,
    roomLocked: false,
    onToggleRoomLock: vi.fn(),
    supportsAudioOutputSelection: false,
    audioOutputs: [],
    audioOutputDeviceId: null,
    onSelectAudioOutput: vi.fn(),
    canBroadcast: false,
    broadcastAvailable: false,
    speakerEnabled: false,
    onToggleSpeaker: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('MediaBarMoreMenu', () => {
  it('sem nenhum item condicional disponível, sempre mostra Reagir e Nearby chat', () => {
    render(<MediaBarMoreMenu {...baseProps()} />)
    expect(screen.getByRole('button', { name: 'Reagir' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir nearby chat' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Levantar a mão' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Abrir pessoas da sala' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Trancar sala' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Escolher saída de áudio' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ligar alto-falante' })).not.toBeInTheDocument()
  })

  it('Reagir dispara onToggleReactions e fecha o menu', () => {
    const onToggleReactions = vi.fn()
    const onClose = vi.fn()
    render(<MediaBarMoreMenu {...baseProps({ onToggleReactions, onClose })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reagir' }))
    expect(onToggleReactions).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Nearby chat dispara onToggleChat e fecha o menu', () => {
    const onToggleChat = vi.fn()
    const onClose = vi.fn()
    render(<MediaBarMoreMenu {...baseProps({ onToggleChat, onClose })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir nearby chat' }))
    expect(onToggleChat).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('com canRaiseHand, Levantar a mão dispara onToggleRaiseHand e fecha o menu', () => {
    const onToggleRaiseHand = vi.fn()
    const onClose = vi.fn()
    render(<MediaBarMoreMenu {...baseProps({ canRaiseHand: true, onToggleRaiseHand, onClose })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Levantar a mão' }))
    expect(onToggleRaiseHand).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('com a mão levantada, mostra "Abaixar a mão"', () => {
    render(<MediaBarMoreMenu {...baseProps({ canRaiseHand: true, raised: true })} />)
    expect(screen.getByRole('button', { name: 'Abaixar a mão' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('com showRoomControls, Participantes dispara onToggleRoomPeople e fecha o menu', () => {
    const onToggleRoomPeople = vi.fn()
    const onClose = vi.fn()
    render(<MediaBarMoreMenu {...baseProps({ showRoomControls: true, onToggleRoomPeople, onClose })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir pessoas da sala' }))
    expect(onToggleRoomPeople).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('com o painel de pessoas aberto, mostra o rótulo de fechar', () => {
    render(<MediaBarMoreMenu {...baseProps({ showRoomControls: true, roomPanel: 'people' })} />)
    expect(screen.getByRole('button', { name: 'Fechar pessoas da sala' })).toBeInTheDocument()
  })

  it('com canLockRoom, Trancar sala dispara onToggleRoomLock e fecha o menu', () => {
    const onToggleRoomLock = vi.fn()
    const onClose = vi.fn()
    render(<MediaBarMoreMenu {...baseProps({ canLockRoom: true, onToggleRoomLock, onClose })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Trancar sala' }))
    expect(onToggleRoomLock).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('com a sala trancada, mostra "Destrancar sala"', () => {
    render(<MediaBarMoreMenu {...baseProps({ canLockRoom: true, roomLocked: true })} />)
    expect(screen.getByRole('button', { name: 'Destrancar sala' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('saída de áudio expande a lista de dispositivos sem fechar o menu; escolher um fecha', () => {
    const onSelectAudioOutput = vi.fn()
    const onClose = vi.fn()
    render(
      <MediaBarMoreMenu
        {...baseProps({
          supportsAudioOutputSelection: true,
          audioOutputs: [{ deviceId: 'out1', label: 'Fone' }],
          onSelectAudioOutput,
          onClose,
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Escolher saída de áudio' }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Fone/ }))
    expect(onSelectAudioOutput).toHaveBeenCalledWith('out1')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('com broadcast disponível, Alto-falante dispara onToggleSpeaker e fecha o menu', () => {
    const onToggleSpeaker = vi.fn()
    const onClose = vi.fn()
    render(
      <MediaBarMoreMenu
        {...baseProps({ canBroadcast: true, broadcastAvailable: true, onToggleSpeaker, onClose })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ligar alto-falante' }))
    expect(onToggleSpeaker).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('com o alto-falante ligado, mostra "Desligar alto-falante"', () => {
    render(<MediaBarMoreMenu {...baseProps({ canBroadcast: true, broadcastAvailable: true, speakerEnabled: true })} />)
    expect(screen.getByRole('button', { name: 'Desligar alto-falante' })).toBeInTheDocument()
  })

  it('Esc fecha o menu', () => {
    const onClose = vi.fn()
    render(<MediaBarMoreMenu {...baseProps({ onClose })} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('clique fora do container marcado com data-more-menu-root fecha o menu', () => {
    const onClose = vi.fn()
    render(
      <div>
        <div data-more-menu-root>
          <MediaBarMoreMenu {...baseProps({ onClose })} />
        </div>
        <button type="button">fora</button>
      </div>,
    )
    fireEvent.mouseDown(screen.getByText('fora'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaBarMoreMenu.test.tsx`
Expected: FAIL — módulo `./MediaBarMoreMenu` não existe.

- [ ] **Step 3: Implementar o componente**

Crie `apps/web/src/office/media/MediaBarMoreMenu.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { DeviceMenu } from './DeviceMenu'
import type { MediaDeviceOption } from './useMediaDevices'

const rowCls = (active: boolean) =>
  `flex w-full items-center gap-sm rounded-lg px-sm py-xs text-left font-label text-label-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
    active ? 'bg-primary/90 text-on-primary' : 'text-white/85 hover:bg-white/10'
  }`

/**
 * Popover "Mais" da MediaBar: agrupa ações secundárias (reações, nearby chat,
 * levantar a mão, participantes, trancar sala, saída de áudio, alto-falante)
 * atrás de um único botão. Mesmo padrão de fechamento (Esc/outside-click) do
 * `DeviceMenu`/`CameraBackgroundMenu`. Clicar em qualquer ação fecha o menu —
 * exceto abrir a lista de saída de áudio, que expande inline.
 */
export function MediaBarMoreMenu({
  onClose,
  showReactions,
  onToggleReactions,
  showChat,
  onToggleChat,
  canRaiseHand,
  raised,
  onToggleRaiseHand,
  showRoomControls,
  roomPanel,
  onToggleRoomPeople,
  canLockRoom,
  roomLocked,
  onToggleRoomLock,
  supportsAudioOutputSelection,
  audioOutputs,
  audioOutputDeviceId,
  onSelectAudioOutput,
  canBroadcast,
  broadcastAvailable,
  speakerEnabled,
  onToggleSpeaker,
}: {
  onClose: () => void
  showReactions: boolean
  onToggleReactions: () => void
  showChat: boolean
  onToggleChat: () => void
  canRaiseHand: boolean
  raised: boolean
  onToggleRaiseHand?: () => void
  showRoomControls: boolean
  roomPanel: 'chat' | 'people' | null
  onToggleRoomPeople?: () => void
  canLockRoom: boolean
  roomLocked: boolean
  onToggleRoomLock?: () => void
  supportsAudioOutputSelection: boolean
  audioOutputs: MediaDeviceOption[]
  audioOutputDeviceId: string | null
  onSelectAudioOutput: (deviceId: string | null) => void
  canBroadcast: boolean
  broadcastAvailable: boolean
  speakerEnabled: boolean
  onToggleSpeaker?: () => void
}) {
  const [showAudioOutputMenu, setShowAudioOutputMenu] = useState(false)

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!(event.target as HTMLElement | null)?.closest('[data-more-menu-root]')) onClose()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  function runAndClose(action?: () => void) {
    return () => {
      action?.()
      onClose()
    }
  }

  const chatLabel = showChat ? 'Fechar nearby chat' : 'Abrir nearby chat'
  const raiseHandLabel = raised ? 'Abaixar a mão' : 'Levantar a mão'
  const roomPeopleLabel = roomPanel === 'people' ? 'Fechar pessoas da sala' : 'Abrir pessoas da sala'
  const lockLabel = roomLocked ? 'Destrancar sala' : 'Trancar sala'
  const speakerLabel = speakerEnabled ? 'Desligar alto-falante' : 'Ligar alto-falante'

  return (
    <div
      role="menu"
      aria-label="Mais opções"
      className="absolute bottom-[calc(100%+0.5rem)] right-0 z-20 w-60 overflow-hidden rounded-xl border border-primary-container/20 bg-surface/70 p-1 shadow-2xl backdrop-blur-xl"
    >
      <button
        type="button"
        aria-label="Reagir"
        aria-expanded={showReactions}
        className={rowCls(showReactions)}
        onClick={runAndClose(onToggleReactions)}
      >
        <Icon name="mood" className="text-[18px]" />
        <span className="min-w-0 flex-1 truncate">Reações</span>
      </button>

      <button
        type="button"
        aria-label={chatLabel}
        aria-expanded={showChat}
        className={rowCls(showChat)}
        onClick={runAndClose(onToggleChat)}
      >
        <Icon name="chat_bubble" className="text-[18px]" />
        <span className="min-w-0 flex-1 truncate">Nearby chat</span>
      </button>

      {canRaiseHand && (
        <button
          type="button"
          aria-label={raiseHandLabel}
          aria-pressed={raised}
          className={rowCls(raised)}
          onClick={runAndClose(onToggleRaiseHand)}
        >
          <Icon name="back_hand" className="text-[18px]" />
          <span className="min-w-0 flex-1 truncate">{raiseHandLabel}</span>
        </button>
      )}

      {showRoomControls && (
        <button
          type="button"
          aria-label={roomPeopleLabel}
          aria-expanded={roomPanel === 'people'}
          className={rowCls(roomPanel === 'people')}
          onClick={runAndClose(onToggleRoomPeople)}
        >
          <Icon name="group" className="text-[18px]" />
          <span className="min-w-0 flex-1 truncate">Participantes</span>
        </button>
      )}

      {canLockRoom && (
        <button
          type="button"
          aria-label={lockLabel}
          aria-pressed={roomLocked}
          className={rowCls(roomLocked)}
          onClick={runAndClose(onToggleRoomLock)}
        >
          <Icon name={roomLocked ? 'lock' : 'lock_open'} className="text-[18px]" />
          <span className="min-w-0 flex-1 truncate">{lockLabel}</span>
        </button>
      )}

      {supportsAudioOutputSelection && (
        <div className="relative" data-audio-output-menu-root>
          <button
            type="button"
            aria-label="Escolher saída de áudio"
            aria-haspopup="menu"
            aria-expanded={showAudioOutputMenu}
            className={rowCls(showAudioOutputMenu)}
            onClick={() => setShowAudioOutputMenu((current) => !current)}
          >
            <Icon name="volume_up" className="text-[18px]" />
            <span className="min-w-0 flex-1 truncate">Saída de áudio</span>
            <Icon name={showAudioOutputMenu ? 'expand_less' : 'expand_more'} className="text-[16px] text-white/55" />
          </button>
          {showAudioOutputMenu && (
            <DeviceMenu
              label="Escolher saída de áudio"
              devices={audioOutputs}
              selectedDeviceId={audioOutputDeviceId}
              onSelect={(deviceId) => {
                onSelectAudioOutput(deviceId)
                onClose()
              }}
              onClose={() => setShowAudioOutputMenu(false)}
              rootAttr="data-audio-output-menu-root"
            />
          )}
        </div>
      )}

      {canBroadcast && broadcastAvailable && (
        <button
          type="button"
          aria-label={speakerLabel}
          aria-pressed={speakerEnabled}
          className={rowCls(speakerEnabled)}
          onClick={runAndClose(onToggleSpeaker)}
        >
          <Icon name={speakerEnabled ? 'campaign' : 'volume_up'} className="text-[18px]" />
          <span className="min-w-0 flex-1 truncate">{speakerLabel}</span>
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaBarMoreMenu.test.tsx`
Expected: PASS (14 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/MediaBarMoreMenu.tsx apps/web/src/office/media/MediaBarMoreMenu.test.tsx
git commit -m "feat(web): componente MediaBarMoreMenu (menu Mais da MediaBar)"
```

---

### Task 3: Realce visual dos botões-chave e do container principal

**Files:**
- Modify: `apps/web/src/index.css:133-135` (inserir bloco novo, após o bloco adicionado na Task 1)
- Modify: `apps/web/src/office/media/MediaBar.tsx:12-17` (`toolButtonCls`), `:448` (container principal)
- Test: `apps/web/src/office/media/MediaBar.test.tsx`

**Interfaces:**
- Produces: função `highlightButtonCls(active: boolean): string` em `MediaBar.tsx`, usada pela Task 4 no botão "Mais". Classe CSS `office-toolbar-btn` (marcador de hover-glow), incluída em `toolButtonCls` e `highlightButtonCls`.

- [ ] **Step 1: Escrever o teste do container e do botão de compartilhar tela**

Em `apps/web/src/office/media/MediaBar.test.tsx`, adicione ao final do `describe('MediaBar', ...)`:

```tsx
  it('o container principal usa os tokens de tema surface/primary-container', () => {
    renderMediaBar()
    const container = screen.getByRole('button', { name: 'Ativar microfone' }).closest('div.rounded-2xl')
    expect(container).toHaveClass('bg-surface/70')
    expect(container).toHaveClass('border-primary-container/20')
  })

  it('compartilhar tela usa o destaque neon (highlightButtonCls)', () => {
    renderMediaBar()
    const button = screen.getByRole('button', { name: 'Compartilhar tela' })
    expect(button).toHaveClass('border-primary-container/30')
    expect(button).toHaveClass('bg-primary-container/10')
  })
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaBar.test.tsx -t "tokens de tema|destaque neon"`
Expected: FAIL — classes ainda não existem.

- [ ] **Step 3: Adicionar `highlightButtonCls` e marcar `office-toolbar-btn`**

Em `apps/web/src/office/media/MediaBar.tsx`, troque (linhas 12-17):

```tsx
const toolButtonCls = (active: boolean) =>
  `group relative flex h-10 w-10 items-center justify-center rounded-xl border transition-all ${
    active
      ? 'border-primary/70 bg-primary/20 text-primary shadow-[0_0_0_1px_rgb(var(--color-primary)/0.15)]'
      : 'border-white/5 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white'
  }`
```

por:

```tsx
const toolButtonCls = (active: boolean) =>
  `office-toolbar-btn group relative flex h-10 w-10 items-center justify-center rounded-xl border transition-all ${
    active
      ? 'border-primary/70 bg-primary/20 text-primary shadow-[0_0_0_1px_rgb(var(--color-primary)/0.15)]'
      : 'border-white/5 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white'
  }`

const highlightButtonCls = (active: boolean) =>
  `office-toolbar-btn group relative flex h-10 w-10 items-center justify-center rounded-xl border transition-all border-primary-container/30 bg-primary-container/10 text-primary-container hover:bg-primary-container/20 hover:shadow-[0_0_15px_rgba(37,222,136,0.3)] ${
    active ? 'shadow-[0_0_15px_rgba(37,222,136,0.3)]' : ''
  }`
```

- [ ] **Step 4: Trocar o fundo/borda do container principal**

Em `apps/web/src/office/media/MediaBar.tsx`, troque (linha 448):

```tsx
      <div className="flex max-w-full items-center gap-xs rounded-2xl border border-white/10 bg-[#2f2f2f]/95 p-xs shadow-2xl backdrop-blur">
```

por:

```tsx
      <div className="flex max-w-full items-center gap-xs rounded-2xl border border-primary-container/20 bg-surface/70 p-xs shadow-2xl backdrop-blur-xl">
```

- [ ] **Step 5: Aplicar `highlightButtonCls` ao botão de compartilhar tela**

Em `apps/web/src/office/media/MediaBar.tsx`, na definição do botão "Compartilhar tela" (linhas 728-737 do arquivo original — a Task 5 é que reposiciona esse botão; por enquanto troque só a classe no lugar onde ele está hoje), troque:

```tsx
          className={`${toolButtonCls(media.screenShareEnabled)} disabled:cursor-not-allowed disabled:opacity-45`}
```

por:

```tsx
          className={`${highlightButtonCls(media.screenShareEnabled)} disabled:cursor-not-allowed disabled:opacity-45`}
```

- [ ] **Step 6: Adicionar o CSS de hover-glow nos ícones**

Em `apps/web/src/index.css`, insira logo após o bloco `presence-online-pulse` adicionado na Task 1 (antes do comentário `/* Thin, technical scrollbars... */`):

```css
/* MediaBar — leve glow verde-neon no ícone ao passar o mouse nos botões
   principais (mic, câmera, compartilhar tela, chat da sala, Mais). Replica o
   micro-interaction do mockup de referência sem JS adicional. */
.office-toolbar-btn .material-symbols-outlined {
  transition: filter 150ms ease;
}
.office-toolbar-btn:hover .material-symbols-outlined {
  filter: drop-shadow(0 0 6px rgba(82, 251, 162, 0.65));
}
```

- [ ] **Step 7: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaBar.test.tsx -t "tokens de tema|destaque neon"`
Expected: PASS

- [ ] **Step 8: Rodar a suíte inteira do arquivo para checar que nada quebrou**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaBar.test.tsx`
Expected: PASS (os testes que dependiam do menu "Mais" ainda vão falhar — são corrigidos na Task 4/5; se algum teste alheio a essa mudança falhar agora, investigue antes de prosseguir)

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/index.css apps/web/src/office/media/MediaBar.tsx apps/web/src/office/media/MediaBar.test.tsx
git commit -m "feat(web): realce visual neon nos botões-chave e no container da MediaBar"
```

---

### Task 4: Atualizar `MediaBar.test.tsx` para o menu "Mais" (red)

**Files:**
- Modify: `apps/web/src/office/media/MediaBar.test.tsx`

**Interfaces:**
- Consumes: nenhuma interface nova — só ajusta a sequência de interação dos testes existentes para abrir o botão `aria-label="Mais opções"` antes de agir sobre itens que vão morar no menu "Mais" (Reagir, Nearby chat, Levantar a mão, Participantes/Pessoas da sala, Trancar sala, Saída de áudio, Alto-falante).

Esta task só mexe no arquivo de teste — o objetivo é deixá-lo **vermelho** contra a implementação atual (que ainda não tem o menu "Mais"), preparando o terreno para a Task 5.

- [ ] **Step 1: Alterar o teste de alto-falante (case sem clique)**

Troque (linhas ~442-464):

```tsx
  it('mostra o alto-falante só para liderança com broadcast disponível', () => {
    const broadcast = broadcastState()
    const { rerender } = renderMediaBar({ broadcast, canBroadcast: false })
    expect(screen.queryByRole('button', { name: /alto-falante/i })).not.toBeInTheDocument()

    rerender(
      <MediaBar
        media={mediaState()}
        zoneName={null}
        broadcast={broadcast}
        canBroadcast
        you={{ name: 'Lucca Secco' }}
        onLeave={vi.fn()}
        cameraBackground={cameraBackgroundState()}
        devices={devicesState()}
        audioOutputDeviceId={null}
        onSelectAudioOutput={vi.fn()}
      />,
    )
    const button = screen.getByRole('button', { name: 'Ligar alto-falante' })
    fireEvent.click(button)
    expect(broadcast.toggleSpeaker).toHaveBeenCalledOnce()
  })
```

por:

```tsx
  it('mostra o alto-falante só para liderança com broadcast disponível', () => {
    const broadcast = broadcastState()
    const { rerender } = renderMediaBar({ broadcast, canBroadcast: false })
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.queryByRole('button', { name: /alto-falante/i })).not.toBeInTheDocument()

    rerender(
      <MediaBar
        media={mediaState()}
        zoneName={null}
        broadcast={broadcast}
        canBroadcast
        you={{ name: 'Lucca Secco' }}
        onLeave={vi.fn()}
        cameraBackground={cameraBackgroundState()}
        devices={devicesState()}
        audioOutputDeviceId={null}
        onSelectAudioOutput={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    const button = screen.getByRole('button', { name: 'Ligar alto-falante' })
    fireEvent.click(button)
    expect(broadcast.toggleSpeaker).toHaveBeenCalledOnce()
  })
```

- [ ] **Step 2: Alterar o teste "com o alto-falante ligado..."**

Troque:

```tsx
  it('com o alto-falante ligado, o botão inverte e o mic local fica desabilitado', () => {
    renderMediaBar({
      media: mediaState({ micEnabled: false }),
      broadcast: broadcastState({ speakerEnabled: true }),
      canBroadcast: true,
    })
    expect(screen.getByRole('button', { name: 'Desligar alto-falante' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ativar microfone' })).toBeDisabled()
  })
```

por:

```tsx
  it('com o alto-falante ligado, o botão inverte e o mic local fica desabilitado', () => {
    renderMediaBar({
      media: mediaState({ micEnabled: false }),
      broadcast: broadcastState({ speakerEnabled: true }),
      canBroadcast: true,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.getByRole('button', { name: 'Desligar alto-falante' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ativar microfone' })).toBeDisabled()
  })
```

- [ ] **Step 3: Alterar o teste "com showRoomControls, os botões de sala aparecem..."**

Troque:

```tsx
  it('com showRoomControls, os botões de sala aparecem e chamam os callbacks', () => {
    const onToggleRoomChat = vi.fn()
    const onToggleRoomPeople = vi.fn()
    renderMediaBar({ showRoomControls: true, onToggleRoomChat, onToggleRoomPeople })

    fireEvent.click(screen.getByRole('button', { name: 'Abrir chat da sala' }))
    expect(onToggleRoomChat).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Abrir pessoas da sala' }))
    expect(onToggleRoomPeople).toHaveBeenCalledOnce()
  })
```

por:

```tsx
  it('com showRoomControls, os botões de sala aparecem e chamam os callbacks', () => {
    const onToggleRoomChat = vi.fn()
    const onToggleRoomPeople = vi.fn()
    renderMediaBar({ showRoomControls: true, onToggleRoomChat, onToggleRoomPeople })

    fireEvent.click(screen.getByRole('button', { name: 'Abrir chat da sala' }))
    expect(onToggleRoomChat).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('button', { name: 'Abrir pessoas da sala' }))
    expect(onToggleRoomPeople).toHaveBeenCalledOnce()
  })
```

- [ ] **Step 4: Alterar o teste "o botão do painel ativo mostra o rótulo de fechar"**

Troque:

```tsx
  it('o botão do painel ativo mostra o rótulo de fechar', () => {
    renderMediaBar({ showRoomControls: true, roomPanel: 'chat' })
    expect(screen.getByRole('button', { name: 'Fechar chat da sala' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir pessoas da sala' })).toBeInTheDocument()
  })
```

por:

```tsx
  it('o botão do painel ativo mostra o rótulo de fechar', () => {
    renderMediaBar({ showRoomControls: true, roomPanel: 'chat' })
    expect(screen.getByRole('button', { name: 'Fechar chat da sala' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.getByRole('button', { name: 'Abrir pessoas da sala' })).toBeInTheDocument()
  })
```

- [ ] **Step 5: Alterar os testes de reações/nearby chat**

Troque o teste `'abre reações e nearby chat a partir da toolbar'`:

```tsx
  it('abre reações e nearby chat a partir da toolbar', () => {
    const onChatOpenChange = vi.fn()
    const onReaction = vi.fn()
    renderMediaBar({ onChatOpenChange, onReaction })

    fireEvent.click(screen.getByRole('button', { name: 'Reagir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reagir com 👋' }))
    expect(onReaction).toHaveBeenCalledWith('👋')
    expect(screen.queryByRole('button', { name: 'Reagir com 👋' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Abrir nearby chat' }))
    expect(screen.getByText('Nearby chat')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Mensagem...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Modo do nearby chat' })).toBeInTheDocument()
    expect(onChatOpenChange).toHaveBeenLastCalledWith(true)
  })
```

por:

```tsx
  it('abre reações e nearby chat a partir da toolbar', () => {
    const onChatOpenChange = vi.fn()
    const onReaction = vi.fn()
    renderMediaBar({ onChatOpenChange, onReaction })

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reagir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reagir com 👋' }))
    expect(onReaction).toHaveBeenCalledWith('👋')
    expect(screen.queryByRole('button', { name: 'Reagir com 👋' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('button', { name: 'Abrir nearby chat' }))
    expect(screen.getByText('Nearby chat')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Mensagem...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Modo do nearby chat' })).toBeInTheDocument()
    expect(onChatOpenChange).toHaveBeenLastCalledWith(true)
  })
```

Nos demais testes que clicam em `'Abrir nearby chat'` ou `'Reagir'` diretamente — `'não dispara atalho de reação enquanto o usuário está digitando'`, `'edita um emoji, salva localmente e usa a personalização na hotkey'`, `'aceita nearby chat controlado por prop'`, `'fecha o nearby chat com Esc'`, `'fecha o nearby chat com Esc mesmo com foco no input de mensagem'`, `'envia nearby chat para o balão do personagem sem fechar o input'`, `'fecha o nearby chat ao enviar com Enter sem texto'`, `'envia nearby chat como pensamento quando o modo Pensar está selecionado'` — adicione, imediatamente antes de cada primeiro clique em `'Reagir'` ou `'Abrir nearby chat'` desses testes:

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
```

(Os testes `'usa as teclas 1 a 8 como atalhos para os emojis'` e `'carrega emojis personalizados salvos localmente'` não clicam em nenhum botão da toolbar — usam só `fireEvent.keyDown` — não precisam de alteração.)

- [ ] **Step 6: Alterar os testes de levantar a mão**

Troque:

```tsx
  it('com canRaiseHand, mostra o botão de levantar a mão e dispara onToggleRaiseHand', () => {
    const onToggleRaiseHand = vi.fn()
    renderMediaBar({ canRaiseHand: true, raised: false, onToggleRaiseHand })
    const button = screen.getByRole('button', { name: 'Levantar a mão' })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(button)
    expect(onToggleRaiseHand).toHaveBeenCalledOnce()
  })

  it('com a mão levantada, o botão mostra "Abaixar a mão"', () => {
    renderMediaBar({ canRaiseHand: true, raised: true })
    expect(screen.getByRole('button', { name: 'Abaixar a mão' })).toHaveAttribute('aria-pressed', 'true')
  })
```

por:

```tsx
  it('com canRaiseHand, mostra o botão de levantar a mão e dispara onToggleRaiseHand', () => {
    const onToggleRaiseHand = vi.fn()
    renderMediaBar({ canRaiseHand: true, raised: false, onToggleRaiseHand })
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    const button = screen.getByRole('button', { name: 'Levantar a mão' })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(button)
    expect(onToggleRaiseHand).toHaveBeenCalledOnce()
  })

  it('com a mão levantada, o botão mostra "Abaixar a mão"', () => {
    renderMediaBar({ canRaiseHand: true, raised: true })
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.getByRole('button', { name: 'Abaixar a mão' })).toHaveAttribute('aria-pressed', 'true')
  })
```

- [ ] **Step 7: Alterar os testes de trancar sala**

Troque:

```tsx
  it('na sala, mostra o cadeado e dispara onToggleRoomLock', () => {
    const onToggleRoomLock = vi.fn()
    renderMediaBar({ canLockRoom: true, roomLocked: false, onToggleRoomLock })
    const button = screen.getByRole('button', { name: 'Trancar sala' })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(button)
    expect(onToggleRoomLock).toHaveBeenCalledOnce()
  })

  it('com a sala trancada, o cadeado vira "Destrancar sala"', () => {
    renderMediaBar({ canLockRoom: true, roomLocked: true })
    expect(screen.getByRole('button', { name: 'Destrancar sala' })).toHaveAttribute('aria-pressed', 'true')
  })
```

por:

```tsx
  it('na sala, mostra o cadeado e dispara onToggleRoomLock', () => {
    const onToggleRoomLock = vi.fn()
    renderMediaBar({ canLockRoom: true, roomLocked: false, onToggleRoomLock })
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    const button = screen.getByRole('button', { name: 'Trancar sala' })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(button)
    expect(onToggleRoomLock).toHaveBeenCalledOnce()
  })

  it('com a sala trancada, o cadeado vira "Destrancar sala"', () => {
    renderMediaBar({ canLockRoom: true, roomLocked: true })
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.getByRole('button', { name: 'Destrancar sala' })).toHaveAttribute('aria-pressed', 'true')
  })
```

- [ ] **Step 8: Alterar o teste de saída de áudio com seleção**

Troque:

```tsx
  it('botão de saída de áudio abre o menu de saídas; escolher uma chama onSelectAudioOutput', () => {
    const onSelectAudioOutput = vi.fn()
    renderMediaBar({
      onSelectAudioOutput,
      devices: devicesState({ audioOutputs: [{ deviceId: 'out1', label: 'Fone' }] }),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Escolher saída de áudio' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Fone/ }))

    expect(onSelectAudioOutput).toHaveBeenCalledWith('out1')
  })
```

por:

```tsx
  it('botão de saída de áudio abre o menu de saídas; escolher uma chama onSelectAudioOutput', () => {
    const onSelectAudioOutput = vi.fn()
    renderMediaBar({
      onSelectAudioOutput,
      devices: devicesState({ audioOutputs: [{ deviceId: 'out1', label: 'Fone' }] }),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    fireEvent.click(screen.getByRole('button', { name: 'Escolher saída de áudio' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Fone/ }))

    expect(onSelectAudioOutput).toHaveBeenCalledWith('out1')
  })
```

- [ ] **Step 9: Adicionar testes novos do menu "Mais" dentro de `MediaBar`**

Adicione ao final do `describe('MediaBar', ...)`:

```tsx
  it('o botão Mais abre o menu com Reagir e Nearby chat sempre disponíveis', () => {
    renderMediaBar()
    expect(screen.queryByRole('menu', { name: 'Mais opções' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.getByRole('menu', { name: 'Mais opções' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reagir' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir nearby chat' })).toBeInTheDocument()
  })

  it('Esc fecha o menu Mais', () => {
    renderMediaBar()
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }))
    expect(screen.getByRole('menu', { name: 'Mais opções' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'Mais opções' })).not.toBeInTheDocument()
  })
```

- [ ] **Step 10: Rodar a suíte e confirmar que está vermelha**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaBar.test.tsx`
Expected: FAIL em todos os testes que agora esperam o botão `'Mais opções'` (ele ainda não existe na implementação).

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/office/media/MediaBar.test.tsx
git commit -m "test(web): atualiza MediaBar.test.tsx para o menu Mais (red)"
```

---

### Task 5: Relocar os botões na implementação da `MediaBar` (green)

**Files:**
- Modify: `apps/web/src/office/media/MediaBar.tsx`

**Interfaces:**
- Consumes: `MediaBarMoreMenu` (Task 2), `highlightButtonCls` (Task 3).

- [ ] **Step 1: Importar `MediaBarMoreMenu`**

No topo de `apps/web/src/office/media/MediaBar.tsx`, adicione ao bloco de imports (perto de `import { DeviceMenu } from './DeviceMenu'`):

```tsx
import { MediaBarMoreMenu } from './MediaBarMoreMenu'
```

- [ ] **Step 2: Trocar `showAudioOutputMenu` por `showMoreMenu` nos estados**

Troque a linha de estado (bloco de `useState`s, próximo a `showMicMenu`):

```tsx
  const [showMicMenu, setShowMicMenu] = useState(false)
  const [showAudioOutputMenu, setShowAudioOutputMenu] = useState(false)
  const [showIdentityMenu, setShowIdentityMenu] = useState(false)
```

por:

```tsx
  const [showMicMenu, setShowMicMenu] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showIdentityMenu, setShowIdentityMenu] = useState(false)
```

- [ ] **Step 3: Remover os blocos de saída de áudio, alto-falante, reagir, nearby chat, levantar mão e trancar sala do corpo principal**

No JSX do container principal, remova por completo (na ordem em que aparecem, logo depois do bloco da câmera/efeitos de fundo e antes do bloco `{showRoomControls && (...)}`):

1. O bloco `{devices.supportsAudioOutputSelection && (...)}` (botão + `DeviceMenu` de saída de áudio).
2. O bloco `{canBroadcast && broadcast.available && (...)}` (botão de alto-falante).
3. O botão `aria-label="Reagir"`.
4. O botão `aria-label={showChat ? 'Fechar nearby chat' : 'Abrir nearby chat'}`.
5. O bloco `{canRaiseHand && (...)}` (levantar a mão).
6. O bloco `{canLockRoom && (...)}` (trancar sala).

- [ ] **Step 4: Simplificar o bloco `{showRoomControls && (...)}` para só o chat da sala**

Troque:

```tsx
        {showRoomControls && (
          <>
            <button
              type="button"
              aria-label={roomPanel === 'chat' ? 'Fechar chat da sala' : 'Abrir chat da sala'}
              title="Chat da sala"
              aria-expanded={roomPanel === 'chat'}
              className={toolButtonCls(roomPanel === 'chat')}
              onClick={onToggleRoomChat}
            >
              <Icon name="forum" className="text-[20px]" />
              {roomChatUnread && roomPanel !== 'chat' && (
                <span
                  aria-hidden
                  className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[#2f2f2f] bg-error"
                />
              )}
            </button>
            <button
              type="button"
              aria-label={roomPanel === 'people' ? 'Fechar pessoas da sala' : 'Abrir pessoas da sala'}
              title="Pessoas da sala"
              aria-expanded={roomPanel === 'people'}
              className={toolButtonCls(roomPanel === 'people')}
              onClick={onToggleRoomPeople}
            >
              <Icon name="group" className="text-[20px]" />
            </button>
          </>
        )}
```

por:

```tsx
        {showRoomControls && (
          <button
            type="button"
            aria-label={roomPanel === 'chat' ? 'Fechar chat da sala' : 'Abrir chat da sala'}
            title="Chat da sala"
            aria-expanded={roomPanel === 'chat'}
            className={toolButtonCls(roomPanel === 'chat')}
            onClick={onToggleRoomChat}
          >
            <Icon name="forum" className="text-[20px]" />
            {roomChatUnread && roomPanel !== 'chat' && (
              <span
                aria-hidden
                className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[#2f2f2f] bg-error"
              />
            )}
          </button>
        )}
```

- [ ] **Step 5: Adicionar divisor, botão "Mais" e `MediaBarMoreMenu` entre o compartilhar tela e o sair**

Depois do botão "Compartilhar tela" (já com `highlightButtonCls`, da Task 3) e antes do botão "Sair", insira:

```tsx
        <div className="mx-1 h-6 w-px shrink-0 bg-outline-variant/30" />

        <div className="relative flex items-center" data-more-menu-root>
          <button
            type="button"
            aria-label="Mais opções"
            aria-haspopup="menu"
            aria-expanded={showMoreMenu}
            className={highlightButtonCls(showMoreMenu)}
            onClick={() => setShowMoreMenu((current) => !current)}
          >
            <Icon name="apps" className="text-[20px]" />
          </button>
          {showMoreMenu && (
            <MediaBarMoreMenu
              onClose={() => setShowMoreMenu(false)}
              showReactions={showReactions}
              onToggleReactions={() => setShowReactions((current) => !current)}
              showChat={showChat}
              onToggleChat={() => setShowChat((current) => !current)}
              canRaiseHand={canRaiseHand}
              raised={raised}
              onToggleRaiseHand={onToggleRaiseHand}
              showRoomControls={showRoomControls}
              roomPanel={roomPanel}
              onToggleRoomPeople={onToggleRoomPeople}
              canLockRoom={canLockRoom}
              roomLocked={roomLocked}
              onToggleRoomLock={onToggleRoomLock}
              supportsAudioOutputSelection={devices.supportsAudioOutputSelection}
              audioOutputs={devices.audioOutputs}
              audioOutputDeviceId={audioOutputDeviceId}
              onSelectAudioOutput={onSelectAudioOutput}
              canBroadcast={canBroadcast}
              broadcastAvailable={broadcast.available}
              speakerEnabled={broadcast.speakerEnabled}
              onToggleSpeaker={() => void broadcast.toggleSpeaker()}
            />
          )}
        </div>

        <div className="mx-1 h-6 w-px shrink-0 bg-outline-variant/30" />
```

Confirme que o botão "Sair" continua logo em seguida, sem alterações.

- [ ] **Step 6: Rodar a suíte completa do arquivo e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaBar.test.tsx`
Expected: PASS (todos os testes, incluindo os atualizados na Task 4)

- [ ] **Step 7: Rodar também `MediaBarMoreMenu.test.tsx` e o typecheck do workspace**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaBarMoreMenu.test.tsx`
Expected: PASS

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros (confere props/tipos entre `MediaBar.tsx` e `MediaBarMoreMenu.tsx` — ver nota em `AGENTS.md`/memória "build ≠ tsc": `pnpm build`/Vitest não fazem typecheck completo).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/office/media/MediaBar.tsx
git commit -m "feat(web): reloca ações secundárias da MediaBar para o menu Mais"
```

---

### Task 6: Verificação final

**Files:** nenhum (só validação)

- [ ] **Step 1: Rodar a suíte completa do workspace web**

Run: `pnpm --filter @legends/web test`
Expected: PASS

- [ ] **Step 2: Rodar a suíte completa do monorepo** (API bate em Postgres real — suba com `pnpm db:up` se ainda não estiver rodando)

Run: `pnpm db:up && pnpm test`
Expected: PASS

- [ ] **Step 3: Verificação visual manual no navegador**

Suba `pnpm dev`, entre no escritório (`/office` ou fluxo equivalente do app), e confira:
- Barra principal mostra: avatar, mic, câmera, divisor, chat da sala (se em reunião), compartilhar tela (com o destaque neon), botão "Mais" (com o mesmo destaque), divisor, sair.
- Clicar em "Mais" abre o popover com Reagir e Nearby chat sempre visíveis, e os demais itens condicionais conforme o contexto (sala de reunião, dispositivos de áudio, permissão de broadcast).
- Clicar em qualquer ação do menu "Mais" executa a ação e fecha o popover (exceto "Saída de áudio", que expande a lista de dispositivos inline).
- O indicador de presença "online" pulsa suavemente; "ausente"/"volto logo" não pulsam.
- Passar o mouse sobre mic/câmera/chat da sala/compartilhar tela/Mais mostra um leve glow verde no ícone.
- Esc e clique fora fecham o menu "Mais".

Reporte o resultado (passou / o que não bateu com o esperado) antes de considerar a task concluída.

- [ ] **Step 4: Commit final (se houver ajustes da verificação manual)**

Se a verificação manual não pedir ajustes, não há o que commitar nesta task. Se pedir, aplique o ajuste, repita os testes automatizados relevantes e commit normalmente.
