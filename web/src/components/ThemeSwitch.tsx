import { Monitor, Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { applyTheme, getTheme, type Theme } from '../theme'

const ITEMS: { t: Theme; icon: typeof Sun; label: string }[] = [
  { t: 'light', icon: Sun, label: '浅色' },
  { t: 'dark', icon: Moon, label: '深色' },
  { t: 'system', icon: Monitor, label: '跟随系统' },
]

/** 主题三段切换:浅色 / 深色 / 跟随系统(存 localStorage.pl-theme) */
export default function ThemeSwitch({ labels = false }: { labels?: boolean }) {
  const [theme, setTheme] = useState<Theme>(() => getTheme())

  const pick = (t: Theme) => {
    setTheme(t)
    applyTheme(t)
  }

  return (
    <div
      role="radiogroup"
      aria-label="主题"
      className="flex w-full items-center gap-0.5 rounded-[11px] border border-line bg-hover p-0.5"
    >
      {ITEMS.map(({ t, icon: Icon, label }) => {
        const on = theme === t
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={on}
            title={label}
            onClick={() => pick(t)}
            className={`flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[8px] transition-colors duration-150 ${
              on ? 'bg-surface font-medium text-ink shadow-card' : 'text-mut hover:text-ink2'
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {labels && <span className="truncate text-[12.5px]">{label}</span>}
          </button>
        )
      })}
    </div>
  )
}
