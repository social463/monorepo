# Feedbacks em temas da Quinta de Desenvolvimento — Design

**Data:** 2026-07-07
**Status:** Implementado

## Contexto

Depois que uma apresentação da Quinta de Desenvolvimento acontece, os demais
colaboradores precisam registrar feedbacks no próprio card do tema. O objetivo é
reforçar que a apresentação ocorreu, incentivar participação e manter a cultura de
feedback.

## Decisões

- O feedback do card é um `Feedback` real, não uma nova tabela de comentários.
- `Feedback` ganha `developmentThursdayEventId` opcional apontando para
  `DevelopmentThursdayEvent`.
- O destinatário é sempre o apresentador do tema; o autor é quem comentou no card.
- Como é o mesmo model de feedback, ele aparece no perfil do apresentador e conta
  automaticamente na contagem de selos `FEEDBACK` do autor.
- A criação pelo card aceita apenas categorias públicas (`POSITIVO`, `ELOGIO`),
  porque o conteúdo fica visível no card do tema.
- Criar feedback no card só é permitido após a apresentação:
  - após a data do evento; ou
  - no mesmo dia, depois do `endTime`, quando houver horário de fim.
- Excluir um tema com feedbacks vinculados é bloqueado para preservar histórico.

## API

- `GET /development-thursday/events/:id/feedbacks`
- `POST /development-thursday/events/:id/feedbacks`

## Fora de escopo

- Estado manual de conclusão do tema.
- Feedback anônimo.
- Métricas específicas de presença/participação além do registro de feedback.
