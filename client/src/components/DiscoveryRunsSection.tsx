import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export function DiscoveryRunsSection() {
  const queryClient = useQueryClient()

  const { data: runs = [], isLoading } = useQuery<any[]>({
    queryKey: ['discovery-runs'],
    queryFn: () => apiFetch('/api/discovery/runs')
  })



  const runDiscovery = useMutation({
    mutationFn: () => apiFetch('/api/discovery/run', { method: 'POST', body: JSON.stringify({ force: true }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discovery-runs'] })

    }
  })

  return (
    <Card className="bg-card/70 backdrop-blur-md border-border/80 rounded-3xl overflow-hidden mt-6">
      <CardHeader className="bg-muted/30 border-b flex flex-row items-center justify-between p-4">
        <div>
          <CardTitle className="text-lg">Model Discovery Runs</CardTitle>
          <CardDescription>Recent discovery and background sync tasks</CardDescription>
        </div>
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => runDiscovery.mutate()}
          disabled={runDiscovery.isPending}
        >
          {runDiscovery.isPending ? 'Running...' : 'Run Discovery Now'}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground animate-pulse">Loading runs...</div>
        ) : runs.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            No recent discovery runs. Click the button above to manually start one.
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {runs.slice(0, 5).map((run: any) => (
              <div key={run.id} className="p-4 flex flex-col sm:flex-row justify-between items-start gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{run.provider || 'Global'}</span>
                    {run.status === 'success' ? (
                      <Badge variant="outline" className="text-green-500 border-green-500/20 rounded-full">Success</Badge>
                    ) : (
                      <Badge variant="outline" className="text-red-500 border-red-500/20 rounded-full">Failed</Badge>
                    )}
                  </div>
                  {run.errorMessage && <p className="text-xs text-destructive mt-1 font-mono">{run.errorMessage}</p>}
                </div>

                <div className="flex gap-4 text-sm text-muted-foreground tabular-nums">
                  <div className="flex flex-col text-right">
                    <span className="text-[10px] uppercase tracking-wider">Models Found</span>
                    <span className="font-medium text-foreground">{run.modelsFound || 0}</span>
                  </div>
                  <div className="flex flex-col text-right">
                    <span className="text-[10px] uppercase tracking-wider">Added</span>
                    <span className="font-medium text-green-500">{run.modelsAdded || 0}</span>
                  </div>
                  <div className="flex flex-col text-right">
                    <span className="text-[10px] uppercase tracking-wider">Updated</span>
                    <span className="font-medium text-blue-500">{run.modelsUpdated || 0}</span>
                  </div>
                  <div className="flex flex-col text-right">
                    <span className="text-[10px] uppercase tracking-wider">Removed</span>
                    <span className="font-medium text-red-500">{run.modelsRemoved || 0}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
