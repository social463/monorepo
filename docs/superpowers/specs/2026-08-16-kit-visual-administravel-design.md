# Kit visual administrável

## Problema

A aba **Kit visual** (`/cultura?aba=kit-visual`) mostra hoje só o que o branding
do SUPER_ADMIN já traz: logos claro/escuro e as cores da marca. É útil, mas é o
mínimo — e não é o que o time de comunicação precisa distribuir.

O protótipo do portal (`portal-emr-source-v2`) resolve isso em
`src/routes/app.kit-visual.tsx`: três cards com imagem grande, título, medida e
botão de baixar — banner de LinkedIn (1584 × 396), logotipo e fundo virtual de
reunião (1920 × 1080). O problema é que lá está tudo **cravado no código**: peça
nova exige deploy, e quem cuida da marca não mexe em `.tsx`.

O resultado é o de sempre: a arte circula por link do Drive, alguém recorta o
logo de um print, e o kit oficial fica desatualizado.

## Entrega

As peças do kit passam a ser **conteúdo**, publicado por quem cuida da marca:
imagem, título, descrição, nome do arquivo no download, enquadramento no card,
publicado/rascunho e ordem. Mais um texto livre em Markdown no topo da aba, para
as regras de uso.

Quem publica: **ADMIN global sempre, ou SUBADMIN do setor com `gente-gestao`** —
`requireSectorFeature('gente-gestao')`, o mesmo guarda de Manuais e Benefícios.
Não é `requireFeature`, que liberaria todo ADMIN e todo SUBADMIN de qualquer
setor.

Quem lê: **todo mundo logado**, sem feature nenhuma, como Manifesto e
Benefícios. São os arquivos oficiais da marca — restringir a leitura é garantir
que alguém vá recortar o logo de um print, que é o que o kit existe para evitar.

## Decisões

### Uma imagem por peça — ela é o preview E o download

Não há "imagem de preview" e "arquivo para baixar" separados. O que se distribui
aqui **é** a imagem, e o card mostra exatamente o que a pessoa vai receber.
`storageKey` é obrigatório: peça sem imagem não existe.

Isso separa a peça do `CultureManual`, cujo PDF é um **anexo** de um card que
existe sem ele — e por isso lá o arquivo é opcional e o download passa por rota
autenticada com link assinado.

### As duas fontes da aba não se misturam

**Logos e cores** continuam vindo do branding do SUPER_ADMIN. São o que o produto
usa para se pintar; duplicá-las como peça administrável deixaria a aba discordar
do app que está em volta dela. **As peças** vêm do banco e são de quem cuida da
comunicação — arte que o produto não consome e que muda o tempo todo.

Por isso a tela de administração diz isso em voz alta: logo e cor não se editam
por lá.

### Prefixo público no S3, ao contrário do manual

`visual-assets/<companyId>/<uuid>.<ext>`, servido pela base pública. O card
precisa exibir a imagem, e um link assinado por card significaria uma ida extra
ao servidor para cada peça só para desenhar a tela. Manual interno é o oposto: é
documento operacional, e o download dele passa por `/culture/manuals/:id/download`.

A chave nasce **sempre no servidor**, no presign. E o service ainda confere o
prefixo antes de gravar (`assertOwnKey`): sem isso um POST direto apontaria a peça
para o objeto de outro tenant, e ela apareceria no kit de quem não a enviou —
mesma defesa que `challenge-service` faz na evidência de desafio.

### `fit` no banco, não deduzido da imagem

`COVER` recorta para preencher (banner, fundo — arte que sangra); `CONTAIN`
mostra a peça inteira com respiro (logo, selo). É escolha de quem publica, não
algo a inferir da proporção do arquivo: um selo quadrado e um avatar quadrado
pedem enquadramentos opostos.

`CONTAIN` desenha sobre fundo branco fixo, e não sobre a `surface` do tema —
peça de fundo transparente feita para o claro sumiria no escuro, e o kit existe
justamente para a pessoa ver o arquivo como ele é.

### O texto reaproveita `CulturePage`, e o editor virou genérico

O schema já dizia, desde o manifesto: *"Genérica de propósito: kit visual e
galeria entram como novos slugs"*. Então `kit-visual` entra como slug, sem model
novo.

