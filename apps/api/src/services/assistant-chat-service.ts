import { ASSISTANT_NOT_FOUND_MESSAGE } from '@legends/shared'
import { isAgentNotConfigured } from '../lib/agent-error'
import { classifySmallTalk, smallTalkReply } from '../lib/assistant-smalltalk'
import { askAgent, appendAgentTurn, type ConversationWithMessages } from './agent-service'
import { findMatchedEntries, logAssistantChatTurn, type AssistantActor } from './assistant-service'

export interface AskAssistantChatInput {
  actor: AssistantActor
  conversationId?: string
  message: string
}

export interface AskAssistantChatResult {
  conversation: ConversationWithMessages
  /** Id do `AssistantQuery` do turno — é por ele que o polegar é registrado. */
  queryId: string
}

/**
 * Um turno do chat da assistente. Mora aqui, e não em `agent-service.ts`, porque
 * é o único agente com **duas** formas de responder, e porque combinar as duas
 * exige importar `assistant-service` e `agent-service` juntos — o que criaria
 * ciclo se ficasse em qualquer um dos dois.
 *
 * Com credencial de IA da empresa, é o agente `assistant` que responde, com
 * histórico e persona. **Sem credencial, a assistente continua respondendo**: a
 * base de conhecimento é a fonte da Emily, e a IA é o que redige melhor em cima
 * dela — não é o que a faz existir. Empresa sem chave tem uma assistente que
 * responde a entrada da base, exatamente como a pergunta única de
 * `/assistant/ask`, em vez de uma tela de erro.
 *
 * Só a **ausência** de credencial degrada. Chave recusada (502) ou limite do
 * provedor (429) sobem para o usuário: são falhas acionáveis, e escondê-las
 * atrás de uma resposta da base faria a empresa nunca descobrir que a IA que ela
 * paga parou de funcionar.
 */
export async function askAssistantChat(input: AskAssistantChatInput): Promise<AskAssistantChatResult> {
  const { actor, conversationId, message } = input
  const agentActor = { id: actor.id, companyId: actor.companyId, sectorId: actor.sectorId }

  try {
    const conversation = await askAgent({ actor: agentActor, agent: 'assistant', conversationId, message })
    const answer = [...conversation.messages].reverse().find((m) => m.role === 'ASSISTANT')?.content ?? ''
    const queryId = await logAssistantChatTurn(actor, message, answer)
    return { conversation, queryId }
  } catch (err) {
    if (!isAgentNotConfigured(err)) throw err

    // Sem IA nenhuma no caminho: a melhor entrada da base é a resposta, como no
    // fallback de `askAssistant`. Nada de cair na `GEMINI_API_KEY` do ambiente —
    // ela é do card do Destaque do Mês, e um tenant sem chave própria gastando a
    // cota de outro é justamente o que o 503 existe para evitar.
    //
    // Cumprimento, agradecimento e despedida não são consulta à base: sem este
    // desvio, "oi" não casa com entrada nenhuma e a pessoa recebe "não
    // encontrei essa informação" como boas-vindas. Com chave da empresa quem
    // resolve isso é o próprio modelo (ver `assistant-prompt.ts`); aqui não há
    // modelo nenhum, então a resposta é texto pronto.
    const smallTalk = classifySmallTalk(message)
    const matched = smallTalk
      ? []
      : await findMatchedEntries({ companyId: actor.companyId, sectorId: actor.sectorId }, message)
    const answer = smallTalk ? smallTalkReply(smallTalk) : matched[0]?.answer ?? ASSISTANT_NOT_FOUND_MESSAGE
    const conversation = await appendAgentTurn({
      actor: agentActor,
      agent: 'assistant',
      conversationId,
      message,
      reply: answer,
    })
    const queryId = await logAssistantChatTurn(actor, message, answer, matched)
    return { conversation, queryId }
  }
}
