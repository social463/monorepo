import { AgentChat } from '../../components/AgentChat'

const WELCOME = `Sou o assistente de gestão da trilha **Eu Aprendiz**. Enxergo os seis encontros, a presença
lançada, as fichas entregues e o resultado da pesquisa de satisfação — e cruzo isso para responder.

Boas perguntas para começar:

- Quem está para trás nas entregas e o que falta exatamente?
- O que os aprendizes dizem levar dos encontros até aqui?
- Como eu melhoro o próximo encontro com base na pesquisa?`

/**
 * Assistente de insights da trilha.
 *
 * Usa o provedor e a chave que a EMPRESA cadastra em Administração ›
 * Inteligência Artificial, como o Benchmarking — não há chave de ambiente. Sem
 * credencial, a resposta é um 503 com mensagem tratada.
 *
 * O protótipo deixava a facilitadora subir os documentos oficiais da trilha para
 * a IA cruzar. Aqui isso não é mais preciso: a trilha VIROU dado estruturado
 * (encontros, objetivos, entregáveis, fichas, presença, pesquisa), e é isso que
 * vai no contexto — melhor do que um PPTX de onde a IA teria de adivinhar o
 * mesmo.
 */
export function AssistantTab() {
  return (
    <AgentChat
      agent="apprentice"
      title="Assistente da trilha"
      welcome={WELCOME}
      placeholder="Ex.: quem está pendente no Encontro 2 e o que falta?"
      pendingLabel="Analisando a trilha…"
      footnote="O assistente lê os encontros, a presença, as entregas e a pesquisa. O conteúdo das fichas é privado e não entra."
    />
  )
}
