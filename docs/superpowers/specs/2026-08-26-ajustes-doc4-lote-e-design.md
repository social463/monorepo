# Ajustes do Documento 4 — Lote E (Campanhas) — design

**Origem:** `Ajustes_Portal_EMR_Documento_4.md` (G&G, 4ª rodada), seções 13.1,
13.2 (a parte que sobrou), 13.3 e 13.4.

Terceiro lote do Documento 4, empilhado sobre o **Lote D** — a cadeia é
A → D → E. O Lote A já entregou o bug da seção 13.2 (comunicado apagado que
continuava no calendário de campanhas); aqui entra o resto da seção.

## 13.3 já está pronto — e é bom dizer isso antes de tudo

> "Faltam no gerador os campos de **quantidade de posts** e de **observações /
> direcionamentos**, presentes na referência abaixo."

Os dois campos **existem** no gerador de campanhas, com esses nomes
("Quantidade" e "Observações (opcional)"), e existem desde o commit que criou a
tela (`d3dec50d`, "geração de campanha com preview editável"). O `notes` chega
ao prompt como "Observações do solicitante" e o `quantity` é o que
`buildScheduleSlots` usa para montar a grade de datas.

Não há trabalho aqui. A hipótese mais provável é que a revisão tenha olhado uma
versão anterior à do Documento 3, ou o gerador do **Feed Corporativo**, que é
outra tela: lá o campo de instruções existe, e "quantidade" não faria sentido
porque ele gera **um** comunicado.

**Confirmar com a G&G** antes de considerar o item entregue — se o que faltou
foi outra coisa, é melhor descobrir agora que depois do merge.

## O que entra

### 13.1 — Publicar comunicado de dentro de Campanhas

> "O G&G precisa controlar, criar e agendar **todos** os comunicados da empresa
> pelo gerenciamento de campanhas."

Hoje quem administra campanha planeja o calendário editorial ali, mas para
publicar um comunicado avulso precisa sair para o Feed Corporativo. São duas
telas para o mesmo trabalho, e a que a G&G abre para trabalhar é a de Campanhas.

Campanhas ganha uma terceira aba, **Publicar**, que renderiza o **mesmo**
`CorporatePostComposer` do Feed — o componente, não uma cópia dele. Isso importa
mais do que parece: o composer carrega menção, anexo, GIF, público-alvo, tipo de
comunicação, geração por IA e, desde o Lote A, o agendamento. Reimplementar
qualquer fatia disso criaria uma segunda versão para divergir da primeira no
primeiro ajuste.

A ligação é a que o Feed já usa: `useCreateCorporatePost` e
`canPublishCorporatePostDirectly`. Nada novo na API.

Como quem chega em Campanhas é do bloco de Gente e Gestão, o comunicado sai
publicado direto — mas a decisão continua sendo do `canPublishCorporatePostDirectly`,
e não uma regra nova desta tela.

### 13.2 — O calendário de campanhas no calendário organizacional

> "Integrar o calendário de campanhas ao calendário organizacional, para uma
> visão sistêmica de todos os eventos."

**Não espelhar.** A tentação é criar um `CalendarEvent` a cada `CampaignPost` e
mantê-los sincronizados. Seriam duas fontes para o mesmo dado, e o próprio
Documento 4 já registrou o que acontece quando elas divergem: o bug da 13.2 que
o Lote A consertou nasceu exatamente de uma linha que sobreviveu ao que ela
representava.

O item de campanha continua sendo **só** `CampaignPost`. O que muda é a
**leitura**: `GET /calendar/events` passa a devolver, ao lado dos eventos, uma
lista `campaignPosts` com os itens da janela consultada. O front desenha os dois
na mesma grade, com o item de campanha em estilo próprio e **somente leitura** —
clicar leva para Administração › Campanhas, que é onde ele se edita.

Lista separada, e não um `CalendarEventDTO` sintético, porque item de campanha
**não é evento**: não tem tipo, cor de categoria, recorrência, convidado nem
lembrete. Fabricar um `typeId` falso para caber no DTO obrigaria toda tela que
consome evento a saber que alguns são mentira.

**Quem enxerga:** a mesma regra de `isInternalComm` — admin e o bloco de Gente e
Gestão (`canSeeInternalCalendarEvents`). O calendário editorial é material de
quem publica; o resto da empresa vê o comunicado quando ele sai, não a agenda de
quando vai sair.

### 13.4 — Modelo padrão de comunicado (Brevidade Inteligente)

> "O gerador precisa ter um modelo padrão de comunicado, aplicado
> automaticamente e **removível** quando o G&G quiser gerar algo fora do padrão."

O texto oficial do prompt (os quatro blocos do Smart Brevity) entra como
**constante em `@legends/shared`** — `SMART_BREVITY_PROMPT` — porque api e web
precisam concordar sobre ele: a API o injeta no prompt, e a tela do admin mostra
o padrão quando ninguém editou.

Mas ele **não fica cravado no código**, e é o que a OBS da seção pede: a G&G
precisa refiná-lo sem depender do time de TI. Vira configuração por empresa em
`AppSetting`, chave `campaign_prompt_template`, com a constante como valor
padrão. Sem nada gravado, vale o oficial; gravado, vale o da empresa.

**Aplicado e removível.** `GenerateCampaignRequest` ganha
`applyTemplate?: boolean`, que o gerador manda `true` por padrão. O toggle da
tela é "Aplicar o modelo padrão (Brevidade Inteligente)", ligado. Desligado, o
prompt sai como é hoje — é a saída para gerar algo fora do padrão, sem apagar a
configuração da empresa.

**Vale também para o Feed.** `buildCorporatePostPrompt` tem um
`TODO(tom-de-voz)` marcando exatamente o ponto onde o manual de tom de voz
entraria. É este. O gerador do Feed passa a receber o mesmo modelo, pela mesma
configuração — a OBS da seção 13.4 diz isso com todas as letras ("Ele também
serve de base para o gerador de comunicados do Feed Corporativo").

Onde o admin edita: um painel **Modelo padrão de comunicado** dentro de
Administração › Campanhas, ao lado do gerador. É onde ele é usado, e é a tela
que a G&G já abre para esse trabalho.

## O que este lote NÃO faz

- **Não muda** a grade de horários das campanhas (`CAMPAIGN_SLOT_HOURS`) nem a
  distribuição dos itens na janela.
- **Não move** o calendário de campanhas para dentro do organizacional: os dois
  continuam existindo, e o organizacional passa a **mostrar** o editorial. Quem
  edita item de campanha continua editando em Campanhas.
- **Não cria** campo de quantidade nem de observações — ver acima, já existem.
- **Não** aplica o modelo padrão retroativamente a comunicado já gerado: ele é
  instrução de geração, não formatação de texto salvo.

## Testes

| Área | O que trava |
|---|---|
| `campaign-prompt.test.ts` | com `applyTemplate`, o prompt carrega os quatro blocos; sem, não |
| `campaign-settings-service.test.ts` | sem nada gravado vale o oficial; gravado vale o da empresa |
| `corporate-post-prompt.test.ts` | o gerador do Feed recebe o mesmo modelo |
| `calendar-events.test.ts` (rotas) | item de campanha na janela; some para quem não é G&G |
| `CampaignsSection.test.tsx` | a aba Publicar renderiza o composer do Feed |
| `CampaignGenerator.test.tsx` | o toggle nasce ligado e viaja no corpo |

Sem migration: `AppSetting` já existe e a chave nova é uma linha nele.
