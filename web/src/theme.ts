export type Theme = 'light' | 'dark' | 'system'
export type AccentName = 'teal' | 'indigo' | 'plum' | 'vermillion' | 'amber'

const KEY = 'pl-theme'
const ACCENT_KEY = 'pl-accent'

interface AccentVars {
  accent: string
  ink: string
  soft: string
  line: string
}

/** 强调色预设:浅色/深色各一套,与 index.css 里的默认青墨绿同结构 */
const ACCENTS: Record<AccentName, { label: string; light: AccentVars; dark: AccentVars }> = {
  teal: {
    label: '青墨绿',
    light: { accent: '#0e7a6d', ink: '#0a5f55', soft: '#e4f2ef', line: '#b9dcd5' },
    dark: {
      accent: '#3fbfae',
      ink: '#7fdcd0',
      soft: 'rgba(63,191,174,.13)',
      line: 'rgba(63,191,174,.32)',
    },
  },
  indigo: {
    label: '靛蓝',
    light: { accent: '#4338ca', ink: '#3730a3', soft: '#e9e9fb', line: '#c5c6f0' },
    dark: {
      accent: '#8b93f8',
      ink: '#b2b7fb',
      soft: 'rgba(139,147,248,.13)',
      line: 'rgba(139,147,248,.32)',
    },
  },
  plum: {
    label: '绛紫',
    light: { accent: '#7c3aed', ink: '#5b21b6', soft: '#f1eafd', line: '#d7c3f5' },
    dark: {
      accent: '#b48cf7',
      ink: '#ccb0fa',
      soft: 'rgba(180,140,247,.13)',
      line: 'rgba(180,140,247,.32)',
    },
  },
  vermillion: {
    label: '朱砂',
    light: { accent: '#b8452f', ink: '#96381f', soft: '#fbeae5', line: '#f0c6b9' },
    dark: {
      accent: '#f0806a',
      ink: '#f5a897',
      soft: 'rgba(240,128,106,.13)',
      line: 'rgba(240,128,106,.32)',
    },
  },
  amber: {
    label: '琥珀',
    light: { accent: '#b45309', ink: '#8a4207', soft: '#fdf1e0', line: '#f3d6ac' },
    dark: {
      accent: '#e8a33d',
      ink: '#f0bd70',
      soft: 'rgba(232,163,61,.13)',
      line: 'rgba(232,163,61,.32)',
    },
  },
}

/** 供设置页渲染色板 */
export const ACCENT_CHOICES = (Object.keys(ACCENTS) as AccentName[]).map((value) => ({
  value,
  label: ACCENTS[value].label,
  swatch: ACCENTS[value].light.accent,
}))

export const isPresetAccent = (v: string): v is AccentName => v in ACCENTS

export function getTheme(): Theme {
  return (localStorage.getItem(KEY) as Theme) || 'system'
}

/** 存预设名(如 'teal')或自定义十六进制色(如 '#7c3aed') */
export function getAccent(): string {
  return localStorage.getItem(ACCENT_KEY) || 'teal'
}

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** 单色 → 整套强调色。全部算出具体 rgb/rgba:
 *  直接把 color-mix 写进 CSS 变量的话,每个用到该变量的元素都要现场解析一次,
 *  自定义取色拖动时整站重绘会明显卡顿。 */
