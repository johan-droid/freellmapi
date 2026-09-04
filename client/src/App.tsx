import { useState, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, NavLink, Link, useLocation, useNavigate } from 'react-router-dom'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ChevronDown, KeyRound, LogOut, Menu, MoreHorizontal, Search, Settings, Sparkles, X, ChevronRight } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AuthGate, ChangeCredentialsModal } from '@/components/auth-gate'
import { CommandPalette } from '@/components/command-palette'
import { openCommandPalette } from '@/components/command-palette-state'
import { ErrorBoundary } from '@/components/error-boundary'
import { SettingsDialog } from '@/components/settings-dialog'
import { Toaster } from '@/components/toaster'
import { UpdateReminder } from '@/components/update-reminder'
import { usePremium } from '@/hooks/use-premium'
import { I18nProvider, useI18n } from '@/i18n'
import { logout } from '@/lib/api'
import { toast } from '@/lib/toast'
import { ThemeProvider } from '@/theme'
import KeysPage from '@/pages/KeysPage'
import PlaygroundPage from '@/pages/PlaygroundPage'
import FallbackPage from '@/pages/FallbackPage'
import ModelDetailPage from '@/pages/ModelDetailPage'
import FusionPage from '@/pages/FusionPage'
import EmbeddingsPage from '@/pages/EmbeddingsPage'
import ImagePage from '@/pages/ImagePage'
import VideoPage from '@/pages/VideoPage'
import AudioPage from '@/pages/AudioPage'
import MediaDetailPage from '@/pages/MediaDetailPage'
import EmbeddingDetailPage from '@/pages/EmbeddingDetailPage'
import AnalyticsPage from '@/pages/AnalyticsPage'
import LogsPage from '@/pages/LogsPage'
import PremiumPage from '@/pages/PremiumPage'
import QuotaPoolsPage from '@/pages/QuotaPoolsPage'
import NotFoundPage from '@/pages/NotFoundPage'
import AgentsPage from '@/pages/AgentsPage'
import AutoRoutingPage from '@/pages/AutoRoutingPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.silenceToast) return
      toast.error(error instanceof Error ? error.message : String(error))
    },
  }),
})

const navItems = [
  { to: '/models', labelKey: 'nav.models' },
  { to: '/playground', labelKey: 'nav.playground' },
  { to: '/keys', labelKey: 'nav.keys' },
  { to: '/agents', labelKey: 'nav.agents' },
  { to: '/analytics', labelKey: 'nav.analytics' },
  { to: '/premium', labelKey: 'nav.premium' },
]

const modelItems = [
  { to: '/models/chat', labelKey: 'models.chatModelsTab' },
  { to: '/models/pools', labelKey: 'models.poolsTab' },
  { to: '/models/embeddings', labelKey: 'models.embeddingsTab' },
  { to: '/models/image', labelKey: 'models.imageTab' },
  { to: '/models/video', labelKey: 'models.videoTab' },
  { to: '/models/audio', labelKey: 'models.audioTab' },
  { to: '/models/fusion', labelKey: 'models.fusionTab' },
  { to: '/models/auto', labelKey: 'Auto Routing' },
]

const analyticsItems = [
  { to: '/analytics', labelKey: 'nav.analytics' },
  { to: '/logs', labelKey: 'nav.logs' },
]

const navMenus: Record<
  string,
  { ariaKey: string; items: { to: string; labelKey: string }[]; isActive: (pathname: string) => boolean }
> = {
  '/models': {
    ariaKey: 'nav.modelsMenu',
    items: modelItems,
    isActive: (pathname) => pathname.startsWith('/models'),
  },
  '/analytics': {
    ariaKey: 'nav.analyticsMenu',
    items: analyticsItems,
    isActive: (pathname) => pathname.startsWith('/analytics') || pathname.startsWith('/logs'),
  },
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `relative text-sm px-1 py-3 transition-colors ${
          isActive
            ? 'text-foreground font-medium after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`
      }
    >
      {children}
    </NavLink>
  )
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 transition-opacity hover:opacity-70 shrink-0">
      <span className="inline-block size-2 rounded-full bg-foreground" />
      <span className="font-semibold tracking-tight text-sm">FreeLLMAPI</span>
    </Link>
  )
}

const isDesktopApp = typeof window !== 'undefined'
  && (window as Window & { __FREEAPI_DESKTOP__?: boolean }).__FREEAPI_DESKTOP__ === true

if (isDesktopApp) {
  document.documentElement.classList.add('desktop')
}

function AccountMenuItems({
  showUpgrade,
  upgradeLabel,
  settingsLabel,
  signOutLabel,
  changeEmailLabel,
  changePasswordLabel,
  onUpgrade,
  onOpenSettings,
  onChangeEmail,
  onChangePassword,
}: {
  showUpgrade: boolean
  upgradeLabel: string
  settingsLabel: string
  signOutLabel: string
  changeEmailLabel: string
  changePasswordLabel: string
  onUpgrade: () => void
  onOpenSettings: () => void
  onChangeEmail: () => void
  onChangePassword: () => void
}) {
  return (
    <>
      {showUpgrade && (
        <DropdownMenuItem onClick={onUpgrade}>
          <Sparkles />
          {upgradeLabel}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={onOpenSettings}>
        <Settings />
        {settingsLabel}
      </DropdownMenuItem>
      {!isDesktopApp && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onChangeEmail}>
            <span className="flex size-4 items-center justify-center font-serif text-xs font-bold">@</span>
            {changeEmailLabel}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onChangePassword}>
            <KeyRound />
            {changePasswordLabel}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => logout()}>
            <LogOut />
            {signOutLabel}
          </DropdownMenuItem>
        </>
      )}
    </>
  )
}

