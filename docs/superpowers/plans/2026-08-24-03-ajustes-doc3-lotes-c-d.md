# Plan — Ajustes do Documento 3, Lotes C e D

Spec: `docs/superpowers/specs/2026-08-24-ajustes-doc3-lotes-c-d-design.md`

O passo 1 é independente. O passo 2 (tags) é pré-requisito do passo 3 (painel),
por causa do filtro de categoria de comunicado.

## 1. Lote C — editar regra de Coins e de Pontos (seção 5)

- [x] `CoinsSection`: botão **Editar** por regra, abrindo a linha num formulário
      com valor e teto (janela + quantidade). Usa o `PATCH` que já existe.
- [x] `XpSection`: o mesmo.
- [x] `RuleValueFields` extraído: as duas telas eram gêmeas linha a linha, e
      duplicar o formulário uma terceira e quarta vez para a edição era garantir
      que uma delas ficasse para trás na próxima mudança.
- [x] Testes: editar muda valor e teto pelo PATCH; o evento não é editável;
      cancelar não grava.

## 2. Lote D, parte 1 — tags do Feed (seção 13)

- [x] Migration: model `CorporatePostTag` (name, slug, color, active, companyId,
      `@@unique([companyId, slug])`) e `CorporatePost.tagId String?`.
- [x] `@legends/shared`: `CorporatePostTagDTO`; `tag` no `CorporatePostDTO`;
      catálogo inicial de seis tags.
- [x] Service + rotas: CRUD do catálogo (bloco de G&G), `tagId` no
      criar/editar post, `?tagId=` no feed — filtro **do servidor**.
- [x] `provisionCorporatePostTags` no onboarding de empresa, como as categorias.
- [x] **`CorporatePostTag` registrado em `TENANT_SCOPED_MODELS`.** Sem isso o
      catálogo de uma empresa aparecia para a outra — pego no smoke test, não em
      teste: as duas empresas de dev devolviam 12 tags no lugar de 6.
- [x] `corporatePostTag.deleteMany()` no `test/setup.ts`, depois do post: sem
      isso o catálogo vazava entre testes.
- [x] Web: seletor de tag no editor, filtro em pílulas no topo do Feed, tela de
      administração do catálogo.
- [x] Testes: filtrar por tag recorta o feed; tag desativada some do seletor mas
      não some dos posts que já a usam.

## 3. Lote D, parte 2 — painel de Comunicação Interna (seção 4.8)

- [x] `GET /admin/communication/overview?range=&from=&to=&sectorId=&tagId=`.
- [x] Service `communication-analytics-service.ts`:
      - KPIs: taxa média de leitura, engajamento total, comunicado mais lido,
        **Pontos** distribuídos por interação no mural (não Coins — ver spec);
      - séries de leituras e interações por dia;
      - alcance por setor;
      - distribuição de reações (top 6 + "outras");
      - Top 5 comunicados por engajamento;
      - melhor horário de envio (mínimo de 3 comunicados na combinação);
      - setores sem interação há mais de 15 dias.
- [x] Web: `CommunicationTab` dentro da aba Engajamento, **substituindo** o bloco
      "Alcance do Feed Corporativo".
- [x] Gráfico de rosca novo em `AnalyticsPrimitives`.
- [x] Testes: taxa de leitura usa o público-alvo do post como denominador;
      "melhor horário" cala com base insuficiente; alerta de 15 dias.

## 4. Fechamento

- [x] `pnpm test` com o Postgres de pé (`LEGENDS_DB_PORT=5442 pnpm db:up`).
      Shared 526/526, web 2526/2527 (a falha é o flake de relógio conhecido do
      `RoomAudioPlayer`, que passa isolado) e **api 2922/2922**, com
      `TEAMS_NOTIFICATIONS_ENABLED=true` e o `legends_test` recriado — rodar
      suites em paralelo corrompe o banco de teste e derruba tudo em massa.
- [x] Conferido no app rodando: o painel devolve taxa de leitura, alcance por
      setor, rosca de reações e o alerta de baixo alcance sobre os dados de dev;
      "melhor horário" cala com um comunicado só, como projetado. O filtro por
      tag recorta o feed (1 com a tag, 0 com outra).

## 5. Achados fora do plano

- **Guarda frágil no Feed.** `tags.data?.tags.length` estoura quando a resposta
  vem sem `tags` — a corrente opcional parava em `data`. Corrigido para
  `?.tags?.length`; o teste do feed pegou.
- **Regra do design system quebrada.** `disabled:opacity-50` no botão preenchido
  do catálogo de tags — `brand-pairs.test.ts` trava isso: desabilitado é par de
  cores, não opacidade. Trocado por
  `disabled:bg-surface-container disabled:text-on-surface-variant`.
- **Alcance por setor contava leituras, não pessoas.** A seção pede "percentual
  de colaboradores de cada área que abriram e leram" — contar leituras faria um
  setor de duas pessoas muito engajadas passar de 100%.
