# Ajustes do Documento 4 — Lote A (quick wins) — design

**Origem:** `Ajustes_Portal_EMR_Documento_4.md` (G&G, 4ª rodada), seções 2, 5, 7,
8, 9.3, 9.4, 10, 11.1, 12 e 13.2.

Os 60 itens do documento foram fatiados em lotes, como já foi feito com o
Documento 3. Este é o **Lote A**: o que entrega valor visível sem depender de
material que a G&G ainda não enviou e sem abrir a reforma da Central de Cursos.
Os demais lotes:

| Lote | Seções | Por que está fora daqui |
|---|---|---|
| B — Aprendizado | 9.1, 9.2, 9.6, 9.7, 9.8 | Reforma inteira da autoria de curso: blocos empilháveis na aula, segmentação por público, Central de Cursos, instrutores e unificação dos certificados |
| C — Analytics de T&D | 9.5 | Painel novo; entra junto com a trilha de Desenvolvimento & IA do Documento 3 |
| D — Selos e Emblemas | 11.2, 11.3, 11.4, 11.5 | Solicitação de selo com anexo, categoria de emblema administrável e import/export por planilha — migration + telas novas |
| E — Campanhas | 13.1, 13.3, 13.4 | Unificação com o editor do Feed, campos do gerador e o modelo Smart Brevity como configuração |
| Bloqueados | 3, 4, 6, 14 | Travamento do avatar (sem repro), férias pela ferramenta oficial (.zip no Teams), manuais desatualizados (conteúdo da G&G) e calculadora "Todos pelos 9" (.zip no Teams) |

**Não entra a colagem com formatação no editor de manuais (seção 6).** A parte de
conteúdo é da G&G, mas o bug de colagem é técnico e independente — fica no Lote B,
junto com o editor de blocos da aula (9.1), porque é o mesmo problema de entrada
de texto rico e resolver duas vezes seria jogar um dos dois fora.

## O que entra

### 2 — Tela de login: o portal não é uma ferramenta de feedback

O painel da direita ainda vende "Feedback entre pares" e "Quem constrói merece
virar lenda", com três benefícios de reconhecimento. Como o produto agora é o
**Portal de Gente & Gestão**, quem chega na tela de entrada entende que está
abrindo uma ferramenta de feedback — e o portal é maior que isso.

Troca de conteúdo, não de layout: a paleta, a tipografia e a organização do
painel ficam como estão.

| Onde | Texto |
|---|---|
| Kicker | `PORTAL EMR` |
| Headline | `Conecte-se com a nossa cultura, engaje e evolua.` |
| Parágrafo | `Sua central de informações e cultura na EMR.` |
| Pilar 1 | 📣 `Fique por dentro de todas as novidades` |
| Pilar 2 | 🤝 `Envie reconhecimentos e seja reconhecido` |
| Pilar 3 | 📊 `Acumule EMR Coins, Pontos e Selos` |
| Rodapé da lista | `E muito mais!` (corpo menor) |

Os ícones deixam de ser `Icon` do Material e passam a ser **emoji**, como o
documento pede. Os três emojis entram com `aria-hidden`: quem usa leitor de tela
já ouve o texto do pilar, e "megafone" antes dele só atrapalha.

**ATENÇÃO — white label.** Esta copy é literal e cita EMR. É a mesma decisão que
o produto já tomou em outros 21 lugares onde `EMR Coins` está cravado no front,
então não abre precedente novo; mas a tela de login é a única que **todo** tenant
vê antes de existir sessão. Se o portal ganhar um segundo cliente, esta copy vira
campo de branding — não é este lote que faz isso. O `appName`/`tagline` do tenant
EMR (hoje `EMR Legends` / `Onde as lendas nascem`) é dado do console do
SUPER_ADMIN, não código: se a G&G quiser "Portal EMR" também no logo e na
assinatura, é lá.

**ATENÇÃO — quarto pilar.** O documento fala em "estes 4 pilares" e envia três,
mais o "E muito mais!". Implementado com três; o quarto entra depois, se vier.

