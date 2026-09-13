import {
  Check,
  CheckCircle2,
  Cpu,
  Download,
  Info,
  Languages,
  Loader2,
  Palette,
  Plug,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import Dropdown from '../components/Dropdown'
import ThemeSwitch from '../components/ThemeSwitch'
import {
  ACCENT_CHOICES,
  applyAccent,
  applyPaperFont,
  applyUiScale,
  getAccent,
  getPaperCjk,
  getPaperLatin,
  getUiScale,
  isPresetAccent,
  PAPER_CJK,
  PAPER_LATIN,
  SCALE_CHOICES,
} from '../theme'
import type { EngineInfo, EngineInstallState, Settings as SettingsType } from '../types'

const EFFORT_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'none', label: 'none' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'max', label: 'max' },
]

/** 解析模型的下载源。MinerU 三个都认;Docling 只走 HuggingFace。 */
const MODEL_SOURCE_OPTIONS = [
  { value: 'hf-mirror', label: 'hf-mirror(国内镜像)' },
  { value: 'modelscope', label: 'ModelScope(仅 MinerU)' },
  { value: 'huggingface', label: 'HuggingFace(官方)' },
]

/** 引擎包本身从 PyPI 下载,国内直连很慢,默认走镜像 */
const INDEX_OPTIONS = [
  { value: 'tsinghua', label: '清华 TUNA 镜像' },
  { value: 'aliyun', label: '阿里云镜像' },
  { value: 'ustc', label: '中科大镜像' },
  { value: 'tencent', label: '腾讯云镜像' },
  { value: '', label: 'PyPI 官方(pypi.org)' },
]

/** 目标语言:常用选项 + 自动保留自定义值 */
const LANG_OPTIONS = [
  { value: '简体中文', label: '简体中文' },
  { value: '繁体中文', label: '繁体中文' },
  { value: 'English', label: 'English' },
  { value: '日本語', label: '日本語' },
  { value: '한국어', label: '한국어' },
  { value: 'Deutsch', label: 'Deutsch' },
  { value: 'Français', label: 'Français' },
  { value: 'Español', label: 'Español' },
  { value: 'Русский', label: 'Русский' },
]

function Section({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: typeof Languages
  title: string
  desc: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-card border border-line bg-surface p-6 shadow-card">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft">
          <Icon className="h-4 w-4 text-accent" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-tight text-ink">{title}</h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-mut">{desc}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-medium text-ink2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] leading-relaxed text-mut">{hint}</span>}
    </label>
  )
}

/** 论文正文字体(中西文分开)与界面缩放 */
function FontScaleControls() {
  const [latin, setLatin] = useState<string>(() => getPaperLatin())
  const [cjk, setCjk] = useState<string>(() => getPaperCjk())
  const [scale, setScale] = useState<number>(() => getUiScale())

  const pick = (nextLatin: string, nextCjk: string) => {
    setLatin(nextLatin)
    setCjk(nextCjk)
    applyPaperFont(nextLatin, nextCjk)
  }

  return (
    <>
      <div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-ink2">论文字体 · 西文</p>
            <Dropdown
              value={latin}
              options={PAPER_LATIN.map((f) => ({ value: f.value, label: f.label }))}
              onChange={(v) => pick(v, cjk)}
              size="md"
            />
          </div>
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-ink2">论文字体 · 中文</p>
            <Dropdown
              value={cjk}
              options={PAPER_CJK.map((f) => ({ value: f.value, label: f.label }))}
              onChange={(v) => pick(latin, v)}
              size="md"
            />
          </div>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-mut">
          只影响阅读页的论文正文,界面本身不受影响;西文字体缺字时自动回退到中文字体。
        </p>
      </div>

      <div>
        <p className="mb-2 text-[12.5px] font-medium text-ink2">界面缩放</p>
        <div className="flex w-full max-w-[360px] items-center gap-0.5 rounded-[11px] border border-line bg-hover p-0.5">
          {SCALE_CHOICES.map((n) => {
            const on = scale === n
            return (
              <button
                key={n}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setScale(n)
                  applyUiScale(n)
                }}
                className={`h-7 flex-1 rounded-[8px] text-[12.5px] tabular-nums transition-colors duration-150 ${
                  on ? 'bg-surface font-medium text-ink shadow-card' : 'text-mut hover:text-ink2'
                }`}
              >
                {Math.round(n * 100)}%
              </button>
            )
          })}
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-mut">
          等比缩放界面字号与控件尺寸;阅读页正文另有右上角的 A− / A+ 单独调节。
        </p>
      </div>
    </>
  )
}

