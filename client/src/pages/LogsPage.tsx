import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownToLine, Pause, Play, ScrollText, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { ConfirmButton } from '@/components/confirm-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import {
  advanceCursor,
  buildLogsQuery,
  clampMessage,
  collectProviders,
  DEFAULT_LOG_LEVELS,
  EMPTY_LOG_COUNTS,
  formatLogTime,
  isLongMessage,
  levelsCsv,
  LOG_BUFFER_LIMIT,
  LOG_LEVELS,
  LOG_PAGE_LIMIT,
  LOG_POLL_MS,
  mergeEntries,
  toggleLevel,
  type LogCounts,
  type LogEntry,
  type LogLevel,
  type LogsResponse,
} from '@/lib/logs'

const SEARCH_DEBOUNCE_MS = 300
const SCROLL_FOLLOW_SLACK = 40

const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: 'bg-muted text-muted-foreground',
  info: 'bg-sky-600/15 text-sky-700 dark:text-sky-400',
  warn: 'bg-amber-600/15 text-amber-700 dark:text-amber-400',
  error: 'bg-destructive/10 text-destructive',
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
      {children}
    </span>
  )
}

function LogRow({
  entry,
  expanded,
  onToggleExpand,
  expandLabel,
  collapseLabel,
}: {
  entry: LogEntry
  expanded: boolean
  onToggleExpand: () => void
  expandLabel: string
  collapseLabel: string
}) {
  const long = isLongMessage(entry.message)
  return (
    <div
      data-log-level={entry.level}
      className="flex flex-wrap sm:flex-nowrap items-start gap-1.5 sm:gap-2 rounded-lg px-2 py-1 font-mono text-[11px] leading-relaxed hover:bg-muted/40"
    >
      <span className="shrink-0 tabular-nums text-muted-foreground text-[10px] sm:text-[11px]">{formatLogTime(entry.ts)}</span>
      <Badge
        variant="secondary"
        className={cn('h-4 shrink-0 rounded px-1 font-mono text-[9px] sm:text-[10px] uppercase', LEVEL_CLASS[entry.level])}
      >
        {entry.level}
      </Badge>
      <div className="min-w-0 flex-1 basis-full sm:basis-auto">
        {(entry.source || entry.provider || entry.model || entry.event || entry.requestId) && (
          <span className="me-1.5 inline-flex flex-wrap items-center gap-1 align-top">
            {entry.source && <Chip>{entry.source}</Chip>}
            {entry.provider && <Chip>{entry.provider}</Chip>}
            {entry.model && <Chip>{entry.model}</Chip>}
            {entry.event && <Chip>{entry.event}</Chip>}
            {entry.requestId && <Chip>#{entry.requestId}</Chip>}
          </span>
        )}
        <span className="whitespace-pre-wrap break-all sm:break-normal">
          {long && !expanded ? clampMessage(entry.message) : entry.message}
        </span>
        {long && (
          <button
            type="button"
            onClick={onToggleExpand}
            className="ms-1.5 align-baseline text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {expanded ? collapseLabel : expandLabel}
          </button>
        )}
      </div>
    </div>
  )
}

export default function LogsPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()

  const [levels, setLevels] = useState<LogLevel[]>(() => [...DEFAULT_LOG_LEVELS])
  const [provider, setProvider] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [paused, setPaused] = useState(false)

  const [entries, setEntries] = useState<LogEntry[]>([])
  const [counts, setCounts] = useState<LogCounts>(EMPTY_LOG_COUNTS)
  const [providers, setProviders] = useState<string[]>([])
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
  const [follow, setFollow] = useState<{ following: boolean; seenId: number | null }>({
    following: true,
    seenId: null,
  })

  const cursorRef = useRef<number | null>(null)
  const streamRef = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const lastScrollTopRef = useRef(0)

  const resetStream = useCallback(() => {
    streamRef.current += 1
    cursorRef.current = null
    followRef.current = true
    lastScrollTopRef.current = 0
    setEntries([])
    setExpanded(new Set())
    setFollow({ following: true, seenId: null })
  }, [])

  useEffect(() => {
    const trimmed = searchInput.trim()
    if (trimmed === search) return
    const timer = window.setTimeout(() => {
      setSearch(trimmed)
      resetStream()
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchInput, search, resetStream])

  const filterKey = `${levelsCsv(levels)}|${search}|${provider}`

  const query = useQuery({
    queryKey: ['logs', filterKey],
    enabled: levels.length > 0,
    queryFn: async () => {
      const stream = streamRef.current
      const response = await apiFetch<LogsResponse>(
        buildLogsQuery({ levels, q: search, provider, sinceId: cursorRef.current, limit: LOG_PAGE_LIMIT }),
      )
      if (streamRef.current !== stream) return response
      const incoming = response.entries ?? []
      cursorRef.current = advanceCursor(cursorRef.current, { entries: incoming, nextId: response.nextId })
      setCounts(response.counts ?? EMPTY_LOG_COUNTS)
      setProviders(prev => collectProviders(prev, incoming))
      setEntries(prev => mergeEntries(prev, incoming))
      return response
    },
    refetchInterval: paused ? false : LOG_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: !paused,
    refetchOnReconnect: !paused,
  })

  const clearLogs = useMutation({
    mutationFn: () => apiFetch<{ ok: true }>('/api/logs/clear', { method: 'POST' }),
    onSuccess: () => {
      resetStream()
      setCounts(EMPTY_LOG_COUNTS)
      setProviders([])
      toast.success(t('logs.cleared'))
      void queryClient.invalidateQueries({ queryKey: ['logs'] })
    },
  })

  const newestId = entries.length ? entries[entries.length - 1].id : null

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    const top = el.scrollTop
    const movedUp = top < lastScrollTopRef.current - 1
    lastScrollTopRef.current = top
    if (el.scrollHeight - top - el.clientHeight <= SCROLL_FOLLOW_SLACK) {
      followRef.current = true
      setFollow(current => (current.following ? current : { following: true, seenId: null }))
    } else if (movedUp) {
      followRef.current = false
      setFollow(current => (current.following ? { following: false, seenId: newestId } : current))
    }
  }

  useEffect(() => {
    if (!entries.length) return
    if (followRef.current) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries])

  const jumpToLatest = () => {
    followRef.current = true
    setFollow({ following: true, seenId: null })
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const toggleExpanded = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const loading = query.isPending && !query.isError
  const showJump = !follow.following && newestId != null && (follow.seenId == null || newestId > follow.seenId)

  return (
    <div>
      <PageHeader
        title={t('logs.title')}
        description={t('logs.description')}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={paused}
              onClick={() => setPaused(current => !current)}
            >
              {paused ? <Play /> : <Pause />}
              {paused ? t('logs.resume') : t('logs.pause')}
            </Button>
            <ConfirmButton
              variant="outline"
              size="sm"
              disabled={clearLogs.isPending}
              onConfirm={() => clearLogs.mutate()}
            >
              <Trash2 />
              {t('logs.clear')}
            </ConfirmButton>
          </>
        }
      />

      <div className="mb-3 sm:mb-4 flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('logs.levelFilter')}>
          {LOG_LEVELS.map(level => {
            const active = levels.includes(level)
            return (
              <button
                key={level}
                type="button"
                aria-pressed={active}
                data-level={level}
                onClick={() => {
                  setLevels(current => toggleLevel(current, level))
                  resetStream()
                }}
                className={cn(
                  'inline-flex h-6 sm:h-7 items-center gap-1 sm:gap-1.5 rounded-full border border-transparent px-2 sm:px-2.5 text-[11px] sm:text-xs font-medium transition-colors',
                  active ? LEVEL_CLASS[level] : 'bg-muted/40 text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`logs.levels.${level}`)}
                <span className="tabular-nums opacity-70">{counts[level]}</span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Select
            value={provider}
            onValueChange={(value) => {
              setProvider(value ?? 'all')
              resetStream()
            }}
          >
            <SelectTrigger size="sm" aria-label={t('common.provider')} className="w-1/2 sm:w-auto">
              <SelectValue>
                {(value: string) => (!value || value === 'all' ? t('analytics.allProviders') : value)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('analytics.allProviders')}</SelectItem>
              {providers.map(name => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t('logs.searchPlaceholder')}
            aria-label={t('logs.searchPlaceholder')}
            className="h-8 text-xs w-1/2 sm:w-64"
          />
        </div>
      </div>

      <p className="mb-2 text-xs text-muted-foreground">{t('logs.countsHint')}</p>

      {query.isError && (
        <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {t('logs.loadFailed')}{' '}
          {query.error instanceof Error ? query.error.message : String(query.error ?? '')}
        </div>
      )}

      <div className="relative rounded-2xl sm:rounded-3xl border bg-card">
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="max-h-[65vh] min-h-[200px] overflow-y-auto p-2 sm:p-3"
        >
          {levels.length === 0 ? (
            <EmptyState
              className="border-0"
              icon={ScrollText}
              title={t('logs.noLevelsTitle')}
              description={t('logs.noLevelsDescription')}
            />
          ) : loading ? (
            <div className="space-y-1.5">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-4 rounded" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            query.isError ? null : (
              <EmptyState
                className="border-0"
                icon={ScrollText}
                title={t('logs.emptyTitle')}
                description={t('logs.emptyDescription')}
              />
            )
          ) : (
            entries.map(entry => (
              <LogRow
                key={entry.id}
                entry={entry}
                expanded={expanded.has(entry.id)}
                onToggleExpand={() => toggleExpanded(entry.id)}
                expandLabel={t('logs.showMore')}
                collapseLabel={t('logs.showLess')}
              />
            ))
          )}
          <div ref={endRef} />
        </div>

        {showJump && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={jumpToLatest}
            className="absolute inset-x-0 bottom-3 mx-auto w-fit shadow-sm text-xs"
          >
            <ArrowDownToLine />
            {t('logs.jumpToLatest')}
          </Button>
        )}
      </div>

      {entries.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('logs.buffered', { count: entries.length, max: LOG_BUFFER_LIMIT })}
        </p>
      )}
    </div>
  )
}
