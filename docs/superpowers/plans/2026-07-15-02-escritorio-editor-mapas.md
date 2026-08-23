# Plano de execução — editor administrativo de mapas

**Data:** 2026-07-15  
**Spec:** `docs/superpowers/specs/2026-07-15-escritorio-editor-mapas-design.md`

## Entregas

1. Adicionar `MapDocumentV1`, schemas, DTOs, validação e helpers de runtime em
   `@legends/shared`, com testes de contrato e geometria.
2. Criar models Prisma, migration e snapshot inicial convertido da planta
   legada com tileset local.
3. Implementar service/rotas Fastify para CRUD, locks, drafts, assets S3,
   validação, publicação, ativação, salas e mapa ativo.
4. Portar o editor React + Phaser e criar a aba administrativa `Mapas` e a rota
   full-screen protegida.
5. Fazer Phaser, WebSocket, pathfinding e LiveKit consumirem o snapshot ativo e
   reagirem a `map-changed`.
6. Cobrir fluxos críticos, rodar testes dos workspaces, migration e build.

## Aceite

- Criar mapa, adquirir lock, editar e salvar com revisão otimista.
- Validar, publicar e ativar uma versão; impedir exclusão do mapa ativo.
- Configurar salas e aplicar status, capacidade, voz e allowlist no servidor.
- Renderizar a publicação no escritório e usar colisões/spawns/pathfinding do
  documento, sem depender das constantes antigas.
- Upload PNG/WebP usa S3 quando configurado e retorna 503 controlado quando não.
- Testes e builds de shared, API e web concluem sem erro.
