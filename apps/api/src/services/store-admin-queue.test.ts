import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createProduct, updateOrderStatus, updateOrdersBatch, exportOrdersCsv, listOrdersForAdmin } from './store-admin-service'
import { redeemProduct, InvalidStatusTransitionError } from './store-service'

async function makeUser(role: 'LEGEND' | 'ADMIN' = 'LEGEND') {
  return prisma.user.create({
    data: { name: 'Pessoa', email: `q-${Math.random()}@x.com`, passwordHash: 'x', role },
  })
}

async function credit(userId: string, amount: number) {
  await prisma.coinTransaction.create({
    data: { userId, kind: 'MANUAL_CREDIT', amount, dedupeKey: `MANUAL:${Math.random()}`,
            day: new Date('2026-08-02'), companyId: DEFAULT_COMPANY_ID },
  })
}

function balanceOf(userId: string) {
  return prisma.coinTransaction
    .aggregate({ where: { userId }, _sum: { amount: true } })
    .then((r) => r._sum.amount ?? 0)
}

/** Pessoa com 500 coins, produto de 100 e um pedido pendente já resgatado. */
async function scenario() {
  const admin = await makeUser('ADMIN')
  const actor = { id: admin.id, companyId: DEFAULT_COMPANY_ID }
  const product = await createProduct(actor, {
    title: 'Fone', category: 'Equipamento', priceInCoins: 100, stock: 5,
  })
  const user = await makeUser()
  await credit(user.id, 500)
  const { order } = await redeemProduct({ id: user.id, companyId: DEFAULT_COMPANY_ID }, product.id)
  return { actor, user, product, order }
}

describe('transições', () => {
  it('aprova um pedido pendente', async () => {
    const { actor, user, product, order } = await scenario()
    const updated = await updateOrderStatus(actor, order.id, 'APPROVED', 'Separado no estoque')

    expect(updated.status).toBe('APPROVED')
    expect(updated.handledById).toBe(actor.id)
    expect(updated.handledAt).not.toBeNull()
    expect(updated.adminNotes).toBe('Separado no estoque')

    // Aprovar não é cancelar: nem coin nem estoque se mexem aqui. Se o refund ou a
    // devolução de estoque um dia escaparem do `if (next === 'CANCELLED')`, é esta
    // asserção que denuncia — as de cima sozinhas não veem.
    expect(await balanceOf(user.id)).toBe(400)
    const afterApprove = await prisma.storeProduct.findUniqueOrThrow({ where: { id: product.id } })
    expect(afterApprove.stock).toBe(4)
  })

  it('omitir adminNotes preserva a nota anterior; só null limpa', async () => {
    const { actor, order } = await scenario()
    await updateOrderStatus(actor, order.id, 'APPROVED', 'Separado no estoque')

    // Entrega sem digitar nota nenhuma: `undefined` não pode apagar o que a
    // aprovação já registrou.
    const delivered = await updateOrderStatus(actor, order.id, 'DELIVERED', undefined)
    expect(delivered.adminNotes).toBe('Separado no estoque')
  })

  // Achado #9 da revisão final: sem `adminNotes` no `before`, o log de auditoria
  // lia como se TODA mudança de status tivesse criado a nota agora, mesmo
  // quando ela já existia de uma decisão anterior.
  //
  // `toEqual` (e não `toMatchObject`) de propósito nas duas asserções de
  // `after`: `toMatchObject` ignora chave ausente, e foi exatamente uma chave
  // ausente (`adminNotes: undefined` removida pelo JSON.stringify de
  // `recordAuditLog`) que fez a correção original da #9 escapar deste mesmo
  // teste — o `after` ficava `{ status: 'DELIVERED' }`, sem `adminNotes`, e a
  // tela de auditoria (que calcula "o que mudou" pela união das chaves dos
  // dois lados) lia isso como "a nota foi apagada", quando na verdade só o
  // status mudou e a nota foi preservada.
  it('audita o before e o after com a nota preservada quando o PATCH a omite', async () => {
    const { actor, order } = await scenario()
    await updateOrderStatus(actor, order.id, 'APPROVED', 'Separado no estoque')

    // Entrega sem digitar nota nenhuma: `undefined` preserva, não apaga.
    await updateOrderStatus(actor, order.id, 'DELIVERED', undefined)

    const logs = await prisma.adminAuditLog.findMany({
      where: { entityType: 'StoreOrder', entityId: order.id },
      orderBy: { createdAt: 'asc' },
    })
    expect(logs).toHaveLength(2)
    expect(logs[1].before).toEqual({ status: 'APPROVED', adminNotes: 'Separado no estoque' })
    expect(logs[1].after).toEqual({ status: 'DELIVERED', adminNotes: 'Separado no estoque' })
  })

  it('audita a nota nova quando o PATCH a sobrescreve explicitamente', async () => {
    const { actor, order } = await scenario()
    await updateOrderStatus(actor, order.id, 'APPROVED', 'Separado no estoque')

    await updateOrderStatus(actor, order.id, 'CANCELLED', 'Cliente desistiu')

    const logs = await prisma.adminAuditLog.findMany({
      where: { entityType: 'StoreOrder', entityId: order.id },
      orderBy: { createdAt: 'asc' },
    })
    expect(logs).toHaveLength(2)
    expect(logs[1].before).toEqual({ status: 'APPROVED', adminNotes: 'Separado no estoque' })
    expect(logs[1].after).toEqual({ status: 'CANCELLED', adminNotes: 'Cliente desistiu' })
  })

  it('recusa pular de pendente direto para entregue', async () => {
    const { actor, order } = await scenario()
    await expect(
      updateOrderStatus(actor, order.id, 'DELIVERED', null),
    ).rejects.toBeInstanceOf(InvalidStatusTransitionError)
  })

  it('recusa mexer em pedido já entregue', async () => {
    const { actor, order } = await scenario()
    await updateOrderStatus(actor, order.id, 'APPROVED', null)
    await updateOrderStatus(actor, order.id, 'DELIVERED', null)

    await expect(
      updateOrderStatus(actor, order.id, 'APPROVED', null),
    ).rejects.toBeInstanceOf(InvalidStatusTransitionError)
  })

  it('entregar também não mexe em coin nem estoque', async () => {
    const { actor, user, product, order } = await scenario()
    await updateOrderStatus(actor, order.id, 'APPROVED', null)
    await updateOrderStatus(actor, order.id, 'DELIVERED', null)

    expect(await balanceOf(user.id)).toBe(400)
    const afterDeliver = await prisma.storeProduct.findUniqueOrThrow({ where: { id: product.id } })
    expect(afterDeliver.stock).toBe(4)
  })
})

