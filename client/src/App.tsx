import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { AuthGate } from '@/components/auth-gate'
import { Menu, X } from 'lucide-react'
import { logout } from '@/lib/api'
import KeysPage from '@/pages/KeysPage'
import PlaygroundPage from '@/pages/PlaygroundPage'
import FallbackPage from '@/pages/FallbackPage'
import AnalyticsPage from '@/pages/AnalyticsPage'
import ProvidersPage from '@/pages/ProvidersPage'
import ModelsPage from '@/pages/ModelsPage'

const queryClient = new QueryClient()

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `relative text-sm px-1 py-4 transition-colors ${
          isActive
            ? 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`
      }
    >
      {children}
    </NavLink>
  )
}

function DarkModeToggle() {
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined' && document.documentElement.classList.contains('dark')
  )

  useEffect(() => {
        const stored = localStorage.getItem('theme')
    if (stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark')
      setDark(true)
    }
  }, [])

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }

  return (
    <Button variant="ghost" size="sm" onClick={toggle} aria-label="Toggle theme">
      {dark ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
      )}
    </Button>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block size-2 rounded-full bg-foreground" />
      <span className="font-semibold tracking-tight text-sm">FreeLLMAPI</span>
    </div>
  )
}

function App() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Prevent scroll when drawer is open
  useEffect(() => {
        if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileMenuOpen])

  const closeMobileMenu = () => setMobileMenuOpen(false)

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AuthGate>
          <div className="min-h-screen bg-background">
            <header className="sticky top-0 z-40 bg-background/80 backdrop-blur border-b">
              <div className="max-w-6xl mx-auto px-4 md:px-6 flex items-center justify-between h-14">
                <div className="flex items-center gap-6">
                  <Brand />
                  <nav className="hidden md:flex items-center gap-6">
                    <NavItem to="/playground">Playground</NavItem>
                    <NavItem to="/providers">Providers</NavItem>
                    <NavItem to="/keys">Keys</NavItem>
                    <NavItem to="/models">Models</NavItem>
                    <NavItem to="/fallback">Fallback</NavItem>
                    <NavItem to="/analytics">Analytics</NavItem>
                  </nav>
                </div>

                <div className="flex items-center gap-1">
                  <DarkModeToggle />
                  <Button className="hidden md:inline-flex" variant="ghost" size="sm" onClick={() => logout()}>Sign out</Button>
                  <Button className="md:hidden inline-flex items-center justify-center size-9" variant="ghost" size="icon" onClick={() => setMobileMenuOpen(true)}>
                    <Menu className="size-5" />
                  </Button>
                </div>
              </div>
            </header>

            {/* Mobile Drawer Backdrop */}
            {mobileMenuOpen && (
              <div
                className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm md:hidden"
                onClick={closeMobileMenu}
              />
            )}

            {/* Mobile Drawer */}
            <div
              className={`fixed inset-y-0 right-0 z-50 w-full sm:w-80 bg-background border-l shadow-lg transform transition-transform duration-300 ease-in-out md:hidden flex flex-col ${
                mobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
              }`}
            >
              <div className="flex items-center justify-between px-4 h-14 border-b">
                <Brand />
                <Button variant="ghost" size="icon" onClick={closeMobileMenu} className="size-9 inline-flex items-center justify-center">
                  <X className="size-5" />
                </Button>
              </div>
              <nav className="flex flex-col p-4 gap-2 flex-1">
                <NavLink to="/playground" onClick={closeMobileMenu} className={({ isActive }) => `px-4 py-3 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-secondary text-secondary-foreground' : 'hover:bg-muted'}`}>Playground</NavLink>
                <NavLink to="/providers" onClick={closeMobileMenu} className={({ isActive }) => `px-4 py-3 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-secondary text-secondary-foreground' : 'hover:bg-muted'}`}>Providers</NavLink>
                <NavLink to="/keys" onClick={closeMobileMenu} className={({ isActive }) => `px-4 py-3 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-secondary text-secondary-foreground' : 'hover:bg-muted'}`}>Keys</NavLink>
                <NavLink to="/models" onClick={closeMobileMenu} className={({ isActive }) => `px-4 py-3 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-secondary text-secondary-foreground' : 'hover:bg-muted'}`}>Models</NavLink>
                <NavLink to="/fallback" onClick={closeMobileMenu} className={({ isActive }) => `px-4 py-3 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-secondary text-secondary-foreground' : 'hover:bg-muted'}`}>Fallback</NavLink>
                <NavLink to="/analytics" onClick={closeMobileMenu} className={({ isActive }) => `px-4 py-3 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-secondary text-secondary-foreground' : 'hover:bg-muted'}`}>Analytics</NavLink>
              </nav>
              <div className="p-4 border-t">
                <Button className="w-full justify-start" variant="ghost" onClick={() => { logout(); closeMobileMenu(); }}>
                  Sign out
                </Button>
              </div>
            </div>

            <main className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8">
              <Routes>
                <Route path="/" element={<Navigate to="/playground" replace />} />
                <Route path="/playground" element={<PlaygroundPage />} />
                <Route path="/providers" element={<ProvidersPage />} />
                <Route path="/keys" element={<KeysPage />} />
                <Route path="/models" element={<ModelsPage />} />
                <Route path="/fallback" element={<FallbackPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/test" element={<Navigate to="/playground" replace />} />
                <Route path="/health" element={<Navigate to="/keys" replace />} />
              </Routes>
            </main>
          </div>
        </AuthGate>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