### 5 — Botões 1:1 e PDI da Liderança caem na Home

O sintoma relatado ("volta para a página inicial") tem causa exata:
`LeadershipPage` aponta os atalhos para as rotas internas `/1-1` e `/pdi`, e
essas rotas passam por `FeatureGate`, que devolve `<Navigate to="/" replace />`
para quem não tem a feature (`App.tsx:207`). A EMR não usa o 1:1 nem o PDI do
portal — usa a ImpulseUp — então as features estão desligadas e o clique cai na
Home. Não é bug de roteamento: é atalho apontando para uma tela que a empresa
não habilitou.

Os dois `ShortcutCard` passam a apontar para a **ImpulseUp**, abrindo em aba
nova. A URL não é cravada: sai de `impulseUpUrl`, o mesmo campo de
**Administração › Desenvolvimento** que já alimenta o item "Avaliações e
Pesquisas" do menu (`nav-items.ts:99`). Empresa sem URL cadastrada **não vê os
dois cards** — é a mesma regra do menu, e é o que impede o destino de um cliente
de vazar para outro.

`ShortcutCard` ganha suporte a link externo (`<a target="_blank" rel="noreferrer">`
em vez de `<Link>`), com o ícone `open_in_new` como afixo. As rotas `/1-1` e
`/pdi` continuam existindo intactas: quem ligar a feature volta a usá-las.

### 7 — Peças para baixar: duas identidades visuais convivendo

A EMR tem duas marcas em uso ao mesmo tempo, e a aba mistura as peças das duas.
O que a G&G precisa não é só separar visualmente: é que a **regra de uso
acompanhe o download**, porque quem baixa não lembra do combinado.

Cada peça passa a declarar a qual marca pertence. No banco, um enum novo:

```prisma
enum CultureVisualAssetBrand {
  CURRENT // Marca atual — uso interno e externo
  NEW     // Nova marca — uso interno apenas
}
```

`CultureVisualAsset.brand` entra com `@default(CURRENT)`: as peças que já existem
foram publicadas antes de a nova marca ser divulgada, então a marca atual é o
valor correto para todas elas — o backfill é o próprio default, sem UPDATE.

Na aba pública, "Peças para baixar" vira duas abas:

| Aba | Legenda fixa |
|---|---|
| Marca Atual | Uso interno e externo, até a divulgação oficial da nova marca. |
| Nova Marca | Uso restrito ao ambiente interno. Não deve ser usada fora da empresa. |

A legenda fica **dentro** da aba, acima da grade, sempre visível — não é tooltip
nem texto de rodapé. Aba sem peça mostra estado vazio em vez de sumir: aba que
some tira da tela a regra que ela carrega, e a regra é metade do que este item
entrega.

O seletor de marca entra no formulário de `VisualAssetsSection`, como
`<select>` de dois valores, obrigatório.

**Fora do escopo:** as seções **Logos** e **Cor institucional** da mesma aba, que
não vêm do banco — vêm do branding do SUPER_ADMIN (`GET /branding`), que guarda
**uma** identidade por empresa. Duplicá-las por marca significaria o app se pintar
com uma e a aba oferecer outra. Como a paleta da EMR já migrou para o brandbook
2026 (migration `20260824160000_identidade_visual_emr_2026`), o que está lá é a
nova marca; a marca atual para uso externo circula como **peça**, que é
exatamente o que a separação por aba resolve.

### 8 — Comunidade INOVA como aba própria

Hoje a Comunidade INOVA já existe, mas como **link externo dentro do grupo
Desenvolvimento** (`inovaCommunityItem`, `nav-items.ts:114`): um item no meio de
outros cinco, que sai do portal no clique. O documento pede visibilidade — a
iniciativa é o braço de IA e inovação da empresa — e pede uma tela com convite,
instrução de acesso e caminho para redefinir senha.

Vira **grupo próprio do menu, logo depois de Desenvolvimento**, com um item que
leva a uma página interna `/comunidade-inova`. O link externo sai do grupo
Desenvolvimento: manter os dois seria dois caminhos para o mesmo lugar, e o de
dentro do grupo é justamente o que a G&G disse não ser encontrado.

