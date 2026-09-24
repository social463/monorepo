import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_BONUS_PROGRAM, type BonusProgramSettings, type BonusTier } from '@legends/shared'
import { apiFetch, ApiError } from '../../../lib/api'
import { useCultureManuals } from '../../../lib/use-culture'
import { Icon } from '../../../components/Icon'
import { Select } from '../../../components/Select'
import { Panel, inputCls } from '../shared'

/**
 * Os números do Todos Pelos 9 (Documento 4, seção 14).
 *
 * Eles são da empresa, não do código: a data final do ciclo e os valores
 * distribuídos mudam a cada rodada do programa, e cravá-los obrigaria um deploy
 * para corrigir um número — com bônus errado na tela de todo mundo até lá.
 *
 * O vínculo com o manual mora aqui pelo mesmo motivo: a seção 14 pede a
 * calculadora "veiculada à página existente do manual", e qual manual é esse é
 * decisão da G&G, que cadastra os manuais em produção.
 */
export function BonusProgramSection() {
  const queryClient = useQueryClient()
  const [erro, setErro] = useState<string | null>(null)
  const [salvo, setSalvo] = useState(false)

  const { data } = useQuery({
    queryKey: ['bonus-program'],
    queryFn: () => apiFetch<{ settings: BonusProgramSettings }>('/bonus-program'),
  })
  const manuaisQuery = useCultureManuals()

  const [totalQuotas, setTotalQuotas] = useState('')
  const [deadline, setDeadline] = useState('')
  const [manualId, setManualId] = useState('')
  const [tiers, setTiers] = useState<BonusTier[]>(DEFAULT_BONUS_PROGRAM.tiers)

  // Semeia o formulário quando a configuração chega. `data` é a identidade que
  // muda uma vez, na resposta — não a cada tecla digitada.
  useEffect(() => {
    if (!data) return
    setTotalQuotas(String(data.settings.totalQuotas))
    setDeadline(data.settings.deadline)
    setManualId(data.settings.manualId ?? '')
    setTiers(data.settings.tiers)
  }, [data])

  const salvar = useMutation({
    mutationFn: (body: BonusProgramSettings) =>
      apiFetch<{ settings: BonusProgramSettings }>('/admin/bonus-program', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setErro(null)
      setSalvo(true)
      queryClient.invalidateQueries({ queryKey: ['bonus-program'] })
    },
    onError: (err: unknown) =>
      setErro(err instanceof ApiError ? err.message : 'Erro ao salvar o programa.'),
  })

  function alterarMeta(indice: number, campo: keyof BonusTier, valor: string) {
    setSalvo(false)
    setTiers((atuais) =>
      atuais.map((meta, i) => (i === indice ? { ...meta, [campo]: Number(valor) } : meta)),
    )
  }

  return (
    <Panel title="Todos Pelos 9">
      <form
        className="flex flex-col gap-lg"
        onSubmit={(e) => {
          e.preventDefault()
          salvar.mutate({
            totalQuotas: Number(totalQuotas),
            deadline,
            tiers,
            manualId: manualId || null,
          })
        }}
      >
        <p className="text-body-md text-on-surface-variant">
          O que a calculadora usa para converter as cotas de cada pessoa em valor. Todo colaborador vê a
          calculadora; estes números aparecem nela.
        </p>

        <div className="grid gap-md sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Total de cotas da empresa</span>
            <input
              type="number"
              min="1"
              value={totalQuotas}
              onChange={(e) => {
                setSalvo(false)
                setTotalQuotas(e.target.value)
              }}
              className={inputCls}
            />
            <span className="text-label-sm text-on-surface-variant">
              O denominador do rateio: a fatia de cada pessoa é a cota dela sobre este total.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Data final do ciclo</span>
            <input
              type="date"
              value={deadline}
              onChange={(e) => {
                setSalvo(false)
                setDeadline(e.target.value)
              }}
              className={inputCls}
            />
            <span className="text-label-sm text-on-surface-variant">
              Até quando o tempo de casa conta — a mesma régua para todo mundo.
            </span>
          </label>
        </div>

        <div className="flex flex-col gap-sm">
          <span className="font-label text-label-sm text-on-surface-variant">
            Metas e valor distribuído
          </span>
          {tiers.map((meta, i) => (
            <div key={i} className="flex flex-wrap items-end gap-md">
              <label className="flex flex-col gap-1">
                <span className="text-label-sm text-on-surface-variant">Meta (%)</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={meta.percent}
                  onChange={(e) => alterarMeta(i, 'percent', e.target.value)}
                  className={`${inputCls} w-28`}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-label-sm text-on-surface-variant">Valor distribuído (R$)</span>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  value={meta.pool}
                  onChange={(e) => alterarMeta(i, 'pool', e.target.value)}
                  className={`${inputCls} w-48`}
                />
              </label>
              {tiers.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setSalvo(false)
                    setTiers((atuais) => atuais.filter((_, idx) => idx !== i))
                  }}
                  aria-label={`Remover a meta de ${meta.percent}%`}
                  className="pb-2 text-on-surface-variant transition-colors hover:text-error"
                >
                  <Icon name="delete" className="text-[20px]" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              setSalvo(false)
              setTiers((atuais) => [...atuais, { percent: 0, pool: 0 }])
            }}
            className="w-fit font-label text-label-md text-primary hover:underline"
          >
            + Adicionar meta
          </button>
        </div>

        <label className="flex max-w-md flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">
            Manual que abre a calculadora
          </span>
          <Select
            ariaLabel="Manual que abre a calculadora"
            value={manualId}
            onChange={(v) => {
              setSalvo(false)
              setManualId(v)
            }}
            options={[
              { value: '', label: 'Nenhum — a calculadora fica só pela URL' },
              ...(manuaisQuery.data?.manuals ?? []).map((m) => ({ value: m.id, label: m.title })),
            ]}
          />
          <span className="text-label-sm text-on-surface-variant">
            O manual escolhido ganha o atalho “Simular o meu bônus”.
          </span>
        </label>

        {erro && <p role="alert" className="text-body-sm text-error">{erro}</p>}
        {salvo && !erro && (
          <p className="text-body-sm text-primary">Programa salvo.</p>
        )}

        <button
          type="submit"
          disabled={salvar.isPending}
          className="w-fit rounded-md bg-primary px-lg py-sm font-label text-label-lg text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </button>
      </form>
    </Panel>
  )
}
