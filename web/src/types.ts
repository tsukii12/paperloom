export type DocStatus =
  | 'uploaded'
  | 'converting'
  | 'ready'
  | 'translating'
  | 'done'
  | 'cancelled'
  | 'failed'

export interface DocMeta {
  id: string
  filename: string
  created_at: string
  /** 最后修改时间:批注、标签、移动、转换翻译等都会更新它 */
  updated_at: string
  /** 转换/翻译的处理日志,点状态标签可查看 */
  log: string
  status: DocStatus
  stage: string
  progress: number
  engine: string
  error: string
  n_pages: number
  folder: string
  tags: string[]
}

export type BlockType =
  | 'title'
  | 'text'
  | 'table'
  | 'image'
  | 'equation'
  | 'caption'
  | 'list'

export interface Block {
  id: string
  type: BlockType
  page: number
  text?: string | null
  level?: number | null
  items?: string[] | null
  cells?: string[][] | null
  header_rows?: number
  latex?: string | null
  img?: string | null
  zh?: string | null
  zh_items?: string[] | null
  zh_cells?: string[][] | null
  error?: string | null
}

export type AnnKind = 'highlight' | 'underline'
export type AnnColor = 'yellow' | 'green' | 'blue' | 'pink'

export interface Annotation {
  id: string
  doc_id: string
  block_id: string
  start: number
  end: number
  kind: AnnKind
  color: AnnColor
  note: string
  created_at: string
}

export interface Settings {
  base_url: string
  api_key: string
  model: string
  target_lang: string
  batch_blocks: number
  batch_chars: number
  temperature: number
  concurrency: number
  reasoning_effort_doc: string
  reasoning_effort_selection: string
  engine: string
  model_source: string
  pypi_index: string
}

export interface EngineInfo {
  installed: boolean
  version: string
}

export interface EngineInstallState {
  running: boolean
  ok: boolean
  error: string
  log: string
}
