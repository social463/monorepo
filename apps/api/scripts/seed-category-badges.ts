/**
 * Cria as trilhas de selo (kind CATEGORY) das competências que ainda não têm
 * nenhuma.
 *
 * O catálogo de selos deixou de ser seed em `b9224e8e` — hoje é dado que a G&G
 * cria em Administração › Selos, e `Badge.categorySlug` é texto solto, sem FK e
 * sem criação automática. Resultado: as competências que entraram pelo catálogo
 * da G&G nasceram sem selo nenhum, enquanto as herdadas do catálogo de voto
 * ficaram com três níveis cada. Depois da unificação
 * (`specs/2026-08-20-unificar-reconhecimento-em-feedback-design.md`) esses
 * selos contam **feedback recebido**, então competência sem selo é competência
 * que não rende nada para quem a recebe.
 *
 * Este script fecha essa lacuna com a mesma escada das trilhas existentes:
 * 3 / 8 / 20 feedbacks recebidos na competência.
 *
 *   pnpm --filter @legends/api exec tsx scripts/seed-category-badges.ts --dry-run
 *   pnpm --filter @legends/api exec tsx scripts/seed-category-badges.ts
 *   pnpm --filter @legends/api exec tsx scripts/seed-category-badges.ts --company=company-emr
 *
 * Idempotente: pula competência que já tem selo e slug de selo que já existe.
 * Nunca mexe em selo existente — reescrever nome ou limiar do que a G&G
 * curou à mão é decisão dela, não deste script.
 *
 * O alvo é o `DATABASE_URL` do ambiente — confira antes de rodar: o `.env` de
 * desenvolvimento deste repo costuma apontar para homologação, não para o
 * Postgres local.
 */
import { prisma } from '../src/lib/prisma'
import { slugify } from '../src/lib/slug'

interface Tier {
  threshold: number
  name: string
  iconKey: string
}

/**
 * Trilha por **slug** de competência, e não por nome: o nome a G&G renomeia, o
 * slug não — é ele que `Badge.categorySlug` referencia.
 *
 * O slug do selo é único **por empresa** (migration
 * `20260820160000_selo_unico_por_empresa`), então a mesma trilha nasce em cada
 * empresa que tenha a competência — o nome só não pode repetir um selo que já
 * exista naquela empresa.
 */
const LADDERS: Record<string, { label: string; tiers: [Tier, Tier, Tier] }> = {
  'adaptabilidade-e-resiliencia': {
    label: 'Adaptabilidade e Resiliência',
    tiers: [
      { threshold: 3, name: 'Jogo de Cintura', iconKey: 'fe-seedling' },
      { threshold: 8, name: 'Sempre de Pé', iconKey: 'fe-mountain' },
      { threshold: 20, name: 'Inabalável', iconKey: 'fe-shield' },
    ],
  },
  'execucao-impecavel': {
    label: 'Execução Impecável',
    tiers: [
      { threshold: 3, name: 'Caprichoso', iconKey: 'fe-check' },
      { threshold: 8, name: 'Feito Direito', iconKey: 'fe-hundred' },
      { threshold: 20, name: 'Padrão Impecável', iconKey: 'fe-medal-honor' },
    ],
  },
  gratidao: {
    label: 'Gratidão',
    tiers: [
      { threshold: 3, name: 'Sempre Agradece', iconKey: 'fe-heart-hands' },
      { threshold: 8, name: 'Coração Grato', iconKey: 'fe-heart-sparkle' },
      { threshold: 20, name: 'Gratidão que Contagia', iconKey: 'fe-heart-fire' },
    ],
  },
  inspiracao: {
    label: 'Inspiração',
    tiers: [
      { threshold: 3, name: 'Bom Exemplo', iconKey: 'fe-star' },
      { threshold: 8, name: 'Fonte de Inspiração', iconKey: 'fe-star-glow' },
      { threshold: 20, name: 'Estrela-Guia', iconKey: 'fe-shooting-star' },
    ],
  },
  'inteligencia-emocional': {
    label: 'Inteligência Emocional',
    tiers: [
      { threshold: 3, name: 'Escuta Ativa', iconKey: 'fe-heart' },
      { threshold: 8, name: 'Cabeça no Lugar', iconKey: 'fe-brain' },
      { threshold: 20, name: 'Equilíbrio de Aço', iconKey: 'fe-heart-grow' },
    ],
  },
  lideranca: {
    label: 'Liderança',
    tiers: [
      { threshold: 3, name: 'Puxou a Fila', iconKey: 'fe-raising-hands' },
      { threshold: 8, name: 'Líder Natural', iconKey: 'fe-compass' },
      { threshold: 20, name: 'Referência de Liderança', iconKey: 'fe-crown' },
    ],
  },
}

