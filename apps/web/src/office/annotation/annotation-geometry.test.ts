import { describe, it, expect } from 'vitest'
import { toLocal, toNormalized, videoContentRect } from './annotation-geometry'

describe('videoContentRect', () => {
  it('vídeo mais largo que o elemento: barras em cima e embaixo', () => {
    const rect = videoContentRect({ videoWidth: 1920, videoHeight: 1080, clientWidth: 800, clientHeight: 600 })
    expect(rect).toEqual({ left: 0, top: 75, width: 800, height: 450 })
  })

  it('vídeo mais alto que o elemento: barras nas laterais', () => {
    const rect = videoContentRect({ videoWidth: 600, videoHeight: 800, clientWidth: 800, clientHeight: 400 })
    expect(rect).toEqual({ left: 250, top: 0, width: 300, height: 400 })
  })

  it('mesma proporção: preenche tudo, sem barra', () => {
    const rect = videoContentRect({ videoWidth: 1000, videoHeight: 500, clientWidth: 400, clientHeight: 200 })
    expect(rect).toEqual({ left: 0, top: 0, width: 400, height: 200 })
  })

  it('sem metadados ainda (0x0): usa o elemento inteiro em vez de dividir por zero', () => {
    const rect = videoContentRect({ videoWidth: 0, videoHeight: 0, clientWidth: 800, clientHeight: 600 })
    expect(rect).toEqual({ left: 0, top: 0, width: 800, height: 600 })
  })
})

describe('toNormalized', () => {
  const rect = { left: 100, top: 50, width: 200, height: 100 }

  it('converte pixel do elemento em fração do conteúdo', () => {
    expect(toNormalized({ x: 200, y: 100 }, rect)).toEqual({ x: 0.5, y: 0.5 })
  })

  it('prende nas bordas quem sai da área do conteúdo (letterbox)', () => {
    expect(toNormalized({ x: 0, y: 0 }, rect)).toEqual({ x: 0, y: 0 })
    expect(toNormalized({ x: 9999, y: 9999 }, rect)).toEqual({ x: 1, y: 1 })
  })

  it('elemento sem área ainda: devolve o canto, sem NaN', () => {
    expect(toNormalized({ x: 10, y: 10 }, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 })
  })
})

describe('toLocal', () => {
  it('é o inverso de toNormalized dentro da área do conteúdo', () => {
    const rect = { left: 100, top: 50, width: 200, height: 100 }
    expect(toLocal({ x: 0.5, y: 0.5 }, rect)).toEqual({ x: 200, y: 100 })
    expect(toLocal(toNormalized({ x: 150, y: 75 }, rect), rect)).toEqual({ x: 150, y: 75 })
  })
})
