/**
 * Funde as competências que ficaram duplicadas depois da unificação e acerta o
 * texto dos selos que falam delas.
 *
 * A migration `20260820120000_unificar_reconhecimento_em_feedback` fundiu os
 * dois catálogos casando por **nome** (sem acento, sem caixa). O que não casou
 * por pouco entrou duas vezes: "Colaboração" (do voto, com histórico e com selo)
 * e "Trabalho em Equipe e Colaboração" (do catálogo da G&G, zerada) são a mesma
 * competência, e o feedback dado em uma não conta para o selo pendurado na
 * outra.
 *
 * A sobrevivente é a que **tem histórico**, e ela adota o nome da G&G: o nome é
 * editável de propósito, o `slug` não é — é por ele que `Badge.categorySlug`
 * aponta. Assim o selo continua contando os feedbacks que já existem e a pessoa
 * passa a ver o vocabulário do documento da G&G.
 *
 * A duplicata some por DELETE, e não por `active: false`: a regra "categoria se
 * desativa, nunca se apaga" existe para não perder histórico, e estas não têm
 * nenhum (o script se recusa a apagar qualquer uma que tenha). Desativar também
 * não resolveria — a unique (companyId, name) é sobre a linha, ativa ou não, e
 * o nome é justamente o que a sobrevivente vai assumir.
 *
 *   pnpm --filter @legends/api exec tsx scripts/dedupe-recognition-categories.ts --dry-run
 *   pnpm --filter @legends/api exec tsx scripts/dedupe-recognition-categories.ts --company=company-emr
 *
 * Idempotente: par já fundido não faz nada.
 *
 * O alvo é o `DATABASE_URL` do ambiente — confira antes de rodar: o `.env` de
 * desenvolvimento deste repo costuma apontar para homologação, não para o
 * Postgres local.
 */
import { prisma } from '../src/lib/prisma'

interface Merge {
  /** Slug que fica — o que tem histórico e o que os selos referenciam. */
  keepSlug: string
  /** Slug da duplicata zerada, que é apagada. */
  dropSlug: string
  /** Nome do catálogo da G&G, que a sobrevivente assume. */
  name: string
}

const MERGES: Merge[] = [
  { keepSlug: 'colaboracao', dropSlug: 'trabalho-em-equipe-e-colaboracao', name: 'Trabalho em Equipe e Colaboração' },
  { keepSlug: 'senso-de-dono', dropSlug: 'proatividade-e-senso-de-dono', name: 'Proatividade e Senso de Dono' },
  { keepSlug: 'entrega-de-resultado', dropSlug: 'foco-em-resultados', name: 'Foco em Resultados' },
]

/**
 * Descrição de selo de categoria escrita no vocabulário antigo. Só o que casa
 * com esse formato é reescrito — descrição que a G&G tenha redigido à mão fica
 * como está.
 */
const DESCRICAO_ANTIGA = /^Recebeu (\d+) votos? em .+\.$/

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

/** Quantas linhas dependem de uma competência. Zero é o que autoriza o DELETE. */
async function usageOf(categoryId: string): Promise<{ feedbacks: number; votos: number }> {
  const [feedbacks, votos] = await Promise.all([
    prisma.feedbackRecognitionCategory.count({ where: { categoryId } }),
    prisma.voteCategory.count({ where: { categoryId } }),
  ])
  return { feedbacks, votos }
}