Conteúdo da página (copy oficial, literal):

> **O futuro da EMR é construído por você.**
>
> Assuma o protagonismo. Lance seu projeto e faça parte da transformação.
>
> Aqui, cada projeto seu nasce com propósito e evolui para gerar transformação
> real. Usamos Inteligência Artificial como alavanca para inovar com método,
> colaboração e excelência.
>
> Saiba como fazer isso na **Comunidade INOVA**

Botão primário **Começar agora** → `inovaCommunityUrl`, aba nova.

Bloco de acesso:

> Como acessar: Crie uma conta com seu e-mail corporativo.
>
> Esqueceu a senha e precisa redefinir? Fale com **Mariana Venancio** no Teams.

Botão secundário **Quero redefinir minha senha** → conversa no Teams.

**O link do Teams não é cravado.** O documento traz uma URL de conversa individual
com uma pessoa nomeada; se ela mudar de função, o botão quebra e só o time de TI
conserta. Entra como campo novo em **Administração › Desenvolvimento**, ao lado
dos dois que já estão lá:

```
inovaSupportUrl  String?  // "Contato de suporte da Comunidade INOVA"
```

Sem URL cadastrada, o botão e a frase do contato somem — o resto da página fica.
O nome "Mariana Venancio" é o rótulo do contato e continua no texto; quem trocar
a pessoa troca o texto pela mesma tela de admin não é verdade hoje (o texto é da
página), então o campo guarda **só a URL** e o nome fica na copy. É uma dívida
consciente: um campo de nome + um de URL seria o certo, mas o documento não pede
edição da copy e um formulário de dois campos para um botão é mais superfície do
que o item merece agora.

A página inteira só aparece — no menu e na rota — quando `inovaCommunityUrl`
estiver cadastrada, como o item externo já fazia.

### 9.3 — Solicitar certificado ao concluir o curso

Hoje o certificado é **inteiramente automático**: `issueCertificate`
(`learning-service.ts:399`) roda ao concluir e, se o curso exige aprovação
(`requiresCertificateApproval`), cria sozinho a `CertificateRequest` PENDING. A
pessoa não pede nada, e também não vê nada — se o curso não exige aprovação e
algo barrou a emissão (quiz final não feito, certificado desabilitado), a tela
fica muda.

Entra o pedido explícito, sem tirar o automático:

- `GET /learning/courses/:id` passa a devolver `certificateRequest: { status, rejectionReason } | null`
  no `CourseDetailDTO`, ao lado do `certificate` que já existe;
- rota nova `POST /learning/courses/:id/certificate-request`, que chama
  `requestCertificate(viewer, courseId)`;
- o service recusa com 400 quando a inscrição **não está `COMPLETED`**
  ("Conclua o curso antes de solicitar o certificado.") e é no-op quando o
  certificado já foi emitido; caso contrário reaproveita
  `ensureCertificateRequestForEnrollment`, que já é idempotente por
  `enrollmentId` e já sabe reabrir uma recusa.

Na tela do curso, abaixo do bloco de conclusão: botão **Solicitar certificado**,
`disabled` enquanto o curso não está concluído — o documento é explícito quanto a
isso. Depois de solicitar, o botão dá lugar ao estado da fila (Em análise /
Recusada, com o motivo). Certificado já emitido continua caindo no
`CertificateCard`, que não muda.

Manter a criação automática é de propósito: os cursos que já exigem aprovação
seguem funcionando para quem concluiu antes deste ajuste, e o botão vira, para
eles, a visualização do estado — que é o que faltava.

### 9.4 — Avaliação enviada sem confirmação

O botão do `RatingCard` alterna entre "Enviar avaliação" e "Atualizar avaliação"
conforme `course.myRating`, e não há mensagem nenhuma no sucesso: quem avalia vê
o rótulo mudar e não sabe se salvou.

