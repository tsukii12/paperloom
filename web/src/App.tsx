import { Library, PanelLeftClose, PanelLeftOpen, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
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
        `sidebar-nav-item relative flex h-10 items-center gap-3 rounded-[10px] px-3 text-[14px] transition-colors duration-150 ${
          isActive
            ? 'bg-accent-soft font-medium text-accent-ink'
            : 'text-ink2 hover:bg-hover hover:text-ink'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="sr-only">当前页面</span>}
          <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
          <span className="nav-label truncate">{label}</span>
        </>
      )}
    </NavLink>
  )
}

function Sidebar({
  tabs,
  collapsed,
  onToggle,
}: {
  tabs: ReturnType<typeof useTabs>
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <aside className="no-print fixed inset-y-0 left-0 z-40 hidden w-sb flex-col border-r border-line bg-surface md:flex">
      <div className="sidebar-head flex h-[58px] shrink-0 items-center gap-2 px-2.5">
        <div className="sidebar-identity flex min-w-0 flex-1 items-center gap-2.5 px-1.5">
          <BrandMark className="h-7 w-7 shrink-0 text-accent" />
          <span className="nav-label truncate text-[16px] font-semibold tracking-tight text-ink">PaperLoom</span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          title={collapsed ? '打开侧栏' : '收起侧栏'}
          aria-label={collapsed ? '打开侧栏' : '收起侧栏'}
          className="sidebar-toggle pl-iconbtn h-9 w-9 shrink-0 rounded-[10px] text-ink2 hover:bg-hover hover:text-ink"
        >
          {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
        </button>
      </div>

      {/* 浏览:文库 + 已打开的标签页(标签多时可滚动) */}
      <div className="pl-thin flex min-h-0 flex-1 flex-col overflow-y-auto py-1.5">
        <div className="flex shrink-0 flex-col px-2">
          <span className="pl-eyebrow nav-label px-3 pb-1.5 pt-1">浏览</span>
          <SideNavItem to="/" end label="文库" icon={Library} />
        </div>
        <TabsList {...tabs} />
      </div>

      {/* 底部:设置 → 外观 */}
      <div className="shrink-0 p-2">
        <div className="mx-1 mb-2 h-px bg-line" />
        <SideNavItem to="/settings" label="设置" icon={SlidersHorizontal} />
        <div className="sidebar-theme-wide mt-2.5">
          <ThemeSwitch />
        </div>
        <div className="sidebar-theme-compact mt-2.5 hidden justify-center">
          <ThemeSwitch compact />
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('pl-sidebar-collapsed') === '1',
  )

  useEffect(() => {
    document.body.className = ''
  }, [])

  useEffect(() => {
    localStorage.setItem('pl-sidebar-collapsed', sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])

  return (
    <div className={`pl-shell min-h-screen ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''}`}>
      <Sidebar
        tabs={tabs}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((v) => !v)}
      />
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
