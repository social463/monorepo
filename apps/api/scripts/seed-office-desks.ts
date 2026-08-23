import { prisma } from '../src/lib/prisma'
import {
  acquireOfficeMapLock,
  getOfficeMapDraft,
  publishOfficeMap,
  releaseOfficeMapLock,
  saveOfficeMapDraft,
} from '../src/services/office-map-service'

const MAP_ID = 'legacy-office-map'
const DESK_ROW_Y = 4
const DESK_COLUMNS = [8, 10, 12, 14, 16]
const TILE = 32
const DESK_WIDTH = 48
const DESK_HEIGHT = 32

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
  if (!admin) throw new Error('Nenhum usuário ADMIN encontrado')

  const lock = await acquireOfficeMapLock(MAP_ID, admin.id)
  try {
    const draft = await getOfficeMapDraft(MAP_ID)
    const document = draft.document as any

    if (!document.layers.some((layer: any) => layer.key === 'desks')) {
      document.layers.push({
        id: 'desks',
        key: 'desks',
        name: 'Mesas',
        type: 'object',
        locked: false,
        zIndex: 135,
        opacity: 1,
        visible: true,
      })
    }

    const deskObjects = DESK_COLUMNS.map((col, index) => {
      const centerX = col * TILE + TILE / 2
      const centerY = DESK_ROW_Y * TILE + TILE / 2
      return {
        id: `legacy-desk-${index + 1}`,
        layerKey: 'desks',
        type: 'desk',
        geometry: {
          kind: 'rectangle',
          x: centerX - DESK_WIDTH / 2,
          y: centerY - DESK_HEIGHT / 2,
          width: DESK_WIDTH,
          height: DESK_HEIGHT,
        },
        properties: { externalKey: `legacy-desk-${index + 1}`, name: `Mesa ${index + 1}` },
      }
    })

    document.objects = document.objects.filter((o: any) => !deskObjects.some((d) => d.id === o.id))
    document.objects.push(...deskObjects)

    const saved = await saveOfficeMapDraft(MAP_ID, { revision: draft.revision, document }, admin.id, lock.lockToken)
    const published = await publishOfficeMap(MAP_ID, saved.revision, admin.id, true)
    console.log(`Publicado: ${published.desksCreated} mesas criadas (publicação ${published.publication.id}, versão ${published.version}).`)
  } finally {
    await releaseOfficeMapLock(MAP_ID, admin.id, lock.lockToken)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