- o rótulo passa a ser sempre **Enviar avaliação**;
- no sucesso, mensagem **Obrigada pelo seu Feedback!** com `role="status"`, para
  o leitor de tela anunciar sem roubar o foco.

A avaliação continua editável (a rota é a mesma e sobrescreve): o que sai é o
rótulo que prometia "atualizar" sem confirmar nada.

### 10 — Widget de EMR Coins também mostra Pontos

O `CoinPanel` mostra só o saldo de coins. Pontos são a outra moeda do game e
estão em `GET /me/xp` (`useXpBalance`, já sem gate de feature porque o nível
aparece no card de perfil da Home) — nenhuma ponta nova de API.

- saldo de **Pontos** ao lado das EMR Coins, com 🥇, no mesmo bloco do topo;
- `Como ganhar EMR Coins` → **`Como ganhar e usar suas EMR Coins`** (o destino
  segue sendo o Manual do Game);
- `Últimos lançamentos` → **`Suas últimas atividades`**;
- abaixo do saldo, **`Atualizado em <dd/mm/aaaa às HH:MM>`**, lido do `createdAt`
  do lançamento mais recente do extrato — que o painel já busca. Sem lançamento
  nenhum, a linha não aparece: "atualizado em" sobre carteira vazia não informa
  nada.

O rótulo da moeda continua vindo de `COIN_CURRENCY_LABEL`/`XP_CURRENCY_LABEL`, e
não escrito na mão.

### 11.1 — Galeria de ícones do selo abre inteira

`BadgeArtPicker` renderiza os **207** PNGs do catálogo de uma vez, em células
`aspect-square` numa grade de 6/8/10 colunas: a grade ocupa mais tela que o resto
do formulário e empurra os campos para fora da vista.

Três mudanças, todas no componente:

1. **Recolhida por padrão.** O que aparece é um botão com a arte selecionada e o
   nome dela; clicar abre a grade, que fica num painel com `max-height` e rolagem
   própria. Formulário de selo novo abre com a arte padrão já escolhida, então
   recolher não esconde decisão pendente.
2. **Células menores** e mais colunas, para caber mais arte na mesma altura.
3. **Botão "Aleatório"**, que lê o **título** do selo e sugere uma arte
   compatível. Não é sorteio cego: normaliza título e rótulos do catálogo (sem
   acento, minúsculas), casa por palavra, e sorteia entre os que casaram; sem
   nenhum casamento, sorteia entre todos. Sem IA e sem chamada de rede — o
   catálogo tem 207 rótulos em português e o casamento por palavra resolve
   ("Fogo", "Foguete", "Troféu", "Ideia"). Fica na mesma linha do botão que abre
   a grade, e a sugestão aplica direto na prévia.

### 12 — Agendar comunicado

Toda publicação do Feed Corporativo é imediata. Entra o agendamento por dia e
hora.

No banco:

```prisma
enum CorporatePostStatus {
  PENDING
  SCHEDULED   // novo
  PUBLISHED
  REJECTED
}
```

`CorporatePost.publishAt DateTime?` guarda o instante marcado. `SCHEDULED` só
existe com `publishAt` preenchido.

**Quem pode agendar é quem publica direto.** Se o autor cai no fluxo de
aprovação, o post nasce `PENDING` e `publishAt` é ignorado: agendar uma coisa que
ainda vai ser recusada é prometer publicação que pode não acontecer. A regra
reusa exatamente a condição que `createPost` já aplica para decidir entre
`PENDING` e `PUBLISHED`.

**Quem publica é um job do scheduler**, `apps/api/src/scheduler/scheduled-posts.ts`,
no molde dos quatro que já existem (`nudges`, `meeting-reminders`,
`calendar-event-reminders`, `one-on-one-reminders`), registrado em `server.ts`.
Tick de **60 segundos** — o molde das reuniões, não o horário dos lembretes:
"agendado para 14h30" tem que sair às 14h30, não na virada da hora seguinte.
Cada tick pega os `SCHEDULED` com `publishAt <= now`, vira para `PUBLISHED` e
dispara a mesma notificação da publicação imediata.

