-- O assistente de insights da trilha entra como mais um AgentKind, reusando
-- `AgentConversation`/`AgentMessage` e a rota genérica `/admin/agents/:agent/ask`.
-- Não há tabela nova: o que muda de um agente para o outro é o system prompt e a
-- fonte de contexto, não o armazenamento.

-- AlterEnum
ALTER TYPE "AgentKind" ADD VALUE 'APPRENTICE';

