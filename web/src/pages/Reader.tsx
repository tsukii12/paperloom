import katex from 'katex'
import {
  ArrowLeft,
  BookOpenText,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  Download,
  FileText,
  GripVertical,
  Highlighter,
  Languages,
  ListTree,
  Loader2,
  PencilLine,
  RefreshCw,
  StickyNote,
  Trash2,
  Underline as UnderlineIcon,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import type { AnnColor, AnnKind, Annotation, Block, DocMeta } from '../types'

type Mode = 'dual' | 'origin' | 'translated'

const MODE_LABEL: Record<Mode, string> = {
  dual: '对照',
  origin: '原文',
  translated: '译文',
}

const COLORS: { c: AnnColor; cls: string; hex: string }[] = [
  { c: 'yellow', cls: 'bg-yellow-300', hex: '#facc15' },
  { c: 'green', cls: 'bg-green-300', hex: '#4ade80' },
  { c: 'blue', cls: 'bg-blue-300', hex: '#60a5fa' },
  { c: 'pink', cls: 'bg-pink-300', hex: '#f472b6' },
]
const colorHex = (c: AnnColor) => COLORS.find((x) => x.c === c)?.hex ?? '#facc15'

/** 灯箱上的圆形浮钮 */
const LB_BTN =
  'flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white/80 transition-colors duration-150 hover:bg-black/60 hover:text-white'

function Equation({ latex }: { latex: string }) {
  const html = useMemo(
    () => katex.renderToString(latex, { displayMode: true, throwOnError: false, output: 'html' }),
    [latex],
  )
  return <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
}

/** 把批注范围渲染进原文文本 */
function MarkedText({
  text,
  anns,
  onClickAnn,
}: {
  text: string
  anns: Annotation[]
  onClickAnn: (a: Annotation, ev: React.MouseEvent) => void
}) {
  const sorted = [...anns].filter((a) => a.end > a.start).sort((a, b) => a.start - b.start)
  if (!sorted.length) return <>{text}</>
  const out: React.ReactNode[] = []
  let pos = 0
  sorted.forEach((m) => {
    const s = Math.max(m.start, pos)
    const e = Math.min(m.end, text.length)
    if (e <= s) return
    if (s > pos) out.push(<span key={`t${s}`}>{text.slice(pos, s)}</span>)
    out.push(
      <mark
        key={`${m.id}-${s}`}
        title={m.note || undefined}
        className={`ann ${m.kind}-${m.color}`}
        onClick={(ev) => {
          ev.stopPropagation()
          onClickAnn(m, ev)
        }}
      >
        {text.slice(s, e)}
      </mark>,
    )
    pos = e
  })
  if (pos < text.length) out.push(<span key="tail">{text.slice(pos)}</span>)
  return <>{out}</>
}

/** 计算节点内某文本位置相对于块元素的字符偏移 */
/** 列表各项在「整块文本」里的起始偏移(与 offsetInEl 的口径一致:各条目依次拼接) */
function itemOffsets(items: string[]): number[] {
  const out: number[] = []
  let n = 0
  for (const t of items) {
    out.push(n)
    n += t.length
  }
  return out
}

/** 把「整块的字符偏移」换算成列表某一项内部的偏移。 */
function sliceAnns(anns: Annotation[], base: number, len: number): Annotation[] {
  const out: Annotation[] = []
  for (const a of anns) {
    const s = Math.max(a.start - base, 0)
    const e = Math.min(a.end - base, len)
    if (e > s) out.push({ ...a, start: s, end: e })
  }
  return out
}

function offsetInEl(el: HTMLElement, node: Node, offset: number): number {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let pos = 0
  while (walker.nextNode()) {
    if (walker.currentNode === node) return pos + offset
    pos += walker.currentNode.textContent?.length ?? 0
  }
  return -1
}

interface SelTool {
  x: number
  y: number
  blockId: string
  start: number
  end: number
  text: string
  side: 'origin' | 'translated'
}
interface TransBox {
  x: number
  y: number
  busy: boolean
  zh: string
  src?: string
  error?: string
}
interface NoteBox {
  x: number
  y: number
  blockId: string
  start: number
  end: number
  ann: Annotation | null
  draft: string
  side: 'origin' | 'translated'
}

function BlockView({
  b,
  side,
  mode,
  docId,
  anns,
  onAnnClick,
  onRetry,
  retrying,
}: {
  b: Block
  side: 'origin' | 'zh'
  mode: Mode
  docId: string
  anns?: Annotation[]
  onAnnClick?: (a: Annotation, ev: React.MouseEvent) => void
  onRetry?: (b: Block) => void
  retrying?: boolean
}) {
  const zh = side === 'zh'
  // 图片/公式/表格不需要翻译:双栏两侧渲染同样内容,绝不显示"待翻译"
  const untranslatable = b.type === 'image' || b.type === 'equation' || b.type === 'table'
  const missing = zh && mode === 'dual' && !untranslatable && !b.zh && !b.zh_items

  let inner: React.ReactNode = null
  switch (b.type) {
    case 'title': {
      const text = zh ? (b.zh ?? '') : (b.text ?? '')
      const body =
        anns && anns.length ? (
          <MarkedText text={text} anns={anns} onClickAnn={onAnnClick!} />
        ) : (
          text
        )
      if (b.level === 1) inner = <h1 className="pl-h1">{body}</h1>
      else if (b.level === 3) inner = <h3 className="pl-h3">{body}</h3>
      else inner = <h2 className="pl-h2">{body}</h2>
      break
    }
    case 'text': {
      const text = zh ? (b.zh ?? '') : (b.text ?? '')
      const body =
        anns && anns.length ? (
          <MarkedText text={text} anns={anns} onClickAnn={onAnnClick!} />
        ) : (
          text
        )
      inner = <p className="mb-3.5 text-justify leading-[1.85]">{body}</p>
      break
    }
    case 'caption': {
      const text = zh ? (b.zh ?? '') : (b.text ?? '')
      const body =
        anns && anns.length ? (
          <MarkedText text={text} anns={anns} onClickAnn={onAnnClick!} />
        ) : (
          text
        )
      inner = <p className="pl-cap">{body}</p>
      break
    }
    case 'list': {
      const items = (zh ? (b.zh_items ?? b.items) : b.items) ?? []
      const marks = anns && anns.length ? anns : null
      const starts = itemOffsets(items)
      inner = (
        <ul className="mb-3.5 list-disc space-y-1.5 pl-5 leading-[1.85] marker:text-mut">
          {items.map((t, i) => (
            <li key={i}>
              {marks ? (
                <MarkedText
                  text={t}
                  anns={sliceAnns(marks, starts[i], t.length)}
                  onClickAnn={onAnnClick!}
                />
              ) : (
                t
              )}
            </li>
          ))}
        </ul>
      )
      break
    }
    case 'table': {
      const cells = b.cells ?? [] // 表格不翻译,两侧均为原文
      if (!cells.length) break
      const hr = b.header_rows ?? 0
      const hasHead = hr > 0 && cells.length > hr
      const tbody = hasHead ? cells.slice(hr) : cells
      inner = (
        <div className="mb-4 overflow-x-auto rounded-[10px] border border-line">
          <table className="w-full border-collapse bg-surface text-[12.5px] leading-relaxed">
            {hasHead && (
              <thead>
                <tr>
                  {cells[0].map((c, i) => (
                    <th
                      key={i}
                      className="border-b border-line bg-hover px-2.5 py-1.5 text-left font-semibold"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {tbody.map((row, r) => (
                <tr key={r} className="border-b border-line last:border-b-0">
                  {row.map((c, i) => (
                    <td key={i} className="border-r border-line px-2.5 py-1.5 align-top last:border-r-0">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      break
    }
    case 'image':
      inner = b.img ? (
        <figure className="mb-4 text-center">
          <img
            src={`/files/${docId}/${b.img}`}
            alt="figure"
            loading="lazy"
            data-zoom="1"
            className="mx-auto max-w-full cursor-zoom-in rounded-[10px] border border-line bg-surface p-1.5 transition-shadow duration-200 hover:shadow-pop"
          />
        </figure>
      ) : null
      break
    case 'equation':
      inner = <Equation latex={b.latex ?? ''} />
      break
  }

  if (missing) return <p className="pl-pending">—— 待翻译 ——</p>

  return (
    <div>
      {inner}
      {zh && b.error && (
        <button
          onClick={() => onRetry?.(b)}
          disabled={retrying}
          className="mb-3 flex items-center gap-1.5 rounded-btn border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[12px] text-red-600 transition-colors duration-150 hover:bg-red-500/20 disabled:opacity-60 dark:text-red-400"
        >
          {retrying ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {retrying ? '重试中…' : '翻译失败,点击重试'}
        </button>
      )}
    </div>
  )
}

export default function Reader() {
  const { id = '' } = useParams()
  const [meta, setMeta] = useState<DocMeta | null>(null)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [mode, setMode] = useState<Mode>('dual')
  const [notFound, setNotFound] = useState(false)

  const [anns, setAnns] = useState<Annotation[]>([])
  const [tool, setTool] = useState<SelTool | null>(null)
  const [trans, setTrans] = useState<TransBox | null>(null)
  const [noteBox, setNoteBox] = useState<NoteBox | null>(null)
  // 灯箱:记录整篇所有可放大图片和当前下标,以便切换上一张/下一张
  const [lightbox, setLightbox] = useState<{ srcs: string[]; i: number } | null>(null)
  const [pdfState, setPdfState] = useState<'idle' | 'busy' | 'done'>('idle')
  const pdfBusy = pdfState === 'busy'
  const [panelOpen, setPanelOpen] = useState(false)
  const [tocOpen, setTocOpen] = useState(false)
  const dragTrans = useRef<{ dx: number; dy: number } | null>(null)
  const [flash, setFlash] = useState('')
  const [markColor, setMarkColor] = useState<AnnColor>('yellow')
  const [fontScale, setFontScale] = useState(() => {
    const v = parseFloat(localStorage.getItem('pl-font') || '1')
    return isNaN(v) ? 1 : Math.min(1.5, Math.max(0.75, v))
  })
  const [retryingBlock, setRetryingBlock] = useState('')
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const noteBoxRef = useRef<HTMLDivElement>(null)
  const lastSig = useRef('')

  const annsByBlock = useMemo(() => {
    const m: Record<string, Annotation[]> = {}
    anns.forEach((a) => {
      ;(m[`${a.block_id}:${a.side || 'origin'}`] ??= []).push(a)
    })
    return m
  }, [anns])

  // 批注栏只收录写了笔记的批注;纯高亮/下划线不算
  const notes = useMemo(() => anns.filter((a) => (a.note || '').trim()), [anns])

  const blockById = useMemo(() => {
    const m: Record<string, Block> = {}
    blocks.forEach((b) => (m[b.id] = b))
    return m
  }, [blocks])

  // 目录:按顺序的标题块
  const toc = useMemo(
    () => blocks.map((b, i) => ({ b, i })).filter((x) => x.b.type === 'title'),
    [blocks],
  )

  // 某块所属小节:最近的标题块在标题序列中的序号
  const sectionOf = useCallback(
    (blockId: string): { no: number; title: string } | null => {
      const idx = blocks.findIndex((b) => b.id === blockId)
      if (idx < 0 || toc.length === 0) return null
      let t = -1
      toc.forEach((x, k) => {
        if (x.i <= idx) t = k
      })
      if (t < 0) return null
      return { no: t + 1, title: toc[t].b.text || '' }
    },
    [blocks, toc],
  )

  const locateBlock = (blockId: string, side?: 'origin' | 'translated') => {
    const sideSelector = side ? `[data-side="${side}"]` : ''
    const el = document.querySelector(`[data-bid="${blockId}"]${sideSelector}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlash(blockId)
    setTimeout(() => setFlash(''), 1600)
  }

  const stepLightbox = useCallback((d: number) => {
    setLightbox((lb) => (lb ? { ...lb, i: (lb.i + d + lb.srcs.length) % lb.srcs.length } : lb))
  }, [])

  /** 打开灯箱:收集整篇里的可放大图片,单张时也能正常显示 */
  const openLightbox = (src: string) => {
    const srcs = [...document.querySelectorAll<HTMLImageElement>('img[data-zoom="1"]')].map(
      (el) => el.src,
    )
    const list = srcs.length ? srcs : [src]
    setLightbox({ srcs: list, i: Math.max(0, list.indexOf(src)) })
  }

  const saveLightboxImage = async () => {
    if (!lightbox) return
    const src = lightbox.srcs[lightbox.i]
    try {
      const blob = await (await fetch(src)).blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = decodeURIComponent(src.split('/').pop() || 'figure.png')
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      /* 图片取不到就不下载 */
    }
  }

  /** 另存为 PDF:后端用无头浏览器打印。先弹「另存为」拿位置,再生成。 */
  const exportPdf = async () => {
    const name = `${(meta?.filename || 'paper').replace(/\.pdf$/i, '')}.pdf`

    // ①「另存为」必须在用户手势里发起,所以放在最前面;生成要几十秒,先让用户选好位置
    let handle: FileSystemFileHandle | null = null
    if (window.showSaveFilePicker) {
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: 'PDF 文档', accept: { 'application/pdf': ['.pdf'] } }],
        })
      } catch {
        return // 用户取消
      }
    }

    // ② 生成(耗时较长,页面下方有提示条)
    setPdfState('busy')
    try {
      const r = await api.exportPdf(id, mode)
      if (!r.ok) {
        const detail = await r
          .json()
          .then((b: { detail?: string }) => b.detail)
          .catch(() => '')
        throw new Error(detail || 'PDF 生成失败')
      }
      const blob = await r.blob()
      if (handle) {
        const w = await handle.createWritable()
        await w.write(blob)
        await w.close()
      } else {
        // 浏览器不支持「另存为」时退回直接下载
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = name
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      setPdfState('done')
      window.setTimeout(() => setPdfState((s) => (s === 'done' ? 'idle' : s)), 3000)
    } catch (e) {
      setPdfState('idle')
      alert(String(e instanceof Error ? e.message : e))
    }
  }

  // 灯箱:Esc 关闭,← → 切换
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
      else if (e.key === 'ArrowLeft') stepLightbox(-1)
      else if (e.key === 'ArrowRight') stepLightbox(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, stepLightbox])

  const locate = (ann: Annotation) => {
    const side = ann.side || 'origin'
    if (mode !== 'dual' && mode !== side) setMode(side)
    window.setTimeout(() => locateBlock(ann.block_id, side), 0)
  }

  const delAnn = async (ann: Annotation) => {
    try {
      await api.deleteAnnotation(id, ann.id)
    } catch {
      /* ignore */
    }
    reloadAnns()
  }

  const load = useCallback(
    async (full = false) => {
      try {
        const m = await api.getDoc(id)
        setMeta(m)
        // 轮询优化:状态/进度没变化时跳过内容重拉
        const sig = `${m.status}:${m.progress.toFixed(3)}`
        if (full || sig !== lastSig.current) {
          const c = await api.content(id)
          setBlocks(c.blocks)
          lastSig.current = sig
        }
      } catch {
        setNotFound(true)
      }
    },
    [id],
  )

  const reloadAnns = useCallback(async () => {
    try {
      setAnns(await api.listAnnotations(id))
    } catch {
      /* ignore */
    }
  }, [id])

  // 单块重试翻译:等任务结束后刷新内容
  const retryBlock = async (b: Block) => {
    if (retryingBlock) return
    setRetryingBlock(b.id)
    try {
      await api.retryBlocks(id, [b.id])
      for (let i = 0; i < 120; i++) {
        const m = await api.getDoc(id)
        if (!['translating', 'queued'].includes(m.status)) break
        await new Promise((r) => setTimeout(r, 1000))
      }
      lastSig.current = ''
      await load(true)
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e))
    } finally {
      setRetryingBlock('')
    }
  }

  useEffect(() => {
    lastSig.current = '' // 文档切换时强制全量加载
    load(true)
    reloadAnns()
  }, [load, reloadAnns])

  // 转换/翻译进行中时轮询
  useEffect(() => {
    if (!meta || !['queued', 'converting', 'translating'].includes(meta.status)) return
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [meta, load])

  // 面板与双栏的空间互斥:按剩余宽度自适应(每栏 ≥340px 才保留双栏),用户手动切换后不再干预
  const autoCols = useRef(true)
  useEffect(() => {
    const apply = () => {
      if (!autoCols.current) return
      const row = document.querySelector('.pl-reader-row') as HTMLElement | null
      const avail = row?.clientWidth || window.innerWidth
      const cols = avail - (tocOpen ? 312 : 0) - (panelOpen ? 364 : 0)
      const fits = cols >= 730 // 两栏各 ≥340px + 中缝
      setMode(fits ? 'dual' : 'origin')
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [panelOpen, tocOpen])

  // 滚动时收起弹出层。批注输入框内容变多时自身也会滚动,那个事件同样冒到这里,
  // 必须放过 —— 否则一按回车换行、或者多打几行,编辑器就直接消失了。
  useEffect(() => {
    const clear = (e: Event) => {
      const t = e.target as Node | null
      if (t && noteBoxRef.current?.contains(t)) return
      setTool(null)
      setNoteBox(null)
    }
    window.addEventListener('scroll', clear, true)
    return () => window.removeEventListener('scroll', clear, true)
  }, [])

  const onMouseUp = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) {
      setTool(null)
      return
    }
    const range = sel.getRangeAt(0)
    const startEl = (range.startContainer.parentElement as HTMLElement | null)?.closest('[data-bid]')
    const endEl = (range.endContainer.parentElement as HTMLElement | null)?.closest('[data-bid]')
    if (
      !startEl ||
      startEl !== endEl ||
      !startEl.hasAttribute('data-side') ||
      !(startEl instanceof HTMLElement)
    ) {
      setTool(null)
      return
    }
    const start = offsetInEl(startEl, range.startContainer, range.startOffset)
    const end = offsetInEl(startEl, range.endContainer, range.endOffset)
    if (start < 0 || end <= start) {
      setTool(null)
      return
    }
    const rect = range.getBoundingClientRect()
    setNoteBox(null)
    setTool({
      x: rect.left + rect.width / 2,
      y: rect.top,
      blockId: startEl.getAttribute('data-bid') || '',
      start,
      end,
      text: sel.toString(),
      side: (startEl.dataset.side as 'origin' | 'translated') || 'origin',
    })
  }

  const addMark = async (kind: AnnKind, color: AnnColor) => {
    if (!tool) return
    try {
      await api.addAnnotation(id, {
        block_id: tool.blockId,
        start: tool.start,
        end: tool.end,
        kind,
        color,
        side: tool.side,
      })
    } catch {
      /* ignore */
    }
    window.getSelection()?.removeAllRanges()
    setTool(null)
    reloadAnns()
  }

  const openNote = () => {
    if (!tool) return
    setNoteBox({
      x: tool.x,
      y: tool.y,
      blockId: tool.blockId,
      start: tool.start,
      end: tool.end,
      ann: null,
      draft: '',
      side: tool.side,
    })
    setTool(null)
    setTimeout(() => noteRef.current?.focus(), 30)
  }

  const onAnnClick = (a: Annotation, ev: React.MouseEvent) => {
    setTool(null)
    setNoteBox({
      x: ev.clientX,
      y: ev.clientY,
      blockId: a.block_id,
      start: a.start,
      end: a.end,
      ann: a,
      draft: a.note,
      side: a.side || 'origin',
    })
  }

  const saveNote = async () => {
    if (!noteBox) return
    try {
      if (noteBox.ann) {
        await api.editAnnotation(id, noteBox.ann.id, { note: noteBox.draft })
      } else {
        await api.addAnnotation(id, {
          block_id: noteBox.blockId,
          start: noteBox.start,
          end: noteBox.end,
          kind: 'highlight',
          color: markColor,
          note: noteBox.draft,
          side: noteBox.side,
        })
      }
      setNoteBox(null)
      reloadAnns()
    } catch {
      /* ignore */
    }
  }

  const deleteAnn = async () => {
    if (!noteBox?.ann) return
    try {
      await api.deleteAnnotation(id, noteBox.ann.id)
    } catch {
      /* ignore */
    }
    setNoteBox(null)
    reloadAnns()
  }

  const doTranslate = async () => {
    if (!tool) return
    const pos = { x: tool.x, y: tool.y }
    setTrans({ ...pos, busy: true, zh: '', src: tool.text })
    setTool(null)
    window.getSelection()?.removeAllRanges()
    try {
      const r = await api.selectionTranslate(id, tool.text)
      setTrans({ ...pos, busy: false, zh: r.zh, src: tool.text })
    } catch (e) {
      setTrans({
        ...pos,
        busy: false,
        zh: '',
        src: tool.text,
        error: String(e instanceof Error ? e.message : e),
      })
    }
  }

  if (notFound)
    return (
      <main className="grid min-h-[70vh] place-items-center px-6 text-center">
        <div>
          <p className="text-[14px] text-mut">文档不存在或已被删除。</p>
          <Link to="/" className="pl-btn pl-btn-sm pl-btn-ghost mt-4">
            <ArrowLeft className="h-3.5 w-3.5" />
            返回文库
          </Link>
        </div>
      </main>
    )
  if (!meta)
    return (
      <main className="grid min-h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </main>
    )

  const working = ['queued', 'converting', 'translating'].includes(meta.status)
  const progress = Math.max(3, Math.round((meta.progress || 0) * 100))
  const locked = blocks.length > 0 && ['queued', 'ready', 'done', 'cancelled'].includes(meta.status)

  return (
    <div onMouseDown={() => setTool(null)}>
      {/* ——— 悬浮胶囊工具条(吸顶,两侧面板与它上缘对齐) ——— */}
      <div className="pl-reader-bar no-print sticky top-0 z-40 flex w-full justify-center px-2 pb-1.5 pt-2.5">
        <div className="pl-fade-up relative w-fit max-w-full overflow-hidden rounded-full border border-line bg-surface/85 shadow-pop backdrop-blur-xl">
          <div className="flex flex-nowrap items-center gap-0.5 px-1.5 py-1">
            <Link to="/" className="pl-iconbtn !h-7 !w-7" title="返回文库">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <span className="mx-0.5 h-5 w-px bg-line" />
            <span
              className="max-w-[11rem] truncate px-1 text-[12px] font-medium text-ink"
              title={meta.filename}
            >
              {meta.filename}
            </span>

            <span className="mx-0.5 h-5 w-px bg-line" />

            {/* 模式分段 */}
            <div className="flex items-center gap-0.5 rounded-full bg-hover p-0.5">
              {(['dual', 'origin', 'translated'] as Mode[]).map((m) => {
                const Icon = m === 'dual' ? Columns2 : m === 'origin' ? FileText : Languages
                const on = mode === m
                return (
                  <button
                    key={m}
                    onClick={() => {
                      autoCols.current = false // 用户显式选择后,不再自动切换模式
                      setMode(m)
                    }}
                    title={`${MODE_LABEL[m]}模式`}
                    className={`flex items-center gap-1 rounded-full px-2 py-[3px] text-[11.5px] whitespace-nowrap transition-colors duration-150 ${
                      on
                        ? 'bg-surface font-medium text-accent-ink shadow-card'
                        : 'text-mut hover:text-ink2'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="hidden sm:inline">{MODE_LABEL[m]}</span>
                  </button>
                )
              })}
            </div>

            {/* 字号 */}
            {blocks.length > 0 && (
              <>
                <span className="mx-0.5 h-5 w-px bg-line" />
                <div className="flex items-center">
                  <button
                    onClick={() => {
                      const v = Math.max(0.75, Math.round((fontScale - 0.1) * 10) / 10)
                      setFontScale(v)
                      localStorage.setItem('pl-font', String(v))
                    }}
                    disabled={fontScale <= 0.75}
                    title="减小字号"
                    className="pl-iconbtn !h-7 !w-7 disabled:opacity-40"
                  >
                    <span className="text-[11.5px] font-semibold">A−</span>
                  </button>
                  <span className="w-9 text-center text-[11px] tabular-nums text-mut">
                    {Math.round(fontScale * 100)}%
                  </span>
                  <button
                    onClick={() => {
                      const v = Math.min(1.5, Math.round((fontScale + 0.1) * 10) / 10)
                      setFontScale(v)
                      localStorage.setItem('pl-font', String(v))
                    }}
                    disabled={fontScale >= 1.5}
                    title="增大字号"
                    className="pl-iconbtn !h-7 !w-7 disabled:opacity-40"
                  >
                    <span className="text-[11.5px] font-semibold">A+</span>
                  </button>
                </div>
              </>
            )}

            {/* 功能组 */}
            {locked && (
              <>
                <span className="mx-0.5 h-5 w-px bg-line" />
                <button
                  onClick={() => setTocOpen((o) => !o)}
                  title="目录导航"
                  className={`pl-iconbtn !h-7 !w-7 ${tocOpen ? 'is-active' : ''}`}
                >
                  <ListTree className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPanelOpen((o) => !o)}
                  title="批注列表"
                  className={`pl-iconbtn !h-7 !w-7 ${panelOpen ? 'is-active' : ''}`}
                >
                  <StickyNote className="h-4 w-4" />
                </button>
                <a
                  href={`/files/${id}/${mode}.html`}
                  target="_blank"
                  rel="noreferrer"
                  title="打开独立 HTML 版(图片/公式完整,可直接另存)"
                  className="pl-iconbtn !h-7 !w-7"
                >
                  <FileText className="h-4 w-4" />
                </a>
                <button
                  onClick={exportPdf}
                  disabled={pdfBusy}
                  title={
                    pdfBusy ? '正在生成 PDF…' : '保存为 PDF(弹窗选择保存位置)'
                  }
                  className="pl-iconbtn relative !h-7 !w-7"
                >
                  {/* 下载图标始终占位,转圈用绝对定位叠加居中(inset-0 + m-auto):
                      不参与 flex 布局,切换时按钮尺寸不变,圆圈也不会漂 */}
                  <Download className={`h-4 w-4 ${pdfBusy ? 'opacity-0' : ''}`} />
                  {pdfBusy && (
                    <Loader2 className="absolute inset-0 m-auto h-4 w-4 animate-spin text-accent" />
                  )}
                </button>
              </>
            )}
          </div>

          {/* 进度细线(内嵌胶囊底部) */}
          {working && (
            <div className="absolute inset-x-0 bottom-0 h-[2px] bg-hover">
              <div
                className={`relative h-full overflow-hidden transition-[width] duration-300 ${
                  meta.status === 'translating'
                    ? 'bg-violet-500'
                    : meta.status === 'queued'
                      ? 'bg-amber-500'
                      : 'bg-blue-500'
                }`}
                style={{ width: `${progress}%` }}
              >
                <span className="pl-bar-shine" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ——— 正文与两侧面板并排(面板不遮挡正文;正文始终居中于剩余空间) ——— */}
      <div className="pl-reader-row mx-auto flex w-fit max-w-full items-start gap-3">
        {tocOpen && (
          <aside
            className="no-print pl-slide-left pl-aside-sticky z-30 ml-3 flex w-[300px] shrink-0 flex-col rounded-pop border border-line bg-surface shadow-pop"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">
                <ListTree className="h-4 w-4 text-accent" />
                目录
                <span className="text-mut">({toc.length})</span>
              </span>
              <button onClick={() => setTocOpen(false)} title="关闭" className="pl-iconbtn">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="pl-thin flex-1 overflow-y-auto p-2">
              {toc.length === 0 && (
                <p className="py-12 text-center text-[12.5px] text-mut">本文未解析出标题</p>
              )}
              {toc.map(({ b }) => (
                <button
                  key={b.id}
                  onClick={() => locateBlock(b.id)}
                  className={`block w-full rounded-btn py-1.5 pr-2 text-left text-[13px] leading-snug transition-colors duration-150 hover:bg-accent-soft hover:text-accent-ink ${
                    (b.level || 1) <= 1 ? 'font-medium text-ink' : 'text-ink2'
                  }`}
                  style={{ paddingLeft: 12 + Math.min((b.level || 1) - 1, 3) * 16 }}
                  title={b.text || ''}
                >
                  {(b.text || '').slice(0, 60) || '(无标题)'}
                </button>
              ))}
            </div>
          </aside>
        )}
        <main
          className={`pl-reader-main min-w-0 flex-1 px-5 pb-[120px] pt-6 md:px-10 ${
            mode === 'dual' ? 'max-w-[1500px]' : 'max-w-[760px]'
          }`}
          onMouseUp={onMouseUp}
          onClick={(e) => {
            const t = e.target as HTMLElement
            if (t.tagName === 'IMG' && t.dataset.zoom === '1') openLightbox((t as HTMLImageElement).src)
          }}
      >
        {blocks.length === 0 && (
          <div className="grid place-items-center rounded-card border border-dashed border-line2 bg-surface px-6 py-20 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft">
              <BookOpenText className="h-6 w-6 text-accent" />
            </span>
            <p className="mt-4 text-[14px] text-ink2">
              {meta.status === 'queued'
                ? '任务排队中,开始处理后会自动刷新…'
                : meta.status === 'converting'
                  ? 'PDF 转换中,完成后自动刷新…'
                : '尚无内容,请先在文库完成转换'}
            </p>
            {meta.status === 'translating' && (
              <p className="mt-1 text-[12.5px] text-violet-500 dark:text-violet-400">
                转换已完成,正在翻译,页面会实时更新…
              </p>
            )}
          </div>
        )}

        {blocks.length > 0 && (
          <div
            className={`pl-prose grid ${
              mode === 'dual' ? 'pl-dual grid-cols-2 gap-x-[44px]' : 'grid-cols-1'
            }`}
            style={{ fontSize: `${15 * fontScale}px` }}
          >
            {blocks.map((b) =>
              mode === 'dual' ? (
                <div key={b.id} className="col-span-2 grid grid-cols-2 gap-x-[44px]">
                  <div
                    className={`pl-col-origin min-w-0 ${flash === b.id ? 'pl-flash' : ''}`}
                    data-bid={b.id}
                    data-side="origin"
                  >
                    <BlockView
                      b={b}
                      side="origin"
                      mode={mode}
                      docId={id}
                      anns={annsByBlock[`${b.id}:origin`]}
                      onAnnClick={onAnnClick}
                    />
                  </div>
                  <div className="pl-col-zh min-w-0" data-bid={b.id} data-side="translated">
                    <BlockView
                      b={b}
                      side="zh"
                      mode={mode}
                      docId={id}
                      anns={annsByBlock[`${b.id}:translated`]}
                      onAnnClick={onAnnClick}
                      onRetry={retryBlock}
                      retrying={retryingBlock === b.id}
                    />
                  </div>
                </div>
              ) : (
                <div
                  key={b.id}
                  className={`min-w-0 ${mode === 'origin' ? 'pl-col-origin' : 'pl-col-zh'} ${
                    flash === b.id ? 'pl-flash' : ''
                  }`}
                  data-bid={b.id}
                  data-side={mode === 'translated' ? 'translated' : 'origin'}
                >
                  <BlockView
                    b={b}
                    side={mode === 'translated' ? 'zh' : 'origin'}
                    mode={mode}
                    docId={id}
                    anns={annsByBlock[`${b.id}:${mode === 'translated' ? 'translated' : 'origin'}`]}
                    onAnnClick={onAnnClick}
                  />
                </div>
              ),
            )}
          </div>
        )}
      </main>

        {/* ——— 批注侧栏(与正文并排,不遮挡文字) ——— */}
        {panelOpen && (
          <aside
            className="no-print pl-slide-right pl-aside-sticky z-30 mr-3 flex w-[340px] shrink-0 flex-col rounded-pop border border-line bg-surface shadow-pop"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">
                <StickyNote className="h-4 w-4 text-accent" />
                批注
                <span className="text-mut">({notes.length})</span>
              </span>
              <button onClick={() => setPanelOpen(false)} title="关闭" className="pl-iconbtn">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="pl-thin flex-1 overflow-y-auto p-3">
              {notes.length === 0 && (
                <div className="px-3 py-12 text-center">
                  <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft">
                    <StickyNote className="h-5 w-5 text-accent" />
                  </span>
                  <p className="mt-3 text-[12.5px] leading-relaxed text-mut">
                    还没有批注笔记。
                    <br />
                    划选原文或译文 → 点「批注」写下笔记,就会集中在这里。
                  </p>
                </div>
              )}
              <div className="space-y-2.5">
                {[...notes].reverse().map((a) => {
                  const b = blockById[a.block_id]
                  const translated = (a.side || 'origin') === 'translated'
                  const full = translated
                    ? b?.zh ?? b?.zh_items?.join('') ?? ''
                    : b?.text ?? b?.items?.join('') ?? ''
                  const excerpt = full.slice(
                    Math.max(0, a.start - 12),
                    Math.min(full.length, a.end + 12),
                  )
                  const sec = sectionOf(a.block_id)
                  return (
                    <div
                      key={a.id}
                      onClick={() => locate(a)}
                      className="group/note relative cursor-pointer rounded-card border border-line bg-surface p-3 pl-4 pr-8 shadow-card transition-colors duration-150 hover:border-accent-line hover:bg-accent-soft/30"
                    >
                      <span
                        className="absolute inset-y-3 left-0 w-1 rounded-r-full"
                        style={{ background: colorHex(a.color) }}
                        title={a.kind === 'highlight' ? '高亮' : '下划线'}
                      />
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation()
                          delAnn(a)
                        }}
                        title="删除批注"
                        className="pl-iconbtn is-danger absolute right-1.5 top-1.5 h-7 w-7 opacity-0 transition-opacity duration-150 group-hover/note:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <span className="mb-1.5 flex items-center gap-1.5 text-[11px] text-mut">
                        <Highlighter className="h-3 w-3 text-accent" />
                        {a.kind === 'highlight' ? '高亮' : '下划线'}
                        {translated ? ' · 译文' : ' · 原文'}
                        {sec ? ` · 第 ${sec.no} 节` : ''}
                        {sec?.title ? ` · ${sec.title.slice(0, 16)}` : ''}
                      </span>
                      {excerpt && <p className="pl-quote mb-1.5 line-clamp-2">{excerpt}</p>}
                      <p className="text-[13px] leading-relaxed text-ink">{a.note}</p>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 划词翻译结果(侧栏底部,不遮挡正文) */}
            {trans && (
              <div className="shrink-0 border-t border-line bg-bg p-3">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Languages className="h-3.5 w-3.5 text-accent" />
                  <span className="text-[12px] font-medium text-ink2">划词翻译</span>
                  <span className="ml-auto flex items-center gap-0.5">
                    <button
                      onClick={() => navigator.clipboard.writeText(trans.zh)}
                      title="复制译文"
                      className="pl-iconbtn h-7 w-7"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setTrans(null)} title="关闭" className="pl-iconbtn h-7 w-7">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
                {trans.busy ? (
                  <div className="flex items-center gap-2 py-2 text-[13px] text-mut">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    翻译中…
                  </div>
                ) : trans.error ? (
                  <p className="py-1 text-[13px] leading-relaxed text-red-500">{trans.error}</p>
                ) : (
                  <>
                    {trans.src && <p className="pl-quote mb-2 line-clamp-3">{trans.src}</p>}
                    <p className="text-[14px] leading-[1.7] text-ink">{trans.zh}</p>
                  </>
                )}
              </div>
            )}
          </aside>
        )}
      </div>

      {/* ——— 划选工具条(墨黑反色胶囊) ——— */}
      {tool && (
        <div
          className="ink-bar pl-pop-in no-print fixed z-50 flex -translate-x-1/2 items-center gap-0.5 px-1.5 py-1"
          style={{ left: tool.x, top: Math.max(10, tool.y - 48) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button onClick={doTranslate} className="ink-bar-btn font-medium" title="划词翻译">
            <Languages className="h-3.5 w-3.5" />
            翻译
          </button>
          <span className="mx-1 h-4 w-px bg-inkbar-line" />
          <div className="flex items-center gap-1.5 px-1" title="选择标注颜色">
            {COLORS.map(({ c, cls }) => (
              <button
                key={c}
                onClick={() => setMarkColor(c)}
                title={c}
                aria-label={c}
                className={`swatch ${cls} ${markColor === c ? 'on' : ''}`}
              />
            ))}
          </div>
          <span className="mx-1 h-4 w-px bg-inkbar-line" />
          <button
            onClick={() => addMark('highlight', markColor)}
            className="ink-bar-btn"
            title={`高亮(${markColor})`}
          >
            <Highlighter className="h-3.5 w-3.5" />
            高亮
          </button>
          <button
            onClick={() => addMark('underline', markColor)}
            className="ink-bar-btn"
            title={`下划线(${markColor})`}
          >
            <UnderlineIcon className="h-3.5 w-3.5" />
            下划线
          </button>
          <button onClick={openNote} className="ink-bar-btn" title="添加批注">
            <PencilLine className="h-3.5 w-3.5" />
            批注
          </button>
        </div>
      )}

      {/* ——— 划词翻译结果:批注栏开启时贴在侧栏底部,否则浮动窗口(可拖动) ——— */}
      {trans && !panelOpen && (
        <div
          className="pl-pop-in no-print fixed z-50 w-80 rounded-pop border border-line bg-surface shadow-pop"
          style={{
            left: Math.max(8, Math.min(trans.x, window.innerWidth - 340)),
            top: Math.max(8, Math.min(trans.y, window.innerHeight - 180)),
          }}
        >
          <div
            className="flex cursor-move select-none items-center gap-1.5 rounded-t-pop border-b border-line px-3 py-2"
            onPointerDown={(e) => {
              // 点在按钮上时不进入拖动,否则会吞掉 click
              if ((e.target as HTMLElement).closest('button')) return
              dragTrans.current = { dx: e.clientX - trans.x, dy: e.clientY - trans.y }
              ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              if (!dragTrans.current) return
              setTrans((t) =>
                t
                  ? {
                      ...t,
                      x: e.clientX - dragTrans.current!.dx,
                      y: e.clientY - dragTrans.current!.dy,
                    }
                  : t,
              )
            }}
            onPointerUp={() => {
              dragTrans.current = null
            }}
          >
            <GripVertical className="h-3.5 w-3.5 shrink-0 text-mut" />
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink2">
              <Languages className="h-3.5 w-3.5 text-accent" />
              划词翻译
            </span>
            <span className="ml-auto flex items-center gap-0.5">
              <button
                onClick={() => navigator.clipboard.writeText(trans.zh)}
                title="复制译文"
                className="pl-iconbtn h-7 w-7"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setTrans(null)} title="关闭" className="pl-iconbtn h-7 w-7">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
          <div className="px-3 py-3">
            {trans.src && !trans.busy && !trans.error && (
              <p className="pl-quote mb-2 line-clamp-3">{trans.src}</p>
            )}
            {trans.busy ? (
              <div className="flex items-center gap-2 py-2 text-[13px] text-mut">
                <Loader2 className="h-4 w-4 animate-spin text-accent" />
                翻译中…
              </div>
            ) : trans.error ? (
              <p className="py-1 text-[13px] leading-relaxed text-red-500">{trans.error}</p>
            ) : (
              <p className="text-[14px] leading-[1.7] text-ink">{trans.zh}</p>
            )}
          </div>
        </div>
      )}

      {/* ——— 批注编辑器浮层 ——— */}
      {noteBox && (
        <div
          ref={noteBoxRef}
          className="pl-pop-in no-print fixed z-50 w-80 rounded-pop border border-line bg-surface p-3 shadow-pop"
          style={{
            left: Math.max(8, Math.min(noteBox.x, window.innerWidth - 340)),
            top: Math.max(8, Math.min(noteBox.y + 8, window.innerHeight - 300)),
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="mb-2.5 flex items-center gap-1.5">
            <Highlighter className="h-3.5 w-3.5 text-accent" />
            <span className="text-[12px] font-medium text-ink2">
              {noteBox.ann ? '编辑批注' : '添加批注'}
            </span>
            <span className="ml-auto flex items-center gap-0.5">
              {noteBox.ann && (
                <button onClick={deleteAnn} title="删除批注" className="pl-iconbtn is-danger h-7 w-7">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              <button onClick={() => setNoteBox(null)} title="关闭" className="pl-iconbtn h-7 w-7">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>

          {noteBox.ann && (
            <div className="mb-2.5 flex items-center gap-2">
              <span className="text-[11px] text-mut">颜色</span>
              <div className="flex items-center gap-1.5">
                {COLORS.map(({ c, cls }) => {
                  const a = noteBox.ann
                  const on = a?.color === c
                  return (
                    <button
                      key={c}
                      onClick={() => {
                        if (!a) return
                        api
                          .editAnnotation(id, a.id, { color: c })
                          .then(reloadAnns)
                          .catch(() => {})
                        setNoteBox({ ...noteBox, ann: { ...a, color: c } })
                      }}
                      title={c}
                      aria-label={c}
                      className={`h-4 w-4 rounded-full border transition-transform duration-150 ${cls} ${
                        on
                          ? 'scale-110 border-transparent ring-2 ring-accent'
                          : 'border-black/10 hover:scale-110'
                      }`}
                    />
                  )
                })}
              </div>
            </div>
          )}

          <textarea
            ref={noteRef}
            value={noteBox.draft}
            onChange={(e) => setNoteBox({ ...noteBox, draft: e.target.value })}
            onKeyDown={(e) => {
              // 回车换行(比输入框高度更早触发保存的那套行为已修掉);⌘/Ctrl+回车才是保存
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                saveNote()
              }
            }}
            placeholder="写点笔记… 回车换行,⌘/Ctrl + 回车保存"
            className="pl-textarea"
          />

          <div className="mt-2.5 flex justify-end gap-2">
            {noteBox.ann && (
              <button
                onClick={() => {
                  const a = noteBox.ann
                  if (!a) return
                  const next = a.kind === 'highlight' ? 'underline' : 'highlight'
                  api.editAnnotation(id, a.id, { kind: next }).then(reloadAnns)
                  setNoteBox(null)
                }}
                className="pl-btn pl-btn-sm pl-btn-ghost"
              >
                切换为{noteBox.ann.kind === 'highlight' ? '下划线' : '高亮'}
              </button>
            )}
            <button onClick={saveNote} className="pl-btn pl-btn-sm pl-btn-primary">
              保存
            </button>
          </div>
        </div>
      )}

      {/* ——— PDF 生成中 / 已完成提示 ——— */}
      {pdfState !== 'idle' && (
        <div className="no-print fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div className="pl-pop-in flex items-center gap-2.5 rounded-full border border-line bg-surface px-4 py-2.5 shadow-pop">
            {pdfState === 'busy' ? (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
                <span className="text-[13px] text-ink2">正在生成 PDF…</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                <span className="text-[13px] text-ink2">PDF 已完成</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ——— 图片灯箱 ——— */}
      {lightbox && (
        <div
          className="no-print fixed inset-0 z-[60] flex cursor-zoom-out items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox.srcs[lightbox.i]}
            alt="preview"
            className="rounded-[6px] object-contain"
            style={{
              maxHeight: 'calc(94dvh / var(--pl-zoom, 1))',
              maxWidth: 'calc(94vw / var(--pl-zoom, 1))',
            }}
          />

          <span className="absolute left-4 top-4 rounded-full bg-black/40 px-3 py-1 text-[12px] tabular-nums text-white/80">
            {lightbox.i + 1} / {lightbox.srcs.length}
          </span>

          <span className="absolute right-4 top-4 flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation()
                saveLightboxImage()
              }}
              title="保存图片"
              className={LB_BTN}
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setLightbox(null)
              }}
              title="关闭(Esc)"
              className={LB_BTN}
            >
              <X className="h-4 w-4" />
            </button>
          </span>

          {lightbox.srcs.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  stepLightbox(-1)
                }}
                title="上一张(←)"
                className={`${LB_BTN} absolute left-4 top-1/2 -translate-y-1/2`}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  stepLightbox(1)
                }}
                title="下一张(→)"
                className={`${LB_BTN} absolute right-4 top-1/2 -translate-y-1/2`}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
