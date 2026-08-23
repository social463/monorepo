import { describe, expect, it } from 'vitest'
import {
  COURSE_ENROLLMENT_STATUSES,
  COURSE_ENROLLMENT_STATUS_LABELS,
  COURSE_LESSON_TYPES,
  COURSE_LESSON_TYPE_LABELS,
  COURSE_LEVELS,
  COURSE_LEVEL_LABELS,
  certificateHoursFor,
  toVideoEmbedUrl,
} from './learning'

describe('rótulos de aprendizado', () => {
  it('todo enum tem rótulo em pt-BR', () => {
    for (const level of COURSE_LEVELS) expect(COURSE_LEVEL_LABELS[level]).toBeTruthy()
    for (const type of COURSE_LESSON_TYPES) expect(COURSE_LESSON_TYPE_LABELS[type]).toBeTruthy()
    for (const status of COURSE_ENROLLMENT_STATUSES) expect(COURSE_ENROLLMENT_STATUS_LABELS[status]).toBeTruthy()
  })
})

describe('certificateHoursFor', () => {
  it('arredonda a duração para horas, com o mínimo de 1h', () => {
    expect(certificateHoursFor(0)).toBe(1)
    expect(certificateHoursFor(20)).toBe(1)
    expect(certificateHoursFor(60)).toBe(1)
    expect(certificateHoursFor(90)).toBe(2)
    expect(certificateHoursFor(240)).toBe(4)
  })
})

describe('toVideoEmbedUrl', () => {
  it('converte o link que a pessoa copia do YouTube para a forma embutível', () => {
    expect(toVideoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    )
    expect(toVideoEmbedUrl('https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    )
    expect(toVideoEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ')
    expect(toVideoEmbedUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    )
  })

  it('preserva o instante inicial do link', () => {
    expect(toVideoEmbedUrl('https://www.youtube.com/watch?v=abc123&t=90')).toBe(
      'https://www.youtube.com/embed/abc123?start=90',
    )
    expect(toVideoEmbedUrl('https://youtu.be/abc123?t=1h2m3s')).toBe(
      'https://www.youtube.com/embed/abc123?start=3723',
    )
  })

  it('converte Vimeo', () => {
    expect(toVideoEmbedUrl('https://vimeo.com/123456789')).toBe('https://player.vimeo.com/video/123456789')
  })

  it('não mexe no que já está embutível', () => {
    const embed = 'https://www.youtube.com/embed/dQw4w9WgXcQ?start=30'
    expect(toVideoEmbedUrl(embed)).toBe(embed)
  })

  it('deixa passar host desconhecido, URL inválida e vazio', () => {
    expect(toVideoEmbedUrl('https://cdn.empresa.com/aula.mp4')).toBe('https://cdn.empresa.com/aula.mp4')
    expect(toVideoEmbedUrl('nao é uma url')).toBe('nao é uma url')
    expect(toVideoEmbedUrl('   ')).toBe('')
  })
})
