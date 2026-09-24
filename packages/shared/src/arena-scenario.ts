import { arenaMapAssets, arenaMapDocument } from './arena-map'
import { soccerMapAssets, soccerMapDocument } from './arena-soccer-map'
import { raceMapAssets, raceMapDocument } from './arena-race-map'
import type { ArenaMode } from './arena-match'
import type { MapDocumentV1, OfficeMapAssetDTO } from './index'

/**
 * Qual cenário cada modo joga.
 *
 * O modo passou a escolher mais do que a regra de ponto: mata-mata e bandeira
 * dividem o campo de batalha (a mesma cobertura serve aos dois), o futebol tem
 * campo próprio e a corrida tem pista própria. Quem pergunta são os DOIS lados —
 * o hub, ao configurar a arena, e a cena, ao montar o Phaser —, então a resposta
 * mora aqui, e não num `if` repetido em cada um.
 */

/**
 * Memoizado por modo, e não por chamada.
 *
 * `configure` roda a cada conexão, e montar o campo de batalha significa
 * varrer 121×85 tiles e sortear cobertura por setor. Os documentos são tratados
 * como imutáveis pelo runtime da arena (quem edita mapa é o editor do
 * escritório, com outro documento), e a grade de colisão é memoizada pela
 * IDENTIDADE de `document.objects` — então reaproveitar o documento também
 * reaproveita a grade, em vez de rasterizar tudo de novo a cada quem entra.
 */
const documentos = new Map<Scenario, MapDocumentV1>()
const assets = new Map<Scenario, OfficeMapAssetDTO[]>()

/**
 * Os cenários, que são MENOS que os modos: mata-mata e bandeira jogam no mesmo
 * campo de batalha.
 *
 * A cache é por cenário, e não por modo, porque a IDENTIDADE do que sai daqui
 * é significativa dos dois lados. No cliente, trocar de mata-mata para
 * bandeira não pode remontar o Phaser (o efeito depende do documento e dos
 * assets, e remontar zeraria a cena de quem só mudou de regra); no servidor, a
 * grade de colisão é memoizada pela identidade de `document.objects`.
 */
type Scenario = 'batalha' | 'campo' | 'pista'

function scenarioFor(mode: ArenaMode): Scenario {
  if (mode === 'futebol') return 'campo'
  if (mode === 'corrida') return 'pista'
  return 'batalha'
}

export function arenaDocumentFor(mode: ArenaMode): MapDocumentV1 {
  const cenario = scenarioFor(mode)
  const pronto = documentos.get(cenario)
  if (pronto) return pronto
  const documento =
    cenario === 'campo'
      ? soccerMapDocument()
      : cenario === 'pista'
        ? raceMapDocument()
        : arenaMapDocument()
  documentos.set(cenario, documento)
  return documento
}

export function arenaAssetsFor(mode: ArenaMode): OfficeMapAssetDTO[] {
  const cenario = scenarioFor(mode)
  const pronto = assets.get(cenario)
  if (pronto) return pronto
  const lista =
    cenario === 'campo'
      ? soccerMapAssets()
      : cenario === 'pista'
        ? raceMapAssets()
        : arenaMapAssets()
  assets.set(cenario, lista)
  return lista
}
