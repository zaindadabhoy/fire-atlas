// Human-readable labels for citation keys. The full key stays available as a tooltip,
// so every chip remains traceable to the evidence pack / source row.

const HABITATS: Record<string, string> = {
  'moon-base': 'Moon base',
  'apollo-1': 'Apollo 1',
  'earth-sea-level': 'Earth',
  iss: 'ISS',
  spacesuit: 'Spacesuit',
}

const PHASES: Record<string, string> = { solid: 'Solid', liquid: 'Droplet', gas: 'Gas' }

function humanizeFact(key: string): string {
  let text = key
  for (const [id, name] of Object.entries(HABITATS)) {
    if (text === id || text.startsWith(`${id}_`)) {
      text = `${name} · ${text.slice(id.length + 1)}`
      break
    }
  }
  const unit = /pressure/.test(text) ? ' psi' : ' %'
  return text
    .trim()
    .replace(/psi_(\d+)_\d+$/i, (_, n) => `PSI-${n}`) // trailing group index is internal
    .replace(/psi_(\d+)/gi, (_, n) => `PSI-${n}`)
    .replace(/(\d+)_(\d+)$/, `$1–$2${unit}`)
    .replace(/_/g, ' ')
    .replace(/\bgt(\d+)$/, `>$1${unit}`)
    .replace(/\blt(\d+)$/, `<$1${unit}`)
    .replace(/\babove (\d+)$/, `above $1 %`)
    .replace(/\bco2\b/gi, 'CO₂')
    .replace(/\bn2\b/gi, 'N₂')
    .replace(/\bhe\b/g, 'He')
    .replace(/\bo2\b/gi, 'O₂')
    .replace(/\bvs\b/g, 'vs.')
    .replace(/\bearth\b/g, 'Earth')
    .replace(/\b(saffire|flex|cfi|bass|spice)\b/gi, (m) => m.toUpperCase())
    .replace(/\bcfi g\b/gi, 'CFI-G')
    .replace(/\s+/g, ' ')
    .trim()
}

export function citeLabel(cite: string): string {
  if (cite.startsWith('fact:')) return `Fact · ${humanizeFact(cite.slice(5))}`
  if (cite.startsWith('coverage:')) return `Coverage · ${PHASES[cite.slice(9)] ?? cite.slice(9)}`
  if (cite.startsWith('habitat:')) return `Habitat · ${HABITATS[cite.slice(8)] ?? cite.slice(8)}`
  if (cite.startsWith('query:')) return 'Your query'
  if (cite.startsWith('PSI-') && cite.includes(':')) {
    const parts = cite.split(':')
    return `${parts[0]} · ${parts[parts.length - 1]}`
  }
  return cite
}
