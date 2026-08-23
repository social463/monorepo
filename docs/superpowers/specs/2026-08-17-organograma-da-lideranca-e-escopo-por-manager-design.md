# Organograma pela Liderança, e `managerId` como fonte única de "meu time"

**Data:** 2026-08-17
**Status:** implementado

## Problema

Duas coisas, que viraram uma só entrega porque têm a mesma causa.

1. O atalho **Organograma** da área de Liderança levava a `/time`, a visão da
   empresa inteira. O líder entra ali para ver o time dele, não a estrutura
   completa — e a matriz de permissões diz que ver a empresa inteira **por essa
   entrada** não é dele, e sim de Admin / Gente e Gestão.
2. O produto tinha **duas hierarquias paralelas**. O organograma desenha a
   cadeia de comando por `User.managerId`; o resto da área de Liderança (humor
   do time, férias, indicadores) recortava por **squad** (para `LEAD`) e por
   **área** (para `MANAGER`), em `team-scope-service`. "Meu time" numa aba podia
   não ser "meu time" na aba do lado.

## Decisão

**`User.managerId` é a fonte de verdade de quem lidera quem.** Squad e área
continuam existindo para o que são; não definem mais time.

### Entrada da Liderança

- Rota nova `/lideranca/organograma`, sob `LeadershipOnly` + `FeatureGate('time')`,
  renderizando a mesma `TeamPage` com `scope="direct-reports"`.
- API: `GET /organization/direct-reports` (autenticada, feature `time`). O
  recorte sai do JWT — não há como pedir o time de outra pessoa. Endpoint
  próprio em vez de `?escopo=` no `/organization` por isso mesmo.
- A árvore tem **um nível**: a pessoa no topo, seus diretos como folhas. Quem
  lidera alguém mais abaixo aparece aqui como folha; `reportsCount` descreve a
  subárvore *desta* resposta.
- Sem liderado direto, a resposta vem vazia (`roots: []`) e a tela explica —
  card solitário passaria por organograma quebrado.
- `/time` segue como estava: empresa inteira, feature `time`, aberta a quem tem
  a feature. Da entrada da Liderança, só **Admin / G&G** ganham o link
  "Ver a empresa inteira".

### Escopo de liderança (`team-scope-service`)

Consumido por humor do time, férias e indicadores da Liderança.

- `listManagedGroups` devolve **um** grupo, "Meu time", com os liderados
  **diretos** — é o que os painéis mostram nominalmente.
- `managesUser` aceita qualquer pessoa da **subárvore**: líder de líderes lança
  férias e lê humor de quem está dois níveis abaixo. Autorizar é superconjunto
  de listar, então ninguém aparece num painel sem poder ser aberto.
- Elegibilidade é a mesma do organograma (`ORGANIZATION_MEMBER_WHERE`, exportado
  de `organization-service`): ativo, não desligado, papel da cadeia de comando,
  setor ativo. Líder intermediário fora da árvore **rompe o elo**, como já
  acontecia no desenho da árvore.
- `managerId` é campo livre: a subida da cadeia carrega um `seen` contra ciclo
  gravado, do mesmo jeito que `breakCycles` no organograma.

## Consequências

- **Papel deixa de importar.** Quem tem gente apontando para si lidera. `HEAD`,
  que não via ninguém, passa a ver os diretos. Some a assimetria antiga entre
  `managesUser` e `listManagedGroups` — as duas leem a mesma cadeia.
- **Alcance muda nas duas direções.** Ganha-se o skip-level; perde-se o acesso
  que vinha só de squad liderada ou de área em comum.
- **Depende do dado.** Empresa sem `managerId` preenchido fica com os painéis da
  Liderança vazios. O líder direto é cadastrado em
  **Administração › Organização › Lendas** ou pela importação por planilha.
  Essa é a dependência a acompanhar na subida.

## Fora de escopo

- Mudar `/time`, a feature `time` ou a semântica de `/users`.
- `PdiPlan.leaderId` (líder **do plano**, escolhido por plano) e
  `Squad.leaderId` (liderança **da squad**): outros conceitos, intocados.
- Renomear a rota `/me/led-squads/moods`, que hoje já não fala de squad.