function Navbar() {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [credentialsMode, setCredentialsMode] = useState<'password' | 'email' | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [expandedSubmenu, setExpandedSubmenu] = useState<string | null>(null)
  const { data: premium, licensed, isLoading: premiumLoading, isError: premiumError } = usePremium()
  const showUpgrade = Boolean(premium) && !licensed && !premiumLoading && !premiumError

  // Close mobile drawer automatically on location change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  return (
    <>
      <header
        className={`sticky top-0 z-40 border-b backdrop-blur ${isDesktopApp ? 'bg-background/45' : 'bg-background/80'}`}
        style={isDesktopApp ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : undefined}
      >
        <div
          className={`mx-auto flex h-12 sm:h-14 max-w-6xl items-center px-3 sm:px-6 ${isDesktopApp ? 'pl-20 sm:pl-20' : ''}`}
        >
          <Brand />
          <nav
            className="ms-8 hidden items-center gap-5 md:flex"
            style={isDesktopApp ? ({ WebkitAppRegion: 'no-drag' } as React.CSSProperties) : undefined}
          >
            {navItems.map((item) => {
              const menu = navMenus[item.to]
              return menu ? (
                <div key={item.to} className="flex items-center gap-0.5">
                  <NavItem to={item.to}>{t(item.labelKey)}</NavItem>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={t(menu.ariaKey)}
                      className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none"
                    >
                      <ChevronDown className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-44">
                      {menu.items.map((entry) => (
                        <DropdownMenuItem key={entry.to} onClick={() => navigate(entry.to)}>
                          {t(entry.labelKey)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : (
                <NavItem key={item.to} to={item.to}>
                  {t(item.labelKey)}
                </NavItem>
              )
            })}
          </nav>
          <div
            className="ms-auto hidden items-center gap-1 md:flex"
            style={isDesktopApp ? ({ WebkitAppRegion: 'no-drag' } as React.CSSProperties) : undefined}
          >
            <button
              type="button"
              onClick={openCommandPalette}
              aria-label={t('palette.title')}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              <Search className="size-3.5" />
              <kbd className="text-[10px] text-muted-foreground">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger
                className={buttonVariants({ variant: 'ghost', size: 'icon' })}
                aria-label={t('nav.openMenu')}
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <AccountMenuItems
                  showUpgrade={showUpgrade}
                  upgradeLabel={t('nav.upgrade')}
                  settingsLabel={t('nav.settings')}
                  signOutLabel={t('nav.signOut')}
                  changeEmailLabel={t('auth.changeEmail')}
                  changePasswordLabel={t('auth.changePassword')}
                  onUpgrade={() => navigate('/premium')}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onChangeEmail={() => setCredentialsMode('email')}
                  onChangePassword={() => setCredentialsMode('password')}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Mobile Actions: Search + Menu Drawer Button */}
          <div className="ms-auto flex items-center gap-1 md:hidden">
            <button
              type="button"
              onClick={openCommandPalette}
              aria-label={t('palette.title')}
              className={buttonVariants({ variant: 'ghost', size: 'icon' })}
            >
              <Search className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label={t('nav.openMenu')}
              className={buttonVariants({ variant: 'ghost', size: 'icon' })}
            >
              <Menu className="size-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Slide-over Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex justify-end md:hidden">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 flex h-full w-[280px] max-w-[85vw] flex-col border-s bg-background p-4 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b">
              <Brand />
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className={buttonVariants({ variant: 'ghost', size: 'icon' })}
                aria-label="Close menu"
              >
                <X className="size-4" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto py-3 space-y-1">
              {navItems.map((item) => {
                const menu = navMenus[item.to]
                const isActive = menu ? menu.isActive(location.pathname) : location.pathname === item.to
                const isExpanded = expandedSubmenu === item.to

                return (
                  <div key={item.to} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          navigate(item.to)
                          setMobileMenuOpen(false)
                        }}
                        className={`flex-1 text-start px-3 py-2 rounded-lg text-sm transition-colors ${
                          isActive ? 'bg-accent text-accent-foreground font-medium' : 'text-foreground/80 hover:bg-muted'
                        }`}
                      >
                        {t(item.labelKey)}
                      </button>
                      {menu && (
                        <button
                          type="button"
                          onClick={() => setExpandedSubmenu(isExpanded ? null : item.to)}
                          className="p-2 text-muted-foreground hover:text-foreground"
                          aria-label={t(menu.ariaKey)}
                        >
                          <ChevronRight className={`size-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                        </button>
                      )}
                    </div>

                    {menu && isExpanded && (
                      <div className="ms-4 border-s ps-2 space-y-1">
                        {menu.items.map((entry) => (
                          <button
                            key={entry.to}
                            type="button"
                            onClick={() => {
                              navigate(entry.to)
                              setMobileMenuOpen(false)
                            }}
                            className={`block w-full text-start px-3 py-1.5 rounded-md text-xs transition-colors ${
                              location.pathname === entry.to
                                ? 'bg-accent/70 text-accent-foreground font-medium'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            {t(entry.labelKey)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </nav>

            <div className="border-t pt-3 space-y-1">
              {showUpgrade && (
                <button
                  type="button"
                  onClick={() => {
                    navigate('/premium')
                    setMobileMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted rounded-lg"
                >
                  <Sparkles className="size-4 text-amber-500" />
                  {t('nav.upgrade')}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(true)
                  setMobileMenuOpen(false)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted rounded-lg"
              >
                <Settings className="size-4" />
                {t('nav.settings')}
              </button>
              {!isDesktopApp && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setCredentialsMode('email')
                      setMobileMenuOpen(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted rounded-lg"
                  >
                    <span className="flex size-4 items-center justify-center font-serif text-xs font-bold">@</span>
                    {t('auth.changeEmail')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCredentialsMode('password')
                      setMobileMenuOpen(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted rounded-lg"
                  >
                    <KeyRound className="size-4" />
                    {t('auth.changePassword')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      logout()
                      setMobileMenuOpen(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-lg"
                  >
                    <LogOut className="size-4" />
                    {t('nav.signOut')}
                  </button>
                </>
              )}
            </div>
          </aside>
        </div>
      )}

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      {credentialsMode && (
        <ChangeCredentialsModal mode={credentialsMode} onClose={() => setCredentialsMode(null)} />
      )}
    </>
  )
}

function PageBoundary({ children }: { children: ReactNode }) {
  const location = useLocation()
  return <ErrorBoundary key={location.pathname}>{children}</ErrorBoundary>
}

const FULL_BLEED_ROUTES = new Set(['/playground'])

function PageContainer({ children }: { children: ReactNode }) {
  const location = useLocation()
  const fullBleed = FULL_BLEED_ROUTES.has(location.pathname)
  return (
    <main className={fullBleed ? 'flex min-h-0 flex-1 flex-col' : 'mx-auto w-full max-w-6xl px-3 sm:px-6 py-4 sm:py-8'}>
      {children}
    </main>
  )
}

function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation()
  const fullBleed = FULL_BLEED_ROUTES.has(location.pathname)
  return (
    <div className={`flex flex-col ${fullBleed ? 'h-dvh overflow-hidden' : 'min-h-screen'} ${isDesktopApp ? 'desktop-backdrop' : 'bg-background'}`}>
      {children}
    </div>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <BrowserRouter basename={import.meta.env.BASE_URL}>
            <AuthGate>
              <AppShell>
                <Navbar />
                <PageContainer>
                  <PageBoundary>
                    <Routes>
                      <Route path="/" element={<Navigate to="/models/chat" replace />} />
                      <Route path="/models" element={<Navigate to="/models/chat" replace />} />
                      <Route path="/models/chat" element={<FallbackPage />} />
                      <Route path="/models/pools" element={<QuotaPoolsPage />} />
                      <Route path="/models/chat/:id" element={<ModelDetailPage />} />
                      <Route path="/models/fusion" element={<FusionPage />} />
                      <Route path="/models/auto" element={<AutoRoutingPage />} />
                      <Route path="/models/embeddings" element={<EmbeddingsPage />} />
                      <Route path="/models/embeddings/:id" element={<EmbeddingDetailPage />} />
                      <Route path="/models/image" element={<ImagePage />} />
                      <Route path="/models/image/:id" element={<MediaDetailPage modality="image" />} />
                      <Route path="/models/video" element={<VideoPage />} />
                      <Route path="/models/video/:id" element={<MediaDetailPage modality="video" />} />
                      <Route path="/models/audio" element={<AudioPage />} />
                      <Route path="/models/audio/:id" element={<MediaDetailPage modality="audio" />} />
                      <Route path="/models/transcription/:id" element={<MediaDetailPage modality="transcription" />} />
                      <Route path="/playground" element={<PlaygroundPage />} />
                      <Route path="/keys" element={<KeysPage />} />
                      <Route path="/agents" element={<AgentsPage />} />
                      <Route path="/fallback" element={<Navigate to="/models/chat" replace />} />
                      <Route path="/analytics" element={<AnalyticsPage />} />
                      <Route path="/logs" element={<LogsPage />} />
                      <Route path="/premium" element={<PremiumPage />} />
                      <Route path="/test" element={<Navigate to="/playground" replace />} />
                      <Route path="/health" element={<Navigate to="/keys" replace />} />
                      <Route path="*" element={<NotFoundPage />} />
                    </Routes>
                  </PageBoundary>
                </PageContainer>
                <Toaster />
                <CommandPalette />
                <UpdateReminder />
              </AppShell>
            </AuthGate>
          </BrowserRouter>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

export default App
