import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { CourseLessonBlock } from '@legends/shared'
import { CourseBlockEditor } from './CourseBlockEditor'

/** Casca controlada: o editor é controlado, então o teste guarda o estado. */
function Harness({
  inicial = [],
  quizzes = [],
}: {
  inicial?: CourseLessonBlock[]
  quizzes?: { id: string; title: string }[]
}) {
  const [blocks, setBlocks] = useState<CourseLessonBlock[]>(inicial)
  return (
    <>
      <CourseBlockEditor blocks={blocks} onChange={setBlocks} quizzes={quizzes} />
      <output data-testid="ordem">{blocks.map((b) => b.type).join(',')}</output>
    </>
  )
}

describe('CourseBlockEditor', () => {
  it('empilha texto e imagem na mesma aula — o exemplo da seção 9.1', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    expect(screen.getByText(/nenhum bloco ainda/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /adicionar bloco/i }))
    await user.click(screen.getByRole('button', { name: 'Texto' }))
    await user.click(screen.getByRole('button', { name: /adicionar bloco/i }))
    await user.click(screen.getByRole('button', { name: 'Imagem' }))

    expect(screen.getByTestId('ordem')).toHaveTextContent('text,image')
  })

  it('oferece os catorze tipos de bloco', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: /adicionar bloco/i }))

    for (const rotulo of [
      'Título',
      'Texto',
      'Checklist',
      'Imagem',
      'Vídeo',
      'PDF',
      'Destaque',
      'Citação',
      'Código',
      'Divisor',
      'Botão',
      'Link externo',
      'Anexo',
      'Quiz',
    ]) {
      expect(screen.getByRole('button', { name: rotulo })).toBeInTheDocument()
    }
  })

  it('move bloco para cima e para baixo', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        inicial={[
          { id: 'b1', type: 'text', text: 'primeiro' },
          { id: 'b2', type: 'divider' },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /mover divisor para cima/i }))
    expect(screen.getByTestId('ordem')).toHaveTextContent('divider,text')

    await user.click(screen.getByRole('button', { name: /mover divisor para baixo/i }))
    expect(screen.getByTestId('ordem')).toHaveTextContent('text,divider')
  })

  // As pontas não têm para onde ir: botão desabilitado em vez de silenciosamente
  // sem efeito.
  it('desabilita mover além das pontas', async () => {
    render(
      <Harness
        inicial={[
          { id: 'b1', type: 'text', text: 'primeiro' },
          { id: 'b2', type: 'divider' },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: /mover texto para cima/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /mover divisor para baixo/i })).toBeDisabled()
  })

  it('remove bloco', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        inicial={[
          { id: 'b1', type: 'text', text: 'fica' },
          { id: 'b2', type: 'divider' },
        ]}
      />,
    )
    await user.click(screen.getByRole('button', { name: /remover divisor/i }))
    expect(screen.getByTestId('ordem')).toHaveTextContent('text')
  })

  it('edita o texto do bloco', async () => {
    const user = userEvent.setup()
    render(<Harness inicial={[{ id: 'b1', type: 'text', text: '' }]} />)

    await user.type(screen.getByRole('textbox', { name: /^texto$/i }), 'Bem-vindo')
    expect(screen.getByRole('textbox', { name: /^texto$/i })).toHaveValue('Bem-vindo')
  })

  it('o bloco de quiz lista os quizzes do curso e avisa quando não há nenhum', async () => {
    const { unmount } = render(<Harness inicial={[{ id: 'b1', type: 'quiz', quizId: null }]} />)
    expect(screen.getByText(/ainda não tem quiz/i)).toBeInTheDocument()
    unmount()

    render(
      <Harness
        inicial={[{ id: 'b1', type: 'quiz', quizId: null }]}
        quizzes={[{ id: 'q1', title: 'Avaliação final' }]}
      />,
    )
    expect(screen.getByText(/não cria uma segunda nota/i)).toBeInTheDocument()
  })

  it('checklist ganha e perde itens', async () => {
    const user = userEvent.setup()
    render(<Harness inicial={[{ id: 'b1', type: 'checklist', items: [{ text: 'um', done: false }] }]} />)

    await user.click(screen.getByRole('button', { name: /^item$/i }))
    expect(screen.getByRole('textbox', { name: /texto do item 2/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /remover item 1/i }))
    const restantes = within(document.body).queryAllByRole('textbox', { name: /texto do item/i })
    expect(restantes).toHaveLength(1)
  })
})
