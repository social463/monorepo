import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { RichDoc } from '@legends/shared'
import { RichTextEditor } from './RichTextEditor'
import { RICH_COLOR_HEX, RICH_SIZE_COMMAND } from './rich-text-dom'

const DOC: RichDoc = { blocks: [{ type: 'paragraph', spans: [{ text: 'Comunicado do time' }] }] }

/**
 * jsdom não implementa `execCommand`; o espião é o que dá para verificar. O que
 * este arquivo cobre é a PARTE NOSSA: qual comando cada controle dispara e se a
 * seleção do trecho sobrevive ao clique na barra — o resto (aplicar o estilo) é
 * do navegador.
 */
function stubExecCommand() {
  const spy = vi.fn().mockReturnValue(true)
  Object.defineProperty(document, 'execCommand', { value: spy, configurable: true, writable: true })
  return spy
}

/** Seleciona o texto do editor, como um arrastar de mouse faria. */
function selectAllText(): HTMLElement {
  const editor = screen.getByRole('textbox')
  const textNode = editor.querySelector('div')?.firstChild ?? editor.firstChild
  const range = document.createRange()
  range.selectNodeContents(textNode as Node)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  fireEvent.mouseUp(editor)
  return editor
}

function commandsOf(spy: ReturnType<typeof stubExecCommand>) {
  return spy.mock.calls.map((call) => [call[0], call[2]])
}

describe('RichTextEditor: formatar o trecho selecionado', () => {
  let exec: ReturnType<typeof stubExecCommand>

  beforeEach(() => {
    exec = stubExecCommand()
    render(<RichTextEditor value={DOC} onChange={vi.fn()} />)
    selectAllText()
  })

  it('sublinhado, negrito e itálico caem no trecho selecionado', () => {
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Sublinhado' }))
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Negrito' }))
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Itálico' }))

    expect(commandsOf(exec)).toEqual(
      expect.arrayContaining([
        ['underline', undefined],
        ['bold', undefined],
        ['italic', undefined],
      ]),
    )
    // A seleção continua cobrindo o texto — é o que faz o comando ter alvo.
    expect(window.getSelection()?.toString()).toBe('Comunicado do time')
  })

  it('a paleta pinta o texto e o preenchimento com a cor escolhida', () => {
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Cor do texto' }))
    fireEvent.click(screen.getByRole('button', { name: 'Texto Vermelho' }))

    expect(commandsOf(exec)).toContainEqual(['foreColor', RICH_COLOR_HEX.danger])

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Cor do texto' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preenchimento Amarelo' }))

    expect(commandsOf(exec)).toContainEqual(['hiliteColor', RICH_COLOR_HEX.warning])
  })

  it('A+ sobe um degrau a partir do tamanho do trecho, e A− desce', () => {
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Aumentar texto' }))
    expect(commandsOf(exec)).toContainEqual(['fontSize', RICH_SIZE_COMMAND.lg])

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Diminuir texto' }))
    expect(commandsOf(exec)).toContainEqual(['fontSize', RICH_SIZE_COMMAND.sm])
  })

  it('link vem de um popover do app, não do prompt do navegador', () => {
    const prompt = vi.spyOn(window, 'prompt')
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Inserir link' }))
    fireEvent.change(screen.getByLabelText('Endereço do link'), { target: { value: 'legends.com.br' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))

    expect(prompt).not.toHaveBeenCalled()
    // Sem esquema, vira https:// — e o popover fecha.
    expect(commandsOf(exec)).toContainEqual(['createLink', 'https://legends.com.br'])
    expect(screen.queryByLabelText('Endereço do link')).not.toBeInTheDocument()
  })

  it('recusa esquema proibido no link em vez de transformá-lo em URL válida', () => {
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Inserir link' }))
    fireEvent.change(screen.getByLabelText('Endereço do link'), { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(commandsOf(exec)).not.toContainEqual(['createLink', expect.anything()])
  })
})
