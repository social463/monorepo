# Ajustes do Documento 4 — Lote D (Selos e Emblemas) — design

**Origem:** `Ajustes_Portal_EMR_Documento_4.md` (G&G, 4ª rodada), seções 11.2,
11.3, 11.4 e 11.5.

Segundo lote do Documento 4. O **Lote A** (spec vizinho
`2026-08-26-ajustes-doc4-lote-a-design.md`) já entregou a seção 11.1, o seletor
de arte do selo — este lote continua no mesmo assunto e é irmão dele: mexe no
mesmo `BadgesSection.tsx`, então **sai empilhado sobre a branch do Lote A**, não
sobre a `main`.

## O nome "categoria" já está ocupado, e não é desta

Antes de tudo: `Badge.categorySlug` **já existe** e significa outra coisa. Ele
aponta para o `slug` de uma `RecognitionCategory` — o catálogo de categorias de
feedback da empresa — e é o que um selo de tipo `CATEGORY` conta ("dez feedbacks
na categoria Colaboração"). É texto sem FK, de propósito, e o `AGENTS.md`
explica por quê.

O que a seção 11.4 pede é outra coisa: uma **prateleira do catálogo**, para o
Painel de Emblemas parar de ser uma lista corrida. As categorias que o documento
cita — Feedback, Social, Desenvolvimento, Clima, Cultura — não são categorias de
reconhecimento; são temas de selo.

São dois conceitos, e fundi-los quebraria o `CATEGORY`: um selo do tema
"Cultura" passaria a contar feedbacks da categoria "Cultura", que pode nem
existir. Por isso entram com nomes que não se confundem:

| Conceito | Model | Campo em `Badge` |
|---|---|---|
| Categoria de **reconhecimento** (a que existe hoje) | `RecognitionCategory` | `categorySlug` (texto, sem FK) |
| **Tema** do selo, novo | `BadgeCategory` | `badgeCategoryId` (FK) |

## O que entra

### 11.4 — Tema do selo e recompensa em duas moedas

**`BadgeCategory`**: `name`, `slug`, `order`, `active`, `companyId`. Único por
empresa (`@@unique([companyId, slug])`), como `Badge.slug`, `Sector.slug` e
`Squad.slug` — a regra do repo para model tenant-scoped. Desativa-se, não se
apaga: o `slug` é o que o import da 11.5 casa, e apagar levaria os selos junto.

A migration cria as cinco do documento **para cada empresa existente**
(`INSERT … SELECT id FROM "Company"`), e o `db:seed` passa a criá-las para as
novas. `Badge.badgeCategoryId` é opcional: selo sem tema cai numa gaveta **Sem
categoria** no painel. Chutar um tema para os selos que já existem seria
inventar dado — a G&G classifica quando quiser.

**Recompensa**: `Badge.rewardPoints Int?` e `Badge.rewardCoins Int?`, os dois
**nulos por padrão**. O documento é explícito: nenhum dos dois é obrigatório, e
tem de dar para salvar com os dois vazios. Nulo e não `@default(0)` porque o
formulário precisa distinguir "não configurado" de "zero digitado" — na tela,
`0` num campo numérico parece valor escolhido.

O crédito sai por `BADGE_EARNED`, valor novo em `CoinEvent` e em `XpEvent`. O
valor vem do selo, não de uma regra: `CoinRule` só sabe valor fixo por evento, e
a recompensa aqui é por selo. É o mesmo problema do desafio, então é a mesma
solução — `awardFixedCoins`, que já existe. Para os Pontos falta o par:
**`awardFixedXp`** entra em `xp-service.ts`, espelhando o de coins linha por
linha (inclusive o `tx` opcional e o `P2002` virando `DUPLICATE`).

**Onde o crédito acontece.** `userBadge.create` aparece em **seis** lugares de
`badge-service.ts` e a notificação de selo novo (`notifyBadgesEarned`) é chamada
de **onze**. Pendurar o crédito em cada um é garantir que um seja esquecido no
próximo selo automático que alguém escrever.

Entra um funil: **`settleBadgesEarned(userId, badgeIds, companyId)`**, que
credita as duas moedas e então notifica. Os onze call sites de
`notifyBadgesEarned` passam a chamá-lo. "Selo conquistado" tem duas
consequências agora, e o lugar de saber disso é um só.

O `reference` do dedupe é o **`badgeId`**, não o id da concessão: a chave única
é `(userId, dedupeKey)`, então `BADGE_EARNED:<badgeId>` significa "este selo
paga uma vez por pessoa, para sempre". Revogar e conceder de novo não paga
duas vezes — e é essa idempotência que torna seguro chamar o funil de onze
lugares que às vezes se sobrepõem.

Crédito é **best-effort**, como a avaliação de selos já é (`AGENTS.md`): falha
de crédito é logada e não derruba o voto, o feedback nem o curso que gerou o
selo.

### 11.2 — Reivindicação de selo pelo colaborador

Model **`BadgeClaim`**: `badgeId`, `userId`, `story` (≤ 1.000 caracteres,
obrigatório), `attachmentKey` + `attachmentKind` (`IMAGE` | `DOCUMENT`, os dois
nulos), `link` (nulo), `status` (`PENDING` | `APPROVED` | `REJECTED`),
`reviewedById`, `reviewedAt`, `rejectionReason`, `companyId`.

Uma reivindicação ativa por (pessoa, selo), garantida por índice único
**parcial** (`WHERE status <> 'REJECTED'`) que vive só no SQL da migration — o
Prisma não sabe representar índice parcial, e declará-lo no schema faria todo
`migrate dev` futuro propor recriá-lo sem o `WHERE`. É exatamente o que
`ChallengeSubmission` já faz; o comentário de lá vale aqui.

**Qual selo dá para reivindicar:** qualquer um que a pessoa ainda não tem. Não
entra flag `claimable` no `Badge`, e a escolha é deliberada — uma flag nova
nasceria `false` e a funcionalidade ficaria invisível até alguém virar duzentas
chaves na mão. Reivindicar um selo que o sistema conta sozinho é ruído que a
G&G recusa em um clique; feature que ninguém encontra é ruído que ninguém
resolve.

**Anexo:** imagem **ou** PDF, como o documento pede. Chave montada no servidor
(`badge-claims/<userId>/<uuid>.<ext>`) por um presign próprio — o cliente nunca
escolhe onde o arquivo é gravado, mesma defesa da evidência de desafio. O DTO
expõe **URL assinada de curta duração**, nunca a chave: comprovação de conquista
é material de uma pessoa, e prefixo público aqui vazaria certificado de todo
mundo (o bucket da EMR é público inteiro — ver o histórico do repo).

**Aprovação** (`approveBadgeClaim`) reusa a anatomia de
`challenge-submission-service.decide`: `updateMany` condicional em
`status: PENDING` dentro da transação — é ele que toma o lock da linha e faz o
recheck valer sob Read Committed — e, no mesmo `tx`, a criação do `UserBadge`
(`source: MANUAL`) e o crédito das duas moedas. Recusa exige motivo, que volta
para quem pediu.

Textos oficiais do modal, literais:

> **Reivindicar "[Nome do selo]"**
>
> Conte como você conquistou este emblema. Sua solicitação será analisada pelo
> time de Gente e Gestão.
>
> *Explique sua conquista: projeto, comportamento, resultado…* (placeholder)
>
> Anexo — print, foto ou certificado (imagem ou PDF)
>
> Ou cole um link (opcional)
>
> **Enviar solicitação**

### 11.3 — Painel de Emblemas segmentado por tema

Hoje o catálogo é agrupado por **setor** (`groupBySectorMulti`). Passa a ser
agrupado por **tema**, com contador em cada gaveta, e cada item ganha as ações
que o documento pede: **Atribuir** e **Excluir**.

O escopo por setor não some da tela — vira um chip no item. Ele continua sendo
regra de verdade (quem enxerga o selo), só deixa de ser o eixo do agrupamento,
que era o que fazia a lista não responder "quantos selos de Cultura existem".

"Atribuir" abre o seletor de pessoa **daquele** selo. Hoje conceder exige
descer até o painel `MemberBadgesPanel`, escolher a pessoa, e só então achar o
selo numa lista de todos — a ordem inversa da pergunta de quem está olhando um
selo específico. O `MemberBadgesPanel` fica: ele responde a outra pergunta
("que selos o fulano tem"), e é por lá que se revoga.

A fila de **reivindicações pendentes** (da 11.2) entra no topo do painel, com
Aprovar e Recusar, e abas Pendentes / Aprovadas / Recusadas.

### 11.5 — Planilha de selos (importar e exportar)

Mesma anatomia da importação de eventos do calendário
(`calendar-event-import-service`) e da de colaboradores: **`preview` e `commit`
passam pelo mesmo `resolveImport`**, então a confirmação enxerga o banco de
agora e não o de quando a prévia foi gerada, e o arquivo é reenviado inteiro em
vez das linhas já interpretadas — nada que o navegador monte entra no banco sem
passar pelas mesmas regras.

Colunas, na ordem do template:

| Coluna | Obrigatória | Observação |
|---|---|---|
| Nome | sim | |
| Descrição | sim | |
| Tipo | sim | rótulo em português (`Por categoria`, `Tempo de casa`…), não o enum cru |
| Tema | não | casa pelo nome da `BadgeCategory`; tema desconhecido vira erro da linha, nunca categoria criada em silêncio |
| Ícone | não | chave do catálogo de arte; vazio ou desconhecido cai no padrão |
| Limiar | não | inteiro; padrão 0 |
| Categoria de reconhecimento | não | só para o tipo `Por categoria`; é o `categorySlug` |
| Pontos | não | vazio = não concede |
| EMR Coins | não | vazio = não concede |

A chave de reconciliação é o **`slug`**, derivado do nome — linha cujo slug já
existe **atualiza**, linha nova **cria**. É o que permite a G&G exportar,
mexer na planilha e reimportar sem duplicar o catálogo inteiro.

O template sai com `;` e BOM, que é o que o Excel em pt-BR abre sem assistente;
o parser fareja o separador na volta, então a planilha exportada do Google
Sheets (vírgula) também entra. O export traz **todas** as colunas do template,
para o ciclo exportar → editar → importar fechar.

## O que este lote NÃO faz

- **Não cria** flag de "selo reivindicável" (ver acima).
- **Não mexe** no `categorySlug` nem no comportamento dos selos `CATEGORY`.
- **Não classifica** os selos existentes num tema — eles ficam em "Sem
  categoria" até a G&G decidir.
- **Não** importa a coluna de setor da planilha: escopo por setor é decisão de
  visibilidade e continua na tela, onde dá para ver a lista de setores ativos.
  A planilha de referência da G&G também não a tem.

## Testes

| Área | O que trava |
|---|---|
| `badge-category-service.test.ts` | slug único por empresa; desativar não apaga |
| `badge-reward.test.ts` | crédito das duas moedas; `null` não credita; conquistar de novo não paga de novo |
| `badge-claim-service.test.ts` | uma ativa por (pessoa, selo); aprovar concede e credita na mesma transação; aprovar duas vezes é 409; recusar exige motivo |
| `badge-import-service.test.ts` | slug existente atualiza; tema desconhecido é erro de linha; preview e commit concordam |
| `BadgesSection.test.tsx` | gavetas por tema com contador; Atribuir e Excluir por item; fila de pendentes |
| `BadgeClaimDialog.test.tsx` | textos oficiais; relato obrigatório; limite de 1.000 |
| `badges.test.ts` (rotas) | reivindicar exige autenticação; aprovar é de quem administra |

Migration única, com o enum novo, os dois valores de evento, as três colunas de
`Badge`, os dois models e o índice parcial no SQL.
