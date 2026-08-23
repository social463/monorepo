/**
 * Quem cada pessoa lidera. Esta é a **única** definição da regra no backend —
 * o painel de humor do time, o lançamento de férias e os indicadores da
 * Liderança consomem daqui, para não divergirem com o tempo.
 *
 * A fonte de verdade é **`User.managerId`**, o mesmo líder direto que desenha o
 * organograma (`organization-service`). Antes o escopo vinha de squad (para
 * LEAD) e de área (para MANAGER), o que mantinha duas hierarquias paralelas no
 * produto: "meu time" na área de Liderança podia não ser o time que aparece
 * abaixo da pessoa no organograma. Agora é o mesmo, e por construção — os dois
 * lados leem `ORGANIZATION_MEMBER_WHERE` do organograma para decidir quem
 * existe na cadeia de comando.
 *
 * Consequências deliberadas da troca:
 *
 * - **Papel não importa mais.** Quem tem gente apontando para si lidera, seja
 *   HEAD, MANAGER, LEAD ou LEGEND. HEAD, que antes não via ninguém, passa a ver
 *   os diretos; squad liderada por quem não tem `managerId` de ninguém deixa de
 *   dar escopo. Some junto a assimetria antiga entre `managesUser` e
 *   `listManagedGroups` — as duas leem a mesma cadeia.
 * - **Listar é raso, autorizar é fundo.** `listManagedGroups` devolve os
 *   liderados **diretos**, que é o que os painéis mostram nominalmente;
 *   `managesUser` aceita qualquer pessoa da subárvore, porque um líder de
 *   líderes lança férias e lê humor de quem está dois níveis abaixo. Como a
 *   autorização é superconjunto da listagem, ninguém aparece num painel sem
 *   poder ser aberto.
 * - **Depende do dado.** Empresa sem `managerId` preenchido fica com os painéis
 *   vazios; o líder direto é cadastrado em Administração › Organização › Lendas
 *   (ou pela importação por planilha).
 *
 * `Squad.leaderId` e `User.area` continuam existindo para o que são — squad e
 * área —, só não definem mais quem lidera quem.
 */
import type { User } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { ORGANIZATION_MEMBER_WHERE } from './organization-service'

export interface ManagedGroup {
  /** `manager:<id>` — um grupo só, os liderados diretos de quem perguntou. */
  groupId: string
  groupName: string
  members: User[]
}

const GROUP_NAME = 'Meu time'

export async function managesUser(viewerId: string, targetId: string): Promise<boolean> {
  if (viewerId === targetId) return false

  const viewer = await prisma.user.findUnique({ where: { id: viewerId }, select: { companyId: true } })
  if (!viewer) return false

  const db = scopedPrisma(viewer.companyId)
  const target = await db.user.findFirst({
    where: { id: targetId, ...ORGANIZATION_MEMBER_WHERE },
    select: { managerId: true },
  })
  if (!target?.managerId) return false
  if (target.managerId === viewerId) return true

  // Fora o caso direto, sobe a cadeia até achar quem perguntou. Só os elegíveis
  // entram no mapa: líder desligado (ou de setor desativado) quebra o elo aqui
  // do mesmo jeito que quebra no organograma, onde a subárvore dele vira raiz.
  const rows = await db.user.findMany({ where: ORGANIZATION_MEMBER_WHERE, select: { id: true, managerId: true } })
  const managerOf = new Map(rows.map((row) => [row.id, row.managerId]))
  // `managerId` é campo livre: sem o `seen`, um ciclo gravado viraria laço infinito.
  const seen = new Set<string>([targetId])
  let current: string | null = target.managerId
  while (current) {
    if (current === viewerId) return true
    if (seen.has(current)) return false
    seen.add(current)
    current = managerOf.get(current) ?? null
  }
  return false
}

export async function listManagedGroups(viewerId: string): Promise<ManagedGroup[]> {
  const viewer = await prisma.user.findUnique({ where: { id: viewerId }, select: { companyId: true } })
  if (!viewer) return []

  const members = await scopedPrisma(viewer.companyId).user.findMany({
    where: { managerId: viewerId, ...ORGANIZATION_MEMBER_WHERE },
    orderBy: { name: 'asc' },
  })
  // Sem liderado direto não há grupo: os painéis mostram o vazio deles, e não
  // um cabeçalho de time sem ninguém embaixo.
  if (members.length === 0) return []
  return [{ groupId: `manager:${viewerId}`, groupName: GROUP_NAME, members }]
}
