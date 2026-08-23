import { describe, expect, it } from 'vitest'
import { quizOptionsSchema } from './course-quiz'
import { CERTIFICATE_REQUEST_STATUSES, CERTIFICATE_REQUEST_STATUS_LABELS } from './course-certificate'

const validOptions = [
  { id: 'opt-1', text: 'Resposta certa', correct: true },
  { id: 'opt-2', text: 'Resposta errada', correct: false },
]

describe('quizOptionsSchema', () => {
  it('recusa lista sem nenhuma opção correta', () => {
    const result = quizOptionsSchema.safeParse([
      { id: 'opt-1', text: 'Errada 1', correct: false },
      { id: 'opt-2', text: 'Errada 2', correct: false },
    ])

    expect(result.success).toBe(false)
  })

  it('recusa lista com uma opção só', () => {
    const result = quizOptionsSchema.safeParse([{ id: 'opt-1', text: 'Única', correct: true }])

    expect(result.success).toBe(false)
  })

  it('aceita a forma válida', () => {
    const result = quizOptionsSchema.safeParse(validOptions)

    expect(result.success).toBe(true)
  })

  /**
   * Id repetido dentro da questão corrompe a correção: ela casa a resposta por
   * id, então a escolha de uma opção vale pela outra. A regra vive no schema
   * (e não só no editor) porque o servidor não pode depender da disciplina de
   * quem envia.
   */
  it('recusa duas opções com o mesmo id', () => {
    const result = quizOptionsSchema.safeParse([
      { id: 'opt-novo-1', text: 'Certa', correct: true },
      { id: 'opt-novo-1', text: 'Errada', correct: false },
    ])

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('As opções da questão não podem repetir o mesmo identificador.')
  })

  it('aceita ids distintos com o mesmo texto — a unicidade é do id, não do texto', () => {
    const result = quizOptionsSchema.safeParse([
      { id: 'opt-1', text: 'Igual', correct: true },
      { id: 'opt-2', text: 'Igual', correct: false },
    ])

    expect(result.success).toBe(true)
  })
})

describe('CERTIFICATE_REQUEST_STATUSES', () => {
  it('tem rótulo em português para cada status', () => {
    for (const status of CERTIFICATE_REQUEST_STATUSES) {
      const label = CERTIFICATE_REQUEST_STATUS_LABELS[status]
      expect(label).toBeTruthy()
      expect(typeof label).toBe('string')
    }
  })
})
