# Super admin — gerenciar as contas ADMIN de cada empresa

**Data:** 2026-08-05
**Status:** aprovado

## Problema

O super admin cria uma empresa junto com o **primeiro** ADMIN
(`POST /super-admin/companies`) e nunca mais toca nessas contas. Depois disso:

- Não há como cadastrar um segundo administrador para a empresa.
- Não há como corrigir nome ou e-mail digitado errado no cadastro inicial.
- Não há como redefinir a senha de um admin que perdeu o acesso — o caminho hoje
  é `UPDATE` na mão no banco (foi o que aconteceu nesta base).
- Não há como cortar o acesso de um admin que saiu da empresa cliente.

A empresa em si já é editável (nome e `active`, na listagem). O buraco é só nas
**contas**.

## Decisão

Quatro rotas novas sob `/super-admin/companies/:id/admins`, e um painel
**Administradores** na página de detalhe da empresa
(`/super-admin/companies/:id`), que hoje só mostra métricas.

| Método | Rota | Efeito |
|---|---|---|
| `GET` | `/admins` | Lista os ADMIN da empresa, **inclusive inativos** |
| `POST` | `/admins` | Cria ADMIN novo na empresa |
| `PATCH` | `/admins/:userId` | Nome, e-mail, senha e/ou `active` |
| `DELETE` | `/admins/:userId` | Remove (= desativa) |

### Remover é desativar, não apagar

`DELETE` grava `active: false`. Um ADMIN é referenciado por votos, feedbacks,
selos concedidos, auditoria e mais de uma dezena de FKs — `user.delete()` ou
estoura na FK ou levaria junto o histórico da empresa. É também o que o
`/admin/users` já faz para colaborador: o repo não tem nenhum hard delete de
usuário. O desfazer é `PATCH { active: true }`, exposto como **Reativar** na
lista, que por isso mostra os inativos.

Login já barra usuário inativo (`auth-service.ts`), e `/auth/refresh` também —
mas o refresh token continuaria válido até o próximo uso, então desativar e
trocar senha **revogam as sessões abertas** (`revokeAllForUser`). Sem isso, um
access token vivo dá até 15 minutos de sobrevida ao acesso que se acabou de
cortar.

### Nunca deixar a empresa sem admin

`DELETE` e `PATCH { active: false }` no **último ADMIN ativo** respondem 409. Uma
empresa sem administrador ativo fica sem ninguém que a administre, e só o super
admin conseguiria destravar — é um estado que não vale poder alcançar por um
clique.

### Escopo por empresa

Usuário que não é `ADMIN`, ou que é ADMIN de **outra** empresa, responde 404 (não
403): a rota é "os admins desta empresa", e distinguir os dois casos vazaria a
existência de contas de outro tenant.

O admin novo é ancorado no primeiro setor da empresa em ordem alfabética — a
criada junto com a empresa chama-se "Geral". O papel ADMIN atravessa setor, então
isso é só a âncora obrigatória de `User.sectorId`, não uma restrição de acesso.
Empresa sem nenhum setor responde 400 (estado que o fluxo normal não produz).

### Fora de escopo

- **Auditoria.** `AdminAuditLog` é por empresa e `listAuditLogActors` resolve o
  ator dentro do `scopedPrisma` da empresa — um ator SUPER_ADMIN (que mora na
  empresa interna) apareceria nas entradas mas não no filtro. As rotas de super
  admin que já existem também não auditam; unificar isso é assunto próprio.
- **Promover/rebaixar** usuário existente para ADMIN. Aqui só se cria conta nova.
- **Convite por e-mail.** A senha continua sendo provisória, definida pelo super
  admin e comunicada por fora, igual ao cadastro da empresa.

## Contrato (`@legends/shared`)

`CompanyAdminDTO` (`id`, `name`, `email`, `active`, `createdAt`),
`CreateCompanyAdminRequest`, `UpdateCompanyAdminRequest`.

`toCompanyAdmin` (em `serialize.ts`) **não** oculta o e-mail — diferente de
`toPublicUser`, que o esconde para ex-lendas. Aqui o e-mail é a credencial de
acesso e é o que identifica quem administra a empresa.