Publicar preguiçosamente (tratar `SCHEDULED` vencido como publicado na leitura do
feed) seria menos código e está errado: o comunicado sairia no feed **sem
notificação nenhuma**, porque `notifyCorporatePostPublished` só roda no ato da
publicação. Comunicado agendado que ninguém é avisado que saiu não é comunicado.

Para isso, `announcePublished` — hoje uma função privada da rota, que lê
`request.user.companyId` e `request.log` — é extraída para o service como
`announceCorporatePostPublished(post, companyId, log)`. A rota e o job passam a
chamar a mesma coisa; deixar duas cópias faria a notificação do agendado divergir
da imediata no primeiro ajuste.

Na tela: no `CorporatePostComposer`, um toggle **Agendar publicação** que revela
`<input type="datetime-local">`. Instante no passado é recusado na rota (400).
O feed de quem administra passa a mostrar os agendados com a data marcada — sem
isso, agendar é publicar num buraco: o autor não tem onde conferir o que marcou.

### 13.2 — Comunicado apagado continua no calendário de campanhas

Bug real e localizado. `CampaignPost.publishedPost` está declarado com
`onDelete: SetNull`, justificado no schema por "apagar o post do mural não pode
derrubar o histórico editorial". A consequência é a que a G&G viu: apagado o
comunicado, a linha do `CampaignPost` fica lá, com `status = PUBLISHED` e
`publishedPostId = null`, e o calendário segue exibindo um comunicado que não
existe mais.

Ao apagar um `CorporatePost`, o `CampaignPost` ligado a ele é **apagado junto**,
na mesma transação.

Isto reverte a decisão registrada no schema, e a reversão é deliberada: o
"histórico editorial" que o `SetNull` preserva é uma linha órfã que afirma que
algo foi publicado quando não foi. O calendário de campanhas é a lista dos
`CampaignPost` — não há como tirar o item da tela sem tirar a linha. Só cai o
item cujo `publishedPostId` é o post apagado; o resto da campanha fica.

## O que este lote NÃO faz

- **Não integra** o calendário de campanhas ao calendário organizacional (o outro
  pedido da seção 13.2). Isso é o Lote E, junto com a unificação do editor.
- **Não mexe** no fluxo de aprovação do Feed Corporativo além de aceitar (e
  recusar) `publishAt`.
- **Não toca** na Central de Cursos, nas telas de certificado do admin nem no
  catálogo de selos além do seletor de arte.
- **Não cria** campo de nome para o contato da Comunidade INOVA — só a URL.

## Testes

Cada item leva teste ao lado do código, no padrão do repo:

| Área | O que trava |
|---|---|
| `LoginPage.test.tsx` | os cinco textos oficiais na tela |
| `LeadershipPage.test.tsx` | 1:1 e PDI apontam para a ImpulseUp; somem sem URL |
| `KitVisualTab.test.tsx` | duas abas, legenda fixa de cada uma, peça na aba certa |
| `ComunidadeInovaPage.test.tsx` | copy, os dois botões, botão de senha some sem URL |
| `nav-items.test.ts` | grupo novo depois de Desenvolvimento; item externo saiu |
| `learning-service.test.ts` | pedido recusado sem conclusão, idempotente, reabre recusa |
| `CoursePlayerPage.test.tsx` | botão travado antes de concluir; estado da fila depois |
| `CoinPanel.test.tsx` | Pontos, os dois rótulos novos, "Atualizado em" ausente sem lançamento |
| `BadgeArtPicker.test.tsx` | recolhida por padrão; "Aleatório" casa pelo título |
| `corporate-mural.test.ts` | agendado não entra no feed; passado dá 400; autor pendente não agenda |
| `scheduled-posts.test.ts` | tick publica o vencido e notifica; não republica |
| `campaign-service.test.ts` | apagar comunicado tira o item do calendário |

Migrations: uma para `CultureVisualAssetBrand` + coluna, outra para
`CorporatePostStatus.SCHEDULED` + `publishAt`. Geradas com `pnpm db:migrate`,
nunca editando as que já foram aplicadas.
