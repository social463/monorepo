const STEPS = [
  'Escolha o tópico da discussão (ex.: a última sprint).',
  'Cada pessoa adiciona post-its nas quatro áreas com ideias/feedback.',
  'Discutam em grupo e usem os votos para priorizar.',
  'Reajam aos post-its com que concordam.',
  'Registrem as Ações de acompanhamento a partir dos pontos mais votados.',
]

export function BoardInstructions({ title }: { title: string }) {
  return (
    <div className="absolute" style={{ left: 0, top: 0, width: 880 }}>
      <h3 className="font-headline text-title-lg text-primary">{title}</h3>
      <ol className="mt-2 space-y-1">
        {STEPS.map((s, i) => (
          <li key={i} className="text-body-sm text-on-surface-variant">
            <span className="font-bold text-on-surface">{i + 1}.</span> {s}
          </li>
        ))}
      </ol>
    </div>
  )
}
