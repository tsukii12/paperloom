import { FileText, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { DocMeta } from '../types'

const KEY = 'pl-tabs'

/** 阅读标签页状态:与浏览器标签页一致 —— 打开、切换、关闭 */
export function useTabs() {
  const [ids, setIds] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
      return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string').slice(0, 24) : []
    } catch {
      return []
    }
  })
  const [docs, setDocs] = useState<Record<string, DocMeta>>({})
  const [loading, setLoading] = useState(false)
  const nav = useNavigate()
  const { pathname } = useLocation()
  // 从 pathname 解析当前文档,而不是 useParams():useTabs 在 <Routes> 外层调用,
  // 那里没有路由参数,activeId 会恒为空 —— 结果就是标签栏永远不高亮
  const activeId = (pathname.match(/^\/reader\/([^/?#]+)/) || [])[1] || ''

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(ids))
  }, [ids])

  // 拉取标签页文档元信息(打开/切换/文库刷新时更新)
  const refresh = useCallback(() => {
    setLoading(true)
    api
      .listDocs()
      .then((list) => {
        const m: Record<string, DocMeta> = {}
        list.forEach((d) => (m[d.id] = d))
        setDocs(m)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // 已存标签:挂载时拉一次
  useEffect(() => {
    if (ids.length) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 切到文库页时刷新(状态可能已变)
  useEffect(() => {
    if (pathname === '/') refresh()
  }, [pathname, refresh])

  const open = useCallback(
    (id: string) => {
      setIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
      refresh()
    },
    [refresh],
  )

  const close = useCallback(
    (id: string) => {
      setIds((prev) => {
        const next = prev.filter((x) => x !== id)
        if (activeId === id) nav(next.length ? `/reader/${next[next.length - 1]}` : '/')
        return next
      })
    },
    [nav, activeId],
  )

  const tabs = useMemo(
    () => ids.map((id) => ({ id, meta: docs[id] as DocMeta | undefined })),
    [ids, docs],
  )

  return { tabs, activeId, open, close, refresh, count: ids.length, loading }
}

/** 侧栏标签列表:位于「浏览 › 文库」下方,像浏览器标签一样切换与关闭 */
export function TabsList({ tabs, activeId, close }: ReturnType<typeof useTabs>) {
  const nav = useNavigate()
  if (!tabs.length) return null
  return (
    <div className="mt-2 flex flex-col gap-0.5 border-t border-line px-2.5 pt-2">
      <span className="pl-eyebrow nav-label px-1 pb-1">打开</span>
      {tabs.map(({ id, meta }) => {
        const on = id === activeId
        const busy = meta?.status === 'converting' || meta?.status === 'translating'
        const label = (meta?.filename || '载入中…').replace(/\.pdf$/i, '')
        return (
          <div
            key={id}
            className={`group/tab flex h-8 items-center gap-1.5 rounded-[9px] pl-2 pr-1 text-[12.5px] transition-colors duration-150 ${
              on ? 'bg-accent-soft font-medium text-accent-ink' : 'text-ink2 hover:bg-hover'
            }`}
          >
            <button
              onClick={() => {
                if (!on) nav(`/reader/${id}`)
              }}
              title={meta?.filename || id}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              {busy ? (
                <span className="pl-dot h-1.5 w-1.5 shrink-0 animate-pulse bg-violet-500" />
              ) : (
                <FileText className={`h-3.5 w-3.5 shrink-0 ${on ? 'text-accent' : 'text-mut'}`} />
              )}
              <span className="nav-label truncate">{label}</span>
            </button>
            <button
              onClick={() => close(id)}
              title="关闭标签页"
              className={`nav-label flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] transition-opacity duration-150 hover:bg-accent-line/50 ${
                on ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover/tab:opacity-60'
              }`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default TabsList
