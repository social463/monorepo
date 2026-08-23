import { describe, it, expect } from 'vitest'
import {
  canModerateCorporatePost,
  canPinCorporatePost,
  canPublishCorporatePostDirectly,
  canSeeCorporateMural,
  CORPORATE_POST_COLLAPSE_CHARS,
  CORPORATE_POST_EXCERPT_LENGTH,
  CORPORATE_POST_REACTIONS,
  isCollapsibleCorporatePost,
} from './corporate-mural'
import type { RichDoc } from './rich-text'

describe('canPublishCorporatePostDirectly', () => {
  // Mudou na 2ª rodada: TODO mundo escreve, e o papel decide só se o post nasce
  // publicado ou pendente. A tabela de permissões da G&G põe o Líder junto do
  // Colaborador — o comunicado dele também passa pela fila.
  it('libera só a administração', () => {
    expect(canPublishCorporatePostDirectly('ADMIN')).toBe(true)
    expect(canPublishCorporatePostDirectly('SUBADMIN')).toBe(true)
  })

  it.each(['HEAD', 'MANAGER', 'LEAD', 'LEGEND', 'THIRD_PARTY'])('manda %s para a fila', (role) => {
    expect(canPublishCorporatePostDirectly(role)).toBe(false)
  })

  it('trata acesso administrativo delegado como admin pleno', () => {
    expect(canPublishCorporatePostDirectly('LEGEND', true)).toBe(true)
  })

  it('trata papel ausente como sem permissão', () => {
    expect(canPublishCorporatePostDirectly(null)).toBe(false)
  })
})

describe('canSeeCorporateMural', () => {
  // O feed é da empresa toda: não passa pelo toggle de feature por setor,
  // senão a Home e a API voltam a barrar uma lenda com 403. O recorte por
  // setor de cada comunicado é outro assunto (`audience`), resolvido no item.
  it('libera quem é do time mesmo sem a feature habilitada', () => {
    expect(canSeeCorporateMural({ role: 'LEGEND', features: [] })).toBe(true)
    expect(canSeeCorporateMural({ role: 'LEAD', features: ['votar'] })).toBe(true)
    expect(canSeeCorporateMural({ role: 'ADMIN' })).toBe(true)
  })

  it('exige a feature na allowlist individual do terceirizado', () => {
    expect(canSeeCorporateMural({ role: 'THIRD_PARTY', features: ['votar'] })).toBe(false)
    expect(canSeeCorporateMural({ role: 'THIRD_PARTY', features: ['mural-corporativo'] })).toBe(true)
    expect(canSeeCorporateMural({ role: 'THIRD_PARTY' })).toBe(false)
  })
})

describe('canPinCorporatePost', () => {
  it.each(['ADMIN', 'SUBADMIN'])('deixa %s fixar', (role) => {
    expect(canPinCorporatePost(role)).toBe(true)
  })

  it.each(['HEAD', 'MANAGER', 'LEAD', 'LEGEND', 'THIRD_PARTY'])('bloqueia %s', (role) => {
    expect(canPinCorporatePost(role)).toBe(false)
  })

  it('trata papel ausente como sem permissão', () => {
    expect(canPinCorporatePost(null)).toBe(false)
    expect(canPinCorporatePost(undefined)).toBe(false)
  })

  it('modera quem fixa — é a mesma turma', () => {
    for (const role of ['ADMIN', 'SUBADMIN', 'LEAD', 'LEGEND']) {
      expect(canModerateCorporatePost(role)).toBe(canPinCorporatePost(role))
    }
  })

  it('expõe o tamanho do trecho do painel', () => {
    expect(CORPORATE_POST_EXCERPT_LENGTH).toBe(80)
  })
})

describe('reações do feed', () => {
  // A G&G pediu o coração da casa em verde. `❤️` continua na lista porque o
  // toggle valida o emoji contra ela: tirá-lo travaria a REMOÇÃO das reações
  // que já estão no banco.
  it('põe o verde na frente e mantém o vermelho disponível', () => {
    expect(CORPORATE_POST_REACTIONS[0]).toBe('💚')
    expect(CORPORATE_POST_REACTIONS).toContain('❤️')
  })
})

describe('isCollapsibleCorporatePost', () => {
  const linhas = (n: number): RichDoc => ({
    blocks: Array.from({ length: n }, (_, i) => ({ type: 'paragraph' as const, spans: [{ text: `linha ${i}` }] })),
  })

  it('não corta post curto', () => {
    expect(isCollapsibleCorporatePost({ content: 'aviso rápido' })).toBe(false)
    expect(isCollapsibleCorporatePost({ content: 'a\nb\nc', body: linhas(3) })).toBe(false)
  })

  it('corta a partir da quarta linha', () => {
    expect(isCollapsibleCorporatePost({ content: 'a\nb\nc\nd', body: linhas(4) })).toBe(true)
  })

  it('corta parágrafo único comprido', () => {
    expect(isCollapsibleCorporatePost({ content: 'x'.repeat(CORPORATE_POST_COLLAPSE_CHARS + 1) })).toBe(true)
  })

  it('funciona em post antigo, que só tem texto puro', () => {
    expect(isCollapsibleCorporatePost({ content: 'a\nb\nc\nd\ne', body: null })).toBe(true)
  })
})
