# Resenha — Enquetes Implementation Plan

**Goal:** Permitir criar e votar em enquetes na Resenha, ocultando o resultado
até o voto do usuário.

**Architecture:** Contrato em `@legends/shared`; três models Prisma escopados por
tenant; regras em `review-service`; rota fina em `review.ts`; serialização decide
se as contagens podem ser expostas; React Query coordena criação/voto e os
componentes existentes recebem a nova opção de anexo e o card da enquete.

- [x] Adicionar tipos, constantes e validações compartilhadas da enquete.
- [x] Adicionar `ReviewPoll`, `ReviewPollOption` e `ReviewPollVote`, relações,
      tenant scope, truncamento de testes e migration nova.
- [x] Estender `createReview`, includes e `toReviewDTO` com enquete.
- [x] Implementar `voteReviewPoll` e `POST /reviews/:id/poll/vote`, incluindo
      isolamento, conflito de segundo voto e broadcast em tempo real.
- [x] Adicionar testes de service/route/serializer.
- [x] Estender `ReviewComposer`, `ResenhaFeed` e hook de criação com o payload.
- [x] Criar `ReviewPoll` visual no card e mutation de voto.
- [x] Adicionar testes do compositor/card e executar testes focados.
- [x] Executar build e suíte completa antes da entrega.
- [x] Expor lista nominal de votantes somente após o voto e adicionar **Ver votos**.
