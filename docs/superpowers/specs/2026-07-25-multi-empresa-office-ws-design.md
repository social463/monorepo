# Multi-tenancy no Escritório — sub-fatia 3: officeHub/office-ws.ts — Design

## Contexto

Última sub-fatia do domínio Escritório na linha de trabalho de multi-tenancy. As sub-fatias 1
(dados + services) e 2 (rotas HTTP) já foram commitadas e mergeadas em
`feat/multi-empresa-auth-jwt-clean` (PR #10609), deixando `apps/api/src/routes/office-ws.ts` e
`apps/api/src/lib/office-hub.ts` deliberadamente intocados/quebrados — handoff documentado desde
a spec da sub-fatia 1.

`officeHub` é um simulador de presença 100% em memória, singleton por processo (`entries`: quem
está conectado; `runtime`: mapa/salas/mesas ativos; mais 17 outras estruturas de estado —
rate-limits, cooldowns, filas de mão levantada/knock, salas trancadas). Ao contrário do
`reviewHub` (que só sinaliza refetch, sem conteúdo), o `officeHub` carrega dado real em cada
broadcast — nome, posição, texto de chat/fala, anotação de tela, mesa ocupada. Hoje, se duas
empresas compartilhassem o mesmo processo, usuários de empresas diferentes se veriam uns aos
outros.

`office-ws.ts` já está com erro de compilação (a assinatura de `getActiveOfficeMap` mudou na
sub-fatia 1; nada em `office-ws.ts` foi ajustado) — isso é esperado, não uma regressão desta
fatia.

## Escopo

- `apps/api/src/lib/office-hub.ts` — adiciona um registry por empresa; a classe `OfficeHub` em
  si não muda internamente.
- `apps/api/src/routes/office-ws.ts` — resolve `companyId` na `preValidation` (do JWT real ou do
  payload de convidado) e usa a instância certa do hub em vez do singleton.
- `apps/api/src/routes/office-maps.ts`, `office-media.ts`, `auth.ts`,
  `apps/api/src/services/office-map-service.ts` — os ~9 call-sites que hoje chamam `officeHub.*`
  diretamente passam a resolver a instância via `companyId` (já disponível em todos eles desde
  as sub-fatias 1/2).

## Arquitetura

### Registry: 1 instância de `OfficeHub` por empresa

Um novo `getOfficeHub(companyId: string): OfficeHub`, apoiado num `Map<string, OfficeHub>` em
memória, cria a instância sob demanda na primeira chamada pra aquela empresa e reusa depois.
Sem limpeza/GC — empresas são um conjunto pequeno e controlado por admin, não input de usuário;
crescer sem limpar é seguro e mais simples que gerenciar ciclo de vida agora (YAGNI).

A classe `OfficeHub` **não muda internamente**. Todos os métodos (`broadcast`, `broadcastToRoom`,
`evaluateHighFive`, `pickSpawn`, `unlockIfRoomEmpty`, `roomEntryDenial`, etc.) já só tocam
`this.entries`/`this.runtime`/os outros campos privados da própria instância — nunca um estado
externo compartilhado. Os testes existentes (`office-hub.test.ts`, `office-hub-map.test.ts`) já
fazem `new OfficeHub()` livremente, provando que a classe já funciona bem como múltiplas
instâncias independentes. Isso resolve de graça o risco de colisão de `roomId` entre empresas
(`raisedHandsByRoom`/`lockedRooms`/`roomEntryGrants`/`pendingKnocks`) identificado na pesquisa —
cada hub só vê `roomId`s do próprio `runtime`.

### `office-ws.ts`

A `preValidation` já resolve identidade (usuário real vs. convidado). Passa a extrair
`companyId` também: do JWT real (`request.user.companyId`, já existe no augment de tipo do
Fastify) ou do payload de convidado (`payload.companyId`, já é `string` real desde a sub-fatia
2 — não mais `''`). O tipo local do payload verificado ganha o campo `companyId`. O handler da
conexão resolve `const hub = getOfficeHub(companyId)` uma vez por conexão, e as ~17 chamadas
`officeHub.<method>(...)` no bloco de despacho de mensagens trocam por `hub.<method>(...)` —
mecânico, nenhuma lógica de validação/despacho muda.

### Os 4 consumidores externos

`office-maps.ts` (claim/release de mesa), `office-media.ts` (resolução de sala/permissão de
mídia), `auth.ts` (`updateAvatar` ao trocar avatar), `office-map-service.ts` (`configure`/
`broadcastMapDecorUpdated` ao publicar/ativar mapa) — todos já têm `companyId` disponível no
escopo de cada call-site (herdado da rota ou do parâmetro da função de serviço). Cada um troca
`officeHub.<method>` por `getOfficeHub(companyId).<method>`.

## Testes

- `office-hub.test.ts`/`office-hub-map.test.ts` — intocados (testam a classe isolada).
- Novo teste do registry: `getOfficeHub` devolve a mesma instância pra chamadas repetidas com o
  mesmo `companyId`, e instâncias diferentes pra `companyId`s diferentes.
- Pelo menos 1 teste WS-level adversarial em `office-ws.test.ts`: dois usuários de empresas
  diferentes conectados simultaneamente (sockets reais via `ws`), um não recebe presença/
  broadcast/chat do outro.
- `office-ws.test.ts` também corrige a fixture de `OfficeSetting` (ainda usa a forma antiga
  `{ id: 1, ... }`, quebrada desde a migration da sub-fatia 1 — mesmo padrão já corrigido em
  `office-guests.test.ts`/`office-feature-gate.test.ts` na sub-fatia 2).

## Fora de escopo

Limpeza/expiração de instâncias de hub ociosas (empresa sem ninguém conectado há muito tempo) —
YAGNI, decisão registrada acima. Qualquer mudança de comportamento visível pro usuário — zero,
já que só existe uma empresa hoje.
