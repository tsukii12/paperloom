import { Check, ChevronRight, Folder, FolderOpen, FolderPlus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { basename, childPath, isUnder, parent, segments, withAncestors } from '../folderPath'

interface TreeNode {
  path: string
  name: string
  children: TreeNode[]
}

/** withAncestors 保证父级一定在子级之前,这里再按层级排序兜底 */
function buildTree(paths: string[]): TreeNode[] {
  const sorted = [...new Set(paths)].sort(
    (a, b) => segments(a).length - segments(b).length || a.localeCompare(b),
  )
  const nodes = new Map<string, TreeNode>()
  const roots: TreeNode[] = []
  for (const p of sorted) {
    const node: TreeNode = { path: p, name: basename(p), children: [] }
    nodes.set(p, node)
    const holder = nodes.get(parent(p))
    if (holder) holder.children.push(node)
    else roots.push(node)
  }
  return roots
}

/** 移动到… —— 可展开的文件夹树选择器 */
export default function MoveDialog({
  folders,
  count,
  blocked = [],
  current = '',
  onClose,
  onConfirm,
}: {
  folders: string[]
  /** 待移动的项目数,用于标题 */
  count: number
  /** 不可作为目标的文件夹(被移动的文件夹自身及子孙) */
  blocked?: string[]
  /** 这些项目当前所在的文件夹 */
  current?: string
  onClose: () => void
  onConfirm: (to: string) => void
}) {
  const tree = useMemo(() => buildTree(withAncestors(folders)), [folders])
  const [dest, setDest] = useState(current)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(withAncestors(folders)))
  const [newName, setNewName] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const isBlocked = (p: string) => blocked.some((b) => p === b || isUnder(p, b))

  const rows = useMemo(() => {
    const out: { node: TreeNode; depth: number }[] = []
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const n of nodes) {
        out.push({ node: n, depth })
        if (expanded.has(n.path)) walk(n.children, depth + 1)
      }
    }
    walk(tree, 0)
    return out
  }, [tree, expanded])

  const toggle = (p: string) =>
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })

  const createAndMove = () => {
    const path = childPath(dest, newName)
    if (!path) {
      setErr('名称无效或层级过深')
      return
    }
    if (folders.includes(path)) {
      setErr('该文件夹已存在')
      return
    }
    onConfirm(path)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="pl-pop-in flex max-h-[80vh] w-full max-w-md flex-col rounded-pop border border-line bg-surface shadow-modal"
      >
        <div className="flex items-start gap-3 p-5 pb-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft">
            <FolderOpen className="h-4 w-4 text-accent" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-ink">移动到…</p>
            <p className="mt-0.5 text-[12px] text-mut">
              已选 {count} 项 · 当前位于「{current || '全部文档'}」
            </p>
          </div>
          <button className="pl-iconbtn" title="关闭" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="pl-thin mx-3 min-h-0 flex-1 overflow-y-auto rounded-card border border-line p-1">
          <button
            onClick={() => setDest('')}
            className={`flex w-full items-center gap-2 rounded-[9px] px-2.5 py-1.5 text-left text-[13px] transition-colors duration-150 ${
              dest === '' ? 'bg-accent-soft font-medium text-accent-ink' : 'text-ink2 hover:bg-hover'
            }`}
          >
            <FolderOpen className="h-4 w-4 shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate">全部文档</span>
            {dest === '' && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
          </button>

          {rows.map(({ node, depth }) => {
            const off = isBlocked(node.path)
            const on = dest === node.path
            const open = expanded.has(node.path)
            return (
              <div
                key={node.path}
                className={`flex items-center rounded-[9px] transition-colors duration-150 ${
                  off
                    ? 'cursor-not-allowed opacity-40'
                    : on
                      ? 'bg-accent-soft font-medium text-accent-ink'
                      : 'text-ink2 hover:bg-hover'
                }`}
                style={{ paddingLeft: 6 + depth * 15 }}
              >
                <button
                  onClick={() => node.children.length && toggle(node.path)}
                  disabled={!node.children.length}
                  aria-label={open ? '折叠' : '展开'}
                  className={`flex h-6 w-5 shrink-0 items-center justify-center ${
                    node.children.length ? 'text-mut hover:text-ink2' : 'opacity-0'
                  }`}
                >
                  <ChevronRight
                    className={`h-3.5 w-3.5 transition-transform duration-150 ${
                      open ? 'rotate-90' : ''
                    }`}
                  />
                </button>
                <button
                  onClick={() => !off && setDest(node.path)}
                  disabled={off}
                  title={off ? '不能移动到文件夹自身或其子文件夹' : node.path}
                  className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2.5 text-left text-[13px] disabled:cursor-not-allowed"
                >
                  <Folder className={`h-4 w-4 shrink-0 ${on ? 'text-accent' : 'text-mut'}`} />
                  <span className="min-w-0 flex-1 truncate">{node.name}</span>
                  {on && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                </button>
              </div>
            )
          })}

          {tree.length === 0 && (
            <p className="px-3 py-6 text-center text-[12px] text-mut">
              还没有文件夹,可在下面新建一个
            </p>
          )}
        </div>

        <div className="p-4 pt-3">
          <p className="mb-1.5 text-[12px] text-mut">
            在「{dest || '全部文档'}」中新建文件夹并移入
          </p>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value)
                setErr('')
              }}
              onKeyDown={(e) => e.key === 'Enter' && newName.trim() && createAndMove()}
              placeholder="新文件夹名称"
              className="pl-input"
            />
            <button
              className="pl-btn pl-btn-ghost pl-btn-fit shrink-0"
              disabled={!newName.trim()}
              onClick={createAndMove}
            >
              <FolderPlus className="h-4 w-4" />
              新建
            </button>
          </div>
          {err && <p className="mt-1.5 text-[12px] text-red-500">{err}</p>}

          <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
            <button className="pl-btn pl-btn-ghost" onClick={onClose}>
              取消
            </button>
            <button className="pl-btn pl-btn-primary" onClick={() => onConfirm(dest)}>
              移动到「{dest ? basename(dest) : '全部文档'}」
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
