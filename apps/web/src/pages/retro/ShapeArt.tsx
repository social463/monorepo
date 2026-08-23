import type { RetroCardColor, RetroShape } from '@legends/shared'
import { SHAPE_COLOR_CLASS } from './ColorPalette'

export function ShapeArt({ shape, color, solid }: { shape: RetroShape; color: RetroCardColor; solid: boolean }) {
  const palette = SHAPE_COLOR_CLASS[color] ?? SHAPE_COLOR_CLASS.blue
  const fill = solid ? palette.fill : 'fill-transparent'
  const stroke = palette.stroke

  return (
    <g className={`${fill} ${stroke}`} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
      {shape === 'rectangle' && <rect x="18" y="22" width="124" height="60" rx="8" />}
      {shape === 'circle' && <ellipse cx="80" cy="52" rx="55" ry="36" />}
      {shape === 'diamond' && <path d="M80 12l66 40-66 40-66-40z" />}
      {shape === 'triangle' && <path d="M80 13l66 78H14z" />}
      {shape === 'arrow-right' && <path d="M12 37h78V16l58 36-58 36V67H12z" />}
      {shape === 'line' && <path d="M18 52h124" fill="none" />}
      {shape === 'star' && <path d="M80 13l15 27 31 6-22 23 4 32-28-14-28 14 4-32-22-23 31-6z" />}
      {shape === 'heart' && <path d="M80 91S25 61 25 32c0-16 12-25 26-25 12 0 22 8 29 19C87 15 97 7 109 7c14 0 26 9 26 25 0 29-55 59-55 59z" />}
      {shape === 'target' && (
        <>
          <circle cx="80" cy="52" r="39" />
          <circle cx="80" cy="52" r="20" fill="none" />
          <path d="M80 9v15M80 80v15M37 52H22M138 52h-15" fill="none" />
        </>
      )}
      {shape === 'document' && (
        <>
          <path d="M44 12h50l22 22v58H44z" />
          <path d="M94 12v24h22M59 52h42M59 68h34" fill="none" />
        </>
      )}
      {shape === 'robot' && (
        <>
          <rect x="42" y="30" width="76" height="52" rx="10" />
          <path d="M80 30V15M61 82v13M99 82v13M30 52h12M118 52h12" fill="none" />
          <path d="M64 55h.1M96 55h.1M67 70h26" fill="none" />
        </>
      )}
      {shape === 'bug' && (
        <>
          <ellipse cx="80" cy="57" rx="31" ry="34" />
          <path d="M60 25l-9-11M100 25l9-11M49 45H29M49 66H29M111 45h20M111 66h20M57 92l-13 10M103 92l13 10M80 30v60" fill="none" />
        </>
      )}
      {shape === 'cloud' && <path d="M49 81h61c17 0 29-11 29-25 0-13-10-24-24-25C109 17 96 8 80 8 60 8 44 22 41 41 28 44 20 52 20 63c0 10 9 18 29 18z" />}
      {shape === 'database' && (
        <>
          <ellipse cx="80" cy="25" rx="47" ry="15" />
          <path d="M33 25v54c0 9 21 16 47 16s47-7 47-16V25M33 52c0 9 21 16 47 16s47-7 47-16" fill="none" />
        </>
      )}
      {shape === 'gear' && (
        <>
          <path d="M80 14l10 8 13-3 7 12-7 11 4 10 12 6v14l-12 6-4 10 7 11-7 12-13-3-10 8-10-8-13 3-7-12 7-11-4-10-12-6V58l12-6 4-10-7-11 7-12 13 3z" />
          <circle cx="80" cy="65" r="17" fill="none" />
        </>
      )}
      {shape === 'briefcase' && (
        <>
          <rect x="26" y="36" width="108" height="55" rx="7" />
          <path d="M61 36v-9h38v9M26 57h108M72 57h16" fill="none" />
        </>
      )}
      {shape === 'calendar' && (
        <>
          <rect x="30" y="24" width="100" height="70" rx="8" />
          <path d="M53 13v21M107 13v21M30 47h100M56 66h.1M80 66h.1M104 66h.1M56 81h.1M80 81h.1" fill="none" />
        </>
      )}
      {shape === 'checklist' && (
        <>
          <rect x="38" y="16" width="84" height="80" rx="8" />
          <path d="M58 43l8 8 15-18M58 72l8 8 15-18M91 44h17M91 74h17" fill="none" />
        </>
      )}
      {shape === 'person' && (
        <>
          <circle cx="80" cy="31" r="20" />
          <path d="M43 94c5-24 20-36 37-36s32 12 37 36z" />
        </>
      )}
      {shape === 'smiley' && (
        <>
          <circle cx="80" cy="52" r="42" />
          <path d="M60 43h.1M100 43h.1M58 63c8 12 36 12 44 0" fill="none" />
        </>
      )}
      {shape === 'shield' && <path d="M80 10l48 18v31c0 25-18 40-48 45-30-5-48-20-48-45V28z" />}
      {shape === 'battery' && (
        <>
          <rect x="39" y="24" width="75" height="58" rx="8" />
          <path d="M114 44h9v18h-9M55 43h43M55 63h31" fill="none" />
        </>
      )}
      {shape === 'grid' && (
        <>
          <rect x="21" y="15" width="30" height="30" rx="5" />
          <rect x="65" y="15" width="30" height="30" rx="5" />
          <rect x="109" y="15" width="30" height="30" rx="5" />
          <rect x="21" y="59" width="30" height="30" rx="5" />
          <rect x="65" y="59" width="30" height="30" rx="5" />
          <rect x="109" y="59" width="30" height="30" rx="5" />
        </>
      )}
      {shape === 'chart' && (
        <>
          <path d="M28 88h104" fill="none" />
          <rect x="39" y="56" width="18" height="32" rx="3" />
          <rect x="71" y="35" width="18" height="53" rx="3" />
          <rect x="103" y="18" width="18" height="70" rx="3" />
        </>
      )}
      {shape === 'warning' && (
        <>
          <path d="M80 13l66 82H14z" />
          <path d="M80 42v25M80 82h.1" fill="none" />
        </>
      )}
      {shape === 'lock' && (
        <>
          <rect x="39" y="45" width="82" height="49" rx="8" />
          <path d="M58 45V32c0-14 9-23 22-23s22 9 22 23v13M80 66v11" fill="none" />
        </>
      )}
    </g>
  )
}
