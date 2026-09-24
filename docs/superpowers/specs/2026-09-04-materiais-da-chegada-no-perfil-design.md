# Materiais da chegada no perfil

## Problema

Quem entra na empresa recebe um punhado de arquivo do G&G — kit visual, plano de
90 dias, o que mais fizer sentido para a função. Desde o adendo "materiais por
pessoa" do kit visual (`2026-08-16-kit-visual-administravel-design.md`) isso já
tem lugar: o G&G sobe em Administração › Cultura › Materiais por pessoa, e a
pessoa vê em Cultura › Kit visual, no bloco "Seus materiais".

O problema é a **descoberta**. Quem chegou ontem não sabe que existe uma área
chamada Cultura, muito menos uma aba dentro dela chamada "Kit visual" — e é
justamente nas primeiras semanas que o plano de 90 dias precisa ser lido. O
próprio spec do kit já tinha anotado o buraco: *"Sem aviso ao destinatário. Quem
recebe descobre ao abrir a aba"*.

O resultado é o de sempre: o arquivo existe, está entregue, e ninguém abriu.

## Entrega

Uma seção no **próprio perfil**, acima do termômetro de humor e das férias, com
os materiais que a pessoa recebeu — enquanto ela tiver menos de **90 dias** de
`joinedAt`. Título, arquivo, tamanho e o botão de baixar, um por linha.

Passados os 90 dias a seção some do perfil. **Nada é apagado**: o material
continua na aba Kit visual, para sempre. O que expira é o destaque.

## Decisões

### Não é modelo novo — é a mesma entrega, vista de outro lugar

A tentação é uma tabela de "materiais de onboarding". Não há nada nela que
`CulturePersonalAsset` não tenha: é arquivo dirigido a UMA pessoa, em prefixo
privado do S3, com download por rota autenticada que reconfere quem pede. Um
modelo paralelo duplicaria a única parte do kit que é de segurança, e dobraria as
telas do G&G — quem sobe o plano de 90 dias sobe pelo mesmo lugar de sempre.

Então a seção lê o que já existe, e a novidade cabe numa rota.

### A janela é do servidor, e a lista nem é carregada fora dela

`GET /culture/onboarding-kit` devolve `{ active, endsAt, daysLeft, assets }`. Quem
decide `active` é o servidor, comparando `User.joinedAt` com o relógio dele — como
o `canSign` do mural de aniversário. O front não faz conta de data nenhuma: o
relógio do navegador é do usuário, e seção que reaparece mudando a data da máquina
não é seção, é enfeite.

Fechada a janela, `assets` vem **vazia**. Material de uma pessoa não trafega para
uma tela que não vai desenhá-lo — e o DTO carrega link assinado, ainda que curto.

### Rota separada de `/culture/personal-assets`

As duas leituras são da mesma pessoa e da mesma tabela, e mesmo assim são duas
rotas. A aba Kit visual mostra o material **para sempre**; o perfil mostra
**enquanto a janela estiver aberta**. Espremer as duas numa resposta só devolveria
a decisão de mostrar para o cliente, na forma de um `if` — que é exatamente o que
a janela do servidor existe para não ter.

O recorte continua sendo o `sub` do token: a rota não aceita parâmetro de pessoa,
então não há onde escrever o id de um colega.

### Linha, e não o card grande da aba

No perfil a seção divide a coluna com humor, férias, selos e feedback. A grade de
prévias da aba Kit visual empurraria a lista de feedbacks — que é a razão de a
tela existir — para baixo da dobra. Aqui é uma linha por material: ícone por tipo,
título, arquivo, botão.

### O aviso diz o que acontece depois

"Em destaque aqui por mais N dias. Depois disso continuam disponíveis em Cultura ›
Kit visual." Sem a segunda frase o card vira contagem regressiva ameaçadora em
cima de um arquivo que a pessoa pode rebaixar quando quiser — e o link ainda
ensina o caminho que ela vai usar no 91º dia.

A tela de administração ganhou a mesma frase, do outro lado: quem envia precisa
saber onde o material vai aparecer.

### Todos os materiais da pessoa, sem marcar quais são "de chegada"

Um `onboarding: boolean` na peça deixaria o G&G escolher o que aparece no perfil.
Não entra: nos primeiros 90 dias, o que uma pessoa recebe do G&G **é** material de
chegada, e um checkbox esquecido na hora do envio é um plano de 90 dias que não
apareceu — o exato problema que isto veio resolver. Se um dia entrar material
pessoal que não seja de chegada e atrapalhe, o campo entra aí.

## Limites conhecidos

- **Janela fixa em 90 dias**, constante em `@legends/shared`
  (`ONBOARDING_MATERIALS_WINDOW_DAYS`). Não é configurável por empresa; vira
  `AppSetting` se alguém pedir.
- **Continua sem aviso ativo.** A seção resolve descoberta para quem abre o
  perfil, e nada mais: notificação in-app na chegada do material é outro passo, e
  segue em aberto desde o spec do kit.
- **Empresa que não preenche `joinedAt`** cai no `@default(now())` do Prisma —
  quem foi importado sem data de admissão conta os 90 dias a partir do cadastro.
  É o mesmo dado que o perfil já exibe como "Na equipe desde".
- **Sem S3 configurado** o download responde 503, como em todo material pessoal.