O que faltava era o front acompanhar: `ManifestoSection` tinha o slug cravado e
147 linhas de editor. Elas viraram `CulturePageEditor`, parametrizado por slug, e
`ManifestoSection` virou um wrapper. As mensagens ("Manifesto salvo.") ficaram
explícitas por conteúdo em vez de costuradas a partir do nome — em português o
artigo e o gênero mudam, e frase montada sai errada em metade dos casos.

## Limites conhecidos

- **Sem S3 configurado, `imageUrl` vem vazia** e o card mostra "Imagem
  indisponível" em vez de um quadrado quebrado, sem botão de baixar. Mesmo
  comportamento de `toEventPhotoDTO`.
- **Apagar a peça remove o objeto do S3 best-effort**, depois do banco. O pior
  caso é um objeto órfão no bucket — nunca um card fantasma na tela, que é o que
  a ordem inversa produziria.
- **Trocar a imagem de uma peça não apaga a anterior** do bucket. O PATCH só
  reaponta a chave; limpar o objeto antigo exigiria saber que ninguém mais o
  referencia, e não vale a complexidade agora.
- **Sem galeria por categoria.** As peças são uma lista ordenada só. Agrupar em
  seções (Logos, Redes sociais, Reuniões) entra quando o volume pedir.

---

# Adendo — materiais por pessoa

## Problema

O kit resolve o que é de todo mundo. Falta o que é **de uma pessoa**: as fotos
que ela recebeu do ensaio, um certificado, uma carta. Hoje isso vai por e-mail ou
link do Drive, some na caixa de entrada e ninguém sabe mais onde está.

## Por que não é uma coluna a mais na peça global

A tentação óbvia é `recipientId` opcional em `CultureVisualAsset`. Não dá, e o
motivo não é organizacional — é de segurança:

| | Peça global | Material pessoal |
|---|---|---|
| Prefixo no S3 | público (`visual-assets/`) | privado (`personal-assets/`) |
| No DTO | `imageUrl` **durável** | link assinado, expira em minutos |
| Quem lê | todo mundo logado | destinatário + quem administra Cultura |
| Download | `<a href download>` | rota autenticada que reconfere quem pede |

Na mesma tabela, um `recipientId` esquecido ou um `published` errado publicaria a
foto de alguém num endereço público — e URL vazada não se revoga. São tabelas
separadas, prefixos separados e serializadores separados: o caminho errado não
existe, em vez de existir e depender de um `if`.

## Como o acesso é provado

A chave nasce no presign e é **namespeada pelo destinatário**
(`personal-assets/<companyId>/<recipientId>/<uuid>.<ext>`). Na hora de gravar, o
service confere que a chave começa com o prefixo daquele destinatário — sem isso
um POST direto anexaria à Ana um objeto enviado para o Bruno.

A leitura do colaborador (`GET /culture/personal-assets`) **não aceita parâmetro
de pessoa**: o recorte é o `sub` do token. Não há como pedir o material de um
colega porque não há onde escrever o id dele.

O download responde **404, não 403**, para quem não pode — a existência de um
material dirigido a alguém já é informação sobre essa pessoa.

Na auditoria vai só metadado (título, destinatário, nome do arquivo). O log é
lido por quem audita, e o conteúdo é de uma pessoa só.

## O que o código NÃO garante

O prefixo `personal-assets/` só é privado se a **policy do bucket** disser que é.
O código nunca serializa URL durável para ele, mas não consegue impedir que uma
policy pública-bucket-wide sirva o objeto direto. Isso já vale hoje para
`manuals/`, `challenges/` e as evidências de PDI — e o plano de Cultura já tinha
deixado a pergunta em aberto (`2026-07-30-03-cultura.md:84`).

**Antes de subir isto para produção, confirme que o bucket não é público
bucket-wide.** Se for, a correção é a mesma para todos os prefixos privados e é
tarefa de infra, não de código.

## Limites conhecidos

- **Um destinatário por material.** Mandar a mesma arte para três pessoas são
  três envios. Uma tabela de ligação entraria se o volume pedir.
- **Editar não troca o destinatário** — só título e descrição. A chave mora na
  pasta de quem recebe; reapontar deixaria o arquivo guardado no lugar errado.
  Entregar para outra pessoa é um envio novo.
- **O destinatário não apaga o que recebeu.** A entrega é de quem publica.
- **Sem aviso ao destinatário.** Quem recebe descobre ao abrir a aba; notificação
  in-app é um passo separado.
