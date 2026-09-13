import { Library, SlidersHorizontal } from 'lucide-react'
import { useEffect } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import BrandMark from './components/BrandMark'
import ThemeSwitch from './components/ThemeSwitch'
import { TabsList, useTabs } from './components/Tabs'
import Documents from './pages/Documents'
import Reader from './pages/Reader'
import SettingsPage from './pages/Settings'

function SideNavItem({
  to,
  end,
  label,
  icon: Icon,
}: {
  to: string
  end?: boolean
  label: string
  icon: typeof Library
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      className={({ isActive }) =>
        `relative flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-[13.5px] transition-colors duration-150 ${
          isActive
            ? 'bg-accent-soft font-medium text-accent-ink'
            : 'text-ink2 hover:bg-hover hover:text-ink'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />
          )}
          <Icon className="h-[17px] w-[17px] shrink-0" />
          <span className="nav-label truncate">{label}</span>
        </>
      )}
    </NavLink>
  )
}

function Sidebar({ tabs }: { tabs: ReturnType<typeof useTabs> }) {
  return (
    <aside className="no-print fixed inset-y-0 left-0 z-40 hidden w-sb flex-col border-r border-line bg-surface md:flex">
      <div className="flex h-[74px] shrink-0 items-center gap-2.5 px-3.5">
        <BrandMark className="h-7 w-7 shrink-0 text-accent" />
        <span className="nav-label min-w-0">
          <span className="block truncate font-display text-[18px] leading-tight tracking-tight text-ink">
            PaperLoom
          </span>
          <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-mut">
            论文翻译阅读助手
          </span>
        </span>
      </div>

      <div className="mx-3 h-px shrink-0 bg-line" />

      {/* 浏览:文库 + 已打开的标签页(标签多时可滚动) */}
      <div className="pl-thin flex min-h-0 flex-1 flex-col overflow-y-auto py-2.5">
        <div className="flex shrink-0 flex-col px-1">
          <span className="pl-eyebrow nav-label px-2.5 pb-1">浏览</span>
          <SideNavItem to="/" end label="文库" icon={Library} />
        </div>
        <TabsList {...tabs} />
      </div>

      {/* 底部:设置 → 外观 */}
      <div className="shrink-0 p-2.5">
        <div className="mx-0.5 mb-2.5 h-px bg-line" />
        <SideNavItem to="/settings" label="设置" icon={SlidersHorizontal} />
        <div className="mt-2.5">
          <ThemeSwitch />
        </div>
      </div>
    </aside>
  )
}

function MobileBar() {
  const items = [
    { to: '/', end: true, label: '文库', icon: Library },
    { to: '/settings', label: '设置', icon: SlidersHorizontal },
  ]
  return (
    <header className="no-print sticky top-0 z-40 flex items-center gap-2 border-b border-line bg-surface/90 px-3 py-2 backdrop-blur md:hidden">
      <BrandMark className="h-6 w-6 shrink-0 text-accent" />
      <span className="font-display text-[16px] tracking-tight text-ink">PaperLoom</span>
      <div className="ml-auto flex items-center gap-1.5">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              `flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[12.5px] transition-colors ${
                isActive
                  ? 'bg-accent-soft font-medium text-accent-ink'
                  : 'text-ink2 hover:bg-hover'
              }`
            }
          >
            <it.icon className="h-4 w-4" />
            {it.label}
          </NavLink>
        ))}
        <div className="hidden w-[104px] min-[420px]:block">
          <ThemeSwitch />
        </div>
      </div>
    </header>
  )
}

export default function App() {
  const tabs = useTabs()

  useEffect(() => {
    document.body.className = ''
  }, [])

  return (
    <div className="min-h-screen">
      <Sidebar tabs={tabs} />
      <MobileBar />
      <div className="ml-sb">
        <Routes>
          <Route path="/" element={<Documents openTab={tabs.open} />} />
          <Route path="/reader/:id" element={<Reader />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </div>
    </div>
  )
}
