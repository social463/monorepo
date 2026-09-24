/**
 * Parâmetros de rede do movimento contínuo.
 *
 * Compartilhados pela arena e pelo escritório: os dois rodam o MESMO modelo —
 * servidor autoritativo em tick fixo, cliente prevendo e reconciliando, os
 * outros interpolados um pouco no passado. Valores diferentes nos dois lugares
 * dariam duas sensações de rede no mesmo produto, e nenhuma razão para isso.
 */

/**
 * Passos de simulação por segundo no servidor.
 *
 * Múltiplo INTEIRO do snapshot de propósito (2×). Com taxas que não se
 * dividem, o snapshot cai ora num tick ora no seguinte e a cadência real vira
 * outra coisa — 30/20 entregaria 15Hz de verdade, não 20.
 */
export const BODY_TICK_HZ = 40

/**
 * Snapshots por segundo. Menor que o tick porque o cliente interpola: mandar
 * um pacote por passo dobraria o tráfego sem melhorar o que se vê.
 *
 * É também o que conserta a escala do movimento. Por evento, com M pessoas
 * andando e N conectadas, são `M × 20 × N` mensagens por segundo; por
 * snapshot são `N × 20`, independente de quantos se mexem.
 */
export const BODY_SNAPSHOT_HZ = 20

/** Amostras de input por segundo no cliente. */
export const BODY_INPUT_HZ = 30

/**
 * Atraso do buffer de interpolação dos OUTROS jogadores. Desenhá-los na
 * posição do último snapshot os faz andar aos solavancos a 20Hz; desenhá-los
 * um pouco no passado, entre dois snapshots já recebidos, os faz andar liso.
 * O custo é ver os outros ~100ms atrás — invisível para quem joga, e o preço
 * padrão desse modelo.
 */
export const BODY_INTERP_MS = 100

/**
 * Quanto tempo de simulação um jogador pode acumular "no banco".
 *
 * O `dtMs` vem do CLIENTE (é ele que sabe quanto tempo passou entre dois
 * inputs), e cliente que escolhe o próprio `dt` escolhe a própria velocidade.
 * O servidor credita tempo pelo relógio DELE e debita a cada input aplicado;
 * quem manda mais tempo do que viveu simplesmente vê os inputs excedentes
 * ficarem para o tick seguinte.
 *
 * O banco existe para não punir jitter: uma rajada que chega atrasada junta
 * ainda é aplicada inteira. O teto é o que impede acumular um "estoque" de
 * movimento e gastá-lo de uma vez.
 */
export const BODY_TIME_BUDGET_CAP_MS = 250

/**
 * Teto de inputs pendentes por jogador. Sem ele, um cliente adulterado compra
 * velocidade enfileirando input: o tick consumiria tudo e ele andaria mais que
 * os outros. Mesmo papel do token bucket do `move` no escritório.
 */
export const BODY_MAX_PENDING_INPUTS = 10

/**
 * Teto de inputs NÃO CONFIRMADOS que o cliente carrega antes de parar de
 * prever.
 *
 * A fila de pendentes existe para cobrir o tempo de ida e volta — uns poucos
 * inputs. Se ela cresce sem parar, é porque ninguém está confirmando: a
 * conexão caiu, e cada passo previsto vira uma promessa que o servidor nunca
 * fez. Sem teto, o personagem anda indefinidamente para um lugar onde ele não
 * está, e volta de teleporte quando a rede retorna.
 *
 * Dois segundos de folga (a 30Hz): passa por engasgo de rede sem travar, e
 * segura antes de a divergência virar um salto grande.
 */
export const BODY_MAX_UNACKED_INPUTS = 60
