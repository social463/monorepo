-- Novo valor do agente de IA da assistente de RH (conversa multi-turno, ver
-- agent-service.ts). Aditivo: só estende o enum existente.
ALTER TYPE "AgentKind" ADD VALUE 'ASSISTANT';
