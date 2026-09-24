import { describe, expect, it } from 'vitest'
import {
  COURSE_BLOCK_TYPES,
  courseLessonBlockSchema,
  createEmptyBlock,
  hasLessonContent,
  isBlockEmpty,
  isSafeBlockUrl,
  lessonKindOf,
  LESSON_KIND_ICONS,
  LESSON_KIND_LABELS,
  MAX_BLOCKS_PER_LESSON,
  parseCourseLessonBlocks,
  type CourseLessonBlock,
} from './course-lesson-block'

describe('catálogo de blocos', () => {
  it('tem os catorze tipos que o Documento 4 lista', () => {
    expect(COURSE_BLOCK_TYPES).toHaveLength(14)
  })

  it('cria bloco vazio válido para todo tipo', () => {
    for (const type of COURSE_BLOCK_TYPES) {
      const bloco = createEmptyBlock(type, `blk_${type}`)
      expect(courseLessonBlockSchema.safeParse(bloco).success, type).toBe(true)
    }
  })

  it('todo bloco recém-criado nasce vazio — menos o divisor, que não tem o que preencher', () => {
    for (const type of COURSE_BLOCK_TYPES) {
      const bloco = createEmptyBlock(type, `blk_${type}`)
      expect(isBlockEmpty(bloco), type).toBe(type !== 'divider')
    }
  })
})

describe('isSafeBlockUrl', () => {
  it('aceita http e https', () => {
    expect(isSafeBlockUrl('https://exemplo.com/a.pdf')).toBe(true)
    expect(isSafeBlockUrl('http://exemplo.com')).toBe(true)
  })

  // Bloco não injeta marcação (o renderer é React, sem dangerouslySetInnerHTML),
  // mas href/src aceitariam esses esquemas — e aí o clique do aluno executa.
  it('recusa javascript:, data: e o que não é URL', () => {
    expect(isSafeBlockUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeBlockUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false)
    expect(isSafeBlockUrl('/caminho/relativo')).toBe(false)
    expect(isSafeBlockUrl('exemplo.com')).toBe(false)
  })

  it('o schema recusa o bloco inteiro quando a URL não é segura', () => {
    const mau = { id: 'b1', type: 'button', label: 'Clique', url: 'javascript:alert(1)' }
    expect(courseLessonBlockSchema.safeParse(mau).success).toBe(false)
  })

  // O editor salva enquanto a pessoa ainda está preenchendo; URL vazia não é
  // URL insegura.
  it('aceita URL vazia, que é bloco em edição', () => {
    const bloco = { id: 'b1', type: 'image', url: '' }
    expect(courseLessonBlockSchema.safeParse(bloco).success).toBe(true)
  })
})

describe('parseCourseLessonBlocks', () => {
  it('devolve lista vazia para o que não é array', () => {
    expect(parseCourseLessonBlocks(null)).toEqual([])
    expect(parseCourseLessonBlocks({})).toEqual([])
    expect(parseCourseLessonBlocks('[]')).toEqual([])
  })

  // A leitura é tolerante de propósito: `contentBlocks` é Json, e uma linha
  // escrita por outra versão do formato não pode derrubar a aula do aluno.
  it('descarta bloco inválido e mantém o resto da aula de pé', () => {
    const blocos = parseCourseLessonBlocks([
      { id: 'b1', type: 'text', text: 'vale' },
      { id: 'b2', type: 'inventado', o: 'que' },
      { id: 'b3', type: 'divider' },
      { type: 'text', text: 'sem id' },
    ])
    expect(blocos.map((b) => b.id)).toEqual(['b1', 'b3'])
  })

  it('para no teto de blocos por aula', () => {
    const muitos = Array.from({ length: MAX_BLOCKS_PER_LESSON + 10 }, (_, i) => ({
      id: `b${i}`,
      type: 'divider',
    }))
    expect(parseCourseLessonBlocks(muitos)).toHaveLength(MAX_BLOCKS_PER_LESSON)
  })
})

describe('hasLessonContent', () => {
  it('aula só com blocos vazios não conta como conteúdo publicado', () => {
    const blocos: CourseLessonBlock[] = [
      createEmptyBlock('text', 'b1'),
      createEmptyBlock('image', 'b2'),
    ]
    expect(hasLessonContent(blocos)).toBe(false)
  })

  it('um bloco preenchido basta', () => {
    const blocos: CourseLessonBlock[] = [
      createEmptyBlock('text', 'b1'),
      { id: 'b2', type: 'text', text: 'Olá' },
    ]
    expect(hasLessonContent(blocos)).toBe(true)
  })
})

describe('lessonKindOf', () => {
  it('o vídeo manda: aula com vídeo e texto se anuncia como vídeo', () => {
    expect(
      lessonKindOf([
        { id: 'b1', type: 'text', text: 'introdução' },
        { id: 'b2', type: 'video', url: 'https://youtu.be/abc', source: 'youtube' },
      ]),
    ).toBe('VIDEO')
  })

  it('vídeo sem URL não conta — é bloco em branco', () => {
    expect(
      lessonKindOf([
        { id: 'b1', type: 'text', text: 'introdução' },
        createEmptyBlock('video', 'b2'),
      ]),
    ).toBe('TEXT')
  })

  it('aula só de quiz é avaliação', () => {
    expect(lessonKindOf([{ id: 'b1', type: 'quiz', quizId: 'q1' }])).toBe('QUIZ')
  })

  it('quiz junto de conteúdo não vira avaliação', () => {
    expect(
      lessonKindOf([
        { id: 'b1', type: 'text', text: 'leia antes' },
        { id: 'b2', type: 'quiz', quizId: 'q1' },
      ]),
    ).toBe('TEXT')
  })

  it('aula vazia é leitura, não quebra', () => {
    expect(lessonKindOf([])).toBe('TEXT')
  })

  // Cobertura que estava em `learning.test.ts` enquanto o formato era enum.
  it('todo formato derivado tem rótulo e ícone', () => {
    for (const kind of ['VIDEO', 'QUIZ', 'TEXT'] as const) {
      expect(LESSON_KIND_LABELS[kind]).toBeTruthy()
      expect(LESSON_KIND_ICONS[kind]).toBeTruthy()
    }
  })
})
