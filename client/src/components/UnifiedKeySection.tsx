import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'

export function UnifiedKeySection() {
  const { data: config } = useQuery<{ unifiedKey: string }>({
    queryKey: ['settings'],
    queryFn: () => apiFetch('/api/settings')
  })

  return (
    <section className="rounded-3xl border bg-card/70 backdrop-blur-md p-6 space-y-2">
      <h2 className="text-sm font-medium">Your Unified API Key</h2>
      <div className="flex items-center gap-4">
        <code className="px-3 py-1.5 bg-muted rounded-full text-sm font-mono flex-1 text-muted-foreground">{config?.unifiedKey || 'Loading...'}</code>
        <Button variant="secondary" className="rounded-full" onClick={() => navigator.clipboard.writeText(config?.unifiedKey || '')}>Copy</Button>
      </div>
      <p className="text-xs text-muted-foreground">Use this key in your applications to access all configured providers below.</p>
    </section>
  )
}
