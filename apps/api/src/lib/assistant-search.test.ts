import { describe, expect, it } from 'vitest'
import {
  normalizeQuestion,
  rankKnowledgeEntries,
  selectKnowledgeContext,
  type RankableEntry,
} from './assistant-search'

function entrada(over: Partial<RankableEntry> & { id: string }): RankableEntry {
  return {
    category: null,
    question: '',
    answer: '',
    keywords: [],
    ...over,
  }
}

const FERIAS = entrada({
  id: 'ferias',
  category: 'Férias',
  question: 'Quantos dias de férias eu tenho por ano?',
  answer: 'São 30 dias corridos após 12 meses de trabalho.',
  keywords: ['ferias', 'descanso'],
})

const VALE = entrada({
  id: 'vale',
  category: 'Benefícios',
  question: 'Como funciona o vale refeição?',
  answer: 'O crédito do vale refeição cai todo dia 5.',
  keywords: ['vale', 'refeicao', 'beneficio'],
})

describe('normalizeQuestion', () => {
  it('junta variações da mesma dúvida na mesma chave', () => {
    expect(normalizeQuestion('Quantos DIAS de férias?')).toBe('quantos dias de ferias')
    expect(normalizeQuestion('  quantos dias de férias  ')).toBe('quantos dias de ferias')
  })
})

describe('rankKnowledgeEntries', () => {
  it('casa por palavra-chave mesmo com acento e caixa diferentes', () => {
    const result = rankKnowledgeEntries([FERIAS, VALE], 'Preciso saber sobre FÉRIAS')
    expect(result.map((e) => e.id)).toEqual(['ferias'])
  })

  it('casa por termo da pergunta cadastrada', () => {
    const result = rankKnowledgeEntries([FERIAS, VALE], 'como funciona o vale refeição')
    expect(result.map((e) => e.id)).toEqual(['vale'])
  })

  it('casa por termo que só aparece na resposta', () => {
    const result = rankKnowledgeEntries([FERIAS, VALE], 'crédito cai que dia?')
    expect(result.map((e) => e.id)).toEqual(['vale'])
  })

  it('ordena palavra-chave acima de acerto só na resposta', () => {
    const soNaResposta = entrada({
      id: 'outro',
      question: 'Onde vejo meu holerite?',
      answer: 'O holerite fica no portal, junto do saldo de férias e descanso.',
    })
    const result = rankKnowledgeEntries([soNaResposta, FERIAS], 'férias e descanso')
    expect(result.map((e) => e.id)).toEqual(['ferias', 'outro'])
  })

  it('palavra-chave de várias palavras não casa pelo conectivo solto', () => {
    // "plano de saude" quebrado em tokens dava a "de" o peso de palavra-chave,
    // e "de" está em quase toda pergunta: perguntar férias respondia plano de
    // saúde (visto no chat, com a base real da EMR).
    const plano = entrada({
      id: 'plano',
      question: 'Como funciona o plano de saúde e odontológico?',
      answer: 'Disponível para colaboradores CLT após 45 dias da admissão.',
      keywords: ['plano de saude', 'odontologico'],
    })
    const ferias = entrada({
      id: 'ferias-30',
      question: 'Como funcionam as férias?',
      answer: 'São 30 dias corridos, ou 20 dias mais 10 de abono pecuniário.',
      keywords: ['ferias', 'abono pecuniario'],
    })

    const result = rankKnowledgeEntries([plano, ferias], 'quantos dias de férias eu tenho?')

    expect(result[0]?.id).toBe('ferias-30')
  })

  it('palavra-chave de várias palavras ainda casa quando a frase inteira aparece', () => {
    const plano = entrada({
      id: 'plano',
      question: 'Como funciona o convênio?',
      answer: 'Unimed no Recife, Amil nos demais estados.',
      keywords: ['plano de saude'],
    })

    expect(rankKnowledgeEntries([plano], 'como entro no plano de saúde?').map((e) => e.id)).toEqual(['plano'])
  })

  it('não casa quando a pergunta só tem palavras vazias', () => {
    expect(rankKnowledgeEntries([FERIAS, VALE], 'como faço?')).toEqual([])
  })

  it('não casa quando nada da pergunta aparece na base', () => {
    expect(rankKnowledgeEntries([FERIAS, VALE], 'qual a política de estacionamento')).toEqual([])
  })

  it('respeita o limite de resultados', () => {
    const muitas = Array.from({ length: 10 }, (_, i) =>
      entrada({ id: `e${i}`, question: 'Política de férias', keywords: ['ferias'] }),
    )
    expect(rankKnowledgeEntries(muitas, 'férias', 3)).toHaveLength(3)
  })

  it('não casa com um único termo genérico compartilhado (caso do atestado)', () => {
    // "dias" sozinho casa a pergunta cadastrada de FERIAS, mas não sustenta a
    // resposta: a pergunta real (sobre atestado) nunca aparece na lacuna se isso
    // contar como match.
    const result = rankKnowledgeEntries(
      [FERIAS, VALE],
      'quantos dias tenho para avisar sobre atestado?',
    )
    expect(result).toEqual([])
  })

  it('casa por palavra-chave de duas letras, mesmo curta demais para o corte normal', () => {
    const rh = entrada({
      id: 'rh',
      question: 'Como faço para falar com o setor responsável?',
      answer: 'Fale com o RH pelo ramal 1234.',
      keywords: ['RH'],
    })
    const result = rankKnowledgeEntries([rh, FERIAS], 'Qual o telefone do RH?')
    expect(result.map((e) => e.id)).toEqual(['rh'])
  })

  it('ignora palavra-chave cadastrada que é palavra vazia', () => {
    const malCurada = entrada({
      id: 'mal-curada',
      question: 'Aviso interno do setor',
      answer: 'Procure a liderança.',
      keywords: ['para', 'como'],
    })
    // "para" está na pergunta, mas como keyword vazia não pode sustentar o match sozinha.
    const result = rankKnowledgeEntries([malCurada], 'Para quem devo enviar o atestado?')
    expect(result).toEqual([])
  })
})

describe('selectKnowledgeContext', () => {
  it('devolve a base inteira quando ela cabe no teto, inclusive o que não casou', () => {
    const result = selectKnowledgeContext([FERIAS, VALE], 'quantos dias de férias?')
    // O vale não casa com a pergunta, e é justamente ele que precisa chegar ao
    // modelo: sem ele, "e quais os benefícios?" no turno seguinte responde um item só.
    expect(result.map((e) => e.id)).toEqual(['ferias', 'vale'])
  })

  it('devolve a base inteira mesmo quando nada casaria com a mensagem', () => {
    // "oi" não gera token nenhum — pelo ranking seria uma lista vazia, e o
    // prompt diria ao modelo que não há base para responder.
    expect(selectKnowledgeContext([FERIAS, VALE], 'oi')).toEqual([FERIAS, VALE])
  })

  it('volta a recortar pelo ranking quando a base estoura o teto', () => {
    const longa = entrada({
      id: 'longa',
      question: 'Manual interno',
      answer: 'x'.repeat(200),
      keywords: ['manual'],
    })
    const result = selectKnowledgeContext([FERIAS, VALE, longa], 'quantos dias de férias?', 12, 100)
    expect(result.map((e) => e.id)).toEqual(['ferias'])
  })
})
