import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useGuiaFavorites, useGuiaLocalState } from './useGuiaLocalState'

describe('useGuiaLocalState', () => {
  beforeEach(() => window.localStorage.clear())

  it('inicia com o valor padrão quando não há nada salvo', () => {
    const { result } = renderHook(() => useGuiaLocalState('teste', 0))
    expect(result.current[0]).toBe(0)
  })

  it('persiste e recarrega o valor salvo', () => {
    const { result, unmount } = renderHook(() => useGuiaLocalState('contador', 0))
    act(() => result.current[1](5))
    expect(result.current[0]).toBe(5)
    unmount()

    const { result: reloaded } = renderHook(() => useGuiaLocalState('contador', 0))
    expect(reloaded.current[0]).toBe(5)
  })

  it('aceita função atualizadora', () => {
    const { result } = renderHook(() => useGuiaLocalState('lista', [] as string[]))
    act(() => result.current[1]((prev) => [...prev, 'a']))
    expect(result.current[0]).toEqual(['a'])
  })
})

describe('useGuiaFavorites', () => {
  beforeEach(() => window.localStorage.clear())

  it('começa vazio e alterna favoritos', () => {
    const { result } = renderHook(() => useGuiaFavorites('prompt'))
    expect(result.current.has('p1')).toBe(false)

    act(() => result.current.toggle('p1'))
    expect(result.current.has('p1')).toBe(true)
    expect(result.current.ids).toEqual(['p1'])

    act(() => result.current.toggle('p1'))
    expect(result.current.has('p1')).toBe(false)
  })

  it('mantém prompt e situação em chaves separadas', () => {
    const { result: promptFavs } = renderHook(() => useGuiaFavorites('prompt'))
    const { result: situationFavs } = renderHook(() => useGuiaFavorites('situation'))
    act(() => promptFavs.current.toggle('x'))
    expect(situationFavs.current.has('x')).toBe(false)
  })
})
