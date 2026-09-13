import type { Annotation, AnnColor, AnnKind, Block, DocMeta, EngineInfo, EngineInstallState, Settings } from './types'

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const body = await r.json().catch(() => ({ detail: r.statusText }))
    throw new Error((body as { detail?: string }).detail || r.statusText)
  }
  return r.json() as Promise<T>
}

const post = (url: string, body?: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

export const api = {
  listDocs: () => fetch('/api/docs').then(j<DocMeta[]>),

  upload: (files: File[]) => {
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f))
    return fetch('/api/docs/upload', { method: 'POST', body: fd }).then(
      j<{ id: string; filename: string }[]>
    )
  },

  convert: (id: string, engine: string) =>
    post(`/api/docs/${id}/convert`, { engine }).then(j<{ ok: boolean }>),

  translate: (id: string, mode: 'auto' | 'force' = 'auto') =>
    post(`/api/docs/${id}/translate`, { mode }).then(j<{ ok: boolean; mode: string }>),

  retryBlocks: (id: string, blockIds: string[]) =>
    post(`/api/docs/${id}/retry`, { block_ids: blockIds }).then(j<{ ok: boolean; count: number }>),

  cancel: (id: string) => post(`/api/docs/${id}/cancel`).then(j<{ ok: boolean }>),

  remove: (id: string) => fetch(`/api/docs/${id}`, { method: 'DELETE' }).then(j<{ ok: boolean }>),

  getDoc: (id: string) => fetch(`/api/docs/${id}`).then(j<DocMeta>),

  content: (id: string) =>
    fetch(`/api/docs/${id}/content`).then(j<{ engine: string | null; blocks: Block[] }>),

  /** 生成 PDF 并下载:后端用无头浏览器打印,矢量文字、可选中可搜索 */
  exportPdf: (id: string, variant: 'origin' | 'translated' | 'dual') =>
    fetch(`/api/docs/${id}/pdf?variant=${variant}`),

  settings: () => fetch('/api/settings').then(j<Settings>),

  saveSettings: (s: Partial<Settings>) =>
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    }).then(j<Settings>),

  testSettings: () => post('/api/settings/test').then(j<{ ok: boolean; message: string }>),

  engines: () =>
    fetch('/api/engines').then(
      j<{ docling: EngineInfo; mineru: EngineInfo; install: Record<string, EngineInstallState> }>,
    ),

  installEngine: (engine: string) =>
    post(`/api/engines/${engine}/install`).then(j<{ ok: boolean; message: string }>),

  updateDoc: (id: string, patch: { folder?: string; tags?: string[] }) =>
    fetch(`/api/docs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(j<DocMeta>),

  /** 批量移动文档(服务端单事务,避免逐条 PATCH 出现半成功状态) */
  moveDocs: (ids: string[], to: string) =>
    post('/api/docs/move', { ids, to }).then(j<{ ok: boolean; moved: number }>),

  listFolders: () => fetch('/api/folders').then(j<string[]>),

  createFolder: (path: string) =>
    post('/api/folders', { path }).then(j<{ ok: boolean; path: string }>),

  /** 重命名或移动整棵文件夹子树 */
  renameFolder: (path: string, to: string) =>
    fetch('/api/folders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, to }),
    }).then(j<{ ok: boolean; path: string }>),

  /** 删除文件夹:其中内容折叠进它的上一级 */
  removeFolder: (path: string) =>
    fetch(`/api/folders?path=${encodeURIComponent(path)}`, { method: 'DELETE' }).then(
      j<{ ok: boolean }>,
    ),

  listAnnotations: (id: string) =>
    fetch(`/api/docs/${id}/annotations`).then(j<Annotation[]>),  addAnnotation: (
    id: string,
    body: { block_id: string; start: number; end: number; kind: AnnKind; color: AnnColor; note?: string },
  ) => post(`/api/docs/${id}/annotations`, body).then(j<Annotation>),

  editAnnotation: (
    id: string,
    annId: string,
    body: { note?: string; color?: AnnColor; kind?: AnnKind },
  ) =>
    fetch(`/api/docs/${id}/annotations/${annId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(j<{ ok: boolean }>),

  deleteAnnotation: (id: string, annId: string) =>
    fetch(`/api/docs/${id}/annotations/${annId}`, { method: 'DELETE' }).then(j<{ ok: boolean }>),

  selectionTranslate: (id: string, text: string) =>
    post(`/api/docs/${id}/selection-translate`, { text }).then(j<{ zh: string }>),
}
