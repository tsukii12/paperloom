import { ChevronDown, Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export interface DropdownOption {
  value: string
  label: string
  disabled?: boolean
}

/** 自定义下拉菜单(替代浏览器原生 select,与输入框同形) */
export default function Dropdown({
  value,
  options,
  onChange,
  placeholder = '请选择',
  size = 'md',
  className = '',
}: {
  value: string
  options: DropdownOption[]
  onChange: (v: string) => void
  placeholder?: string
  size?: 'sm' | 'md'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const current = options.find((o) => o.value === value)
  // 高度继承 --ctl-h(与同一行的输入框/按钮严格等高),未设置时 38/34
  const pad =
    size === 'sm'
      ? 'h-[var(--ctl-h,34px)] px-2.5 text-[12.5px]'
      : 'h-[var(--ctl-h,38px)] px-3 text-[13.5px]'

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 rounded-btn border bg-surface ${pad} text-ink2 transition-colors duration-150 hover:border-accent-line ${
          open ? 'border-accent ring-[3px] ring-accent-soft' : 'border-line2'
        }`}
      >
        <span className={`truncate ${current ? '' : 'text-mut'}`}>
          {current?.label ?? placeholder}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-mut transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="pl-pop-in absolute z-40 mt-1.5 max-h-64 w-full min-w-[9.5rem] overflow-auto rounded-xl border border-line bg-surface py-1 shadow-pop pl-thin"
        >
          {options.map((o) => {
            const active = o.value === value
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={active}
                disabled={o.disabled}
                onClick={() => {
                  if (o.disabled) return
                  onChange(o.value)
                  setOpen(false)
                }}
                className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[13px] transition-colors duration-150 ${
                  o.disabled
                    ? 'cursor-not-allowed text-mut opacity-50'
                    : active
                      ? 'bg-accent-soft font-medium text-accent-ink'
                      : 'text-ink2 hover:bg-hover'
                }`}
              >
                <span className="truncate">{o.label}</span>
                {active && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
