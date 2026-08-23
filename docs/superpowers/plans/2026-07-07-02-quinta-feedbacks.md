# Plano — Feedbacks em temas da Quinta de Desenvolvimento

## Objetivo

Permitir que usuários registrem feedbacks no card de um tema já apresentado, sem
criar uma segunda fonte de verdade para feedbacks ou selos.

## Implementação

- Adicionar vínculo opcional `Feedback.developmentThursdayEventId`.
- Criar endpoints para listar e criar feedbacks de um evento.
- Reusar `createFeedback`, `toFeedbackDTO`, notificações e sincronização de selos.
- Bloquear criação antes da finalização da apresentação.
- Bloquear exclusão de tema com feedbacks registrados.
- Exibir feedbacks e formulário no modal de detalhes do tema no frontend.

## Verificação

- Testes de rota para criação, bloqueio antes da finalização e contagem de selos.
- Build/testes focados da API e build do frontend.
