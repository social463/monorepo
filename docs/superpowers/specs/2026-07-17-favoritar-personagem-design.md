# Design — Favoritar personagem criado

**Data:** 2026-07-17
**Task:** 21871
**PRD:** `docs/superpowers/specs/2026-07-17-favoritar-personagem-prd.md`
**Branch:** `task/21871-favoritar-personagem`
**Status:** Implemented

## Resumo

Adicionar slots de personagem como entidade propria vinculada ao `User`, com
indices fixos de 1 a 5. A tela `/personagem` passa a mostrar sempre os 5 slots,
permitir salvar o visual em edicao em um slot vazio, substituir um slot ocupado
direto, usar um slot como visual atual e limpar slots existentes.

## Referencias Visuais

- Habbo Club Wardrobe: fluxo de montar o personagem e salvar o outfit em slots
  de guarda-roupa. A referencia oficial antiga menciona vestir o Habbo, clicar
  na acao de salvar e guardar em um dos slots disponiveis.
- Habbolytics/HabboFurni: referencias secundarias de guarda-roupa com preview
  do avatar, busca/mix de pecas e visual outfit-first.

Adaptacao para Legends: em vez de uma lista dinamica de favoritos, usar uma
faixa "Meus visuais" com 5 cards/slots numerados. Slot vazio mostra placeholder
e CTA "Salvar aqui"; slot preenchido mostra preview LPC e acoes "Usar",
"Substituir" e "Limpar".

Decisoes fechadas com o usuario:

- Slot nao tem nome editavel; o card mostra apenas numero/posicao, preview e
  acoes.
- Clicar em "Usar" em um slot preenchido carrega o visual no editor, sem salvar
  automaticamente e sem sair de `/personagem`.
- Clicar em "Substituir" em um slot preenchido sobrescreve o slot direto.

## Fatos Verificados do Codigo

- O personagem atual e salvo em `User.avatarStyle`, `User.avatarSeed` e
  `User.avatarOptions` (`apps/api/prisma/schema.prisma`).
- A tela `/personagem` esta em
  `apps/web/src/pages/CharacterEditorPage.tsx`.
- O save atual usa `PATCH /auth/me` com `{ avatarStyle: 'lpc', avatarSeed,
  avatarOptions }`.
- `CharacterOptions` v2, `characterSignature`, validacao e sanitizacao vivem em
  `packages/shared/src/character.ts`.
- A API segue fluxo `route -> service/Prisma` quando ha regra de negocio, e
  validacao de entrada com Zod nas rotas.
- O preview reutilizavel do personagem esta em
  `apps/web/src/components/CharacterPreview.tsx` e componentes da tela estao em
  `apps/web/src/components/character-editor/`.

## Arquitetura

### Modelo de dados

Criar model Prisma:

```prisma
model CharacterFavorite {
  id        String   @id @default(cuid())
  userId    String
  slot      Int
  seed      String
  options   Json
  signature String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, slot])
  @@index([userId])
}
```

Adicionar em `User`:

```prisma
characterFavorites CharacterFavorite[]
```

**Racional:** slot salvo e diferente do visual atual. Guardar `slot` permite
mostrar sempre as posicoes 1-5, inclusive vazias. Guardar `signature` continua
util para identificar se o visual em edicao bate com algum slot, mas nao deve
bloquear duplicatas: o usuario pode substituir slots deliberadamente.

### Contrato compartilhado

Criar `packages/shared/src/character-favorite.ts` e exportar no barril:

```ts
import type { CharacterOptions } from './character'

export const MAX_CHARACTER_FAVORITES = 5
export const CHARACTER_FAVORITE_SLOTS = [1, 2, 3, 4, 5] as const
export type CharacterFavoriteSlot = (typeof CHARACTER_FAVORITE_SLOTS)[number]

export interface CharacterFavoriteDTO {
  id: string
  slot: CharacterFavoriteSlot
  seed: string
  options: CharacterOptions
  signature: string
  createdAt: string
  updatedAt: string
}
```

### API

Nova route protegida `apps/api/src/routes/character-favorites.ts`, registrada em
`buildApp`.

Endpoints:

| Metodo | Rota | Comportamento |
| --- | --- | --- |
| `GET` | `/character-favorites` | Lista slots preenchidos do usuario autenticado. |
| `PUT` | `/character-favorites/:slot` | Cria/substitui slot `1..5` com `{ seed?, options }`, valida `CharacterOptions`. |
| `DELETE` | `/character-favorites/:slot` | Limpa slot `1..5` do usuario autenticado. |

Service `apps/api/src/services/character-favorite-service.ts`:

- `listCharacterFavorites(userId)`.
- `upsertCharacterFavoriteSlot(userId, slot, input)`.
- `deleteCharacterFavoriteSlot(userId, slot)`.
- Erros de dominio tipados com `status`:
  - `InvalidFavoriteSlotError` -> 400.
  - `FavoriteNotFoundError` -> 404 no DELETE de slot vazio, se preferirmos
    DELETE estrito; alternativa aceita: DELETE idempotente retorna 204 mesmo
    quando vazio.

Serializacao em `apps/api/src/lib/serialize.ts`:

- `toCharacterFavoriteDTO(favorite)` sanitiza/migra `options` com a mesma cadeia
  usada para `avatarOptions`.

### Frontend

Cliente HTTP em `apps/web/src/lib/api.ts` via helpers locais na pagina ou novo
arquivo `apps/web/src/lib/characterFavorites.ts`:

- `listCharacterFavorites()`.
- `saveCharacterFavoriteSlot(slot, { seed, options })`.
- `deleteCharacterFavoriteSlot(slot)`.

Componentes:

| Componente | Local | Responsabilidade |
| --- | --- | --- |
| `CharacterSlotsPanel` | `apps/web/src/components/character-editor/CharacterSlotsPanel.tsx` | Renderiza os 5 slots, salvar atual, usar, substituir e limpar. |
| `CharacterSlotCard` | Mesmo arquivo ou componente pequeno separado | Preview/placeholder do slot e acoes contextuais. |
| `CharacterEditorPage` | `apps/web/src/pages/CharacterEditorPage.tsx` | Busca slots preenchidos, monta view model dos 5 slots e passa callbacks ao painel. |

Fluxo na tela:

1. Ao abrir `/personagem`, React Query carrega `GET /character-favorites`.
2. A coluna de preview recebe uma secao "Meus visuais" abaixo de "Aleatorio" ou
   proxima aos controles principais.
3. A pagina monta 5 slots fixos; slots sem registro aparecem vazios.
4. "Salvar aqui" em slot vazio chama `PUT /character-favorites/:slot`.
5. "Substituir" em slot ocupado chama o mesmo PUT.
6. "Usar" em slot ocupado chama `setOptions(favorite.options)`, marca dirty pelo
   mecanismo atual e mantem o usuario em `/personagem`.
7. "Limpar" pede confirmacao simples, chama DELETE e invalida a query.

### UX e Mensagens

- Slot vazio: "Slot vazio"
- Erro generico: "Nao foi possivel atualizar seus favoritos."
- Estado vazio geral: os 5 slots aparecem vazios, sem mensagem global bloqueante.

## Testes

### Shared

- `MAX_CHARACTER_FAVORITES` exportado.
- DTO exportado no barril.

### API

- `PUT /character-favorites/1` cria slot valido.
- `PUT /character-favorites/1` substitui slot existente.
- `PUT /character-favorites/6` rejeita slot invalido com 400.
- `PUT /character-favorites/1` rejeita payload invalido com 400.
- `GET /character-favorites` lista somente slots preenchidos do usuario autenticado.
- `DELETE /character-favorites/1` limpa somente slot proprio.

### Web

- `CharacterEditorPage` carrega slots preenchidos e renderiza 5 cards.
- Slot vazio chama PUT sem confirmacao.
- Slot preenchido chama PUT ao substituir.
- Usar slot atualiza `options` do editor sem chamar `PATCH /auth/me`.
- Depois de usar slot, o botão "Salvar" chama `PATCH /auth/me` e navega ao perfil.
- Limpar slot chama DELETE e volta o card ao estado vazio.

## Riscos e Mitigacoes

| Risco | Mitigacao |
| --- | --- |
| `Json` com `options` invalido persistido por bug futuro | Sanitizar no service e no serializer, como `avatarOptions`. |
| Slot fora de 1-5 | Validar parametro com Zod/refinement e constante compartilhada. |
| Substituicao acidental | A acao fica isolada no card do slot e usa texto claro "Substituir". |
| UI ficar carregada na tela mobile | Renderizar favoritos como carrossel horizontal compacto no mobile. |

## Plano de Implementacao

1. Atualizar contrato compartilhado e schema Prisma com `CharacterFavorite.slot`.
2. Criar migration e gerar Prisma Client.
3. Implementar service, route e serializer da API.
4. Adicionar testes de API para slot 1-5, substituicao e ownership.
5. Implementar cliente web e painel de slots em `/personagem`.
6. Adicionar testes web do painel e integracao na pagina.
7. Rodar `pnpm test` com Postgres ativo.

## Duvidas para Fechamento

Nenhuma no momento.
