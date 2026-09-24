# Ajustes do Documento 4 — Lote B (Aprendizado) — design

**Origem:** `Ajustes_Portal_EMR_Documento_4.md` (G&G, 4ª rodada), seções 9.1,
9.2, 9.6, 9.7, 9.8 e a parte técnica da seção 6 (colagem com formatação).

Último lote do Documento 4 — os outros quatro já entraram (A, D e E na `main`
pelo PR 11025; C no PR 11027). O que sobrou é o maior: **a reforma da autoria
de curso**, que o documento apresenta na 9.6 como uma plataforma inteira, com
dashboard, wizard de três passos e cinco abas de catálogo.

## B não é um PR

Os outros lotes couberam num commit porque cada um mexia numa tela. Este mexe
no **modelo de dados** de curso em cinco pontos independentes — aula, catálogo,
instrutor, público-alvo e status —, e cada ponto tem migration, service, rota e
tela. Um PR único ficaria impossível de revisar e travaria a fila de merge por
semanas.

A proposta é fatiar B em **seis sub-lotes**, na ordem de dependência. B1, B3 e
B4 são independentes de todo o resto e entregam valor sozinhos:

| Sub-lote | Seções | Depende de | Tamanho |
|---|---|---|---|
| B1 — Colagem com formatação nos manuais | 6 | — | pequeno |
| B2 — Certificados num lugar só | 9.8 | — | médio |
| B3 — Blocos empilháveis na aula | 9.1 | — | grande |
| B4 — Catálogo: categorias, competências e instrutores | 9.6 (abas), 9.7 | — | médio |
| B5 — Público-alvo e matrícula automática | 9.2 | B4 | médio |
| B6 — Central de Cursos: dashboard, listagem e wizard | 9.6 (resto) | B3, B4, B5 | grande |

O que segue descreve cada um a partir do **código que existe hoje**: em vários
pontos o documento pede algo que já está pronto por outro nome, e em outros o
que parece um ajuste de tela é troca de modelo. Onde a fonte do protótipo decide
um formato, ela entra citada pelo arquivo.

## O protótipo veio em código, e isso destravou o lote

O `portal-emr-source-v2.zip` — fonte do protótipo Lovable, React + Supabase —
chegou depois da primeira versão deste spec. Ele **não é o que vamos
implementar**: a stack é outra e o modelo de dados é outro. O que ele é: a
resposta, por evidência, do que antes eram perguntas em aberto.

| Pergunta | Resposta | Onde, na fonte |
|---|---|---|
| Os catorze tipos de bloco da 9.1 | o payload de cada um, mais o renderer do aluno | `src/components/course-cms/block-editor.tsx`, `src/components/course/BlockRenderer.tsx` |
| Segmentar por cargo (9.2) | texto livre, assumido | `src/components/course-cms/visibility-panel.tsx` |
| Os cinco status da 9.6 | `draft`, `review`, `pending_approval`, `published`, `archived` | migration `20260702112709` |
| Recompensa por curso (9.6) | `reward_points` 25 e `reward_coins` 10, como default de coluna | migration `20260702150423` |

E o que ele **não** responde: a fila única de certificados (B2), que é decisão
de processo da G&G e não tem como sair de código; e a colagem com formatação
(B1), que o protótipo também não resolve — ver lá.

---

## B1 — Colagem com formatação nos manuais (seção 6)

> "Ao copiar um arquivo e colar como texto no editor de manuais, a formatação
> original é perdida. O conteúdo chega ao portal como um bloco corrido."

**Não é um bug do editor — é que não há editor.** `CultureManual.body` é
Markdown, e o campo em `admin/culture/ManualsSection.tsx` é um `<textarea>`
cru rotulado "Conteúdo em Markdown (opcional)". Colar Word ou PDF num
`<textarea>` **sempre** entrega `text/plain`: o navegador não tem para onde
levar a formatação. A leitura, essa sim, já renderiza estrutura — o
`ManualDetailPage` passa o `body` pelo `<Markdown>`.

Então o item não é "corrigir a colagem", é **dar ao campo um caminho para o
HTML da área de transferência**. E esse caminho já existe no repo:
`components/rich-text/RichTextEditor.tsx` lê `clipboardData.getData('text/html')`,
sanitiza e insere (linhas 146-165) — é o que o Mural Corporativo usa.

Duas saídas, e a escolha importa porque o `body` é **Markdown**, não HTML:

