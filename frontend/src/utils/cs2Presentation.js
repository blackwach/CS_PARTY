const RANK_COLORS = {
  0: ['#3a3f46', '#5f6670'],
  1: ['#7b8087', '#a2a8b1'],
  2: ['#7b8087', '#a2a8b1'],
  3: ['#7b8087', '#a2a8b1'],
  4: ['#7b8087', '#a2a8b1'],
  5: ['#848a92', '#b3bac4'],
  6: ['#8e959f', '#c2cad6'],
  7: ['#8f7a43', '#d7b766'],
  8: ['#8f7a43', '#d7b766'],
  9: ['#8f7a43', '#d7b766'],
  10: ['#9c8247', '#e0bf6c'],
  11: ['#4f74a6', '#7fb2f0'],
  12: ['#4f74a6', '#7fb2f0'],
  13: ['#3f6f98', '#72b0e8'],
  14: ['#315e8f', '#5ea7df'],
  15: ['#8a7a9e', '#c6a0ef'],
  16: ['#8a7a9e', '#c6a0ef'],
  17: ['#b3883d', '#f0ca77'],
  18: ['#ba9224', '#ffd45b'],
}

const MAP_META = {
  de_ancient: { title: 'Ancient', palette: ['#1f3d32', '#7fb092'] },
  de_anubis: { title: 'Anubis', palette: ['#73523a', '#d4b184'] },
  de_dust2: { title: 'Dust II', palette: ['#8d6542', '#d7b488'] },
  de_inferno: { title: 'Inferno', palette: ['#753b35', '#d79b7e'] },
  de_mirage: { title: 'Mirage', palette: ['#4b5f77', '#c09d73'] },
  de_nuke: { title: 'Nuke', palette: ['#355072', '#82a8d1'] },
  de_train: { title: 'Train', palette: ['#3a4b55', '#9ca8b0'] },
  de_overpass: { title: 'Overpass', palette: ['#425a45', '#a7c083'] },
  de_vertigo: { title: 'Vertigo', palette: ['#4f4a62', '#a6a0c8'] },
  de_office: { title: 'Office', palette: ['#2f5f78', '#8ebcd2'] },
  de_italy: { title: 'Italy', palette: ['#6a5136', '#c7a074'] },
  de_cache: { title: 'Cache', palette: ['#35574b', '#86b6a4'] },
}

const MAP_ALIASES = {
  ancient: 'de_ancient',
  anubis: 'de_anubis',
  dust2: 'de_dust2',
  dust_2: 'de_dust2',
  de_dust_2: 'de_dust2',
  inferno: 'de_inferno',
  mirage: 'de_mirage',
  nuke: 'de_nuke',
  train: 'de_train',
  overpass: 'de_overpass',
  vertigo: 'de_vertigo',
  office: 'de_office',
  italy: 'de_italy',
  cache: 'de_cache',
}

const mapImageCache = new Map()
const rankBadgeCache = new Map()

function normalizeText(value) {
  return String(value || '').trim()
}

function normalizeMapKey(rawMap) {
  const source = normalizeText(rawMap).toLowerCase().replace(/\s+/g, '_')
  if (!source) return 'unknown'
  if (MAP_META[source]) return source
  if (MAP_ALIASES[source]) return MAP_ALIASES[source]
  const withoutPrefix = source.replace(/^(de_|cs_|ar_)/, '')
  if (MAP_ALIASES[withoutPrefix]) return MAP_ALIASES[withoutPrefix]
  if (MAP_META[`de_${withoutPrefix}`]) return `de_${withoutPrefix}`
  return source
}

function buildDataUrl(svg) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function buildRankBadge(rankId, rankName) {
  const id = Number.isInteger(rankId) ? rankId : 0
  const colors = RANK_COLORS[id] || RANK_COLORS[0]
  const label = String(rankName || 'No rank')
  const shortLabel = id > 0 ? `R${id}` : 'N/A'

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="92" height="92" viewBox="0 0 92 92">
      <defs>
        <linearGradient id="rankGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${colors[0]}" />
          <stop offset="100%" stop-color="${colors[1]}" />
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="76" height="76" rx="18" fill="url(#rankGrad)" stroke="#0b0d11" stroke-width="4"/>
      <path d="M46 16 66 30v26L46 74 26 56V30z" fill="#0f1218" fill-opacity="0.33"/>
      <circle cx="46" cy="46" r="14" fill="#111827" fill-opacity="0.34"/>
      <text x="46" y="52" text-anchor="middle" fill="#f8fafc" font-size="17" font-family="Verdana, Arial, sans-serif" font-weight="700">${shortLabel}</text>
      <title>${label}</title>
    </svg>
  `
  return buildDataUrl(svg)
}

function buildMapPreview(meta) {
  const [start, end] = meta.palette
  const code = meta.code || ''
  const title = meta.title || 'Unknown map'
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="360" height="208" viewBox="0 0 360 208">
      <defs>
        <linearGradient id="mapGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${start}" />
          <stop offset="100%" stop-color="${end}" />
        </linearGradient>
      </defs>
      <rect width="360" height="208" rx="20" fill="url(#mapGrad)" />
      <g stroke="#0f172a" stroke-opacity="0.22" stroke-width="2" fill="none">
        <path d="M-10 34 62 12l64 34 52-14 66 28 52-9 78 26" />
        <path d="M-20 140 64 115l62 19 70-22 58 14 86-26" />
      </g>
      <rect x="14" y="14" width="332" height="180" rx="14" fill="#09121d" fill-opacity="0.18" stroke="#ffffff" stroke-opacity="0.2" />
      <text x="26" y="166" fill="#ecfeff" font-size="34" font-family="Verdana, Arial, sans-serif" font-weight="700">${title}</text>
      <text x="26" y="189" fill="#dbeafe" fill-opacity="0.92" font-size="16" font-family="Consolas, monospace">${code}</text>
    </svg>
  `
  return buildDataUrl(svg)
}

export function getCs2RankBadgeDataUrl(rankId, rankName = '') {
  const id = Number.isInteger(rankId) ? rankId : 0
  const cacheKey = `${id}|${String(rankName || '')}`
  if (!rankBadgeCache.has(cacheKey)) {
    rankBadgeCache.set(cacheKey, buildRankBadge(id, rankName))
  }
  return rankBadgeCache.get(cacheKey)
}

export function getCs2MapMeta(rawMap) {
  const key = normalizeMapKey(rawMap)
  const known = MAP_META[key] || null
  const fallbackCode = normalizeText(rawMap).toLowerCase() || key || 'unknown'
  const code = known ? key : fallbackCode
  const title = known ? known.title : normalizeText(rawMap) || code.toUpperCase()
  const palette = known ? known.palette : ['#334155', '#64748b']
  const imageKey = known ? key : `fallback:${title}`

  if (!mapImageCache.has(imageKey)) {
    mapImageCache.set(
      imageKey,
      buildMapPreview({
        title,
        code,
        palette,
      })
    )
  }

  return {
    key,
    code,
    title,
    image: mapImageCache.get(imageKey),
  }
}

