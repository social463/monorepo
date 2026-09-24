import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  VACATION_PLAN_STATUS_LABELS,
  formatCivilDate,
  type MyVacationEntitlementDTO,
} from '@legends/shared'
import { fetchMyVacationPlanning, saveMyVacationRequest } from '../../lib/vacation-planning-api'
import { Icon } from '../../components/Icon'

/**
 * "Minhas férias", no próprio perfil.
 *
 * Hoje a pessoa descobre as próprias férias por e-mail, depois de decididas.
 * Aqui ela vê **o direito** (quanto tem e até quando pode gozar), **pede** o que
 * gostaria antes de o gestor programar, e acompanha em que pé está.
 *
 * O pedido é **pedido, não promessa** — e a tela diz isso com essas palavras.
 * Quem decide é o gestor, que precisa cobrir a área; escrever qualquer outra
 * coisa criaria uma expectativa que o produto não tem como honrar.
 */
export function MyVacationSection() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['my-vacation-planning'], queryFn: fetchMyVacationPlanning })

  const salvar = useMutation({
    mutationFn: saveMyVacationRequest,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-vacation-planning'] }),
  })

  const itens = query.data?.items ?? []
  // Sem campanha aberta ou sem direito, a seção não ocupa espaço no perfil.
  if (query.isLoading || query.isError || !query.data?.campaign || itens.length === 0) return null

  return (
    <section className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-lg">
      <h2 className="flex items-center gap-xs font-headline text-headline-md text-on-surface">
        <Icon name="beach_access" className="text-[20px] text-primary" />
        Minhas férias
      </h2>
      <p className="mt-1 text-body-sm text-on-surface-variant">
        Programação de {query.data.campaign.year}. Você pode dizer o que prefere — quem decide,
        combinando a cobertura da área, é a sua liderança.
      </p>

      <div className="mt-md flex flex-col gap-md">
        {itens.map((item) => (
          <ItemDoDireito
            key={item.entitlement.id}
            item={item}
            salvando={salvar.isPending}
            onSalvar={(periods, note) =>
              salvar.mutate({ entitlementId: item.entitlement.id, periods, note })
            }
          />
        ))}
      </div>
    </section>
  )
}

function ItemDoDireito({
  item,
  salvando,
  onSalvar,
}: {
  item: MyVacationEntitlementDTO
  salvando: boolean
  onSalvar: (periods: { startDate: string; days: number }[], note: string) => void
}) {
  const [inicio, setInicio] = useState('')
  const [dias, setDias] = useState('')
  const [nota, setNota] = useState('')

  useEffect(() => {
    const pedido = item.request?.periods[0]
    setInicio(pedido?.startDate ?? '')
    setDias(pedido ? String(pedido.days) : '')
    setNota(item.request?.note ?? '')
  }, [item.request])

  const { entitlement, plan } = item
  // Validado é decidido; antes disso é plano do gestor, que ainda pode mudar —
  // mostrar como certo faria a pessoa se organizar em cima de algo provisório.
  const decidido = plan?.status === 'VALIDATED'

  return (
    <article className="rounded-lg border border-outline-variant/40 p-md">
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <p className="font-label text-label-md text-on-surface">
          Período aquisitivo {formatCivilDate(entitlement.acquisitionStart)} a{' '}
          {formatCivilDate(entitlement.acquisitionEnd)}
        </p>
        <p className="text-body-sm text-on-surface-variant">
          {entitlement.balanceDays} dias · precisam terminar até{' '}
          <strong>{formatCivilDate(entitlement.dueDate)}</strong>
        </p>
      </div>

      {decidido ? (
        <div className="mt-sm rounded-lg bg-tertiary-container px-sm py-xs text-body-sm text-on-tertiary-container">
          <p className="font-label text-label-sm">Suas férias estão programadas</p>
          <ul className="mt-1 space-y-0.5">
            {plan!.periods.map((p) => (
              <li key={p.startDate}>
                {formatCivilDate(p.startDate)} a {formatCivilDate(p.endDate)} — {p.days} dias
                {p.soldDays > 0 ? ` (+${p.soldDays} vendidos)` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          {plan && plan.periods.length > 0 && (
            <p className="mt-sm rounded-lg bg-surface-container px-sm py-xs text-body-sm text-on-surface-variant">
              Sua liderança já rascunhou datas ({VACATION_PLAN_STATUS_LABELS[plan.status]}). Elas só
              valem depois que o time de Gente e Gestão conferir.
            </p>
          )}

          <div className="mt-sm grid gap-sm sm:grid-cols-[1fr_7rem]">
            <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
              Quando você gostaria de começar?
              <input
                type="date"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
                className="rounded-lg border border-outline-variant bg-surface px-sm py-xs text-body-md text-on-surface"
              />
            </label>
            <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
              Quantos dias?
              <input
                type="number"
                min={1}
                max={30}
                value={dias}
                onChange={(e) => setDias(e.target.value)}
                className="rounded-lg border border-outline-variant bg-surface px-sm py-xs text-body-md text-on-surface"
              />
            </label>
          </div>

          <label className="mt-sm flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Quer explicar alguma coisa? (opcional)
            <textarea
              rows={2}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ex.: casamento em julho, se der."
              className="rounded-lg border border-outline-variant bg-surface px-sm py-xs text-body-md text-on-surface"
            />
          </label>

          <div className="mt-sm flex flex-wrap items-center gap-sm">
            <button
              type="button"
              disabled={salvando || !inicio || !dias}
              onClick={() => onSalvar([{ startDate: inicio, days: Number(dias) }], nota)}
              className="rounded-lg bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              {salvando ? 'Enviando…' : item.request ? 'Atualizar pedido' : 'Enviar pedido'}
            </button>
            <span className="text-body-sm text-on-surface-variant">
              É um pedido, não uma reserva — a decisão é da sua liderança.
            </span>
          </div>

          {item.request && (
            <p className="mt-xs text-body-sm text-on-surface-variant">
              Pedido registrado. Sua liderança vê isso ao programar.
            </p>
          )}
        </>
      )}
    </article>
  )
}
