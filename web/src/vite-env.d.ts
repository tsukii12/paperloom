/// <reference types="vite/client" />

/** 构建时由 vite.config.ts 从 package.json 注入 */
declare const __APP_VERSION__: string

/** 文件系统访问 API 的「另存为」对话框:TS 内置的 lib.dom 尚未包含 */
interface Window {
  showSaveFilePicker?: (options?: {
    suggestedName?: string
    types?: { description?: string; accept: Record<string, string[]> }[]
  }) => Promise<FileSystemFileHandle>
}
