import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Markdown, isSafeHref } from './Markdown'

describe('Markdown — formatação', () => {
  it('renderiza títulos de nível 2 e 3', () => {
    const { container } = render(<Markdown content={'## Nossos valores\n\n### Colaboradores'} />)
    expect(container.querySelector('h2')).toHaveTextContent('Nossos valores')
    expect(container.querySelector('h3')).toHaveTextContent('Colaboradores')
  })

  it('rebaixa # para h2 — o h1 é o título da página', () => {
    const { container } = render(<Markdown content="# Manifesto" />)
    expect(container.querySelector('h1')).toBeNull()
    expect(container.querySelector('h2')).toHaveTextContent('Manifesto')
  })

  it('junta linhas seguidas num parágrafo e separa por linha em branco', () => {
    const { container } = render(<Markdown content={'Primeira linha\nmesma ideia\n\nOutro parágrafo'} />)
    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[0]).toHaveTextContent('Primeira linha mesma ideia')
    expect(paragraphs[1]).toHaveTextContent('Outro parágrafo')
  })

  it('renderiza lista não ordenada', () => {
    const { container } = render(<Markdown content={'- Buscamos entender\n- Observamos dados'} />)
    expect(container.querySelectorAll('ul li')).toHaveLength(2)
  })

  it('renderiza lista ordenada', () => {
    const { container } = render(<Markdown content={'1. Crie sua conta\n2. Escolha o plano'} />)
    expect(container.querySelectorAll('ol li')).toHaveLength(2)
  })

  it('renderiza citação', () => {
    const { container } = render(<Markdown content={'> Construir a EMR sempre foi mais\n> do que criar uma empresa'} />)
    const quote = container.querySelector('blockquote')
    expect(quote).not.toBeNull()
    expect(quote!.querySelectorAll('p')).toHaveLength(2)
  })

  it('renderiza separador', () => {
    const { container } = render(<Markdown content={'Antes\n\n---\n\nDepois'} />)
    expect(container.querySelector('hr')).not.toBeNull()
  })

  it('aplica negrito, itálico e código inline', () => {
    const { container } = render(<Markdown content="Somos **donos**, agimos com *clareza* e usamos `dados`." />)
    expect(container.querySelector('strong')).toHaveTextContent('donos')
    expect(container.querySelector('em')).toHaveTextContent('clareza')
    expect(container.querySelector('code')).toHaveTextContent('dados')
  })

  it('link http abre em nova aba com rel seguro', () => {
    render(<Markdown content="Acesse o [Wellhub](https://wellhub.com)." />)
    const link = screen.getByRole('link', { name: 'Wellhub' })
    expect(link).toHaveAttribute('href', 'https://wellhub.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('link interno não abre em nova aba', () => {
    render(<Markdown content="Veja os [manuais](/cultura?aba=manuais)." />)
    const link = screen.getByRole('link', { name: 'manuais' })
    expect(link).toHaveAttribute('href', '/cultura?aba=manuais')
    expect(link).not.toHaveAttribute('target')
  })

  it('conteúdo vazio não quebra', () => {
    const { container } = render(<Markdown content="" />)
    expect(container.querySelectorAll('p')).toHaveLength(0)
  })
})

describe('Markdown — segurança', () => {
  it('não injeta HTML: tag vira texto visível', () => {
    const { container } = render(<Markdown content={'<script>alert(1)</script>'} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('<script>alert(1)</script>')
  })

  it('tag de imagem com onerror não vira elemento', () => {
    const { container } = render(<Markdown content={'<img src=x onerror="alert(1)">'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">')
  })

  it('link javascript: não vira link — fica texto puro', () => {
    const { container } = render(<Markdown content="[clique](javascript:alert(1))" />)
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('[clique](javascript:alert(1))')
  })

  it('link data: não vira link', () => {
    const { container } = render(<Markdown content="[baixe](data:text/html;base64,PHNjcmlwdD4=)" />)
    expect(container.querySelector('a')).toBeNull()
  })

  it('link protocol-relative não vira link', () => {
    const { container } = render(<Markdown content="[fora](//evil.com)" />)
    expect(container.querySelector('a')).toBeNull()
  })

  it('renderiza tabela GFM com cabeçalho e corpo', () => {
    const { container } = render(
      <Markdown
        content={'| Empresa | Prática |\n|---|---|\n| Nubank | Day off |\n| iFood | Creche |'}
      />,
    )
    const headers = [...container.querySelectorAll('th')].map((th) => th.textContent)
    expect(headers).toEqual(['Empresa', 'Prática'])
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(container.querySelector('tbody tr td')).toHaveTextContent('Nubank')
  })

  it('linha com pipes mas sem separadora não vira tabela', () => {
    const { container } = render(<Markdown content="| isto | não é tabela |" />)
    expect(container.querySelector('table')).toBeNull()
  })

  it('normaliza linha com menos e com mais células que o cabeçalho', () => {
    const { container } = render(
      <Markdown content={'| A | B | C |\n|---|---|---|\n| só um |\n| 1 | 2 | 3 | 4 |'} />,
    )
    const rows = [...container.querySelectorAll('tbody tr')]
    expect(rows[0].querySelectorAll('td')).toHaveLength(3)
    expect(rows[1].querySelectorAll('td')).toHaveLength(3)
  })

  it('markup dentro de célula vira texto, não HTML', () => {
    const { container } = render(
      <Markdown content={'| Ação |\n|---|\n| <img src=x onerror=alert(1)> |'} />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('tbody td')).toHaveTextContent('<img src=x onerror=alert(1)>')
  })

  it('negrito e link continuam funcionando dentro da célula', () => {
    const { container } = render(
      <Markdown content={'| Empresa |\n|---|\n| **Nubank** [site](https://nubank.com.br) |'} />,
    )
    expect(container.querySelector('tbody td strong')).toHaveTextContent('Nubank')
    expect(container.querySelector('tbody td a')).toHaveAttribute('href', 'https://nubank.com.br')
  })

  it('isSafeHref aceita o que deve e recusa o resto', () => {
    expect(isSafeHref('https://exemplo.com')).toBe(true)
    expect(isSafeHref('http://exemplo.com')).toBe(true)
    expect(isSafeHref('mailto:pessoa@empresa.com')).toBe(true)
    expect(isSafeHref('tel:188')).toBe(true)
    expect(isSafeHref('/cultura')).toBe(true)
    expect(isSafeHref('#secao')).toBe(true)

    expect(isSafeHref('javascript:alert(1)')).toBe(false)
    expect(isSafeHref('  JavaScript:alert(1)')).toBe(false)
    expect(isSafeHref('data:text/html,<script>')).toBe(false)
    expect(isSafeHref('vbscript:msgbox')).toBe(false)
    expect(isSafeHref('//evil.com')).toBe(false)
    expect(isSafeHref('')).toBe(false)
  })
})
