# Ajustes do Documento 3 — Lote A (quick wins) — design

**Origem:** `Ajustes_Portal_EMR_Documento_3.md` (G&G, 3ª rodada), seções 4.3, 6, 7,
9.1, 9.2, 9.3 e 12.

Os 57 itens do documento foram fatiados em lotes. Este é o **Lote A**: o que dá
para entregar sem instrumentação nova, sem migration pesada e sem depender de
material que a G&G ainda não enviou. Os demais lotes:

| Lote | Seções | Por que está fora daqui |
|---|---|---|
| B — People Analytics | 3, 4.1, 4.2, 4.4, 4.5, 4.6, 4.7 | Bloco maior: filtro de período personalizável, tempo de sessão, Ficha & Perfil tabular, nova aba Dashboard |
| C — Gamificação | 5 | CRUD de regras de coins/XP + reflexo no Manual do Game |
| D — Comunicação Interna | 4.8, 13 | Depende de tags no Feed e de telemetria por post |
| E — Bloqueados | 8, 10 | Agente de Benchmarking e identidade visual esperam material da G&G |

## O que entra

### 4.3 — Remover "Adesão da votação"

O bloco sai da Visão geral de People Analytics. A remoção acompanha a decisão do
Documento 2 de descontinuar a página de Reconhecimento por votação: métrica de um
rito que a EMR não pratica ocupa metade de uma faixa do painel.

Sai a ponta inteira, não só a caixa na tela — `VotingAdoptionDTO`,
`loadVotingAdoption` e o campo `votingAdoption` do `PeopleOverviewDTO`. Deixar o
cálculo rodando para ninguém ler custa duas queries por abertura do painel.

