/**
 * Carrega a trilha Eu Aprendiz — turmas, os seis encontros, as fichas de cada
 * um e o contrato — num banco que já existe, sem o resto do `prisma/seed.ts`.
 *
 * O seed completo também cria usuários, período e categorias fictícios, e por
 * isso não serve para homologação nem produção. O conteúdo é o mesmo
 * (`prisma/apprentice-seed-content.ts`, portado do protótipo `Trilha EMR.zip`).
 *
 *   pnpm --filter @legends/api exec tsx scripts/seed-apprentice-trail.ts --dry-run
 *   pnpm --filter @legends/api exec tsx scripts/seed-apprentice-trail.ts
 *   pnpm --filter @legends/api exec tsx scripts/seed-apprentice-trail.ts --company=company-emr
 *
 * Idempotente: só cria o que ainda não existe (encontro por ordem, ficha por
 * título dentro do encontro, turma por nome). Nunca sobrescreve o que a G&G
 * ajustou no painel.
 *
 * Materiais complementares NÃO entram: no protótipo eles são só nome e formato,
 * sem arquivo nem link, e `ApprenticeMeetingMaterial` exige um dos dois.
 *
 * O alvo é o `DATABASE_URL` do ambiente — confira antes de rodar.
 */
import { prisma } from '../src/lib/prisma'
import {
  APPRENTICE_CLASSES_SEED,
  APPRENTICE_CONTRACT_SEED,
  APPRENTICE_MEETINGS_SEED,
} from '../prisma/apprentice-seed-content'

const dryRun = process.argv.includes('--dry-run')
const companyId =
  process.argv.find((arg) => arg.startsWith('--company='))?.slice('--company='.length) ?? 'company-emr'

async function main() {
  const company = await prisma.company.findUnique({ where: { id: companyId } })
  if (!company) throw new Error(`Empresa ${companyId} não encontrada.`)

  const target = (process.env.DATABASE_URL ?? '').replace(/\/\/[^@]*@/, '//***@')
  console.log(`${dryRun ? '[dry-run] ' : ''}Empresa ${company.name} (${companyId}) em ${target}`)

  const created = { classes: 0, meetings: 0, activities: 0, contract: 0 }

  for (const turma of APPRENTICE_CLASSES_SEED) {
    const existing = await prisma.apprenticeClass.findFirst({ where: { companyId, name: turma.name } })
    if (existing) continue
    created.classes++
    if (!dryRun) {
      await prisma.apprenticeClass.create({ data: { companyId, name: turma.name, shift: turma.shift } })
    }
  }

  for (const meeting of APPRENTICE_MEETINGS_SEED) {
    let row = await prisma.apprenticeMeeting.findFirst({ where: { companyId, order: meeting.order } })
    if (!row) {
      created.meetings++
      if (dryRun) {
        created.activities += meeting.activities.length
        continue
      }
      row = await prisma.apprenticeMeeting.create({
        data: {
          companyId,
          order: meeting.order,
          title: meeting.title,
          theme: meeting.theme,
          objectives: meeting.objectives,
          deliverable: meeting.deliverable,
          scheduledOn: new Date(`${meeting.scheduledOn}T00:00:00.000Z`),
          // O primeiro encontro nasce liberado; os demais, o facilitador abre.
          accessReleased: meeting.order === 1,
        },
      })
    }

    for (const activity of meeting.activities) {
      const found = await prisma.apprenticeActivity.findFirst({
        where: { companyId, meetingId: row.id, title: activity.title },
      })
      if (found) continue
      created.activities++
      if (dryRun) continue
      await prisma.apprenticeActivity.create({
        data: {
          companyId,
          meetingId: row.id,
          title: activity.title,
          kind: activity.kind,
          order: activity.order,
          schema: activity.schema as object,
        },
      })
    }
  }

  const contract = await prisma.apprenticeContract.findFirst({ where: { companyId } })
  if (!contract) {
    created.contract++
    if (!dryRun) {
      await prisma.apprenticeContract.create({ data: { companyId, clauses: APPRENTICE_CONTRACT_SEED } })
    }
  }

  console.log(
    `${dryRun ? 'Criaria' : 'Criado'}: ${created.classes} turma(s), ${created.meetings} encontro(s), ` +
      `${created.activities} ficha(s), ${created.contract} contrato.`,
  )
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err)
    await prisma.$disconnect()
    process.exit(1)
  })
