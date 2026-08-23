# Editor administrativo de mapas do escritório

**Data:** 2026-07-15  
**Status:** implementado

## Objetivo

Substituir a planta fixa do escritório por snapshots versionados e oferecer ao
administrador um editor visual completo, sem introduzir multi-tenancy. A aba
`Mapas` fica separada das configurações de alto-falante da aba `Escritório`.

## Documento e limites

`@legends/shared` é a fonte do contrato `MapDocumentV1`, dos schemas Zod e dos
helpers de colisão, spawn, zona, sala e pathfinding. O mapa aceita dimensões de
10–200 células e tiles de 16/32/48/64 px. As layers canônicas cobrem piso,
paredes, objetos, colisões, spawns, zonas privadas, salas e interações.

Os limites são 50 layers, 20 tilesets, 2.000 objetos, 64 vértices, documento e
asset de 10 MB e 100 MB de assets por mapa. A validação estrutural e semântica
verifica chaves, referências, geometria, spawn padrão, salas e portas.

## Persistência e concorrência

- `OfficeMapDraft` usa revisão otimista.
- `OfficeMapEditLock` é exclusivo por mapa, dura 2 minutos e recebe heartbeat.
- `OfficeMapPublication` guarda um snapshot imutável e vínculos dos assets.
- `OfficeSetting.activeMapPublicationId` garante uma publicação ativa global.
- Publicar materializa `OfficeRoom` numa transação e preserva configuração e
  concessões de acesso por `externalKey`.
- Mapas ativos e assets referenciados por publicação são protegidos de exclusão.

A migration cria uma publicação inicial da planta antiga e usa o tileset
empacotado `/office/legacy-office-tileset.svg`, mantendo o escritório disponível
sem S3. Novos PNG/WebP são validados e deduplicados por SHA-256 antes do upload.

## API e runtime

Rotas `/admin/office-maps`, draft, lock, assets, validação, publicações e salas
exigem autenticação e administrador. `GET /office/map` entrega o snapshot ativo
ao usuário autenticado. Erros de lock, revisão, validação, tamanho e proteção de
recursos usam respectivamente 423, 409, 422, 413 e 409.

O cliente carrega o snapshot antes do Phaser/WebSocket. O servidor valida cada
movimento pelo documento ativo e aplica status, allowlist e capacidade das
salas. Nomes LiveKit incluem a publicação; troca de versão emite `map-changed`,
faz o cliente recarregar e reposiciona a presença em um spawn válido.

## Editor

A rota full-screen `/admin/mapas/:mapId/editar` oferece pincel, borracha,
preenchimento, conta-gotas, seleção, mão, colisão, spawn, zona, sala, porta,
link, action point e objetos. Inclui gerenciamento de layers/tilesets, edição de
geometria, preview, undo/redo (100), autosave, import/export JSON, atalhos, zoom,
estado de lock/revisão e painel de erros. Abaixo de 1024 px abre somente leitura.

## Fora de escopo

CRDT/edição colaborativa, Tiled, geração procedural, marketplace e integrações
de negócio adicionais para portas, links e pontos de ação.
