# Paintball no escritório

**Data:** 2026-08-24
**Status:** implementado

## Problema

O escritório já tem kart, confete, high-five e bola chutável — coisas que
existem só para as pessoas brincarem juntas no mapa. Falta a categoria que
transforma o mapa em *arena*: mira e acerto entre duas pessoas.

O pedido: poder "atirar" no colega como num paintball, deixando **uma marca de
tinta no personagem dele**, que some sozinha depois de um tempo. Modos de jogo
("pegue a bandeira", "mata-mata") vêm depois; por ora, o tiro.

## Decisão

### O marcador é um item vestido, não um botão

Paintball começa por **pegar a arma**. `Q` equipa e guarda o marcador; sem ele
equipado, `V` não faz nada. Isso é o que impede o escritório inteiro de virar
campo de tiro por acidente — quem está trabalhando simplesmente não está
armado, e quem olha o mapa vê pelo sprite quem está jogando e quem não está.

O marcador é o **estilingue do LPC** (`weapon/ranged/slingshot`), que já vem
vendorizado e creditado. Lê como marcador nas quatro poses (o `Y` aparece de
frente, de lado e de costas) e, num escritório, pesa diferente das
alternativas: um paintball com besta ou espingarda não tem a mesma leitura.
O arco foi descartado por sumir de frente e de costas.

**O marcador entra por CAMINHO, não por item do catálogo.** Pelo catálogo,
`weapon_ranged_slingshot` não serve `teen` nem `child`, e criança desarmada no
meio de uma partida seria um bug, não uma regra. O sheet, porém, é **universal**
— um único arquivo para todos os corpos —, e cai bem nos seis. Então
`PAINTBALL_MARKER_LAYERS` referencia os dois PNGs direto, e
`composeCharacterSheet` ganhou um parâmetro de camadas extras. A distinção é
honesta: o marcador não é guarda-roupa (não persiste em `avatarOptions`, não
aparece no editor de personagem), é estado de jogo.

Os dois zPos dele são bem distantes, e a ordem importa: o **fundo entra antes
do corpo** (9 contra os 10 do body), porque nas poses de lado, de costas e para
cima o estilingue fica atrás do tronco; só a de frente usa a camada de 140.
Inverter põe a forquilha por cima das costas.

**Pegar o marcador esvazia as mãos.** Ninguém segura duas coisas: somar o
estilingue por cima do guarda-roupa desenhava quem escolheu espada, escudo ou
enxada empunhando aquilo **e** o marcador, um por cima do outro. As categorias
que ocupam as mãos somem enquanto ele está equipado
(`PAINTBALL_MARKER_HIDES` — com `shield_pattern`/`shield_trim` junto, senão o
brasão flutua sem escudo embaixo, e `ammo`/`weapon_magic_crystal` pelo mesmo
motivo). Como nada disso encosta em `avatarOptions`, guardar a arma devolve
sozinho o que a pessoa tinha.

Consequência mecânica: equipar **troca a textura do personagem**, porque a
assinatura das camadas entra na key (`occupantTextureKey`). É o mesmo caminho
já percorrido por `avatar-updated`, e o cache por assinatura faz a segunda
troca ser instantânea.

### O servidor resolve o tiro inteiro, de uma vez

Igual ao chute (`kickBall`): o hub é orientado a evento e não tem loop de tick.
`firePaintball` (em `@legends/shared`, testável fora do servidor) devolve a
**trajetória inteira** — tiles percorridos, duração, se acertou e quem —, o hub
grava a marca e faz broadcast, e cada cliente só **anima**.

O cliente manda apenas `fire-paintball`, sem direção nem alvo. Direção é o
facing autoritativo, alcance é constante, alvo é quem estiver na linha. Cliente
adulterado não escolhe em quem acerta.

### A bolinha para no primeiro obstáculo — e é isso que cria o jogo

`isMapTileWalkable` continua sendo a regra única de colisão, como na bola. Mesa,
parede e planta **param o tiro**, e é de propósito: cobertura é o que
transforma o mapa em arena e é a peça que "pegue a bandeira" e "mata-mata" vão
herdar de graça. Não há tiro em arco (o `lob` da bola) justamente porque
remover a cobertura removeria o jogo.

Tiro é reto nas **quatro** direções, e não em oito: o `Direction` é o facing, o
personagem LPC tem quatro poses, e o contato da bola já mede por ele. Andar na
diagonal continua valendo — mirar, não.

### Quem está ausente não é alvo nem escudo

`away` e `brb` são status manuais: quem marcou já disse que não está aqui. Essas
pessoas são **atravessadas** pela bolinha — não levam marca e não param o tiro
de quem está atrás delas.

Atravessar (em vez de parar sem marcar) é a parte deliberada: se o corpo de quem
está ausente barrasse o tiro, o status de presença viraria posição tática, e
alguém "se ausentaria" para virar parede. Assim, sair do jogo é sair do jogo
inteiro.

Fora isso, **todo mundo é alvo, armado ou não** — levar uma bolinha de tinta
sem estar jogando é a piada, não o bug. Quem não quer participar tem o status.

### A marca é dado do servidor com prazo, sem timer no servidor

Cada acerto cria um `PaintSplat` guardado no hub por usuário — e o hub **não
ganhou timer nenhum** para expirá-las. A limpeza é preguiçosa: toda leitura
(`welcome`, acerto novo) descarta o que já venceu. Um `setTimeout` por marca
seria estado agendado por empresa para uma coisa que ninguém consulta enquanto
não olha.

