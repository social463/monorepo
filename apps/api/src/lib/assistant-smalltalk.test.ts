import { describe, it, expect } from 'vitest'
import { classifySmallTalk, smallTalkReply } from './assistant-smalltalk'

describe('classifySmallTalk', () => {
  it('reconhece cumprimento em várias formas', () => {
    for (const mensagem of ['oi', 'Oi!', 'olá', 'ola emily', 'bom dia', 'Boa tarde!', 'e aí', 'oiii']) {
      expect(classifySmallTalk(mensagem), mensagem).toBe('greeting')
    }
  })

  it('reconhece agradecimento, despedida, "ok" e "não ajudou"', () => {
    expect(classifySmallTalk('obrigada')).toBe('thanks')
    expect(classifySmallTalk('muito obrigado!')).toBe('thanks')
    expect(classifySmallTalk('valeu')).toBe('thanks')
    expect(classifySmallTalk('tchau')).toBe('farewell')
    expect(classifySmallTalk('até mais')).toBe('farewell')
    expect(classifySmallTalk('ok')).toBe('acknowledgement')
    expect(classifySmallTalk('entendi, obrigado')).toBe('thanks')
    expect(classifySmallTalk('não ajudou')).toBe('negative')
  })

  it('"tudo bem?" é pergunta social, não consulta à base', () => {
    expect(classifySmallTalk('tudo bem?')).toBe('wellbeing')
    expect(classifySmallTalk('oi, tudo bem?')).toBe('wellbeing')
  })

  it('despedida vence agradecimento quando vêm juntos', () => {
    expect(classifySmallTalk('valeu, tchau')).toBe('farewell')
  })

  it('NÃO engole a dúvida real que vem junto com o cumprimento', () => {
    expect(classifySmallTalk('oi, quantos dias de férias?')).toBeNull()
    expect(classifySmallTalk('bom dia, como faço para bater o ponto?')).toBeNull()
    expect(classifySmallTalk('obrigado, mas e o vale alimentação?')).toBeNull()
  })

  it('pergunta comum não é conversa', () => {
    expect(classifySmallTalk('quantos dias de férias eu tenho?')).toBeNull()
    expect(classifySmallTalk('plano de saúde')).toBeNull()
    expect(classifySmallTalk('')).toBeNull()
  })

  it('mensagem longa nunca é conversa, mesmo começando com saudação', () => {
    const desabafo = 'bom dia, estou com uma dúvida grande sobre o meu plano de saúde e os dependentes'
    expect(classifySmallTalk(desabafo)).toBeNull()
  })

  it('toda resposta é texto pronto e não vazio', () => {
    for (const kind of ['greeting', 'wellbeing', 'thanks', 'farewell', 'acknowledgement', 'negative'] as const) {
      expect(smallTalkReply(kind).length).toBeGreaterThan(10)
      expect(smallTalkReply(kind)).not.toContain('*')
    }
  })
})
