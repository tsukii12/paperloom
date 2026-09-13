import {
  AlertCircle,
  ArrowLeft,
  ArrowUpDown,
  BookOpen,
  Check,
  CircleStop,
  ChevronRight,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Hash,
  Languages,
  LayoutGrid,
  List,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  SquarePen,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import {
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import Dropdown from '../components/Dropdown'
import MoveDialog from '../components/MoveDialog'
import { basename, childPath, isUnder, join, parent, segments, withAncestors } from '../folderPath'
import type { DocMeta, DocStatus } from '../types'

const STATUS_LABEL: Record<DocStatus, string> = {
  uploaded: '待转换',
  converting: '转换中',
  ready: '待翻译',
  translating: '翻译中',
  done: '已完成',
  cancelled: '已取消',
  failed: '失败',
}

const STATUS_CLS: Record<DocStatus, string> = {
  uploaded: 'bg-hover text-ink2',
  converting: 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
  ready: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
  translating: 'bg-violet-500/10 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
  done: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
  cancelled: 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
  failed: 'bg-red-500/10 text-red-600 dark:bg-red-500/15 dark:text-red-400',
}

const ACTIVE: DocStatus[] = ['converting', 'translating']

const SORT_OPTIONS = [
  { value: 'time-desc', label: '修改时间 · 新→旧' },
  { value: 'time-asc', label: '修改时间 · 旧→新' },
  { value: 'name-asc', label: '文件名 · A→Z' },
  { value: 'status', label: '状态' },
]

const VIEW_KEY = 'pl-view'
const LEGACY_FOLDERS_KEY = 'pl-folders'

/** 行拖拽用的自定义 MIME:与「从系统拖入 PDF」区分开 */
const DRAG_MIME = 'application/x-pl-items'

type Ctx =
  | { x: number; y: number; kind: 'folder'; path: string }
  | { x: number; y: number; kind: 'doc'; id: string }
  | { x: number; y: number; kind: 'blank' }

const dkey = (id: string) => `d:${id}`
const fkey = (path: string) => `f:${path}`

/** 修改时间:优先取 updated_at,旧数据回落到 created_at */
const mtime = (d: DocMeta) => d.updated_at || d.created_at || ''

/** 相对时间:今天显示时刻,更早显示日期 */
function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (!iso || isNaN(d.getTime())) return (iso || '').replace('T', ' ')
  const now = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return `${hh}:${mm}`
  if (d.getFullYear() === now.getFullYear())
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hh}:${mm}`
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Folder
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors duration-150 ${
        danger ? 'text-red-500 hover:bg-red-500/10 dark:text-red-400' : 'text-ink2 hover:bg-hover'
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
    </button>
  )
}

function readLegacyFolders(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LEGACY_FOLDERS_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string' && x.trim()) : []
  } catch {
    return []
  }
}

export default function Documents({ openTab }: { openTab: (id: string) => void }) {
  const [docs, setDocs] = useState<DocMeta[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [engine, setEngine] = useState('docling')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // 当前文件夹以 URL 为唯一真源,浏览器前进/后退即层级导航
  const [params, setParams] = useSearchParams()
  const folder = params.get('p') || ''

  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [sort, setSort] = useState('time-desc')
  const [view, setView] = useState<'list' | 'grid'>(
    () => (localStorage.getItem(VIEW_KEY) as 'list' | 'grid') || 'list',
  )

  const [sel, setSel] = useState<Set<string>>(new Set())
  const anchor = useRef('')

  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [renaming, setRenaming] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  const renamingRef = useRef('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [createErr, setCreateErr] = useState('')
  const [moveOpen, setMoveOpen] = useState(false)

  const [tagEdit, setTagEdit] = useState<DocMeta | null>(null)
  const [logId, setLogId] = useState('')
  const [draftTags, setDraftTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState('')
  const tagRef = useRef<HTMLDivElement>(null)

  const [dropTarget, setDropTarget] = useState('')
  const [fileDrag, setFileDrag] = useState(false)
  const dragDepth = useRef(0)

  const fileInput = useRef<HTMLInputElement>(null)
  const nav = useNavigate()

  const refresh = useCallback(async () => {
    try {
      const [d, f] = await Promise.all([api.listDocs(), api.listFolders()])
      setDocs(d)
      setFolders(f)
    } catch {
      /* 服务器未启动时静默 */
    } finally {
      setLoaded(true)
    }
  }, [])

  // 首屏:先把旧版 localStorage 里的空文件夹迁到服务端,再取数据
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if ((await api.listFolders()).length === 0) {
          const legacy = readLegacyFolders()
          if (legacy.length) {
            await Promise.allSettled(legacy.map((p) => api.createFolder(p)))
            localStorage.removeItem(LEGACY_FOLDERS_KEY)
          }
        }
      } catch {
        /* 服务器未启动时静默 */
      }
      if (!cancelled) refresh()
    })()
    // 转换引擎只在设置页选择,文库页仅读取默认引擎用于触发「转换」
    api
      .settings()
      .then((s) => setEngine(s.engine || 'docling'))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [refresh])

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view)
  }, [view])

  const [pollBoost, setPollBoost] = useState(false)
  const boostTimer = useRef<number | null>(null)

  // 有进行中的任务(或刚提交过任务)时轮询刷新
  useEffect(() => {
    if (!pollBoost && !docs.some((d) => ACTIVE.includes(d.status))) return
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  }, [docs, refresh, pollBoost])

  /** 点「转换/翻译」后,后台要过一会儿才把状态写成 converting/translating。
   *  只刷新一次可能读到旧状态,轮询条件不成立就永远不刷新了 —— 强制轮询一段时间兜底。 */
  const boostPolling = () => {
    setPollBoost(true)
    if (boostTimer.current !== null) window.clearTimeout(boostTimer.current)
    boostTimer.current = window.setTimeout(() => setPollBoost(false), 15000)
  }

  /* ── 派生数据 ── */

  /** 全部已知文件夹:服务端显式建过的 + 文档隐含的,并补齐祖先 */
  const allFolders = useMemo(
    () => withAncestors([...folders, ...docs.map((d) => d.folder || '')]),
    [folders, docs],
  )

  /** 每个文件夹的递归文档数(含子文件夹) */
  const counts = useMemo(() => {
    const total = new Map<string, number>()
    for (const d of docs) {
      const p = d.folder || ''
      total.set(p, (total.get(p) ?? 0) + 1)
    }
    // 从最深层往上累加
    for (const f of [...allFolders].sort((a, b) => segments(b).length - segments(a).length)) {
      const par = parent(f)
      total.set(par, (total.get(par) ?? 0) + (total.get(f) ?? 0))
    }
    return total
  }, [docs, allFolders])

  const countOf = (p: string) => counts.get(p) ?? 0

  /** 选中项中仍然存在的部分:轮询刷新后可能有已消失的文档或文件夹。
   *  在渲染期派生而不是用 effect 回写,避免每轮刷新都触发级联渲染。 */
  const liveSel = useMemo(() => {
    const live = new Set<string>([...docs.map((d) => dkey(d.id)), ...allFolders.map(fkey)])
    let stale = false
    const next = new Set<string>()
    for (const k of sel) {
      if (live.has(k)) next.add(k)
      else stale = true
    }
    return stale ? next : sel
  }, [sel, docs, allFolders])

  // URL 里的文件夹不存在了(在别处被删或重命名):退回根目录
  useEffect(() => {
    if (loaded && folder && !allFolders.includes(folder)) setParams({}, { replace: true })
  }, [loaded, folder, allFolders, setParams])

  const go = useCallback(
    (p: string) => {
      setParams(p ? { p } : {})
      setSel(new Set())
      anchor.current = ''
    },
    [setParams],
  )

  const q = search.trim().toLowerCase()
  const searching = !!q

  const docsHere = useMemo(() => docs.filter((d) => (d.folder || '') === folder), [docs, folder])

  /** 有搜索词就跨所有文件夹,否则只看当前文件夹 */
  const shownDocs = useMemo(() => {
    const list = (searching ? docs : docsHere).filter((d) => {
      if (
        q &&
        !d.filename.toLowerCase().includes(q) &&
        !(d.tags || []).some((t) => t.toLowerCase().includes(q))
      )
        return false
      if (tagFilter && !(d.tags || []).includes(tagFilter)) return false
      return true
    })
    const by: Record<string, (a: DocMeta, b: DocMeta) => number> = {
      'time-desc': (a, b) => mtime(b).localeCompare(mtime(a)),
      'time-asc': (a, b) => mtime(a).localeCompare(mtime(b)),
      'name-asc': (a, b) => a.filename.localeCompare(b.filename),
      status: (a, b) => a.status.localeCompare(b.status) || a.filename.localeCompare(b.filename),
    }
    return [...list].sort(by[sort])
  }, [searching, docs, docsHere, q, tagFilter, sort])

  const shownFolders = useMemo(
    () =>
      searching
        ? []
        : allFolders
            .filter((f) => parent(f) === folder)
            .sort((a, b) => basename(a).localeCompare(basename(b))),
    [searching, allFolders, folder],
  )

  const allTags = useMemo(() => [...new Set(docs.flatMap((d) => d.tags || []))].sort(), [docs])
  const hasFilter = searching || !!tagFilter

  /** 搜索是全局的,此时「返回」的语义是退出搜索而不是上一层目录 */
  const back = useCallback(() => {
    if (searching) setSearch('')
    else go(parent(folder))
  }, [searching, folder, go])

  /** 当前视图里的全部行,供 Shift 范围选择与 Ctrl+A 使用 */
  const order = useMemo(
    () => [...shownFolders.map(fkey), ...shownDocs.map((d) => dkey(d.id))],
    [shownFolders, shownDocs],
  )

  const selDocIds = useMemo(
    () => [...liveSel].filter((k) => k.startsWith('d:')).map((k) => k.slice(2)),
    [liveSel],
  )
  const selFolderPaths = useMemo(
    () => [...liveSel].filter((k) => k.startsWith('f:')).map((k) => k.slice(2)),
    [liveSel],
  )
  /** 选中的文件夹里,去掉那些已经被别的选中项包含的(否则删除/移动会撞 404) */
  const topFolders = useMemo(
    () => selFolderPaths.filter((p) => !selFolderPaths.some((o) => o !== p && isUnder(p, o))),
    [selFolderPaths],
  )
  const selDoc = useMemo(
    () =>
      selDocIds.length === 1 && !selFolderPaths.length
        ? docs.find((d) => d.id === selDocIds[0]) || null
        : null,
    [docs, selDocIds, selFolderPaths],
  )

  /** 日志弹窗当前展示的文档(从 docs 里实时取,处理中会自动刷新) */
  const logDoc = useMemo(() => docs.find((d) => d.id === logId) || null, [docs, logId])

  /* ── 选择 ── */

  const clickRow = (e: ReactMouseEvent, key: string) => {
    e.stopPropagation()
    if (e.shiftKey && anchor.current) {
      const a = order.indexOf(anchor.current)
      const b = order.indexOf(key)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setSel(new Set(order.slice(lo, hi + 1)))
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSel((s) => {
        const n = new Set(s)
        if (n.has(key)) n.delete(key)
        else n.add(key)
        return n
      })
    } else {
      setSel(new Set([key]))
    }
    anchor.current = key
  }

  const toggleKey = (key: string) =>
    setSel((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      anchor.current = key
      return n
    })

  // 键盘:Esc 清空 / Backspace 上一级 / Ctrl+A 全选 / Enter 进入文件夹
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'Escape') {
        setSel(new Set())
        setCtx(null)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        back()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSel(new Set(order))
      } else if (e.key === 'Enter' && liveSel.size === 1) {
        const k = [...liveSel][0]
        if (k.startsWith('f:')) go(k.slice(2))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back, go, order, liveSel])

  /* ── 操作 ── */

  const act = async (fn: () => Promise<unknown>, startsJob = false) => {
    setError('')
    if (startsJob) boostPolling()
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }

  const fail = async (e: unknown) => {
    setError(String(e instanceof Error ? e.message : e))
    await refresh()
  }

  const runMove = async (to: string, ids: string[], tops: string[]) => {
    const movable = ids.filter((id) => (docs.find((d) => d.id === id)?.folder || '') !== to)
    for (const p of tops) {
      if (to === parent(p)) continue // 已经在目标位置
      await api.renameFolder(p, join(to, basename(p)))
    }
    if (movable.length) await api.moveDocs(movable, to)
  }

  const doMove = async (to: string) => {
    setMoveOpen(false)
    setError('')
    try {
      await runMove(to, selDocIds, topFolders)
      setSel(new Set())
      await refresh()
    } catch (e) {
      await fail(e)
    }
  }

  /** 拖拽到某个文件夹行 */
  const dropInto = async (to: string, keys: string[]) => {
    const ids = keys.filter((k) => k.startsWith('d:')).map((k) => k.slice(2))
    const fps = keys.filter((k) => k.startsWith('f:')).map((k) => k.slice(2))
    const tops = fps.filter((p) => !fps.some((o) => o !== p && isUnder(p, o)))
    if (tops.some((p) => to === p || isUnder(to, p))) {
      setError('不能把文件夹移动到它自己或它的子文件夹里')
      return
    }
    setError('')
    try {
      await runMove(to, ids, tops)
      setSel(new Set())
      await refresh()
    } catch (e) {
      await fail(e)
    }
  }

  /** 显式接收待删项,而不是读 state —— 右键菜单在 setSel 同一次事件里调用,
   *  那时 state 还没更新,读到的会是旧选中。 */
  const removeItems = async (folderPaths: string[], docIds: string[]) => {
    const tops = folderPaths.filter((p) => !folderPaths.some((o) => o !== p && isUnder(p, o)))
    const nf = tops.length
    const nd = docIds.length
    if (!nf && !nd) return
    const msg =
      nf && nd
        ? `删除 ${nf} 个文件夹和 ${nd} 篇文档?\n文件夹中的内容会折叠到它的上一级;文档会移入回收目录(data/trash)。`
        : nf
          ? `删除 ${nf} 个文件夹?\n其中的文档和子文件夹会折叠到它的上一级,不会被删除。`
          : `将 ${nd} 篇文档移入回收目录(data/trash)?`
    if (!window.confirm(msg)) return
    setError('')
    try {
      for (const p of tops) await api.removeFolder(p)
      for (const id of docIds) await api.remove(id)
      setSel(new Set())
      await refresh()
    } catch (e) {
      await fail(e)
    }
  }

  const createFolder = async () => {
    const path = childPath(folder, newName)
    if (!path) {
      setCreateErr('名称无效或层级过深')
      return
    }
    setError('')
    try {
      await api.createFolder(path)
      setCreating(false)
      setNewName('')
      setCreateErr('')
      await refresh()
      setSel(new Set([fkey(path)]))
    } catch (e) {
      setCreateErr(String(e instanceof Error ? e.message : e))
    }
  }

  const startRename = (path: string) => {
    renamingRef.current = path
    setRenaming(path)
    setRenameDraft(basename(path))
  }

  const cancelRename = () => {
    renamingRef.current = ''
    setRenaming('')
  }

  const commitRename = async (from: string) => {
    // 按回车时输入框会卸载并再触发一次 blur,用 ref 挡住第二次提交
    if (renamingRef.current !== from) return
    renamingRef.current = ''
    setRenaming('')
    const name = renameDraft.trim()
    if (!name || name === basename(from)) return
    if (!childPath(parent(from), name)) {
      setError('名称无效')
      return
    }
    await act(() => api.renameFolder(from, join(parent(from), name)))
  }

  const upload = async (files: FileList | File[]) => {
    const pdfs = Array.from(files).filter((f) => f.name.toLowerCase().endsWith('.pdf'))
    if (!pdfs.length) return
    setBusy(true)
    setError('')
    try {
      const created = await api.upload(pdfs)
      // 上传到当前所在文件夹
      if (folder) await api.moveDocs(created.map((c) => c.id), folder)
      await refresh()
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  const openReader = (d: DocMeta) => {
    if (!canRead(d)) return
    openTab(d.id)
    nav(`/reader/${d.id}`)
  }

  const openTagEdit = (d: DocMeta) => {
    setTagEdit(d)
    setDraftTags(d.tags || [])
    setNewTag('')
  }

  const saveTags = async () => {
    if (!tagEdit) return
    try {
      await api.updateDoc(tagEdit.id, { tags: draftTags })
    } catch {
      /* ignore */
    }
    setTagEdit(null)
    refresh()
  }

  /* ── 弹层关闭 ── */

  useEffect(() => {
    if (!ctx) return
    const close = () => setCtx(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [ctx])

  useEffect(() => {
    if (!tagEdit) return
    const close = (e: MouseEvent) => {
      if (tagRef.current && !tagRef.current.contains(e.target as Node)) setTagEdit(null)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [tagEdit])

  /* ── 行内组件 ── */

  const Actions = ({ d }: { d: DocMeta }) => {
    const active = ACTIVE.includes(d.status)
    const cancelling = active && (d.stage || '').startsWith('取消')
    if (active) {
      return cancelling ? (
        <span className="pl-pill bg-amber-500/10 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          取消中…
        </span>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation()
            act(() => api.cancel(d.id))
          }}
          title="取消当前任务"
          className="pl-btn pl-btn-sm pl-btn-danger"
        >
          <CircleStop className="h-3.5 w-3.5" />
          取消
        </button>
      )
    }
    return (
      <div className="flex items-center gap-1">
        {['uploaded', 'ready', 'done', 'failed', 'cancelled'].includes(d.status) && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              act(() => api.convert(d.id, engine), true)
            }}
            title="重新转换会覆盖现有译文与批注位置"
            className="pl-btn pl-btn-sm pl-btn-ghost"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {d.status === 'uploaded' ? '转换' : '重转'}
          </button>
        )}
        {['ready', 'done', 'failed', 'cancelled'].includes(d.status) && (
          <button
            title={
              d.status === 'done'
                ? '全部重新翻译'
                : d.status === 'cancelled'
                  ? '从上次中断处继续'
                  : d.status === 'failed'
                    ? '重试失败的块'
                    : '翻译全文'
            }
            onClick={(e) => {
              e.stopPropagation()
              act(() => api.translate(d.id, d.status === 'done' ? 'force' : 'auto'), true)
            }}
            className="pl-btn pl-btn-sm pl-btn-ghost"
          >
            <Languages className="h-3.5 w-3.5" />
            {d.status === 'done'
              ? '重译'
              : d.status === 'cancelled'
                ? '继续'
                : d.status === 'failed'
                  ? '重试'
                  : '翻译'}
          </button>
        )}
        {canRead(d) && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              openReader(d)
            }}
            className="pl-btn pl-btn-sm pl-btn-soft"
          >
            <BookOpen className="h-3.5 w-3.5" />
            阅读
          </button>
        )}
        {/* 悬停才浮现的次要操作放在末尾:否则它们占的宽度会把「重转」往右推,
            操作列左对齐时就对不上表头了 */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            openTagEdit(d)
          }}
          title="编辑标签"
          className="pl-iconbtn h-7 w-7 opacity-0 group-hover/row:opacity-100"
        >
          <Tag className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (window.confirm(`将「${d.filename}」移入回收目录(data/trash)?`)) {
              act(() => api.remove(d.id))
            }
          }}
          title="移入回收目录"
          className="pl-iconbtn is-danger h-7 w-7 opacity-0 group-hover/row:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  /** 状态标签:有日志时可点击查看处理明细 */
  const StatusPill = ({ d }: { d: DocMeta }) => {
    const hasLog = !!d.log?.trim()
    return (
      <button
        type="button"
        disabled={!hasLog}
        title={hasLog ? '查看处理日志' : undefined}
        onClick={(e) => {
          e.stopPropagation()
          setLogId(d.id)
        }}
        className={`pl-pill ${STATUS_CLS[d.status]} ${
          hasLog ? 'cursor-pointer hover:brightness-125' : 'cursor-default'
        }`}
      >
        <span className={`pl-dot ${ACTIVE.includes(d.status) ? 'animate-pulse' : ''}`} />
        {STATUS_LABEL[d.status]}
      </button>
    )
  }

  const Progress = ({ d }: { d: DocMeta }) =>
    ACTIVE.includes(d.status) ? (
      <span className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-hover">
        <span
          className={`block h-full transition-[width] duration-300 ${
            d.status === 'translating' ? 'bg-violet-500' : 'bg-blue-500'
          }`}
          style={{ width: `${Math.max(3, Math.round((d.progress || 0) * 100))}%` }}
        />
      </span>
    ) : null

  const Checkbox = ({ on }: { on: boolean }) => (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-150 ${
        on
          ? 'border-accent bg-accent text-white dark:text-[#10201d]'
          : 'border-line2 bg-surface text-transparent group-hover/row:border-accent-line'
      }`}
    >
      <Check className="h-3 w-3" strokeWidth={3.5} />
    </span>
  )

  /** 文件夹行的拖放目标行为 */
  const dropProps = (path: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      // dragover 会连续触发,返回同一个值让 React 跳过重渲染
      setDropTarget((t) => (t === path ? t : path))
    },
    onDragLeave: () => setDropTarget((t) => (t === path ? '' : t)),
    onDrop: (e: DragEvent) => {
      const raw = e.dataTransfer.getData(DRAG_MIME)
      if (!raw) return
      e.preventDefault()
      setDropTarget('')
      try {
        dropInto(path, JSON.parse(raw) as string[])
      } catch {
        /* 无效载荷,忽略 */
      }
    },
  })

  const tagOptions = [
    { value: '', label: '全部标签' },
    ...allTags.map((t) => ({ value: t, label: `#${t}` })),
  ]

  /* ── 面包屑 ── */

  const crumbs = segments(folder).map((name, i) => ({
    name,
    path: segments(folder)
      .slice(0, i + 1)
      .join('/'),
  }))

  const contentShape = 'flex items-center gap-3 border-b border-line px-3'

  return (
    <main className="mx-auto max-w-[1500px] px-5 pb-24 pt-6 md:px-8">
      <header className="mb-3">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-ink">文库</h1>
        <p className="mt-1 text-[13px] text-mut">
          {docs.length === 0
            ? '还没有文档'
            : `共 ${docs.length} 篇文档 · ${allFolders.length} 个文件夹`}
          {hasFilter ? ` · 筛选出 ${shownDocs.length} 篇` : ''}
        </p>
      </header>

      {/* 导航条:返回上一级 + 面包屑 + 新建/上传 */}
      <div className="sticky top-3 z-30 mb-3 flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface/95 px-2.5 py-2 shadow-card backdrop-blur">
        <button
          onClick={back}
          disabled={!folder && !searching}
          title={searching ? '清除搜索(Backspace)' : '返回上一级(Backspace)'}
          className="pl-btn pl-btn-sm pl-btn-ghost shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
          {searching ? '清除搜索' : '返回上一级'}
        </button>

        <nav className="pl-thin flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-[13px]">
          {searching ? (
            <span className="flex shrink-0 items-center gap-1.5 rounded-[8px] bg-accent-soft px-2.5 py-1 font-medium text-accent-ink">
              <Search className="h-3.5 w-3.5" />
              搜索结果 · 全部文件夹
              <span className="text-[11px] tabular-nums opacity-70">{shownDocs.length} 篇</span>
            </span>
          ) : (
            <>
              <button
                onClick={() => go('')}
                className={`flex shrink-0 items-center gap-1.5 rounded-[8px] px-2 py-1 transition-colors duration-150 ${
                  folder ? 'text-ink2 hover:bg-hover' : 'font-medium text-ink'
                }`}
              >
                <FolderOpen className="h-4 w-4 text-accent" />
                全部文档
              </button>
              {crumbs.map((c) => (
                <span key={c.path} className="flex shrink-0 items-center gap-0.5">
                  <ChevronRight className="h-3.5 w-3.5 text-mut" />
                  <button
                    onClick={() => go(c.path)}
                    className={`rounded-[8px] px-2 py-1 transition-colors duration-150 ${
                      c.path === folder ? 'bg-hover font-medium text-ink' : 'text-ink2 hover:bg-hover'
                    }`}
                  >
                    {c.name}
                  </button>
                </span>
              ))}
            </>
          )}
        </nav>

        <button
          onClick={() => {
            setCreating(true)
            setNewName('')
            setCreateErr('')
          }}
          className="pl-btn pl-btn-sm pl-btn-ghost shrink-0"
        >
          <FolderPlus className="h-4 w-4" />
          新建文件夹
        </button>

        <button
          className="pl-btn pl-btn-sm pl-btn-primary shrink-0"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          上传 PDF
        </button>

        <input
          ref={fileInput}
          type="file"
          accept=".pdf"
          multiple
          hidden
          onChange={(e) => e.target.files && upload(e.target.files)}
        />
      </div>

      {/* 工具行 */}
      <div className="mb-3 flex flex-wrap items-center gap-2" style={{ ['--ctl-h' as string]: '36px' }}>
        <div className="relative min-w-[200px] flex-1 sm:max-w-[340px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mut" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={folder ? '搜索全部文件夹…' : '搜索文件名或标签…'}
            className="pl-input pl-input-icon text-[13px]"
          />
        </div>

        <Dropdown
          value={tagFilter}
          options={tagOptions}
          onChange={setTagFilter}
          size="sm"
          className="w-[132px]"
        />

        <Dropdown
          value={sort}
          options={SORT_OPTIONS}
          onChange={setSort}
          size="sm"
          className="w-[168px]"
        />

        <div className="flex h-[var(--ctl-h)] shrink-0 items-center gap-0.5 rounded-btn border border-line2 bg-surface px-0.5">
          {(
            [
              ['list', List, '列表'],
              ['grid', LayoutGrid, '网格'],
            ] as const
          ).map(([v, Icon, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              title={`${label}视图`}
              className={`flex h-[26px] w-7 items-center justify-center rounded-[6px] transition-colors duration-150 ${
                view === v ? 'bg-accent-soft text-accent-ink' : 'text-mut hover:text-ink2'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-card border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-600 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button onClick={() => setError('')} className="pl-iconbtn h-6 w-6" title="关闭">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 内容区:整块是拖入 PDF 的投放区 */}
      <div
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return
          e.preventDefault()
          setCtx({ x: e.clientX, y: e.clientY, kind: 'blank' })
        }}
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          dragDepth.current += 1
          setFileDrag(true)
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
        }}
        onDragLeave={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          dragDepth.current -= 1
          if (dragDepth.current <= 0) {
            dragDepth.current = 0
            setFileDrag(false)
          }
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          dragDepth.current = 0
          setFileDrag(false)
          upload(e.dataTransfer.files)
        }}
        onClick={() => {
          setSel(new Set())
          anchor.current = ''
        }}
        className={`overflow-hidden rounded-card border bg-surface transition-colors duration-200 ${
          fileDrag ? 'border-accent bg-accent-soft/40' : 'border-line'
        }`}
      >
        {/* 列表视图列头 */}
        {view === 'list' && (shownFolders.length > 0 || shownDocs.length > 0) && (
          <div className="flex items-center gap-3 border-b border-line bg-bg/40 py-1.5 pl-3 pr-3 text-[11px] text-mut">
            <span className="w-4 shrink-0" />
            <span className="min-w-[140px] flex-1">名称</span>
            <span className="hidden w-[84px] shrink-0 sm:block">状态</span>
            <span className="hidden w-[48px] shrink-0 xl:block">页数</span>
            <span className="hidden w-[68px] shrink-0 xl:block">引擎</span>
            <span className="hidden w-[140px] shrink-0 lg:block">
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <ArrowUpDown className="h-3 w-3 shrink-0" />
                修改时间
              </span>
            </span>
            <span className="w-[290px] shrink-0">操作</span>
          </div>
        )}

        {/* 新建文件夹:行内输入 */}
        {creating && (
          <div className={`${contentShape} py-1.5`}>
            <span className="w-4 shrink-0" />
            <Folder className="h-4 w-4 shrink-0 text-accent" />
            <input
              autoFocus
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value)
                setCreateErr('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createFolder()
                if (e.key === 'Escape') {
                  setCreating(false)
                  setNewName('')
                  setCreateErr('')
                }
              }}
              onBlur={() => {
                if (!newName.trim()) {
                  setCreating(false)
                  setCreateErr('')
                }
              }}
              placeholder={folder ? `在「${basename(folder)}」中新建文件夹` : '新文件夹名称'}
              className="h-8 min-w-0 flex-1 rounded-[7px] border border-line2 bg-surface px-2 text-[13px] outline-none focus:border-accent"
            />
            {createErr && <span className="shrink-0 text-[12px] text-red-500">{createErr}</span>}
            <button className="pl-btn pl-btn-sm pl-btn-primary shrink-0" onClick={createFolder}>
              创建
            </button>
            <button
              className="pl-iconbtn h-7 w-7 shrink-0"
              title="取消"
              onClick={() => {
                setCreating(false)
                setNewName('')
                setCreateErr('')
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* 文件夹行 */}
        {view === 'list' &&
          shownFolders.map((path) => {
            const on = liveSel.has(fkey(path))
            return (
              <div
                key={path}
                draggable={renaming !== path}
                onDragStart={(e) => {
                  const keys = on ? [...liveSel] : [fkey(path)]
                  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(keys))
                  e.dataTransfer.effectAllowed = 'move'
                }}
                {...dropProps(path)}
                onClick={(e) => renaming !== path && clickRow(e, fkey(path))}
                onDoubleClick={() => renaming !== path && go(path)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setCtx({ x: e.clientX, y: e.clientY, kind: 'folder', path })
                }}
                title="双击进入文件夹"
                className={`group/row relative flex items-center gap-3 border-b border-line py-2 pl-3 pr-3 transition-colors duration-100 ${
                  dropTarget === path
                    ? 'bg-accent-soft ring-1 ring-inset ring-accent'
                    : on
                      ? 'bg-accent-soft/50'
                      : 'cursor-pointer hover:bg-hover'
                }`}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleKey(fkey(path))
                    }}
                    title={on ? '取消选择' : '选择'}
                    className="flex"
                  >
                    <Checkbox on={on} />
                  </button>
                </span>

                {renaming === path ? (
                  <input
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => commitRename(path)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(path)
                      if (e.key === 'Escape') cancelRename()
                    }}
                    className="h-7 min-w-0 flex-1 rounded-[7px] border border-line2 bg-surface px-2 text-[13px] outline-none focus:border-accent"
                  />
                ) : (
                  <div className="flex min-w-[140px] flex-1 items-center gap-2">
                    <Folder className="h-4 w-4 shrink-0 text-accent" />
                    <span className="min-w-0 truncate text-[13.5px] font-medium text-ink group-hover/row:text-accent">
                      {basename(path)}
                    </span>
                    <span className="shrink-0 text-[12px] tabular-nums text-mut">
                      {countOf(path)} 篇
                    </span>
                  </div>
                )}

                <span className="hidden w-[84px] shrink-0 sm:block" />
                <span className="hidden w-[48px] shrink-0 xl:block" />
                <span className="hidden w-[68px] shrink-0 xl:block" />
                <span className="hidden w-[140px] shrink-0 lg:block" />

                <div className="flex w-[290px] shrink-0 items-center">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      setCtx({ x: r.right - 176, y: r.bottom + 4, kind: 'folder', path })
                    }}
                    title="更多操作"
                    className="pl-iconbtn h-7 w-7 opacity-0 group-hover/row:opacity-100"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}

        {/* 文档行 */}
        {view === 'list' &&
          shownDocs.map((d, i) => {
            const key = dkey(d.id)
            const on = liveSel.has(key)
            return (
              <div
                key={d.id}
                draggable
                onDragStart={(e) => {
                  const keys = on ? [...liveSel] : [key]
                  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(keys))
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onClick={(e) => clickRow(e, key)}
                onDoubleClick={() => openReader(d)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setCtx({ x: e.clientX, y: e.clientY, kind: 'doc', id: d.id })
                }}
                title={canRead(d) ? '双击打开阅读页' : undefined}
                style={{ animationDelay: `${Math.min(i, 15) * 20}ms` }}
                className={`group/row pl-fade-up relative flex items-center gap-3 border-b border-line py-2 pl-3 pr-3 transition-colors duration-100 last:border-b-0 ${
                  on ? 'bg-accent-soft/50' : 'cursor-pointer hover:bg-hover'
                }`}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleKey(key)
                    }}
                    title={on ? '取消选择' : '选择'}
                    className="flex"
                  >
                    <Checkbox on={on} />
                  </button>
                </span>

                <div className="flex min-w-[140px] flex-1 items-center gap-2">
                  <FileText className={`h-4 w-4 shrink-0 ${canRead(d) ? 'text-accent' : 'text-mut'}`} />
                  <span
                    className={`min-w-0 truncate text-[13.5px] ${
                      canRead(d) ? 'font-medium text-ink group-hover/row:text-accent' : 'text-ink'
                    }`}
                    title={d.filename}
                  >
                    {d.filename}
                  </span>
                  {searching && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setSearch('')
                        go(d.folder || '')
                      }}
                      title="跳到所在文件夹"
                      className="hidden max-w-[150px] shrink-0 items-center gap-1 truncate rounded-[7px] bg-hover px-1.5 py-0.5 text-[11.5px] text-mut transition-colors hover:text-ink2 sm:flex"
                    >
                      <Folder className="h-3 w-3 shrink-0" />
                      {d.folder || '全部文档'}
                    </button>
                  )}
                  {(d.tags || []).map((t) => (
                    <button
                      key={t}
                      onClick={(e) => {
                        e.stopPropagation()
                        setTagFilter(t)
                      }}
                      title="按此标签筛选"
                      className="hidden max-w-[104px] shrink-0 truncate rounded-[7px] bg-accent-soft px-1.5 py-0.5 text-[11.5px] text-accent-ink transition-colors hover:bg-accent-line/60 lg:block"
                    >
                      #{t}
                    </button>
                  ))}
                </div>

                <div className="hidden w-[84px] shrink-0 sm:block">
                  <StatusPill d={d} />
                </div>
                <span className="hidden w-[48px] shrink-0 text-[12.5px] tabular-nums text-mut xl:block">
                  {d.n_pages ? d.n_pages : '—'}
                </span>
                <span className="hidden w-[68px] shrink-0 truncate text-[12.5px] capitalize text-mut xl:block">
                  {d.engine || '—'}
                </span>
                <span className="hidden w-[140px] shrink-0 text-[12.5px] whitespace-nowrap tabular-nums text-mut lg:block">
                  {fmtTime(d.updated_at || d.created_at)}
                </span>

                <div className="flex w-[290px] shrink-0 items-center">
                  <Actions d={d} />
                </div>

                <Progress d={d} />
              </div>
            )
          })}

        {/* 网格视图 */}
        {view === 'grid' && (shownFolders.length > 0 || shownDocs.length > 0) && (
          <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {shownFolders.map((path) => {
              const on = liveSel.has(fkey(path))
              return (
                <div
                  key={path}
                  draggable
                  onDragStart={(e) => {
                    const keys = on ? [...liveSel] : [fkey(path)]
                    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(keys))
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  {...dropProps(path)}
                  onClick={(e) => clickRow(e, fkey(path))}
                  onDoubleClick={() => go(path)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setCtx({ x: e.clientX, y: e.clientY, kind: 'folder', path })
                  }}
                  className={`group/row relative overflow-hidden rounded-card border p-3.5 transition-colors duration-150 ${
                    dropTarget === path
                      ? 'border-accent bg-accent-soft/60'
                      : on
                        ? 'border-accent-line bg-accent-soft/40'
                        : 'cursor-pointer border-line hover:border-accent-line hover:bg-accent-soft/20'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <Folder className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-ink group-hover/row:text-accent">
                        {basename(path)}
                      </p>
                      <p className="mt-1 text-[12px] text-mut">{countOf(path)} 篇文档</p>
                    </div>
                  </div>
                </div>
              )
            })}

            {shownDocs.map((d, i) => {
              const on = liveSel.has(dkey(d.id))
              return (
                <div
                  key={d.id}
                  draggable
                  onDragStart={(e) => {
                    const keys = on ? [...liveSel] : [dkey(d.id)]
                    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(keys))
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onClick={(e) => clickRow(e, dkey(d.id))}
                  onDoubleClick={() => openReader(d)}
                  style={{ animationDelay: `${Math.min(i, 15) * 20}ms` }}
                  className={`group/row pl-fade-up relative overflow-hidden rounded-card border bg-surface p-3.5 transition-colors duration-150 ${
                    on
                      ? 'border-accent-line bg-accent-soft/40'
                      : 'cursor-pointer border-line hover:border-accent-line hover:bg-accent-soft/20'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-[13.5px] font-medium text-ink group-hover/row:text-accent"
                        title={d.filename}
                      >
                        {d.filename}
                      </p>
                      <p className="mt-1 text-[12px] tabular-nums text-mut">
                        {fmtTime(mtime(d))}
                        {d.n_pages ? ` · ${d.n_pages} 页` : ''}
                        {d.engine ? ` · ${d.engine}` : ''}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <StatusPill d={d} />
                        {searching && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setSearch('')
                              go(d.folder || '')
                            }}
                            className="flex max-w-[150px] items-center gap-1 truncate rounded-[7px] bg-hover px-1.5 py-0.5 text-[11.5px] text-mut transition-colors hover:text-ink2"
                          >
                            <Folder className="h-3 w-3 shrink-0" />
                            {d.folder || '全部文档'}
                          </button>
                        )}
                        {(d.tags || []).map((t) => (
                          <span
                            key={t}
                            className="rounded-[7px] bg-accent-soft px-1.5 py-0.5 text-[11.5px] text-accent-ink"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-end border-t border-line pt-2.5">
                    <Actions d={d} />
                  </div>
                  <Progress d={d} />
                </div>
              )
            })}
          </div>
        )}

        {/* 失败详情 */}
        {shownDocs
          .filter((d) => d.status === 'failed' && d.error)
          .map((d) => (
            <pre
              key={`err-${d.id}`}
              className="border-t border-line bg-red-500/10 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-red-600 dark:text-red-400"
            >
              {`${d.filename}: ${d.error.split('\n').slice(-4).join('\n')}`}
            </pre>
          ))}

        {/* 空态:等首次加载完成再显示,避免闪一下空列表 */}
        {loaded && shownFolders.length === 0 && shownDocs.length === 0 && !creating && (
          <div
            className={`flex flex-col items-center justify-center px-6 py-20 text-center transition-transform duration-200 ${
              fileDrag ? 'scale-[1.02]' : ''
            }`}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft">
              {busy ? (
                <Loader2 className="h-6 w-6 animate-spin text-accent" />
              ) : (
                <FolderOpen className="h-6 w-6 text-accent" />
              )}
            </span>
            <p className="mt-4 text-[15px] font-medium text-ink">
              {hasFilter
                ? '没有匹配的文档'
                : folder
                  ? `「${basename(folder)}」还是空的`
                  : '拖入 PDF,或先新建一个文件夹'}
            </p>
            <p className="mt-1 text-[12.5px] text-mut">
              {hasFilter
                ? '换个关键词,或清除筛选条件'
                : '拖拽 PDF 到此处即可上传;双击文件夹进入,双击文档打开阅读页'}
            </p>
            <div className="mt-4 flex items-center gap-2">
              {hasFilter ? (
                <button
                  className="pl-btn pl-btn-sm pl-btn-ghost"
                  onClick={() => {
                    setSearch('')
                    setTagFilter('')
                  }}
                >
                  清除筛选
                </button>
              ) : (
                <>
                  <button
                    className="pl-btn pl-btn-sm pl-btn-ghost"
                    onClick={() => setCreating(true)}
                  >
                    <FolderPlus className="h-4 w-4" />
                    新建文件夹
                  </button>
                  <button
                    className="pl-btn pl-btn-sm pl-btn-primary"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Plus className="h-4 w-4" />
                    选择 PDF
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 选中项浮动操作条 */}
      {liveSel.size > 0 && (
        <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="pl-pop-in flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-2 shadow-pop">
            <span className="pl-1 text-[13px] text-ink2">
              已选 <span className="font-medium tabular-nums text-ink">{liveSel.size}</span> 项
            </span>
            <span className="mx-1 h-4 w-px bg-line" />
            <button className="pl-btn pl-btn-sm pl-btn-ghost" onClick={() => setMoveOpen(true)}>
              <FolderInput className="h-3.5 w-3.5" />
              移动…
            </button>
            <button
              className="pl-btn pl-btn-sm pl-btn-danger"
              onClick={() => removeItems(topFolders, selDocIds)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </button>
            <button
              className="pl-iconbtn h-7 w-7"
              title="取消选择(Esc)"
              onClick={() => setSel(new Set())}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 右键菜单 */}
      {ctx && (
        <div
          className="pl-pop-in fixed z-50 w-44 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-pop"
          style={{
            left: Math.min(ctx.x, window.innerWidth - 190),
            top: Math.min(ctx.y, window.innerHeight - (ctx.kind === 'doc' ? 260 : 210)),
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {ctx.kind === 'folder' && (
            <>
              <p className="truncate px-3 py-1 text-[11px] text-mut">{ctx.path}</p>
              <MenuItem
                icon={FolderOpen}
                label="打开"
                onClick={() => {
                  go(ctx.path)
                  setCtx(null)
                }}
              />
              <MenuItem
                icon={SquarePen}
                label="重命名"
                onClick={() => {
                  startRename(ctx.path)
                  setCtx(null)
                }}
              />
              <MenuItem
                icon={FolderInput}
                label="移动到…"
                onClick={() => {
                  setSel(new Set([fkey(ctx.path)]))
                  setMoveOpen(true)
                  setCtx(null)
                }}
              />
              <div className="my-1 h-px bg-line" />
              <MenuItem
                icon={Trash2}
                label="删除文件夹"
                danger
                onClick={() => {
                  setCtx(null)
                  removeItems([ctx.path], [])
                }}
              />
            </>
          )}

          {ctx.kind === 'doc' &&
            (() => {
              const d = docs.find((x) => x.id === ctx.id)
              if (!d) return null
              return (
                <>
                  <p className="truncate px-3 py-1 text-[11px] text-mut">{d.filename}</p>
                  {canRead(d) && (
                    <MenuItem
                      icon={BookOpen}
                      label="打开阅读页"
                      onClick={() => {
                        setCtx(null)
                        openReader(d)
                      }}
                    />
                  )}
                  <MenuItem
                    icon={FolderInput}
                    label="移动到…"
                    onClick={() => {
                      setSel(new Set([dkey(d.id)]))
                      setMoveOpen(true)
                      setCtx(null)
                    }}
                  />
                  <MenuItem
                    icon={Tag}
                    label="编辑标签"
                    onClick={() => {
                      setCtx(null)
                      openTagEdit(d)
                    }}
                  />
                  <div className="my-1 h-px bg-line" />
                  <MenuItem
                    icon={Trash2}
                    label="移入回收目录"
                    danger
                    onClick={() => {
                      setCtx(null)
                      if (window.confirm(`将「${d.filename}」移入回收目录(data/trash)?`)) {
                        act(() => api.remove(d.id))
                      }
                    }}
                  />
                </>
              )
            })()}

          {ctx.kind === 'blank' && (
            <>
              <MenuItem
                icon={FolderPlus}
                label="新建文件夹"
                onClick={() => {
                  setCreating(true)
                  setNewName('')
                  setCreateErr('')
                  setCtx(null)
                }}
              />
              <MenuItem
                icon={Plus}
                label="上传 PDF"
                onClick={() => {
                  setCtx(null)
                  fileInput.current?.click()
                }}
              />
            </>
          )}
        </div>
      )}

      {/* 移动到… */}
      {moveOpen && liveSel.size > 0 && (
        <MoveDialog
          folders={allFolders}
          count={liveSel.size}
          blocked={topFolders}
          current={selDoc?.folder || (selFolderPaths.length === 1 ? parent(selFolderPaths[0]) : folder)}
          onClose={() => setMoveOpen(false)}
          onConfirm={doMove}
        />
      )}

      {/* 处理日志 */}
      {logDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onMouseDown={() => setLogId('')}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="pl-pop-in flex max-h-[78vh] w-full max-w-2xl flex-col rounded-pop border border-line bg-surface p-5 shadow-modal"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft">
                <FileText className="h-4 w-4 text-accent" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-ink">{logDoc.filename}</p>
                <p className="mt-0.5 flex items-center gap-2 text-[12px] text-mut">
                  <span className={`pl-pill ${STATUS_CLS[logDoc.status]}`}>
                    <span
                      className={`pl-dot ${ACTIVE.includes(logDoc.status) ? 'animate-pulse' : ''}`}
                    />
                    {STATUS_LABEL[logDoc.status]}
                  </span>
                  {ACTIVE.includes(logDoc.status) && (
                    <span className="tabular-nums">
                      {Math.round((logDoc.progress || 0) * 100)}%
                    </span>
                  )}
                </p>
              </div>
              <button className="pl-iconbtn" title="关闭" onClick={() => setLogId('')}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <pre className="pl-thin mt-4 min-h-[160px] flex-1 overflow-auto rounded-card border border-line bg-bg p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink2">
              {logDoc.log?.trim() || '(暂无日志)'}
            </pre>

            <div className="mt-4 flex justify-end">
              <button className="pl-btn pl-btn-ghost" onClick={() => setLogId('')}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 标签编辑 */}
      {tagEdit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onMouseDown={() => setTagEdit(null)}
        >
          <div
            ref={tagRef}
            onMouseDown={(e) => e.stopPropagation()}
            className="pl-pop-in w-full max-w-md rounded-pop border border-line bg-surface p-5 shadow-modal"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft">
                <Tag className="h-4 w-4 text-accent" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-ink">{tagEdit.filename}</p>
                <p className="mt-0.5 text-[12px] text-mut">标签便于跨文件夹搜索与筛选</p>
              </div>
              <button className="pl-iconbtn" title="关闭" onClick={() => setTagEdit(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="my-4 h-px bg-line" />

            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-ink2">
                <Hash className="h-3.5 w-3.5 text-mut" />
                标签
              </span>
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTag.trim()) {
                    setDraftTags([...new Set([...draftTags, newTag.trim()])])
                    setNewTag('')
                  }
                }}
                placeholder="输入标签后回车添加"
                className="pl-input mb-2"
              />
              <div className="flex flex-wrap gap-1.5">
                {draftTags.map((t) => (
                  <span
                    key={t}
                    className="flex items-center gap-1 rounded-[7px] bg-accent-soft px-2 py-1 text-[12px] text-accent-ink"
                  >
                    #{t}
                    <button
                      onClick={() => setDraftTags(draftTags.filter((x) => x !== t))}
                      title="移除标签"
                      className="text-mut transition-colors hover:text-red-500"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {draftTags.length === 0 && <span className="text-[12px] text-mut">暂无标签</span>}
              </div>
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button className="pl-btn pl-btn-ghost" onClick={() => setTagEdit(null)}>
                取消
              </button>
              <button className="pl-btn pl-btn-primary" onClick={saveTags}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

const canRead = (d: DocMeta) => ['ready', 'translating', 'done', 'cancelled'].includes(d.status)