No fio a marca viaja com **`ttlMs` restante**, nunca com um instante absoluto:
quem chega no meio da vida dela recebe o que sobrou, e o cliente conta a partir
dali. É a mesma escolha do áudio de sala, que manda a faixa "com a posição já
avançada" em vez do horário em que começou — e evita depender de relógios
sincronizados.

Cada pessoa acumula até `PAINTBALL_MAX_SPLATS` marcas; a mais velha sai para a
nova entrar. Sem teto, uma rajada em cima de alguém parado empilharia dezenas
de sprites no mesmo container.

### Onde a mancha cai é derivado, não sorteado

O servidor manda **o fato** (id, cor, ttl); o cliente deriva **a aparência** —
posição no torso, tamanho e giro — de `officeHash(id)`, em
`paintSplatPlacement`. Como o hash é compartilhado e o id é o mesmo para todo
mundo, todos veem a mancha no mesmo lugar sem que isso ocupe payload.

Cada um dos quatro campos sai de um hash **próprio**, com prefixo diferente, e
não de fatias de bits do mesmo número. Fatiar não serve aqui: ids de tiros
seguidos do mesmo par diferem só nos últimos dígitos do instante, e o djb2 quase
não leva essa diferença para os bits altos — o giro saía **idêntico** e o
tamanho quase igual em todas as manchas de uma pessoa, que é exatamente o
carimbo repetido que a função existe para evitar. Ficou um teste em cima disso.

O tronco onde a tinta cai é **medido no sprite**, não chutado: o container fica
no centro do tile e o personagem é ancorado pelos pés, então as linhas 32..47 do
frame LPC (a 48/64 de escala) viram y −8..+4 em coordenada local. Pela mesma
conta, a mancha tem 7px de base — o torso tem 22px de largura na tela, e mancha
maior que isso vira babador em vez de marca. A bolinha voa na linha da cintura
(`PAINTBALL_MUZZLE_Y`), a única altura em que ela sai da arma **e** chega no
corpo do outro.

Nada de aleatório em lugar nenhum do tiro: a mesma dupla, da mesma posição, dá
sempre o mesmo resultado — é o que deixa a pessoa aprender a mira em vez de
sentir que o jogo sorteia. Mesmo princípio do chute.

### A cor é de quem atira

`paintballColorFor(userId)` deriva a cor de `officeHash` sobre uma paleta fixa,
como o spawn e o confete. Isso já responde "quem me acertou?" olhando a mancha —
e é o gancho por onde os modos por time entram depois: basta a cor passar a vir
do time em vez do usuário, sem tocar em trajetória, marca ou render.

### O aviso na tela é só de quem está armado

Só o `V` aparece, e só para quem já tem o marcador na mão. O `Q` que o pega
mora no painel de atalhos: um chip permanente convidando o escritório inteiro a
atirar é ruído para quem só quer trabalhar.

Os avisos de ação ao alcance ficam **todos numa coluna só**, e não cada um com o
seu `bottom`. Dois podem estar na tela ao mesmo tempo (dá para andar armado até
perto da bola), e afastar um do outro no olho rende exatamente o que rendeu na
primeira versão: diferença de `bottom` menor que a altura do chip, um por cima
do outro. Com `gap`, vale para qualquer combinação — inclusive a próxima.

### Teclas: Q equipa, V atira

`Q` estava livre desde que o toque na bola mudou para `Z`, e é a tecla mais
perto do WASD. `V` fica sob o indicador da mesma mão, e não conflita com o `V`
do editor (espelhar vertical): o gesto inteiro é desarmado em modo de edição,
como o da bola.

O aviso na tela traz os dois como botões clicáveis, pelo mesmo motivo do aviso
da bola: quem está no celular não tem teclado.

### Cadência é do servidor

`PAINTBALL_COOLDOWN_MS` mora no hub, não no cliente. Segurar a tecla dispara
`keydown` repetido, e cada tiro aceito é broadcast para o escritório inteiro —
sem cadência do lado de lá, um cliente adulterado (ou só um teclado com
auto-repeat) vira metralhadora de broadcast. O cliente espelha o mesmo valor,
mas só para apagar o botão: quem decide é o servidor.

## Alternativas descartadas

- **Tiro contínuo com loop de tick no servidor**, com a bolinha colidindo com
  quem se mexe durante o voo. Mesmo veredito da bola: um timer permanente por
  empresa e toda a reconciliação junto, para um comportamento visível quase
  idêntico ao da trajetória fechada.
- **Sobrepor o marcador como sprite separado**, sincronizado quadro a quadro
  com o frame do personagem. Evitaria recompor a textura, mas duplicaria o
  problema que o LPC já resolve por camadas (e o estilingue tem uma camada
  ATRÁS do corpo, que um overlay único não desenha).
- **Marca no perfil / placar persistido.** Fora do escopo: o pedido é a
  funcionalidade, e placar é assunto do modo de jogo. Marca é efêmera como
  toda presença do escritório.
- **Exigir que os dois lados estejam armados.** Mataria o começo de qualquer
  partida — ninguém equipa primeiro se não dá para provocar.

## Onde está

- `packages/shared/src/office-paintball.ts` — tipos, constantes, `firePaintball`,
  `paintballColorFor`, `paintSplatPlacement`, camadas do marcador e o que ele esconde.
- `apps/api/src/lib/office-hub.ts` — `paintSplats`, `setPaintMarker`, `firePaintball`.
- `apps/web/src/office/useOfficePaintball.ts` — teclas e estado do marcador.
- `apps/web/src/office/scenes/OfficeScene.ts` — `playPaintballShot`, `applyPaintSplats`.
- `apps/web/src/office/media/paintball-sound.ts` — o "pluft" (síntese, não sample).
- `apps/web/src/lib/character.ts` — camadas extras na composição do sheet.