/** Mesmo formato das trilhas que já existem, só que falando feedback. */
function describe(tier: Tier, categoryLabel: string): string {
  return `Recebeu ${tier.threshold} feedbacks em ${categoryLabel}.`
}

/** Host do banco, sem credencial — só para o operador conferir o alvo. */
function databaseTarget(): string {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '')
    return `${url.host}${url.pathname}`
  } catch {
    return '(DATABASE_URL ausente ou inválida)'
  }
}

function flag(name: string): string | undefined {
  const found = process.argv.find((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`))
  if (!found) return undefined
  return found.includes('=') ? found.slice(found.indexOf('=') + 1) : ''
}

interface PlannedBadge {
  companyId: string
  categorySlug: string
  categoryName: string
  slug: string
  name: string
  description: string
  iconKey: string
  threshold: number
}

/**
 * O que falta criar. A competência entra só se **não tiver nenhum** selo
 * CATEGORY: uma trilha curada à mão com dois níveis é escolha da G&G, e
 * completar a escada por baixo dos panos mudaria o catálogo dela.
 */
async function plan(companyId: string): Promise<PlannedBadge[]> {
  const [categories, badges] = await Promise.all([
    prisma.recognitionCategory.findMany({
      where: { companyId, slug: { in: Object.keys(LADDERS) } },
      select: { slug: true, name: true },
    }),
    prisma.badge.findMany({ where: { companyId, kind: 'CATEGORY' }, select: { categorySlug: true } }),
  ])
  const jaTemSelo = new Set(badges.map((badge) => badge.categorySlug))

  const planned: PlannedBadge[] = []
  for (const category of categories) {
    if (jaTemSelo.has(category.slug)) continue
    const ladder = LADDERS[category.slug]
    for (const tier of ladder.tiers) {
      planned.push({
        companyId,
        categorySlug: category.slug,
        categoryName: category.name,
        // Mesmo slugify de `createBadgeAdmin` — o selo criado por script e o
        // criado pela tela precisam nascer com o mesmo slug.
        slug: slugify(tier.name),
        name: tier.name,
        description: describe(tier, ladder.label),
        iconKey: tier.iconKey,
        threshold: tier.threshold,
      })
    }
  }
  return planned
}

async function main(): Promise<void> {
  const isDryRun = flag('dry-run') !== undefined
  const only = flag('company') || undefined

  console.log(`Banco: ${databaseTarget()}${isDryRun ? '  (prévia, nada é escrito)' : ''}`)

  const companies = only
    ? [{ id: only }]
    : await prisma.company.findMany({ select: { id: true }, orderBy: { id: 'asc' } })

  for (const company of companies) {
    const planned = await plan(company.id)
    console.log(`\n▸ ${company.id}`)
    let created = 0
    let skipped = 0
    for (const badge of planned) {
      const { categorySlug, categoryName, ...data } = badge
      const label = `${categoryName.padEnd(30)} ${String(badge.threshold).padStart(3)}  ${badge.name}`
      // Por (companyId, slug): o mesmo nome de selo em outra empresa é outro selo,
      // e não motivo para pular. O script nunca sobrescreve o que já existe aqui.
      const existente = await prisma.badge.findFirst({
        where: { companyId: company.id, slug: data.slug },
        select: { id: true },
      })
      if (existente) {
        console.log(`    · ${label}  (slug "${data.slug}" já existe nesta empresa, pulado)`)
        skipped += 1
        continue
      }
      if (!isDryRun) await prisma.badge.create({ data: { ...data, kind: 'CATEGORY', categorySlug, global: true } })
      console.log(`    + ${label}`)
      created += 1
    }
    console.log(`  ${created} ${isDryRun ? 'a criar' : 'criados'} · ${skipped} pulados`)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