/** 强调色选择:5 个预设 + 任意自定义色,直接改 <html> 上的 CSS 变量,全站立即生效 */
function AccentPicker() {
  const [accent, setAccent] = useState<string>(() => getAccent())
  const preset = isPresetAccent(accent)
  const [hex, setHex] = useState(preset ? '#0e7a6d' : accent)

  // 取色器拖动时事件极其密集,每次都会触发整站重绘 —— 节流到 ~16 次/秒
  const pend = useRef('')
  const timer = useRef<number | null>(null)

  const pick = (v: string) => {
    setAccent(v)
    applyAccent(v)
  }

  const scheduleAccent = (v: string) => {
    pend.current = v
    if (timer.current !== null) return
    timer.current = window.setTimeout(() => {
      timer.current = null
      applyAccent(pend.current)
    }, 60)
  }

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  const onHex = (v: string) => {
    setHex(v)
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      const next = v.toLowerCase()
      setAccent(next)
      scheduleAccent(next)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {ACCENT_CHOICES.map(({ value, label, swatch }) => {
        const on = accent === value
        return (
          <button
            key={value}
            type="button"
            aria-pressed={on}
            title={label}
            onClick={() => pick(value)}
            className={`flex h-[34px] items-center gap-2 rounded-btn border px-3 text-[12.5px] transition-colors duration-150 ${
              on
                ? 'border-accent-line bg-accent-soft font-medium text-accent-ink'
                : 'border-line2 text-ink2 hover:bg-hover'
            }`}
          >
            <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: swatch }} />
            {label}
          </button>
        )
      })}

      {/* 自定义:取色器只管选色,旁边的输入框可以直接粘十六进制 */}
      <label
        className={`flex h-[34px] cursor-pointer items-center gap-2 rounded-btn border px-3 text-[12.5px] transition-colors duration-150 ${
          preset
            ? 'border-line2 text-ink2 hover:bg-hover'
            : 'border-accent-line bg-accent-soft font-medium text-accent-ink'
        }`}
      >
        <input
          type="color"
          value={preset ? '#0e7a6d' : accent}
          onChange={(e) => onHex(e.target.value.toLowerCase())}
          className="pl-color"
          aria-label="自定义主题色"
        />
        自定义
      </label>

      <input
        value={hex}
        onChange={(e) => onHex(e.target.value)}
        placeholder="#0e7a6d"
        spellCheck={false}
        aria-label="主题色十六进制值"
        className="h-[34px] w-[112px] rounded-btn border border-line2 bg-surface px-2.5 font-mono text-[12.5px] text-ink outline-none transition-colors duration-150 focus:border-accent"
      />
    </div>
  )
}

/** 「关于」里的信息行 */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="w-20 shrink-0 text-[12.5px] text-mut">{label}</dt>
      <dd className="min-w-0 flex-1 text-[13px] text-ink2">{value}</dd>
    </div>
  )
}

