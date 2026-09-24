# Importar eventos do calendário por planilha

**Data:** 2026-08-24
**Status:** implementado

## Problema

O Calendário Endomarketing existe antes do produto: a G&G mantém o ano inteiro
numa planilha do Google Sheets — 135 linhas, de junho/26 a agosto/27 — com Tag,
datas, horário, descrição e público-alvo. O produto só sabe cadastrar evento
**um por vez**, num formulário.

Cadastrar 135 eventos à mão custa um dia de trabalho e não sobrevive à primeira
revisão da planilha: a G&G corrige uma data, e o calendário do produto passa a
mentir. O resultado previsível é o de sempre — a planilha continua sendo a fonte
de verdade, e a tela do produto fica vazia.

## Decisão

**Importar o arquivo que já existe**, sem pedir para reescrevê-lo. As colunas do
formato são as da planilha da G&G, na ordem dela:

| Coluna | Vai para |
|---|---|
| Mês | ignorada (derivada da data de início) |
| Tag | `CalendarEvent.tag` (etiqueta) **e** a categoria em que ela cai |
| Evento / Celebração | `title` (obrigatória) |
| Data de Início | `date` (obrigatória) |
| Data Final | `endDate` (`null` quando é igual à de início) |
| Duração | ignorada (derivada do horário, `calendarDurationLabel`) |
| Horário | `startTime`/`endTime` |
| Descrição | `description` |
| Tags (Público-Alvo) | `audienceTags` |

`Mês` e `Duração` **entram no mapa de colunas para serem descartadas com
aviso**. Deixá-las como "coluna desconhecida" seria mentira (são do formato);
descartá-las em silêncio faria alguém editar "Duração" achando que surte efeito.

### Anatomia: a mesma da importação de Lendas

`preview` → uma pessoa lê → `commit`, com o **arquivo inteiro reenviado** e
revalidado do zero (`resolveImport` é o mesmo caminho nas duas rotas). O
`fileHash` só garante que é o arquivo que a pessoa acabou de ver; se ele mudou,
409. Qualquer linha com erro **trava o arquivo inteiro** — importação pela
metade num calendário é pior que importação nenhuma, porque ninguém sabe o que
entrou.

### Identidade: título + data de início

Não há id na planilha. O par (título, data de início) é o que a G&G trata como
"o mesmo evento" ao revisar o arquivo, e é o que faz **reimportar corrigir em
vez de duplicar** — a operação normal aqui é subir a planilha de novo depois de
uma revisão. Duas linhas com o mesmo par no mesmo arquivo é erro.

Na atualização, mexe-se **só no que a planilha traz** (título, datas, horário,
descrição, etiqueta, categoria e público). Recorrência, lembretes, setores, cor
própria e a marca de comunicação interna não têm coluna: zerá-las apagaria
configuração feita na tela sem ninguém pedir.

### A Tag não é a categoria

A primeira versão criava **uma categoria por Tag**. O resultado apareceu na
primeira tela: 21 categorias novas, todas com a cor de fallback — porque
`calendarCategoryColor` só conhece o catálogo padrão — e o calendário inteiro
saiu do mesmo indigo, com 31 chips na barra de filtro.

O erro foi tratar dois conceitos como um. O **Portal EMR**, de onde essa
planilha vem, sempre teve os dois separados: `category` (10 valores fixos, cada
um com cor e ícone) e `tag` (texto livre da planilha, mostrado como etiqueta ao
lado da categoria). É esse desenho que vale aqui:

- a **categoria** (`CalendarEventType`) dá cor, ícone e o chip de filtro. São as
  10 do catálogo, e a barra não cresce por vocabulário novo da planilha;
- a **etiqueta** (`CalendarEvent.tag`) guarda a grafia original — "Simulado",
  "Circuito", "Porta de Prova" — e aparece no evento, sem cor própria.

O mapa mora em `CALENDAR_IMPORT_TAG_CATEGORIES` (`@legends/shared`) e resolve em
três degraus: a tag já É uma categoria do catálogo ("Reunião" → `reuniao`); a
tag está no mapa ("Simulado" → `evento`); ou nada casa, e vira **Evento** com
aviso no preview — recusar a linha travaria a planilha inteira por um
vocabulário novo, e a grafia não se perde, fica na etiqueta.

Categoria do catálogo que a empresa tenha apagado renasce com **nome, cor e
ícone do catálogo** — não com a de fallback, que era a origem do problema.

### Permissão: bloco de Desenvolvimento de Produto

As rotas são `/admin/calendar-events/import/{template,preview,commit}`, sob
`requireSectorFeature('desenvolvimento-produto')` — a mesma guarda de
`/admin/calendar-event-types`, e **não** a de `/calendar/events`. A liderança
cadastra evento avulso; quem mexe no catálogo de categorias é o bloco, e a
importação mexe.

### Horário escrito à mão

`parseSpreadsheetTimeRange` (em `lib/spreadsheet-values.ts`, junto do parser de
data que a importação de Lendas já usava) lê `15h-22h`, `16h-16h50`,
`15h00-16h00`, `14h30 às 15h`, `14:00-15:30` e `Dia todo`. Célula que não dá
para ler como horário vira **erro de linha** em vez de virar evento de dia
inteiro: a planilha dizia que tinha hora marcada.

## Os eventos de 2026/27

O arquivo versionado é `apps/api/scripts/data/calendario-endomarketing-2026.csv`
— a planilha da G&G exportada, menos a única linha sem data definida (*Festa de
Final de Ano | EMR*, "Sexta (verificando)"), que entra quando a data existir.

Carrega-se pela tela (Administração › Eventos do calendário › Importar planilha)
ou pelo script, que chama o mesmo service:

```bash
pnpm --filter @legends/api exec tsx scripts/import-calendar-events.ts --dry-run
DATABASE_URL="<url do ambiente>" pnpm --filter @legends/api exec tsx \
  scripts/import-calendar-events.ts --batch 20
```

O script vai em **lotes** (`--batch`, 40 por padrão) porque a transação do
commit tem teto de 30 s e, rodando de fora do cluster, cada statement paga a
latência da rede: os 135 numa transação só estouram o teto contra o HML — a
mesma pedra em que a importação de Lendas bateu. Pela tela isso não acontece,
que é onde a API fala com o banco na mesma rede. Como a identidade é
(título, data), repetir um lote é idempotente.

O teste `admin.calendar-events-import.test.ts` importa esse mesmo arquivo de
ponta a ponta: se a planilha da G&G mudar de formato, é ali que quebra.
