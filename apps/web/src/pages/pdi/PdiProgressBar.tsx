/**
 * Barra de progresso do PDI: rótulo à esquerda, porcentagem à direita e a barra
 * embaixo. Mora fora da página porque o painel do líder usa a mesma peça — e
 * importar de `PdiPage` fecharia um ciclo (a página importa o painel).
 */
export function PdiProgressBar({
  value,
  label,
  className = 'h-2',
}: {
  value: number
  label?: string
  className?: string
}) {
  return (
    <div className="flex flex-col gap-xs">
      <div className="flex items-center justify-between gap-sm font-label text-label-sm text-on-surface-variant">
        <span>{label}</span>
        <span className="tabular-nums">{value}%</span>
      </div>
      <div className={`overflow-hidden rounded-full bg-surface-container-highest ${className}`}>
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  )
}