describe('cancelamento', () => {
  it('devolve os coins e o estoque', async () => {
    const { actor, user, product, order } = await scenario()
    expect(await balanceOf(user.id)).toBe(400)

    await updateOrderStatus(actor, order.id, 'CANCELLED', 'Sem estoque no fornecedor')

    expect(await balanceOf(user.id)).toBe(500)
    const after = await prisma.storeProduct.findUniqueOrThrow({ where: { id: product.id } })
    expect(after.stock).toBe(5)
  })

  it('cancelar duas vezes não credita duas', async () => {
    const { actor, user, order } = await scenario()
    await updateOrderStatus(actor, order.id, 'CANCELLED', null)

    await expect(
      updateOrderStatus(actor, order.id, 'CANCELLED', null),
    ).rejects.toBeInstanceOf(InvalidStatusTransitionError)

    expect(await balanceOf(user.id)).toBe(500)
    expect(await prisma.coinTransaction.count({ where: { userId: user.id, kind: 'REFUND' } })).toBe(1)
  })

  it('cancela pedido de produto apagado: estorna os coins e não quebra', async () => {
    const { actor, user, product, order } = await scenario()
    await prisma.storeProduct.delete({ where: { id: product.id } })

    await updateOrderStatus(actor, order.id, 'CANCELLED', null)

    expect(await balanceOf(user.id)).toBe(500)
  })
})

describe('lote', () => {
  it('aprova os válidos e relata os que falharam', async () => {
    const { actor, order } = await scenario()
    const outro = await scenario()
    await updateOrderStatus(actor, outro.order.id, 'CANCELLED', null)   // já terminal

    const result = await updateOrdersBatch(actor, [order.id, outro.order.id], 'APPROVED', null)

    expect(result.succeeded).toEqual([order.id])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].id).toBe(outro.order.id)
    expect(result.failed[0].message).toBe('Não é possível mudar o pedido para este status.')
  })
})

describe('filtros e CSV', () => {
  it('filtra por status', async () => {
    const { actor, order } = await scenario()
    await scenario()
    await updateOrderStatus(actor, order.id, 'APPROVED', null)

    const { orders, total } = await listOrdersForAdmin(actor, { status: 'APPROVED' }, 1)

    expect(total).toBe(1)
    expect(orders[0].id).toBe(order.id)
  })

  it('exporta CSV com BOM, cabeçalho e o preço congelado', async () => {
    const { actor } = await scenario()
    const csv = await exportOrdersCsv(actor, {})

    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('Pessoa;E-mail;Produto;Preço pago;Status')
    expect(csv).toContain(';100;Pendente')
  })
})