**Não entra:** a segunda frase da seção 4.3 ("analisar os feedbacks por tags e
competências") é análise nova, não remoção — vai para o Lote B junto com o resto
da Visão geral.

### 6 — Termômetro do humor duplicado

Hoje o termômetro administrativo existe em dois lugares:

- `/admin/clima` → `MoodOverviewSection` (528 linhas: médias, tendência, alertas,
  comentários) — no grupo **Comunidade** do menu de admin;
- `/admin/pessoas`, aba "Clima & Engajamento" → um resumo de três cards + dois
  gráficos, dentro de `PeopleAnalyticsSection`.

A G&G quer **uma** página, e recomenda ficar com a de People Analytics, que é
onde estão os filtros de período e setor.

O caminho é mover a tela boa para dentro da aba, não apagar a fraca:

1. a aba "Clima & Engajamento" vira **"Clima"** e passa a renderizar
   `MoodOverviewSection`;
2. o que era o resumo de clima da aba antiga (humor médio, participantes,
   tendência, distribuição) some — `MoodOverviewSection` já mostra tudo isso com
   mais detalhe;
3. o que sobra da aba antiga (Alcance do Feed Corporativo e Telas mais acessadas)
   fica numa aba **"Engajamento"** própria;
4. o item `/admin/clima` sai do menu **Comunidade**, e a rota passa a redirecionar
   para `/admin/pessoas?aba=clima` — link antigo em favorito ou e-mail não pode
   virar 404.

Isso significa que o Lote A já entrega, de fato, a separação de abas pedida na
seção **4.5** — e é inevitável: não dá para tirar a duplicidade sem decidir onde
o termômetro completo passa a morar. O que **fica para o Lote B** é o conteúdo
novo dessas abas: filtro de período personalizável (4.6), card "Distribuição de
hoje" (4.6), comentários identificados (4.6) e a mudança de `/admin/engajamento`
para dentro da aba (4.7).

A aba ativa passa a viajar na URL (`?aba=`), como já acontece em `LearningPage` —
sem isso o redirecionamento do item 4 acima não tem para onde apontar.

### 7 — Kit Visual: envio de várias mídias de uma vez

Em Cultura › Kit visual, "Materiais por pessoa" hoje sobe **um arquivo por
formulário**. A G&G entrega um kit inteiro por pessoa, então repete o formulário
N vezes.

O `<input type="file">` ganha `multiple`; cada arquivo sobe pelo
`uploadPersonalAsset` já existente (a chave no S3 continua namespeada por
destinatário, então a regra de acesso não muda) e vira **um `CulturePersonalAsset`
por arquivo**, todos com o mesmo destinatário, título e descrição — que é o que o
documento pede.

Um arquivo que falha não derruba os outros: o resumo diz quantos subiram e quais
falharam. A alternativa (abortar tudo) faria a pessoa reenviar um kit de 12 fotos
por causa de um PDF grande demais.

Sem endpoint novo: o `POST /admin/culture/personal-assets` é chamado uma vez por
arquivo. Um endpoint em lote economizaria idas ao servidor, mas o upload em si já
é uma ida por arquivo — o ganho seria marginal e custaria contrato novo.

### 9.1 — Aniversariantes

Três mudanças no `BirthdaysCard` e no `WorkAnniversariesCard`:

**Máximo de 3 pessoas por bloco.** Hoje o corte é por **data**, não por pessoa:
`nearestThreeDates`, no `celebration-service`, mantém as 3 datas mais próximas
inteiras — e uma data com sete aniversariantes traz os sete. O corte novo é de
**pessoas** e é feito **no cliente**, não no service: o mesmo `upcoming` alimenta
a página `/aniversariantes` ("aniversariantes de hoje") e o
`use-birthday-confetti`. Cortar no servidor apagaria gente dessas duas telas.

O link "Ver todos os aniversários" já existe e continua sendo a saída para os
demais.

**Parabéns pelo próprio bloco.** O `CelebrationTile` já tem uma ação secundária:
o coração que leva a `/perfil/:id` para deixar um feedback. Ganha um segundo
ícone (`celebration`) que abre o `FeedbackComposer` num diálogo, com o
destinatário já preenchido — a pessoa dá os parabéns sem sair da Home.

Reaproveitar o `FeedbackComposer` (e não inventar um "parabéns" novo) é o que
mantém o parabéns dentro do mesmo vocabulário do produto: ele nasce como
feedback, conta para selo e paga coins como qualquer outro. Um segundo tipo de
mensagem seria um vocabulário paralelo — exatamente o que a unificação de
reconhecimento em feedback desfez.

**Animação de quem faz aniversário hoje.** Já existe `BirthdayConfetti` na Home,
mas ele é a celebração de *quem está olhando*. Falta marcar *o colega* do dia: a
linha `highlighted` do `CelebrationTile` ganha bolo e balões animados.

### 9.2 — Férias do mês e Ranking mais compactos

Blocagem menor, sem perder o que a linha informa:

- `MonthVacationsCard`: de 4 para **3** pessoas, avatar de 40px → 32px, nome e
  período na mesma linha, o selo "Ausente" vira um ponto colorido com `title`.
- `TopEngagementCard`: continua Top 5 (é o nome do bloco e o que o ranking
  significa), mas com linha de altura menor — avatar 32px e setor no mesmo
  parágrafo da posição.

O objetivo declarado é "melhor leitura", não menos informação: nada some, as
linhas encolhem.

### 9.3 — Feed Corporativo e Mural de Feedbacks na Home

**Limite de 3.** `CorporateFeedPreview` já corta em 3 (`PREVIEW = 3`) — nada a
fazer. `FeedbackWallSection` corta em 2 (`FEEDBACK_WALL_PREVIEW_SIZE = 2`, em
`@legends/shared`): passa a 3.

**Marcação "Novo".** Retângulo verde no canto superior direito do item.

Para **comunicado**, a fonte já existe: o model `CorporatePostRead`
(`@@unique([postId, userId])`) grava quem leu, e `POST /corporate-posts/:id/read`
já é chamado quando o post é aberto. Falta só expor: o DTO do post ganha
`viewerRead: boolean`, e a Home marca "Novo" onde for `false`. Sem migration.

Para **feedback compartilhado** não há nada equivalente, e é aqui que está a
decisão em aberto que o próprio documento levanta ("por item ou por aba?").

A recomendação é **por aba, guardada no servidor**: um campo
`feedbackWallSeenAt` em `User`, gravado quando a pessoa abre `/mural-feedbacks`;
é "Novo" o feedback compartilhado depois desse instante. Marcar por item exigiria
uma tabela `FeedbackWallRead` inteira para um selo visual, e a G&G descreve o
comportamento como "a aba que ainda não abriu". Guardar no servidor, e não em
`localStorage`, é o que faz a marcação sobreviver à troca de navegador — quem
lê no celular não deveria reencontrar tudo como novo no desktop.

Custo: **uma migration** (uma coluna nullable em `User`). É a única deste lote.

### 12 — Link de envio de certificados

Na aba **Certificados** de `/aprendizado`, um bloco fixo com o link do Notion
(`https://app.notion.com/p/Envie-seu-Certificado-218f78ae7fea816aa9cfe31ba8868483`),
acima da lista, visível também quando a lista está vazia — que é justamente o
estado de quem ainda vai enviar o primeiro.

O link é **externo e fixo neste lote**. O certificado emitido pelo portal
(conclusão de curso, com fila de aprovação em `/admin/certificados/fila`) continua
como está; o Notion cobre o certificado de curso feito **fora**, que ainda não tem
fluxo no portal.

Cravar a URL no código, e não num `AppSetting`, é decisão consciente de escopo:
num produto white label a página do Notion é da EMR, não das outras empresas.
A saída correta é o link virar configuração de empresa quando houver a segunda
empresa usando Aprendizado — registrado abaixo como pendência, não resolvido
aqui.

## Permissões

Nada muda de perfil neste lote:

| Item | Quem vê |
|---|---|
| 4.3, 6 | ADMIN e SUBADMIN de setor com `gente-gestao` (igual hoje) |
| 7 | ADMIN e SUBADMIN de setor com `gente-gestao` (igual hoje) |
| 9.1, 9.2, 9.3 | Qualquer pessoa logada — são blocos da Home |
| 12 | Qualquer pessoa logada com acesso a Aprendizado |

O parabéns do 9.1 herda a regra do `FeedbackComposer`, que já recusa ADMIN e
recusa escrever para si mesmo.

## Decisões em aberto

1. **Marcação "Novo" do Mural de Feedbacks (9.3):** por aba com coluna em `User`
   (recomendado, custa uma migration) ou por item com tabela própria. Precisa de
   sim/não antes da implementação — é o único ponto do lote que mexe no schema.
2. **Link do Notion (12):** fica cravado em código agora; vira configuração por
   empresa quando o Aprendizado for para o segundo tenant.
3. **Seção 4.3, segunda frase:** "analisar feedbacks por tags e competências" foi
   deslocada para o Lote B. Confirmar com a G&G que a remoção do bloco de votação
   pode entrar sem essa análise junto.
