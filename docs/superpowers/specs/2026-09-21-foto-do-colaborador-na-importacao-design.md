# Foto do colaborador pela planilha — design

Data: 2026-09-21

## Problema

Quem entra no Legends pela importação por planilha (Administração › Organização ›
Lendas) nasce **sem foto**: o `Avatar` cai no personagem LPC ou nas iniciais até
alguém abrir o cadastro de cada pessoa e subir a imagem à mão. Numa carga de 100
linhas isso é 100 uploads manuais, e na prática ninguém faz — a plataforma inteira
fica com gente sem rosto.

A planilha da G&G **já tem** a foto de cada colaborador, como link do Google
Drive. O que faltava era o sistema ler essa coluna.

## Decisões

### A coluna é `Foto (URL)`, no fim do template

Anexar no fim, como `Categoria do cargo`: o casamento é por nome de cabeçalho,
então a posição não muda comportamento — mas inserir no meio embaralharia a ordem
que quem já baixou o modelo conhece. Aliases: `foto`, `link da foto`, `url da
foto`, `imagem`, `avatar`.

**Célula vazia mantém a foto gravada.** Mesma regra do Tipo de contrato: foto some
por ação explícita em Administração › Lendas, nunca por uma coluna que faltou numa
carga de 100 linhas. **Célula preenchida substitui** a foto existente, inclusive a
que um admin subiu à mão — a planilha é a fonte do cadastro, e é por ela que a G&G
corrige uma foto errada.

### O link do Drive é normalizado, porque ele não é uma imagem

`https://drive.google.com/file/d/<id>/view` é uma PÁGINA. Colado num `<img src>`
não renderiza nada, e guardá-lo cru deixaria o avatar quebrado sem erro visível em
lugar nenhum. `normalizePhotoSourceUrl` (`apps/api/src/lib/photo-mirror.ts`)
extrai o id das formas que o Drive gera (`/file/d/<id>/…`, `?id=<id>`) e monta a
URL de conteúdo `/thumbnail?id=<id>&sz=w800`. URL que já aponta para a imagem
passa inteira; o que não é http(s) vira **erro de linha**, no preview.

### A imagem é espelhada no nosso bucket, não linkada

Guardar o link do Drive no `photoUrl` faria o rosto de todo mundo depender da
permissão de um arquivo que a G&G pode mover, renomear ou fechar — e ele sumiria
da plataforma sem ninguém entender por quê. Então o commit **baixa e re-hospeda**
(`putS3Object`), na mesma casa das fotos subidas à mão.

A chave carrega o **sha256 da URL de origem**
(`photo-imports/<companyId>/<hash>.<ext>`). É isso que torna a reimportação
idempotente sem coluna nova no banco: se o `photoUrl` gravado já é o espelho
daquela origem, a linha sai `UNCHANGED` e nada é baixado de novo. Consequência
aceita: foto trocada no Drive **mantendo a mesma URL** não é reimportada — trocar
a foto normalmente gera link novo.

### O download é antes da transação, e falha é aviso

Pelo mesmo motivo do bcrypt: são chamadas de rede a um servidor de terceiro, e 200
delas dentro da transação estourariam o timeout com o banco travado esperando o
Google.

Falha **não bloqueia a carga**. O caso comum é link do Drive que exige login, e
travar o cadastro de 100 pessoas por causa de uma permissão de arquivo seria
desproporcional: a linha entra sem mexer na foto e o resultado lista quais
falharam (`photoWarnings`). O Drive responde **200 com HTML** nesse caso, então a
checagem de content-type não é zelo — sem ela, uma página de login viraria a foto
de alguém.

Sem S3 configurado (dev sem bucket), o espelho degrada para a própria URL de
origem — o mesmo degrade do `PhotoUploadField`, que some quando `/uploads/config`
vem desabilitado. Melhor a foto do Drive do que nenhuma foto.

## O que NÃO mudou

- **O `Avatar` não foi tocado.** Ele já resolve `photoUrl` → personagem LPC →
  iniciais; preencher o campo bastou para o ícone virar o rosto em toda a
  plataforma.
- **O export CSV de Lendas continua sem a coluna.** Ele já é um subconjunto
  deliberado do template (não tem Categoria do cargo nem Tipo de contrato).
- **Nenhuma migration.** `User.photoUrl` já existia.

## Arquivos

- `packages/shared/src/user-import.ts` — coluna, aliases, `photosImported` e
  `photoWarnings` no `UserImportResultDTO`
- `apps/api/src/lib/photo-mirror.ts` (+ teste) — normalização e espelho
- `apps/api/src/services/user-import-service.ts` — parse, diff e gravação
- `apps/web/src/pages/admin/UserImportDialog.tsx` — ajuda da coluna e resultado
