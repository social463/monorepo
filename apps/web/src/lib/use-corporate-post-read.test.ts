import { createElement } from 'react'
import { render, renderHook, screen } from '@testing-library/react'
import { vi, type Mock, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useCorporatePostRead, __resetCorporatePostReadCache } from './use-corporate-post-read'
import { apiFetch } from './api'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock

/** Captura o callback do observer para disparar a interseção à mão. */
let trigger: ((entries: { isIntersecting: boolean }[]) => void) | null = null
const observe = vi.fn()
const disconnect = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  __resetCorporatePostReadCache()
  mockApiFetch.mockResolvedValue(undefined)
  trigger = null
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        trigger = cb
      }
      observe = observe
      disconnect = disconnect
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useCorporatePostRead', () => {
  it('marca leitura quando o post entra na viewport', () => {
    const { result } = renderHook(() => useCorporatePostRead('post-1'))
    expect(result.current).toBeDefined()
    trigger?.([{ isIntersecting: true }])
    expect(mockApiFetch).toHaveBeenCalledWith('/corporate-posts/post-1/read', { method: 'POST' })
  })

  it('não marca de novo se o post reaparecer na viewport', () => {
    renderHook(() => useCorporatePostRead('post-2'))
    trigger?.([{ isIntersecting: true }])
    trigger?.([{ isIntersecting: true }])
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
  })

  it('não marca enquanto o post está fora da viewport', () => {
    renderHook(() => useCorporatePostRead('post-3'))
    trigger?.([{ isIntersecting: false }])
    expect(mockApiFetch).not.toHaveBeenCalled()
  })

  it('conecta o observer ao <li> real do card (ref colado no DOM)', () => {
    // `renderHook` não monta um elemento de verdade — `ref.current` fica
    // `null` a vida toda. Aqui usamos `render` com um componente mínimo que
    // cola o ref num `<li>` de verdade, para garantir que
    // `observer.observe(ref.current)` é de fato exercitado.
    function TestListItem({ postId }: { postId: string }) {
      const ref = useCorporatePostRead(postId)
      return createElement('ul', null, createElement('li', { ref }, 'post'))
    }
    render(createElement(TestListItem, { postId: 'post-4' }))
    const item = screen.getByRole('listitem')
    expect(observe).toHaveBeenCalledWith(item)
  })

  it('desconecta o observer ao desmontar', () => {
    const { unmount } = renderHook(() => useCorporatePostRead('post-5'))
    unmount()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('ao trocar o postId, desconecta o observer antigo e assina um novo — o Set de sessão persiste', () => {
    const { rerender } = renderHook(({ postId }) => useCorporatePostRead(postId), {
      initialProps: { postId: 'post-6' },
    })
    trigger?.([{ isIntersecting: true }])
    expect(mockApiFetch).toHaveBeenCalledWith('/corporate-posts/post-6/read', { method: 'POST' })
    expect(disconnect).toHaveBeenCalledTimes(1) // disconnect() chamado dentro do próprio callback ao marcar

    rerender({ postId: 'post-7' })
    // Troca de postId muda a dependência do efeito: o cleanup do observer
    // antigo roda (novo disconnect) antes de assinar um observer para o
    // novo id.
    expect(disconnect).toHaveBeenCalledTimes(2)

    trigger?.([{ isIntersecting: true }])
    expect(mockApiFetch).toHaveBeenCalledWith('/corporate-posts/post-7/read', { method: 'POST' })
    // post-6 continua marcado no Set module-level — não é re-notificado.
    expect(mockApiFetch).toHaveBeenCalledTimes(2)
  })
})
