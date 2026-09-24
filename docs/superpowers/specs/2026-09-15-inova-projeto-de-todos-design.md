# Comunidade INOVA — cadastrar é de todos, e dá para excluir

## Por que

O spec de 2026-09-03 copiou a régua da ferramenta original: criar, editar e
mudar de fase eram de `ADMIN`/`SUBADMIN`. Na prática, quem tem a ideia é quem
está no problema, e o próprio formulário de cadastro já dizia o contrário —
"cada projeto pode ter até dois responsáveis, que serão **os donos da
iniciativa e responsáveis por atualizar o andamento**". O dono não tinha como
atualizar nada.

Faltava também **excluir**: projeto, entrada do diário e tarefa só entravam. O
arquivamento resolve tirar do quadro, não o engano (projeto de teste, entrada
duplicada, tarefa criada no projeto errado).

## Regra

Uma função em `@legends/shared` (`canManageInovaProject`) é a fonte única do
front e da API — a tela esconde exatamente o que a rota recusaria.

| Ação | Quem pode |
|---|---|
| Ver projetos, diário, tarefas | qualquer colaborador |
| **Cadastrar projeto** | qualquer colaborador |
| Editar projeto, mudar de fase | quem administra **ou** o dono (quem criou e os dois responsáveis) |
| **Excluir projeto** | quem administra **ou** o dono |
| Escrever no diário, criar tarefa | qualquer colaborador (como já era) |
| **Excluir entrada do diário** | quem escreveu, o dono do projeto ou quem administra |
| **Excluir tarefa** | o dono do projeto ou quem administra |
| Prioridade e arquivamento | só quem administra |

Duas decisões que se pagam ao mexer:

- **Prioridade e arquivamento não são edição, são curadoria.** O dono conta a
  história do próprio projeto; quem destaca no quadro e quem tira de circulação
  é quem administra o programa. Por isso `updateInovaProject` recusa `priority`
  e `archived` de quem não administra, mesmo sendo dono — a trava é no service,
  não na rota, porque a rota não sabe quem é dono da linha.
- **Excluir tarefa não tem "autor".** `InovaProjectTask` não guarda quem criou
  (`responsible` é texto livre, não usuário), diferente de `InovaDiaryEntry`,
  que tem `createdById`. Então a tarefa segue a régua do projeto. Se um dia a
  tarefa passar a guardar o criador, vale abrir para ele, como no diário.

## Exclusão é exclusão

`DELETE /inova/projects/:id` apaga de verdade: diário, tarefas, histórico de
fase e atividade vão junto pela cascata que já existia no schema
(`onDelete: Cascade`). Não é arquivamento e não tem desfazer — o front confirma
antes (`window.confirm`, como no resto do produto). Apagar entrada e tarefa
grava `InovaActivity` (`DIARY_ENTRY_DELETED`, `TASK_DELETED`), que é o que
mantém a linha do tempo do projeto honesta; a exclusão do projeto não grava
nada, porque não sobra projeto onde gravar.

## Rotas

```
POST   /inova/projects            → authenticate            (era requireAdminOrSubadmin)
PATCH  /inova/projects/:id        → authenticate + dono     (era requireAdminOrSubadmin)
PATCH  /inova/projects/:id/phase  → authenticate + dono     (era requireAdminOrSubadmin)
DELETE /inova/projects/:id        → authenticate + dono     (nova)
DELETE /inova/diary/:entryId      → authenticate + autor/dono (nova)
DELETE /inova/tasks/:id           → authenticate + dono     (nova)
```

O painel administrativo e o chat de IA continuam em `requireAdminOrSubadmin`:
são leitura agregada do programa, não do projeto.

## Front

- `InovaLayout`: a aba "Criar projeto" deixa de ser escondida.
- `ComunidadeInovaPage`: "Novo projeto" aparece para todos; o botão de
  prioridade continua só para quem administra (`podeCurar`).
- `InovaProjectDetailPage`: seletor de fase, "Editar" e "Excluir projeto"
  aparecem para o dono; cada entrada do diário e cada tarefa ganham o botão de
  excluir para quem pode.
- `InovaProjectFormPage`: em modo edição, quem não é dono volta para o detalhe.
