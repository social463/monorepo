# Escritório — salvar decoração in-place

**Data:** 2026-07-30
**Status:** aprovado
**Branch:** `feat/22041-decoracao-in-place`
**Card:** [22041](https://dev.azure.com/EuMedicoResidente/Legends/_workitems/edit/22041)

## Problema

Toda ação de **Salvar** no editor de decoração cria uma linha nova em
`OfficeMapPublication`. O caminho é `POST /office/map/edit/merge-publish` →
`mergeAndPublishDecoration` → `materializePublication`. Como esse Salvar é do
usuário comum e o fluxo colaborativo não tem rascunho compartilhado, o histórico
de um mapa chegou a 198 versões.

Cada versão custa mais do que uma linha: copia o `mapData` inteiro e recria
todas as linhas de `OfficeRoom` e `OfficeDesk` daquela publicação. Recriar as
mesas obriga a apagar e recriar o `OfficeDeskClaim` de todo mundo — a cada
Salvar de qualquer pessoa.

## Decisão

Publicação volta a ser **snapshot estrutural**, criado só pelo publish de admin.
O Salvar de decoração muta **in-place** o `mapData` da publicação ativa.

Versão, porém, não é só histórico: `mergeAndPublishDecoration` usa a publicação
de número `baseVersion` como **base do merge de 3 vias**. Mutar in-place destrói
essa base, então ela ganha casa própria: um **anel de 10 revisões** numa tabela
leve, que serve ao mesmo tempo de base de merge e de histórico de decoração.

## Modelo

`OfficeMapPublication` ganha `decorRevision Int @default(0)` — contador de saves
de decoração aplicados àquela publicação. `version` continua identificando a
publicação e só é incrementado por publish estrutural.

Nova model:

```prisma
model OfficeMapDecorRevision {
  id            String   @id @default(cuid())
  publicationId String
  revision      Int
  mapData       Json
  createdById   String?
  createdAt     DateTime @default(now())
  companyId     String   @default("company-emr")

  @@unique([publicationId, revision])
}
```

Uma linha guarda o documento que **esteve ativo enquanto** a publicação tinha
aquele `decorRevision`. É empurrada no momento em que o save a substitui.

## Fluxo do save de decoração

1. Lê a publicação ativa (`mapData`, `decorRevision`) dentro da transação.
2. `theirs` = `mapData` atual.
3. `base` = `theirs` quando `baseRevision === decorRevision` (ninguém salvou no
   meio); senão, o `mapData` da linha do anel com aquele `revision`; se o anel
   já descartou (editor mais de 10 saves atrás), cai em `theirs` — mesmo
   fallback do código atual quando a publicação-base não existe.
4. `assertOnlyDecorationChanged(base, mine)` como hoje. A base continua vindo do
   servidor, então não há regressão de segurança: um cliente não escolhe a base
   contra a qual é julgado.
5. `mergeDecoration(base, mine, theirs)` e validação, como hoje.
6. Empurra `theirs` no anel como `revision = decorRevision` e poda o que ficar
   além de 10.
7. Grava in-place com guarda otimista:
   `updateMany({ where: { id, decorRevision }, data: { mapData, decorRevision: decorRevision + 1 } })`.
   `count === 0` significa que outro save entrou no meio — refaz o ciclo, até 3
   tentativas.

Conflito real chega de duas formas e as duas entram no retry: a guarda devolve
`count === 0`, ou o Postgres aborta a transação perdedora antes disso e o
Prisma converte em `P2034`. Com dois saves simultâneos de verdade é o `P2034`
que acontece — tratá-lo só como erro faria uma das pessoas levar 500 e perder a
edição.

Nenhuma linha de `OfficeMapPublication` é criada.

## Reconciliação de salas e mesas

Como a publicação continua a mesma, `OfficeRoom` e `OfficeDesk` já existem e
passam a ser reconciliados por `externalKey` em vez de recriados:

- chave nova no documento → cria a linha;
- chave que sumiu do documento → apaga a linha (cascata leva `accessGrants` e
  `claim`);
- chave que permanece → preserva a linha. `name` acompanha o documento;
  `status`, `capacity`, `voiceEnabled`, `accessPolicy` e as concessões de acesso
  são administradas por `updateOfficeRoom` e não são tocadas.

Isso elimina o `deleteMany`/`createMany` de `OfficeDeskClaim` do caminho de
decoração: quem está sentado numa mesa continua sentado quando alguém salva.

Usuário comum consegue criar sala pela ferramenta "call-zone" (objeto
`meeting-room`), então a reconciliação de salas é necessária, não teórica.
Mesa não tem ferramenta no editor de membro, mas a reconciliação cobre as duas
para o caminho ficar simétrico.

## Poda de publicações

O publish estrutural passa a apagar as publicações do mapa além das 10 mais
recentes. A ativa **nunca** é apagada; quando ela já saiu da janela (admin
reativou uma versão antiga à mão), ocupa uma das 10 vagas e quem sai é a mais
antiga da janela — o teto é 10 de verdade, não 10 mais uma.

A poda lê só a janela (`take: 10`) e apaga por exclusão (`notIn`). Um `SELECT`
sobre todas as publicações do mapa dentro da transação `Serializable` amplia o
predicate lock do SSI a ponto de o próprio `create` da publicação abortar com
`P2034`.

Com o save de decoração fora do caminho, publicação volta a ser rara e a poda
quase nunca tem trabalho — mas fecha o limite pedido pelo card.

## Contrato

`ActiveOfficeMapDTO` ganha `decorRevision`. O editor deixa de ancorar em
`publication.version` e passa a ancorar nesse valor; o merge-publish devolve o
`decorRevision` novo e o editor reancora nele.

## Testes

- `office-map-service.test.ts`: save de decoração não cria publicação e
  incrementa `decorRevision`; anel retém no máximo 10 e descarta a mais antiga;
  base vem do anel; base descartada cai no fallback; claim de mesa sobrevive ao
  save; sala nova criada, sala removida apagada, sala preservada mantém
  `status`/`capacity`/`accessGrants`; dois saves simultâneos na mesma revisão
  preservam as duas edições; publish estrutural poda além de 10 e a ativa
  sobrevive ocupando uma vaga.
- `useOfficeMapEditing.test.ts`: âncora sai de `publication.version` e vai para
  `decorRevision`, e reancora com o valor devolvido pelo save.

## Fora de escopo

O editor de mapa do admin (`MapEditor`) e o fluxo antigo com lock exclusivo
(`POST /office/map/edit/publish`) seguem criando publicação como hoje. Limpeza
retroativa das versões já acumuladas além do que a poda fizer no próximo publish
estrutural.
