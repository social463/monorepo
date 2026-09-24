import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { CourseLessonBlock } from '@legends/shared'
import { LessonBlocks } from './LessonBlocks'

function renderBlocks(blocks: CourseLessonBlock[]) {
  return render(
    <MemoryRouter>
      <LessonBlocks blocks={blocks} />
    </MemoryRouter>,
  )
}

describe('LessonBlocks', () => {
  it('renderiza os blocos na ordem em que foram montados', () => {
    renderBlocks([
      { id: 'b1', type: 'heading', level: 2, text: 'Introdução' },
      { id: 'b2', type: 'text', text: 'Bem-vindo ao curso' },
      { id: 'b3', type: 'quote', text: 'Feito é melhor que perfeito', author: 'Alguém' },
    ])

    expect(screen.getByRole('heading', { name: 'Introdução' })).toBeInTheDocument()
    expect(screen.getByText('Bem-vindo ao curso')).toBeInTheDocument()
    expect(screen.getByText('— Alguém')).toBeInTheDocument()
  })

  // O `contentHtml` antigo ia para `dangerouslySetInnerHTML`. O bloco de texto
  // é TEXTO: marcação colada aparece literal em vez de virar elemento.
  it('não interpreta marcação no bloco de texto', () => {
    renderBlocks([{ id: 'b1', type: 'text', text: '<img src=x onerror="alert(1)"> fim' }])

    expect(screen.getByText(/<img src=x onerror="alert\(1\)"> fim/)).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('vídeo do YouTube vira iframe de embed; arquivo direto vira player nativo', () => {
    const { unmount } = renderBlocks([
      { id: 'b1', type: 'video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', source: 'youtube' },
    ])
    expect(screen.getByTitle('Vídeo da aula')).toHaveAttribute(
      'src',
      expect.stringContaining('youtube.com/embed/dQw4w9WgXcQ'),
    )
    unmount()

    renderBlocks([{ id: 'b2', type: 'video', url: 'https://cdn.exemplo.com/aula.mp4', source: 'upload' }])
    expect(screen.queryByTitle('Vídeo da aula')).not.toBeInTheDocument()
    expect(document.querySelector('video')).toHaveAttribute('src', 'https://cdn.exemplo.com/aula.mp4')
  })

  // Marcar item é conforto de leitura do aluno, não progresso do curso: some
  // ao sair da aula e não volta para a API.
  it('o checklist marca e desmarca na sessão', async () => {
    const user = userEvent.setup()
    renderBlocks([
      {
        id: 'b1',
        type: 'checklist',
        items: [
          { text: 'Ler o material', done: false },
          { text: 'Fazer o exercício', done: true },
        ],
      },
    ])

    expect(screen.getByText('Ler o material')).not.toHaveClass('line-through')
    // O que já nasce marcado pela autoria aparece marcado.
    expect(screen.getByText('Fazer o exercício')).toHaveClass('line-through')

    await user.click(screen.getByRole('button', { name: /ler o material/i }))
    expect(screen.getByText('Ler o material')).toHaveClass('line-through')

    await user.click(screen.getByRole('button', { name: /ler o material/i }))
    expect(screen.getByText('Ler o material')).not.toHaveClass('line-through')
  })

  it('o bloco de quiz leva para o quiz e some quando não há quiz escolhido', () => {
    const { unmount } = renderBlocks([{ id: 'b1', type: 'quiz', quizId: 'quiz-9' }])
    expect(screen.getByRole('link', { name: /fazer o quiz/i })).toHaveAttribute(
      'href',
      '/aprendizado/quiz/quiz-9',
    )
    unmount()

    renderBlocks([{ id: 'b2', type: 'quiz', quizId: null }])
    expect(screen.queryByRole('link', { name: /fazer o quiz/i })).not.toBeInTheDocument()
  })

  it('destaque, botão, link e anexo saem com o que a pessoa escreveu', () => {
    renderBlocks([
      { id: 'b1', type: 'callout', text: 'Prazo até sexta', tone: 'warning' },
      { id: 'b2', type: 'button', label: 'Abrir planilha', url: 'https://exemplo.com/x' },
      { id: 'b3', type: 'link', url: 'https://exemplo.com/y', title: 'Guia', description: 'Passo a passo' },
      { id: 'b4', type: 'attachment', url: 'https://exemplo.com/z.pdf', name: 'Contrato.pdf' },
    ])

    expect(screen.getByText('Prazo até sexta')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /abrir planilha/i })).toHaveAttribute('href', 'https://exemplo.com/x')
    expect(screen.getByText('Passo a passo')).toBeInTheDocument()
    expect(screen.getByText('Contrato.pdf')).toBeInTheDocument()
  })
})
