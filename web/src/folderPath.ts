/** 文件夹路径工具:'' 表示根目录,'A/B/C' 表示嵌套路径。
 *  与后端 server/app.py 的 _clean_path 保持同一套校验规则。 */

/** 从根到 path 的每一级:'A/B' → ['A', 'A/B'] */
export function ancestors(path: string): string[] {
  const out: string[] = []
  let cur = ''
  for (const s of segments(path)) {
    cur = join(cur, s)
    out.push(cur)
  }
  return out
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? path : path.slice(i + 1)
}

/** 在 dir 下新建 name 的完整路径;名称或层级非法时返回 null */
export function childPath(dir: string, name: string): string | null {
  if (validateName(name)) return null
  if (segments(dir).length >= MAX_DEPTH) return null
  return join(dir, name)
}

export function join(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

/** path 是否在 anc 之下(不含 anc 自身) */
export function isUnder(path: string, anc: string): boolean {
  return !!anc && path.startsWith(anc + '/')
}

export function parent(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export function segments(path: string): string[] {
  return path ? path.split('/') : []
}

/** 校验单级名称:返回错误文案,合法返回 null */
export function validateName(name: string): string | null {
  if (!name.trim()) return '名称不能为空'
  if (name !== name.trim()) return '名称首尾不能有空格'
  if (name === '.' || name === '..') return '名称无效'
  if (name.includes('\\')) return '不能包含反斜杠'
  if (/\p{Cc}/u.test(name)) return '不能包含控制字符'
  if (name.length > MAX_SEGMENT) return `名称最多 ${MAX_SEGMENT} 个字符`
  return null
}

/** 补齐所有祖先路径,去重排序(父级一定排在子级之前,便于建树) */
export function withAncestors(paths: string[]): string[] {
  const set = new Set<string>()
  for (const p of paths) for (const a of ancestors(p || '')) set.add(a)
  return [...set].sort((a, b) => a.localeCompare(b))
}

export const MAX_DEPTH = 10
export const MAX_SEGMENT = 60