function deriveAccent(hex: string, dark: boolean) {
  const [r, g, b] = hexToRgb(hex)
  const WHITE: [number, number, number] = [255, 255, 255]
  const BLACK: [number, number, number] = [0, 0, 0]
  /** 与 color-mix(in srgb, 基色 pct%, target) 等价 */
  const toward = (target: [number, number, number], pct: number): [number, number, number] => {
    const t = pct / 100
    return [
      Math.round(r * t + target[0] * (1 - t)),
      Math.round(g * t + target[1] * (1 - t)),
      Math.round(b * t + target[2] * (1 - t)),
    ]
  }
  const rgb = (c: [number, number, number]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`
  const rgba = (a: number) => `rgba(${r}, ${g}, ${b}, ${a})`

  return dark
    ? {
        accent: rgb(toward(WHITE, 80)), // 基色提亮,深底上才够亮
        ink: rgb(toward(WHITE, 62)),
        soft: rgba(0.15),
        line: rgba(0.42),
      }
    : {
        accent: hex,
        ink: rgb(toward(BLACK, 78)), // 压暗,浅底上才够沉
        soft: rgb(toward(WHITE, 12)),
        line: rgb(toward(WHITE, 34)),
      }
}

/** 把强调色写进 <html> 的行内样式:优先级高于 :root 和 .dark 里的默认值 */
function paintAccent() {
  const dark = document.documentElement.classList.contains('dark')
  const v = getAccent()
  const root = document.documentElement.style

  if (isPresetAccent(v)) {
    const vars = ACCENTS[v][dark ? 'dark' : 'light']
    root.setProperty('--accent', vars.accent)
    root.setProperty('--accent-ink', vars.ink)
    root.setProperty('--accent-soft', vars.soft)
    root.setProperty('--accent-line', vars.line)
    return
  }

  const d = deriveAccent(v, dark)
  root.setProperty('--accent', d.accent)
  root.setProperty('--accent-ink', d.ink)
  root.setProperty('--accent-soft', d.soft)
  root.setProperty('--accent-line', d.line)
}

export function applyAccent(t: string) {
  localStorage.setItem(ACCENT_KEY, t)
  paintAccent()
}

export function applyTheme(t: Theme) {
  localStorage.setItem(KEY, t)
  const dark =
    t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  paintAccent() // 强调色分浅色/深色两套,主题变了要重新涂
}

export function initTheme() {
  applyTheme(getTheme())
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getTheme() === 'system') applyTheme('system')
  })
}

/* ── 论文正文字体 ──
   只作用于阅读页正文(.pl-prose),界面本身仍用 --font-ui。
   中西文分开选:CSS 会先用西文字体,缺字再回退到中文字体栈。 */

const PAPER_LATIN_KEY = 'pl-paper-latin'
const PAPER_CJK_KEY = 'pl-paper-cjk'

export const PAPER_LATIN: { value: string; label: string; stack: string }[] = [
  { value: 'georgia', label: 'Georgia', stack: 'Georgia' },
  { value: 'times', label: 'Times New Roman', stack: '"Times New Roman", Times' },
  {
    value: 'palatino',
    label: 'Palatino',
    stack: '"Palatino Linotype", Palatino, "Book Antiqua"',
  },
  { value: 'cambria', label: 'Cambria', stack: 'Cambria' },
  { value: 'constantia', label: 'Constantia', stack: 'Constantia' },
  { value: 'garamond', label: 'Garamond', stack: 'Garamond, "EB Garamond"' },
  { value: 'segoe', label: 'Segoe UI', stack: '"Segoe UI"' },
  { value: 'arial', label: 'Arial', stack: 'Arial, Helvetica' },
]

export const PAPER_CJK: { value: string; label: string; stack: string }[] = [
  { value: 'system', label: '系统默认', stack: '"PingFang SC", "Microsoft YaHei", ui-sans-serif' },
  { value: 'simsun', label: '宋体', stack: 'SimSun, "Songti SC", NSimSun, serif' },
  { value: 'kaiti', label: '楷体', stack: 'KaiTi, "Kaiti SC", STKaiti, serif' },
  { value: 'fangsong', label: '仿宋', stack: 'FangSong, FangSong_GB2312, STFangsong, serif' },
  { value: 'simhei', label: '黑体', stack: 'SimHei, "Heiti SC", STHeiti, sans-serif' },
  { value: 'yahei', label: '微软雅黑', stack: '"Microsoft YaHei", "PingFang SC", sans-serif' },
  { value: 'dengxian', label: '等线', stack: 'DengXian, "DengXian Light", sans-serif' },
]

export function getPaperLatin(): string {
  const v = localStorage.getItem(PAPER_LATIN_KEY)
  return v && PAPER_LATIN.some((f) => f.value === v) ? v : 'georgia'
}

export function getPaperCjk(): string {
  const v = localStorage.getItem(PAPER_CJK_KEY)
  return v && PAPER_CJK.some((f) => f.value === v) ? v : 'system'
}

function paintPaperFont() {
  const latin = PAPER_LATIN.find((f) => f.value === getPaperLatin())?.stack ?? ''
  const cjk = PAPER_CJK.find((f) => f.value === getPaperCjk())?.stack ?? ''
  const stack = [latin, cjk, 'ui-sans-serif', 'sans-serif'].filter(Boolean).join(', ')
  document.documentElement.style.setProperty('--font-paper', stack)
}

export function applyPaperFont(latin: string, cjk: string) {
  localStorage.setItem(PAPER_LATIN_KEY, latin)
  localStorage.setItem(PAPER_CJK_KEY, cjk)
  paintPaperFont()
}

/** 界面缩放档位:整体等比缩放字号与控件尺寸 */
export const SCALE_CHOICES = [0.9, 1, 1.1, 1.25]

const SCALE_KEY = 'pl-ui-scale'

export function getUiScale(): number {
  const v = parseFloat(localStorage.getItem(SCALE_KEY) || '1')
  return SCALE_CHOICES.includes(v) ? v : 1
}

export function initAppearance() {
  // 旧版本设过「界面字体」,已改成论文字体;清掉免得界面停在非常规字体上
  localStorage.removeItem('pl-font-ui')
  document.documentElement.style.removeProperty('--font-ui')
  paintPaperFont()
  applyUiScale(getUiScale())
}

/** 用 CSS zoom 整体缩放。--pl-zoom 同时暴露给样式表,
 *  让 100dvh 之类的视口单位可以除掉它(否则缩放后换算会偏大)。 */
export function applyUiScale(n: number) {
  localStorage.setItem(SCALE_KEY, String(n))
  const root = document.documentElement
  root.style.setProperty('--pl-zoom', String(n))
  root.style.zoom = n === 1 ? '' : String(n)
}