export default function SettingsPage() {
  const [s, setS] = useState<SettingsType | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [saved, setSaved] = useState(false)

  const [engines, setEngines] = useState<{ docling: EngineInfo; mineru: EngineInfo } | null>(null)
  const [install, setInstall] = useState<Record<string, EngineInstallState>>({})
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    api.settings().then(setS)
    refreshEngines()
  }, [])

  const refreshEngines = () => {
    api.engines().then((e) => {
      setEngines({ docling: e.docling, mineru: e.mineru })
      setInstall(e.install || {})
      // 安装进行中:持续轮询直到结束
      if (Object.values(e.install || {}).some((i) => i.running)) {
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = setInterval(async () => {
          const e2 = await api.engines()
          setEngines({ docling: e2.docling, mineru: e2.mineru })
          setInstall(e2.install || {})
          if (!Object.values(e2.install || {}).some((i) => i.running)) {
            if (pollRef.current) clearInterval(pollRef.current)
          }
        }, 1500)
      }
    })
  }

  if (!s) return null

  const set = (k: keyof SettingsType, v: string | number) => setS({ ...s, [k]: v })

  const langOptions = LANG_OPTIONS.some((o) => o.value === s.target_lang)
    ? LANG_OPTIONS
    : [{ value: s.target_lang, label: s.target_lang }, ...LANG_OPTIONS]

  const save = async () => {
    setSaving(true)
    try {
      setS(await api.saveSettings(s))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  /** 引擎卡片点了就立刻落盘 —— 卡片说明写的是「点击卡片即可设为默认」,
   *  只改本地 state 的话,不点「保存设置」就不会生效(回文库页还是老引擎)。
   *  这里只存 engine,不整体覆盖,免得丢掉其它还没保存的改动。 */
  const pickEngine = async (name: string) => {
    set('engine', name)
    try {
      await api.saveSettings({ engine: name })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      /* 保存失败:本地选中态还在,用户仍可点「保存设置」重试 */
    }
  }

  const test = async () => {
    setTesting(true)
    setResult(null)
    try {
      setResult(await api.testSettings())
    } catch (e) {
      setResult({ ok: false, message: String(e instanceof Error ? e.message : e) })
    } finally {
      setTesting(false)
    }
  }

  const startInstall = async (engine: string) => {
    try {
      await api.installEngine(engine)
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e))
    }
    refreshEngines()
  }

  return (
    <main className="mx-auto max-w-[720px] px-5 pb-20 pt-8 md:px-6">
      <header className="mb-6">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-ink">设置</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-mut">
          翻译接口兼容所有 OpenAI Chat Completions 服务。
        </p>
      </header>

      <div className="space-y-4">
        {/* ── 翻译接口 ── */}
        <Section
          icon={Plug}
          title="翻译接口"
          desc="填入服务商提供的信息,保存后用「测试连接」验证是否可用。"
        >
          <div className="space-y-4">
            <Field label="Base URL" hint="填写到 /v1 为止,以接口文档为准">
              <input
                className="pl-input"
                value={s.base_url}
                onChange={(e) => set('base_url', e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </Field>

            <Field label="API Key">
              <input
                className="pl-input font-mono"
                type="password"
                value={s.api_key}
                onChange={(e) => set('api_key', e.target.value)}
                placeholder="sk-..."
              />
            </Field>

            <Field label="模型名称">
              <input
                className="pl-input"
                value={s.model}
                onChange={(e) => set('model', e.target.value)}
                placeholder="deepseek-flash / glm-5.3-flash"
              />
            </Field>

            <div className="h-px bg-line" />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="目标语言">
                <Dropdown
                  value={s.target_lang}
                  options={langOptions}
                  onChange={(v) => set('target_lang', v)}
                  placeholder="选择目标语言"
                  size="md"
                />
              </Field>
              <Field label="每批翻译块数">
                <input
                  className="pl-input"
                  type="number"
                  min={1}
                  max={64}
                  value={s.batch_blocks}
                  onChange={(e) => set('batch_blocks', Number(e.target.value))}
                />
              </Field>
              <Field label="并发请求数" hint="越大越快,注意接口限流">
                <input
                  className="pl-input"
                  type="number"
                  min={1}
                  max={16}
                  value={s.concurrency}
                  onChange={(e) => set('concurrency', Number(e.target.value))}
                />
              </Field>
              <Field label="推理等级 · 文档翻译">
                <Dropdown
                  value={s.reasoning_effort_doc}
                  options={EFFORT_OPTIONS}
                  onChange={(v) => set('reasoning_effort_doc', v)}
                  size="md"
                />
              </Field>
              <Field label="推理等级 · 划词翻译">
                <Dropdown
                  value={s.reasoning_effort_selection}
                  options={EFFORT_OPTIONS}
                  onChange={(v) => set('reasoning_effort_selection', v)}
                  size="md"
                />
              </Field>
            </div>

            <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-mut">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              推理等级选择非「默认」时向接口传递 reasoning_effort，模型不支持该参数请保持默认。
            </p>

            <div className="h-px bg-line" />

            <div className="flex flex-wrap items-center gap-3">
              <button className="pl-btn pl-btn-primary" onClick={save} disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                保存设置
              </button>
              <button className="pl-btn pl-btn-ghost" onClick={test} disabled={testing}>
                {testing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plug className="h-4 w-4" />
                )}
                {testing ? '测试中…' : '测试连接'}
              </button>
              {saved && (
                <span className="flex items-center gap-1 text-[12.5px] font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  已保存
                </span>
              )}
            </div>

            {result && (
              <div
                className={`flex items-start gap-2 rounded-btn border px-3.5 py-2.5 text-[12.5px] leading-relaxed ${
                  result.ok
                    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400'
                }`}
              >
                {result.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1 break-words">{result.message}</span>
              </div>
            )}
          </div>
        </Section>

        {/* ── 转换引擎:点击整张卡片即选择 ── */}
        <Section
          icon={Cpu}
          title="转换引擎"
          desc="把 PDF 解析成结构化内容。引擎较大,不随安装包分发,点「下载安装」按需获取;装好后点击卡片即可设为默认。"
        >
          {/* 两处下载来源不同:引擎包走 PyPI,解析模型走 HuggingFace / ModelScope */}
          <div className="mb-4 grid grid-cols-1 gap-4 rounded-card border border-line bg-bg px-4 py-3.5 sm:grid-cols-2">
            <Field
              label="引擎包下载源"
              hint="引擎本身(含 PyTorch)从 PyPI 下载,国内直连很慢,默认走清华镜像。"
            >
              <Dropdown
                value={s.pypi_index}
                options={INDEX_OPTIONS}
                onChange={(v) => set('pypi_index', v)}
                size="md"
              />
            </Field>
            <Field label="模型下载源" hint="解析模型,首次转换时下载;Docling 只走 HuggingFace。">
              <Dropdown
                value={s.model_source}
                options={MODEL_SOURCE_OPTIONS}
                onChange={(v) => set('model_source', v)}
                size="md"
              />
            </Field>
          </div>

          <div className="space-y-2.5" role="radiogroup" aria-label="默认转换引擎">
            {(['docling', 'mineru'] as const).map((name) => {
              const info = engines?.[name]
              const st = install[name]
              const label = name === 'docling' ? 'Docling' : 'MinerU'
              const desc =
                name === 'docling'
                  ? '轻量快速,CPU 速度快,适合快速预览。安装包含 PyTorch,约 1 GB。'
                  : '学术 PDF 解析质量更佳(表格/公式/版面)。安装包含 PyTorch,约 1.2 GB。'
              const selected = s.engine === name
              return (
                <div
                  key={name}
                  role="radio"
                  aria-checked={selected}
                  tabIndex={0}
                  onClick={() => pickEngine(name)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      pickEngine(name)
                    }
                  }}
                  className={`cursor-pointer rounded-card border px-4 py-3.5 transition-colors duration-150 ${
                    selected
                      ? 'border-accent-line bg-accent-soft/50'
                      : 'border-line bg-bg hover:border-line2 hover:bg-hover/60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Cpu className={`h-4 w-4 shrink-0 ${selected ? 'text-accent' : 'text-mut'}`} />
                    <span className="text-[14px] font-semibold text-ink">{label}</span>
                    {info ? (
                      info.installed ? (
                        <span className="pl-pill bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
                          <span className="pl-dot" />
                          v{info.version}
                        </span>
                      ) : (
                        <span className="pl-pill bg-hover text-mut">
                          <span className="pl-dot" />
                          未安装
                        </span>
                      )
                    ) : (
                      <span className="text-[12px] text-mut">…</span>
                    )}

                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      {!info?.installed && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            startInstall(name)
                          }}
                          disabled={!!st?.running}
                          className="pl-btn pl-btn-sm pl-btn-primary"
                        >
                          {st?.running ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                          {st?.running ? '安装中…' : '下载安装'}
                        </button>
                      )}
                      {info?.installed && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            refreshEngines()
                          }}
                          title="刷新版本"
                          className="pl-iconbtn"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* 选择指示 */}
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full border transition-colors duration-150 ${
                          selected
                            ? 'border-accent bg-accent text-white'
                            : 'border-line2 bg-surface text-transparent'
                        }`}
                        title={selected ? '当前默认引擎' : '设为默认引擎'}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                    </span>
                  </div>

                  <p className="mt-1.5 text-[12px] leading-relaxed text-mut">{desc}</p>

                  {st?.running && (
                    <div className="mt-2.5 overflow-hidden rounded-btn border border-line bg-surface">
                      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11px] text-mut">
                        <Loader2 className="h-3 w-3 animate-spin text-accent" />
                        安装日志
                      </div>
                      <pre className="pl-thin max-h-28 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-mut">
                        {st.log.split('\n').slice(-6).join('\n') || '准备中…'}
                      </pre>
                    </div>
                  )}
                  {st && !st.running && st.error && (
                    <p className="mt-2 text-[12px] leading-relaxed text-red-500 dark:text-red-400">
                      {st.error}
                    </p>
                  )}
                  {st && !st.running && st.ok && (
                    <p className="mt-2 text-[12px] text-emerald-600 dark:text-emerald-400">
                      安装完成,现在就可以在文库页选用(首次转换还会下载解析模型)。
                    </p>
                  )}
                </div>
              )
            })}
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-[12px] text-mut">
            <CheckCircle2 className="h-3.5 w-3.5 text-accent" />
            当前默认:
            <span className="font-medium text-ink2">
              {s.engine === 'mineru' ? 'MinerU' : 'Docling'}
            </span>
          </p>
        </Section>

        {/* ── 外观 ── */}
        <Section
          icon={Palette}
          title="外观"
          desc="主题、主题色、字体与缩放都保存在本地,下次打开自动恢复。"
        >
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-[12.5px] font-medium text-ink2">主题</p>
              <div className="max-w-[420px]">
                <ThemeSwitch labels />
              </div>
            </div>
            <div>
              <p className="mb-2 text-[12.5px] font-medium text-ink2">主题色</p>
              <AccentPicker />
            </div>
            <FontScaleControls />
          </div>
        </Section>

        {/* ── 关于 ── */}
        <Section icon={Info} title="关于" desc="一款论文 AI 翻译工具。">
          <dl className="divide-y divide-line">
            <Row label="版本" value={`v${__APP_VERSION__}`} />
            <Row
              label="转换引擎"
              value={
                [
                  engines?.docling?.installed ? `Docling ${engines.docling.version}` : null,
                  engines?.mineru?.installed ? `MinerU ${engines.mineru.version}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || '尚未安装任何引擎'
              }
            />
          </dl>
        </Section>
      </div>
    </main>
  )
}