| Caminho | O que muda | Custo |
|---|---|---|
| **Converter no paste** (recomendado) | O `<textarea>` continua Markdown; um `onPaste` pega o `text/html`, converte para Markdown e insere no cursor | pequeno, e não toca no dado |
| Trocar pelo `RichTextEditor` | O `body` passa a ser o documento rico do Mural; exige migrar os manuais existentes e trocar o `<Markdown>` pelo `RichTextView` | médio, e mexe em conteúdo publicado |

**Recomendo o primeiro.** O segundo troca o formato de armazenamento de um
conteúdo que a G&G já escreveu e revisou, para resolver um problema de entrada
— e a alternativa que o próprio documento aceita ("colagem a partir de arquivo
.docx ou .pdf com conversão automática") é a mesma conversão, só que num
importador. A conversão HTML→Markdown cobre o que o documento lista: títulos,
listas, numeração, negrito e quebras de parágrafo.

O reaproveitamento certo aqui é o **sanitizador** do `rich-text-dom.ts`, não o
editor inteiro: HTML colado de fora é entrada não confiável, e já existe uma
regra escrita para ela neste repo.

**O protótipo não ajuda aqui.** O `TextBlockEditor` do `block-editor.tsx` tem um
`onPaste`, mas ele só trata **imagem colada como arquivo**: procura no clipboard
um item `kind === 'file'` de tipo `image/`, sobe para o storage e insere um bloco
de imagem. `text/html` ele ignora, então colar Word lá entrega texto puro do
mesmo jeito. A recomendação acima não muda.

## B2 — Certificados num lugar só (seção 9.8)

> "As duas telas já existem e precisam apenas ser refinadas e unificadas."

Confere. Existem `CertificateTemplate` (+ visual por modelo), `CertificateRequest`
com `PENDING/APPROVED/REJECTED` e `Certificate` emitido com `code` único; as
telas são `CertificateTemplatesSection.tsx` e `CertificateRequestsSection.tsx`,
e o Lote A já ligou a solicitação ao fim do curso (9.3). As duas formas de
aprovação que o documento pede — anexar o PDF assinado ou gerar pelo modelo
padrão — também já existem, assim como o vínculo curso→modelo
(`Course.certificateTemplateId`, que cai no `isDefault` da empresa quando nulo).

Sobra, de fato:

- **A fila única.** Hoje o certificado de curso interno vem por
  `CertificateRequest` e o **externo entra por uma página do Notion**
  (Documento 3, seção 12) — fora do portal. Unificar é trazer o externo para a
  mesma fila, como uma origem diferente da mesma entidade.
- **Tirar os nomes fixos.** O texto da tela cita nominalmente quem recebe a
  notificação de nova solicitação; vira configuração por papel (os ADMIN do
  bloco de G&G), como o documento recomenda.

**Respondido: o Notion sai.** A G&G confirmou que o envio de certificado
externo passa a entrar pelo portal, e vai mandar as perguntas do formulário de
lá para serem remontadas aqui. Era a resposta barata das duas: sem o Notion, não
há integração entre sistemas — é um formulário a mais alimentando a fila que já
existe.

Então o externo vira uma **origem** de `CertificateRequest`, não uma entidade
nova: mesma fila, mesmas abas Pendentes/Emitidos/Rejeitados, mesma aprovação. O
que distingue os dois é de onde veio e o que cada um exige — o interno nasce de
um curso concluído (`courseId` preenchido, Lote A) e o externo nasce de um
upload com os campos do formulário antigo. Uma coluna de origem e um `courseId`
nulo dão conta; duas telas seriam de novo o problema que a seção 9.8 pede para
resolver.

### O formulário do Notion, campo a campo

A G&G mandou o formulário (anexo do Documento 4, "Envie Seu Certificado"). Ele
pede também **onde** a coisa mora, e isso separa dois lados:

- **Para o colaborador, são duas telas.** Uma página nova em Desenvolvimento ›
  Aprendizado, chamada **Envie seu Certificado**, para o externo; e a página de
  Cursos continua mostrando **só** os certificados emitidos pela EMR pelos
  treinamentos do portal.
- **Para o admin, é uma fila só.** É aqui que mora a unificação da 9.8 — não no
  lado de quem envia.

### E o lado do admin já está partido em dois

A G&G apontou isso olhando a tela de **Modelos de certificado**: *"se der, coloca
para a gente receber isso dentro dessa página? pra centralizar."*

Ela tem razão, e o problema é maior do que o pedido. Hoje o admin tem **duas
páginas** e **duas entradas de menu** para o mesmo assunto:

| Rota | Tela | Quem entra |
|---|---|---|
| `/admin/certificados/modelos` | `CertificateTemplatesSection` | ADMIN pleno (`StrictAdminOnly`) |
| `/admin/certificados/fila` | `CertificateRequestsSection` | ADMIN e SUBADMIN de G&G |

Então "unificar tudo em um lugar só" (9.8) não é só trazer o externo do Notion —
é juntar o que já está separado dentro do portal. Vira **uma** página
`/admin/certificados`, com abas: **Modelos** e **Fila** (e, dentro da fila, as
Pendentes/Emitidos/Rejeitados que já existem).

**A permissão sai da rota e vai para a aba, e isso não é detalhe.** As duas
entradas têm gates diferentes de propósito: modelo é documento da empresa toda e
o CRUD na API é `requireAdmin`; a fila segue o escopo do curso, e por isso o
SUBADMIN de G&G entra nela, restrito ao próprio setor pelo service. Juntar as
duas páginas sem mover o gate faria uma das duas coisas erradas — ou tranca o
subadmin fora da fila que ele usa hoje, ou mostra a aba de modelos para quem a
API vai recusar na hora de salvar. A aba de Modelos só aparece para ADMIN pleno;
a página em si segue no bloco de G&G.

O redirecionamento das duas rotas antigas fica: link salvo e favorito de quem já
usa a tela não podem quebrar por causa de uma reorganização de menu.

| Pergunta do formulário | Obrigatório | No portal |
|---|---|---|
| Nome Completo | sim | **não se pergunta** — é o usuário logado |
| Setor (12 opções) | sim | **não se pergunta** — `User.sectorId` |
| Nome do Curso/Treinamento | *(sem marca)* | campo novo, texto |
| Tipo do treinamento | sim | enum novo: `COMPLIANCE`, `TECNICO`, `COMPORTAMENTAL` |
| Responsável pelo pagamento | sim | enum: `GRATUITO`, `EMR`, `PROPRIO`, `OUTRO` + texto livre opcional |
| Valor investido pela EMR | não | opcional, só faz sentido quando o pagamento é `EMR` |
| Por que realizou (até 2) | sim | múltipla com **teto de 2**: iniciativa própria, solicitação do gestor, faz parte do PDI, obrigatório |
| Data da solicitação | não | data opcional — *ver ressalva abaixo* |
| Anexe o Certificado | sim | upload |

**Nome e Setor saem do formulário.** Um formulário do Notion tinha de perguntar
quem é a pessoa; dentro do portal, perguntar é pedir dado que o sistema já tem e
abrir caminho para divergir — a pessoa erra a escolha, ou muda de setor depois e
o pedido guarda o setor velho. E a lista de doze setores do formulário **já não
bate** com a da empresa: ela traz "Gente e Gestão" onde o cadastro tem `G&G`, e
não tem `Interno`, `Operações` nem `Receita`. Manter a pergunta seria manter uma
terceira lista de setores para desatualizar.

**Duas coisas para confirmar com a G&G, ambas do próprio formulário:**

1. **"Nome do Curso/Treinamento" ficou sem o asterisco**, mas é o único campo que
   identifica o certificado — sem ele o pedido chega anônimo na fila. Tratado
   como obrigatório, salvo objeção.
2. **"Caso positivo na pergunta anterior, qual foi a data da solicitação?" não
   fecha.** A pergunta anterior é "Por que você realizou esse curso?", que é
   múltipla escolha e não tem "positivo". Pelo texto, a data provavelmente se
   refere a **"Solicitação do gestor"**. Implementado assim, condicionado a essa
   opção — mas é chute com cara de certo, não certeza.

### O modelo precisa de migration, e não é só um formulário

Registrando uma imprecisão do commit anterior: eu disse que o externo seria "um
formulário a mais na fila que já existe". A fila existe, mas o modelo não aceita
o externo como está — `CertificateRequest` tem `enrollmentId` **obrigatório e
`@unique`** e `courseId` **obrigatório**, e certificado de fora não tem matrícula
nem curso no portal.

Então:

- `enrollmentId` e `courseId` viram **opcionais**. O `@unique` sobrevive: no
  Postgres, nulo não colide com nulo.
- Entra **`origin`** (`INTERNAL` / `EXTERNAL`) como coluna explícita, não
  derivada de `courseId IS NULL` — origem é o que a fila filtra e o que a tela
  rotula, e derivar isso de um campo nulo é a regra ficar escondida num `where`.
- Entram os campos do externo: nome do curso, tipo, pagamento (+ texto do
  "Outro"), valor, motivos e data da solicitação, mais a URL do anexo.

Continua sendo pequeno, e continua sendo **uma** fila — mas é migration, não só
tela.

### Como ficou, na implementação

**Aprovar um certificado externo não emite certificado.** O documento já foi
emitido por outra instituição; o portal valida que ele vale, e não cunha um
código nem se declara emissor do que não emitiu. É também o que mantém a
promessa da própria seção — na tela de Cursos só aparece o que a EMR emitiu. Por
isso `ApproveCertificateRequestResponse.certificate` passou a aceitar `null`.

**O recorte do SUBADMIN precisou de um segundo braço.** A fila sempre recortou
pelo setor do CURSO; no externo não há curso, então o setor sai de quem PEDIU —
o análogo natural e o único disponível. Sem isso, todo certificado externo
sumiria da fila do subadmin **em silêncio**, que é pior do que aparecer demais.

**O anexo é chave, não URL.** Certificado é documento pessoal: fica gravada a
chave no S3, sob `certificate-requests/<userId>/`, e a leitura sai como URL
assinada e temporária. O service confere o prefixo antes de gravar — sem isso,
alguém poderia mandar a chave do documento de outra pessoa e anexá-lo ao próprio
pedido (mesma guarda da reivindicação de selo).

**Os dois campos condicionais são descartados no servidor, não só escondidos na
tela.** Valor investido só quando quem pagou foi a EMR; data da solicitação só
quando o motivo inclui "Solicitação do gestor". Guardar fora disso seria gravar
número e data que nenhuma tela mostra.

**O anexo vai para o bucket público.** É onde `pdi-evidences/` já mora, então o
precedente é o mesmo tipo de documento pessoal; vale saber que é assim e não
descobrir depois. Chave por empresa, como as outras (`s3-client.ts`).

## B3 — Blocos empilháveis na aula (seção 9.1)

> "Não é possível colocar um texto e, logo abaixo, uma imagem — o editor aceita
> apenas um formato por aula."

Confere, e o modelo explica por quê: `CourseLessonType` tem **dois** valores
(`VIDEO`, `TEXT`), e a aula guarda um `videoUrl` e um `contentHtml`. Na tela, o
tipo escolhe qual campo aparece — vídeo mostra a URL e um "texto de apoio" de
duas linhas; texto mostra um `<textarea>` de cinco. É literalmente um formato
por aula.

O documento pede **catorze** tipos de bloco empilháveis em qualquer ordem:
Título · Texto · Checklist · Imagem · Vídeo · PDF · Destaque · Citação · Código ·
Divisor · Botão · Link externo · Anexo · Quiz.

Isso é uma lista de blocos por aula, com a aula deixando de ter conteúdo
próprio. Tabela (`CourseLessonBlock`) ou coluna `Json`? A fonte do protótipo
decidiu, e a decisão fecha esta seção. Três pontos que decidem o resto do
sub-lote:

1. **A migração dos dados.** Toda aula existente vira uma aula de um ou dois
   blocos: `videoUrl` → bloco Vídeo, `contentHtml` → bloco Texto. Sem isso o
   conteúdo já publicado some da tela do aluno, e é a parte que **não pode**
   ficar para depois.
2. **O bloco Quiz já tem dono.** `CourseQuiz` tem `lessonId @unique` e editor
   próprio (`CourseQuizEditor.tsx`). O bloco Quiz referencia esse registro, não
   duplica o modelo — senão passam a existir dois quizzes por aula, com notas
   diferentes.
3. **O bloco Texto é o mesmo problema do B1.** É por isso que a seção 6 está
   neste lote: resolver a entrada de texto rico duas vezes jogaria uma das duas
   fora. B1 sai primeiro e B3 usa o que ele deixou pronto.

**Os catorze blocos deixaram de ser risco.** A OBS da 9.1 oferecia prints ou
acesso ao protótipo; veio a fonte inteira, e com ela o payload de cada bloco
(`BLOCK_LIB`, em `block-editor.tsx`) e a renderização para o aluno
(`BlockRenderer.tsx`).

| Bloco | Rótulo | Payload |
|---|---|---|
| `heading` | Título | `level` (1–3), `text` |
| `text` | Texto | `text` |
| `checklist` | Checklist | `items[]` de `{ text, done }` |
| `image` | Imagem | `url`, `caption?` |
| `video` | Vídeo | `url`, `source` (`youtube`/`vimeo`/`loom`/`upload`) |
| `pdf` | PDF | `url`, `title?` |
| `callout` | Destaque | `text`, `tone` (`info`/`success`/`warning`/`danger`) |
| `quote` | Citação | `text`, `author?` |
| `code` | Código | `code`, `language?` |
| `divider` | Divisor | — |
| `button` | Botão | `label`, `url` |
| `link` | Link externo | `url`, `title`, `description?` |
| `attachment` | Anexo | `url`, `name` |
| `quiz` | Quiz | `quizId` |

As três ambiguidades que mais custariam retrabalho, resolvidas:

- **Botão e Link externo não são a mesma coisa.** Botão é chamada para ação —
  `label` + `url`, renderizado como botão. Link externo é card de preview, com
  título, URL e descrição opcional.
- **Destaque é callout com tom**, não card: quatro tons, cada um com ícone e cor
  no renderer (💡 Info, ✅ Sucesso, ⚠️ Atenção, 🔥 Cuidado).
- **O bloco Quiz guarda só o `quizId`**, com um select dos quizzes do curso —
  que é exatamente o ponto 2 acima, agora confirmado pela fonte.

Dois detalhes que a fonte entrega e o documento não menciona:

- Existe um tipo `audio` no union, com renderer (`<audio controls>`), mas **fora
  do `BLOCK_LIB`**: dá para renderizar, não dá para criar. Criáveis são catorze,
  batendo com o documento. Não implementar o `audio` sem pedir — ou é resíduo,
  ou é um pedido que não chegou.
- O editor do bloco Texto sobe **imagem colada** e insere um bloco de imagem
  logo abaixo. É ganho barato e vale copiar; não confundir com o B1, que é outro
  problema.

**O armazenamento da fonte diverge da proposta acima, e vale seguir o dela.** O
protótipo guarda `course_lessons.content_blocks jsonb` — um array na própria
aula —, não uma tabela por bloco. O array simplifica a reordenação (o `dnd-kit`
reordena em memória e salva a aula inteira) e evita uma tabela cujo `payload`
seria `Json` de qualquer jeito. O que a tabela daria a mais é consulta por tipo
de bloco, e a única que existe é a do quiz — que continua em `CourseQuiz`,
tabela própria, nos dois desenhos.

Então: **`CourseLesson.contentBlocks Json @default("[]")`**, e a migração do
ponto 1 vira um `UPDATE` que monta o array a partir de `videoUrl` e
`contentHtml`, em vez de inserir linhas numa tabela nova.

## B4 — Catálogo: categorias, competências e instrutores (9.6 abas, 9.7)

Três abas do protótipo que hoje são **texto livre na tabela de curso**:

| O que a tela pede | Como está hoje | O que entra |
|---|---|---|
| Aba Categorias, com subcategoria, ícone emoji e categoria raiz | `Course.category` é `String` | `CourseCategory` (`name`, `slug`, `icon`, `parentId`, `order`, `active`, `companyId`) |
| Aba Competências, com nome, ícone e descrição | `Course.competencies` é `Json` de strings | `Competency` (`name`, `icon`, `description`, `companyId`) + tabela de ligação |
| Instrutores, com nome, e-mail, foto, bio e expertise | `Course.instructorName` / `instructorBio`, texto solto | `Instructor` (`userId?`, `name`, `email`, `photoUrl`, `bio`, `expertise`) + N:N com curso |

Três regras do repo valem aqui, e não são detalhe:

- **Slug único por empresa**, não na instância: `@@unique([companyId, slug])`,
  como `Badge.slug`, `Sector.slug` e o `BadgeCategory` do Lote D. É a regra para
  model tenant-scoped.
- **Desativa-se, não se apaga** — categoria com curso atrás não pode sumir.
- **Instrutor interno não duplica cadastro.** A 9.7 pede que nome e área venham
  da base de colaboradores quando o instrutor for da EMR: `Instructor.userId`
  aponta para `User` e os campos viram derivados; externo preenche na mão. E
  **mais de um instrutor por curso**, que é o que obriga o N:N.

**A fonte confirma o desenho, com os campos.** `course_categories` tem
`parent_id` — a subcategoria que a 9.6 pede —, mais `icon` e `sort_order`;
`course_competencies` tem `name`, `description` e `icon`; e `course_instructors`
tem `user_id` **opcional**, que é literalmente o "interno puxa da base, externo
preenche na mão". A única coisa a não copiar é o N:N: lá é um
`courses.instructors uuid[]`, e array de FK não tem integridade referencial —
aqui é tabela de ligação.

**Decisão pendente com a G&G** (marcada no documento): as competências da 9.6
convergem com as categorias de reconhecimento do Mural (Documento 2, 3.2)?

**A recomendação é manter separado**, e é o mesmo argumento do Lote D. A
`RecognitionCategory` é o catálogo de **feedback** da empresa, e `Badge.categorySlug`
já a referencia por slug — fundir faria um curso de "Liderança" contar como
categoria de feedback "Liderança", que pode nem existir na empresa. São dois
catálogos com o mesmo tipo de nome, como `BadgeCategory` e `RecognitionCategory`
já são desde D.

## B5 — Público-alvo e matrícula automática (seção 9.2)

> "Não há como restringir um curso por área, setor ou tipo de público."

Parcialmente. `Course.sectorId` já restringe a **um** setor (nulo = empresa
toda) e `Course.mandatory` já existe — o toggle "Curso obrigatório" que o
documento pede está pronto, e o Lote C já conta em cima dele. Falta:

- **Escopo com mais de um setor** e com **cargos**. O cargo mudou de desenho
  depois da resposta da G&G — ver "O cargo são dois campos", logo abaixo.
- **"Público-alvo" e "Recomendado para"** (Todos, Novos colaboradores, Líderes):
  são rótulos de recomendação, não de acesso. Não confundir com escopo — um
  curso "recomendado para líderes" continua visível para todos. Na fonte são
  `target_audience` (texto) e `recommended_for` (lista), guardados **fora** do
  `visibility` justamente por isso.
- **Regras de matrícula automática**: quem tem certos atributos de setor e cargo
  é inscrito sozinho. É a única parte com efeito de escrita em massa —
  `CourseEnrollment` para gente que não pediu — e por isso precisa ser
  idempotente e rodar em lote, não numa transação só (a importação de Lendas em
  HML já ensinou que transação longa estoura).

A OBS da seção fecha a questão da fonte: setor, cargo e tags vêm da base de
colaboradores do Documento 3, sem cadastro paralelo.

### O cargo são cinco campos, e o portal importa um

Este spec começou com uma pergunta em aberto — segmentar por `User.position`,
que é texto livre, ou esperar um cadastro de cargo? A G&G respondeu mandando a
planilha (`BI Dashboard Colaboradores 2026`, aba Colaboradores, 121 linhas). Ela
não tem uma coluna de cargo: tem **cinco**, e o portal importa uma.

| Coluna na planilha | Distintos | Exemplos | No portal hoje |
|---|---|---|---|
| **Cargo** (12ª) | 80 | `Analista de CRM`, `Assistente de Edição` | `User.position` |
| Nível (13ª) | 10 | `I`…`X`, `Não Aplicável` | — |
| Senioridade (14ª) | 4 | `Júnior`, `Pleno`, `Sênior`, `Não Aplicável` | — |
| Função (15ª) | 2 | `Colaborador` (91), `Líder` (30) | — |
| **Cargo** (16ª) | **12** | `Analista`, `Especialista`, `Assistente`… | — |
| Tags (Público-Alvo) (17ª) | 23 | `Todos`, `Analista`, `Líder`, `Mãe` | — |

A lista fixa que a G&G descreveu é a **16ª coluna**, e ela está completa:

| | | | |
|---|---|---|---|
| Analista (51) | Especialista (20) | Assistente (15) | Diretor (6) |
| Gerente (6) | Team Leader (6) | Head (5) | Coordenador (4) |
| Supervisor (3) | Jovem Aprendiz (3) | Técnico (1) | Auxiliar (1) |

**Ela não é derivável do título, e é por isso que precisa ser importada.** A
tentação seria tirar a categoria da primeira palavra do cargo; não funciona em
**23 dos 80** títulos, incluindo o maior grupo da empresa:

| Título | Categoria | Pessoas |
|---|---|---|
| `Desenvolvedor(a)` | Analista | 14 |
| `Tech Lead` | Team Leader | 3 |
| `Consultor(a) Comercial` | Analista | 3 |
| `Product Manager` / `Product Designer` | Analista | 2 cada |
| `CAO` | Diretor | 1 |

Quatorze desenvolvedores classificados como Analista é exatamente o caso que
derivação nenhuma acerta: a categoria é decisão de RH, não morfologia do título.

Então:

- **`User.position` fica como está**: título completo, é o que aparece no perfil
  e no organograma. Nada a migrar.
- **Entra um campo novo com a lista fechada de doze**, importado da 16ª coluna.
  É ele que o escopo de curso e as regras de matrícula automática usam — e o
  seed já está aqui, não falta mais insumo.
- **Nível, Senioridade e Função não entram.** O Documento 4 não os pede, e a
  Função (`Colaborador`/`Líder`) seria uma segunda verdade sobre liderança: quem
  lidera quem é `User.managerId`, fonte única do organograma e do escopo da
  Liderança. Duas fontes divergem no primeiro remanejamento.

**O cabeçalho precisa mudar, e a importação avisa.** Na planilha as duas colunas
se chamam literalmente `Cargo`, e o nosso template já usa esse nome para o
título completo (`user-import.ts`, aliases `posicao`/`position`). Importar esse
arquivo hoje **falha com erro claro** — `mapHeaders` recusa cabeçalho repetido
com *“A coluna «Cargo» aparece duas vezes na planilha”* (400). Não há risco de
sobrescrita silenciosa; há uma importação que não roda até alguém renomear. O
campo novo entra com nome próprio — **`Categoria do cargo`**, decidido com a
G&G — e a planilha acompanha na próxima carga.

### A planilha já tem o público-alvo, e ele já tem casa no produto

A 17ª coluna, `Tags (Público-Alvo)`, é literalmente o que a 9.2 pede, preenchida
para as 121 linhas. E não é conceito novo aqui: `viewerAudienceTags`
(`packages/shared/src/calendar-event.ts`) já existe, já alimenta o público-alvo
dos eventos do calendário, e o comentário dela diz o que a planilha confirma —
"é o ponto de encontro entre o público-alvo do evento e a planilha de
colaboradores". Até o valor universal bate: `CALENDAR_AUDIENCE_ALL` é `'Todos'`,
e `Todos` está nas 121 linhas.

A diferença é que hoje as tags são **derivadas** (setor, `G&G`, `Líder`, `CEO`),
nunca guardadas — o `CollaboratorsSection.tsx` documenta isso na coluna que
exibe. A planilha traz tags que não dá para derivar de nada: `Comitê` (14),
`BP`, `Culture`, `CPO`.

**Público-alvo é um vocabulário só.** Curso e evento têm de falar de "Líder"
com o mesmo significado — é o mesmo argumento do B4 sobre catálogo. Mas "usar as
tags" não quer dizer importar a coluna inteira, e olhar o conteúdo dela explica
por quê.

**Tirando as pessoais, quase tudo que sobra já é outra coisa que o portal sabe.**
Das 23 tags, onze repetem um valor da coluna `Categoria do cargo` (`Analista`,
`Especialista`, `Head`, `Gerente`…) e três são derivadas hoje sem nenhum dado
novo: `Todos` é o `CALENDAR_AUDIENCE_ALL`, `Líder` (32) sai de `managerId` e
`CEO` sai do cargo. O que **só** existe nesta coluna é pouco e específico:

| Tag | Pessoas |
|---|---|
| `Comitê` | 14 |
| `CPO`, `CRO`, `Culture`, `BP` | 1 cada |

**E a parte repetida está desatualizada.** Em **14 das 121 linhas** a tag de
papel discorda da coluna de categoria, sempre no mesmo sentido — a tag guarda
uma granularidade diferente:

| Categoria | Tag que a pessoa carrega |
|---|---|
| `Diretor` | `CEO`, `CPO` ou `Head` (o papel real, não a faixa) |
| `Team Leader` | `Analista` (2 pessoas) |
| `Especialista` | `Gerente` |
| `Analista` | nenhuma tag de papel, só `Todos` |

Um Team Leader marcado como `Analista` é o caso que decide o desenho: um curso
segmentado para Team Leader não chegaria nele, e um para Analista chegaria.

**A G&G arbitrou: o cargo é que vale.** Onde a tag discorda da `Categoria do
cargo`, é a tag que está atrasada — não é intenção editorial. As catorze linhas
divergentes são manutenção manual pendente da planilha, e nenhuma delas precisa
ser resolvida antes de implementar.

**Então a tag repetida não é importada, é derivada.** A `Categoria do cargo` é o
fato, mantido por validação de dados na planilha; `Todos`, `Líder` e `CEO`
continuam saindo do `viewerAudienceTags`, que já os deriva. Importadas mesmo,
só as tags que carregam informação que nada mais tem — `Comitê`, `CPO`, `CRO`,
`Culture` e `BP`, dezenove pessoas ao todo.

Com isso as onze tags que divergiam deixam de existir como segunda fonte: elas
passam a sair do cargo, que é quem manda, e param de poder discordar dele. A
única lista mantida à mão é a das cinco que ninguém mais sabe — e ela é curta o
bastante para não repetir esse problema.

**As tags pessoais ficam de fora — decidido com a G&G.** `Mulher` (63), `Homem`
(56), `Mãe` (24) e `Pai` (13) não entram nesta rodada. Para comunicado há uso
óbvio (Dia das Mães, benefício de parentalidade), mas matrícula automática por
atributo pessoal inscreve gente sem ela pedir, e ninguém pediu isso ainda.
Voltam quando alguém pedir nomeando o uso — e `Sexo` já é coluna à parte na
planilha, então o dado não se perde por não estar aqui.

**Consequência fora deste lote**: o filtro de Cargo do Lote C
(`training-analytics-service.ts`) hoje se alimenta dos 80 valores distintos em
uso — um seletor com quase uma opção por pessoa. Quando a categoria existir, é
por ela que aquele filtro deveria recortar. Não é trabalho deste sub-lote, mas é
dele que a oportunidade nasce.

## B6 — Central de Cursos: dashboard, listagem e wizard (9.6, o resto)

O maior, e o que só faz sentido depois dos outros — o wizard de três passos é
onde categorias (B4), instrutores (B4), público-alvo (B5) e módulos com blocos
(B3) aparecem juntos.

**Dashboard.** Cards de Total, Publicados, Rascunhos, Em revisão, Alunos
inscritos, Taxa média de conclusão, Horas ofertadas e Avaliação média; mais
"Cursos mais acessados", "Cursos com maior abandono" e distribuição por status.
Boa parte disso o Lote C já sabe calcular (`training-analytics-service.ts` já
faz conclusões por setor e top de cursos) — **reusar o service, não escrever o
segundo**, ou os dois números divergem no primeiro ajuste, que é exatamente o
motivo de "Telas mais acessadas" não ter sido duplicado no Lote C.

**Status é troca de modelo, não rótulo.** Hoje `Course.published` é um booleano.
O protótipo tem cinco estados, e o documento manda padronizá-los em português:
Rascunho, Em revisão, Aguardando Aprovação, Publicado e Arquivado. Vira enum
`CourseStatus`, com `published` derivado dele na leitura para não quebrar as
telas do aluno de uma vez.

Os valores da fonte são `draft`, `review`, `pending_approval`, `published` e
`archived`, com `published_at` e `archived_at` ao lado. E o "ATENÇÃO" do
documento se confirma na origem: o `status-pill.tsx` do protótipo só traduz
`draft` e `published` — os outros três caem no fallback e aparecem crus na tela.
A padronização em português é trabalho nosso, não cópia.

**Recompensas por curso.** A 9.6 pede 25 pontos e 10 EMR Coins por padrão,
definidos **por curso**. Hoje não existe: concluir curso rende **selo**
(`syncCourseBadgesForUser`), e é o selo que carrega ponto e moeda. Recompensa
direta por curso é conceito novo, e a OBS do documento amarra o que ela exige —
qualquer valor definido aqui tem de aparecer no Manual do Game e no extrato do
colaborador. Na fonte isso é `courses.reward_points` com default 25 e
`courses.reward_coins` com default 10 — o padrão que o documento cita é default
de coluna, não constante de código, então cada curso já nasce com o valor
editável.

**Identidade visual (passo 2)** — capa, banner, vídeo de apresentação, ícone
emoji e cor principal com prévia — é a parte mais barata: só campos novos em
`Course` e uma prévia que reusa o card que já existe. Os campos, na fonte:
`banner_url`, `intro_video_url`, `icon` e `primary_color`, ao lado do
`cover_url` que já temos.

---

## O que não entra

- **Conteúdo dos manuais** (seção 6, tabela de status): é material que a G&G vai
  buscar, não código.
- **Seções 3, 4 e 14** (travamento do avatar sem repro, férias pela ferramenta
  oficial e a calculadora "Todos pelos 9"): seguem bloqueadas por material que
  está num `.zip` no Teams ou sem reprodução.
- **Versionamento e comentários de curso.** A fonte tem `course_versions`,
  `publish-workflow.tsx` e `comments-panel.tsx`, e nada disso está no Documento
  4. Ficam de fora até alguém pedir: copiar o protótipo inteiro porque ele está
  disponível é exatamente como o escopo dobra.

## Não falta mais nada da G&G

As três perguntas que travavam sub-lotes foram respondidas — a dos catorze
blocos pela fonte do protótipo, o Notion e o cargo pela G&G —, e os dois insumos
que faltavam chegaram: a planilha de colaboradores fechou o B5 e o formulário do
Notion fechou o B2.

Sobram duas confirmações pequenas, as duas sobre o próprio formulário do Notion
(o asterisco que falta no nome do curso e o "caso positivo" que não fecha). Nenhuma
trava implementação: as duas têm leitura provável e estão registradas no B2.

**Ordem recomendada: B3 e B4 primeiro.** B3 era o maior risco do Documento 4 e
deixou de ser — os catorze blocos estão especificados campo a campo — e é
pré-requisito do B6. B4 não depende de nada e é o que destrava o B5. O B1
continua pequeno e independente; de preferência antes do B3, porque o bloco
Texto herda o que ele resolver. B2 pode andar em paralelo a qualquer um deles.