/** Devolve true quando o par foi (ou seria, na prévia) fundido. */
async function mergeOne(companyId: string, merge: Merge, isDryRun: boolean): Promise<boolean> {
  const [keep, drop] = await Promise.all([
    prisma.recognitionCategory.findFirst({ where: { companyId, slug: merge.keepSlug } }),
    prisma.recognitionCategory.findFirst({ where: { companyId, slug: merge.dropSlug } }),
  ])
  if (!keep) {
    console.log(`    · ${merge.keepSlug} não existe aqui, nada a fundir`)
    return false
  }
  if (!drop && keep.name === merge.name) {
    console.log(`    · ${merge.keepSlug} já fundida`)
    return true
  }

  if (drop) {
    const uso = await usageOf(drop.id)
    if (uso.feedbacks > 0 || uso.votos > 0) {
      // Duplicata com histórico não é mais duplicata descartável: fundir aqui
      // exigiria mover as marcações, que é decisão de produto, não de script.
      console.log(
        `    ! "${drop.name}" tem ${uso.feedbacks} feedback(s) e ${uso.votos} voto(s) — NÃO apagada. Par ignorado.`,
      )
      return false
    }
  }

  console.log(
    `    + "${keep.name}" (${keep.slug}) → "${merge.name}"` +
      (drop ? `  ·  apaga "${drop.name}" (${drop.slug}, sem uso)` : ''),
  )
  if (isDryRun) return true

  // Numa transação: o DELETE precisa liberar o nome antes do UPDATE, ou a
  // unique (companyId, name) recusa a renomeação.
  await prisma.$transaction(async (tx) => {
    if (drop) await tx.recognitionCategory.delete({ where: { id: drop.id } })
    await tx.recognitionCategory.update({ where: { id: keep.id }, data: { name: merge.name } })
  })
  return true
}

/**
 * Reescreve a descrição dos selos de categoria que ainda falam em "votos".
 *
 * Desde a unificação eles contam feedback recebido, de qualquer origem — o voto
 * é só mais uma delas. E, depois da fusão acima, a descrição também traria o
 * nome antigo da competência ("Recebeu 3 votos em Colaboração." num selo que
 * agora é de Trabalho em Equipe e Colaboração). O nome sai do catálogo, não do
 * texto congelado.
 */
async function fixDescriptions(companyId: string, fundidos: Set<string>, isDryRun: boolean): Promise<void> {
  const [badges, categories] = await Promise.all([
    prisma.badge.findMany({ where: { companyId, kind: 'CATEGORY' }, orderBy: { name: 'asc' } }),
    prisma.recognitionCategory.findMany({ where: { companyId }, select: { slug: true, name: true } }),
  ])
  const nomePorSlug = new Map(categories.map((c) => [c.slug, c.name]))
  // Na prévia a renomeação ainda não aconteceu no banco; sem isto o texto
  // mostrado aqui traria o nome antigo e não seria o que a execução escreve.
  for (const merge of MERGES) {
    if (fundidos.has(merge.keepSlug)) nomePorSlug.set(merge.keepSlug, merge.name)
  }

  let alterados = 0
  for (const badge of badges) {
    if (!badge.categorySlug) continue
    if (!DESCRICAO_ANTIGA.test(badge.description)) continue
    const categoryName = nomePorSlug.get(badge.categorySlug)
    if (!categoryName) {
      console.log(`    ! "${badge.name}" aponta para ${badge.categorySlug}, que não existe — descrição intocada`)
      continue
    }
    const description = `Recebeu ${badge.threshold} feedbacks em ${categoryName}.`
    if (description === badge.description) continue
    console.log(`    ~ ${badge.name.padEnd(26)} "${description}"`)
    alterados += 1
    if (!isDryRun) await prisma.badge.update({ where: { id: badge.id }, data: { description } })
  }
  if (alterados === 0) console.log('    · nenhuma descrição a acertar')
}

async function main(): Promise<void> {
  const isDryRun = flag('dry-run') !== undefined
  const only = flag('company') || undefined

  console.log(`Banco: ${databaseTarget()}${isDryRun ? '  (prévia, nada é escrito)' : ''}`)

  const companies = only
    ? [{ id: only }]
    : await prisma.company.findMany({ select: { id: true }, orderBy: { id: 'asc' } })

  for (const company of companies) {
    console.log(`\n▸ ${company.id}`)
    console.log('  competências duplicadas')
    const fundidos = new Set<string>()
    for (const merge of MERGES) {
      if (await mergeOne(company.id, merge, isDryRun)) fundidos.add(merge.keepSlug)
    }
    console.log('  descrições dos selos')
    await fixDescriptions(company.id, fundidos, isDryRun)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
