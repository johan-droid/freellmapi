import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ModelDetailModal } from '@/components/ModelDetailModal'
import { DiscoveryRunsSection } from '@/components/DiscoveryRunsSection'


export default function ModelsPage() {
  const { data: models = [], isLoading } = useQuery<any[]>({
    queryKey: ['models'],
    queryFn: () => apiFetch('/api/models')
  })

  // Basic stats for summary strip
  const stats = useMemo(() => {
    if (!models.length) return null;
    const providers = new Set(models.map(m => m.platform)).size;
    let totalAccounts = 0;
    let activeAccounts = 0;
    let activeCredentials = 0;

    models.forEach(m => {
      if (m.providerAccounts && Array.isArray(m.providerAccounts)) {
         m.providerAccounts.forEach((acc: any) => {
            totalAccounts++;
            if (acc.enabled) activeAccounts++;
            if (acc.credentials) {
               activeCredentials += acc.credentials.filter((c: any) => c.enabled).length;
            }
         });
      }
    });

    const activeModels = models.filter(m => m.enabled).length;
    const toolCapable = models.filter(m => m.supportsTools).length;

    return {
      providers,
      totalAccounts,
      activeAccounts,
      activeCredentials,
      activeModels,
      toolCapable
    };
  }, [models]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'grouped' | 'flat'>('grouped');
  const [selectedModel, setSelectedModel] = useState<any | null>(null);

  const filteredModels = useMemo(() => {
    return models.filter(m => {
      if (search) {
        const term = search.toLowerCase();
        if (!m.displayName.toLowerCase().includes(term) && !m.modelId.toLowerCase().includes(term) && !m.platform.toLowerCase().includes(term)) {
          return false;
        }
      }
      if (statusFilter !== 'all') {
        if (statusFilter === 'active' && !m.enabled) return false;
        if (statusFilter === 'disabled' && m.enabled) return false;
        if (statusFilter === 'deprecated' && !m.deprecated) return false;
      }
      if (providerFilter !== 'all' && m.platform !== providerFilter) return false;
      return true;
    });
  }, [models, search, statusFilter, providerFilter]);

  // Group models by provider for grouped view
  const groupedModels = useMemo(() => {
    const groups = new Map<string, any[]>();
    filteredModels.forEach(m => {
      const platform = m.platform || 'Unknown';
      if (!groups.has(platform)) groups.set(platform, []);
      groups.get(platform)!.push(m);
    });
    return Array.from(groups.entries()).map(([provider, models]) => ({ provider, models }));
  }, [filteredModels]);

  const providers = Array.from(new Set(models.map(m => m.platform))).sort();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Models"
        description="View and manage discovered models."
      />

      {/* Summary Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card className="bg-card/70 backdrop-blur-md border-border/80 rounded-3xl">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-medium uppercase tracking-wider">Providers</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold">{stats?.providers || 0}</div>
          </CardContent>
        </Card>

        <Card className="bg-card/70 backdrop-blur-md border-border/80 rounded-3xl">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-medium uppercase tracking-wider">Active Accounts</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold">{stats?.activeAccounts || 0}</div>
          </CardContent>
        </Card>

        <Card className="bg-card/70 backdrop-blur-md border-border/80 rounded-3xl">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-medium uppercase tracking-wider">Active Credentials</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold">{stats?.activeCredentials || 0}</div>
          </CardContent>
        </Card>

        <Card className="bg-card/70 backdrop-blur-md border-border/80 rounded-3xl">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-medium uppercase tracking-wider">Active Models</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold">{stats?.activeModels || 0}</div>
          </CardContent>
        </Card>

        <Card className="bg-card/70 backdrop-blur-md border-border/80 rounded-3xl">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-medium uppercase tracking-wider">Tool-capable</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold">{stats?.toolCapable || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 p-4 rounded-3xl border bg-card/70 backdrop-blur-md border-border/80">
        <div className="flex-1">
          <Input
            placeholder="Search model, provider..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-full"
          />
        </div>
        <div className="w-full sm:w-48">
          <Select value={providerFilter} onValueChange={(v) => setProviderFilter(v || 'all')}>
            <SelectTrigger className="rounded-full">
              <SelectValue placeholder="Provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Providers</SelectItem>
              {providers.map((p: any) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full sm:w-48">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v || 'all')}>
            <SelectTrigger className="rounded-full">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
              <SelectItem value="deprecated">Deprecated</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-full sm:w-48">
          <Select value={viewMode} onValueChange={(v) => setViewMode(v as 'grouped'|'flat')}>
            <SelectTrigger className="rounded-full">
              <SelectValue placeholder="View Mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="grouped">Grouped View</SelectItem>
              <SelectItem value="flat">Flat Table</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground animate-pulse">Loading models...</div>
      ) : filteredModels.length === 0 ? (
        <div className="p-12 text-center border rounded-3xl bg-card/50 text-muted-foreground">
          No models found matching your criteria.
        </div>
      ) : viewMode === 'grouped' ? (
        <div className="space-y-8">
          {groupedModels.map(({ provider, models: groupModels }) => (
            <Card key={provider} className="bg-card/70 backdrop-blur-md border-border/80 rounded-3xl overflow-hidden">
              <CardHeader className="bg-muted/30 border-b p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold">{provider}</h3>
                  <Badge variant="secondary" className="rounded-full">{groupModels.length} Models</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="grid gap-px bg-border/50">
                  {groupModels.map((model: any) => (
                    <div key={model.id} className="bg-card p-4 hover:bg-muted/50 transition-colors flex flex-col sm:flex-row justify-between sm:items-center gap-4 cursor-pointer" onClick={() => setSelectedModel(model)}>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{model.displayName}</span>
                          {model.enabled ? (
                            <Badge variant="outline" className="text-green-500 border-green-500/20 rounded-full">Active</Badge>
                          ) : (
                            <Badge variant="outline" className="text-red-500 border-red-500/20 rounded-full">Disabled</Badge>
                          )}
                          {model.deprecated && <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-500 rounded-full">Deprecated</Badge>}
                          {model.isFree && <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500 rounded-full">Free</Badge>}
                        </div>
                        <p className="text-sm text-muted-foreground font-mono">{model.modelId}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {model.supportsTools && <Badge variant="secondary" className="rounded-full">Tools</Badge>}
                        {model.supportsVision && <Badge variant="secondary" className="rounded-full">Vision</Badge>}
                        {model.supportsStreaming && <Badge variant="secondary" className="rounded-full">Streaming</Badge>}
                        {model.dynamic && <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 rounded-full">Dynamic</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border bg-card/70 backdrop-blur-md overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Model ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Capabilities</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredModels.map((model: any) => (
                <TableRow key={model.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedModel(model)}>
                  <TableCell className="font-medium">{model.platform}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">{model.modelId}</TableCell>
                  <TableCell>{model.displayName}</TableCell>
                  <TableCell>
                    {model.enabled ? (
                      <Badge variant="outline" className="text-green-500 border-green-500/20 rounded-full">Active</Badge>
                    ) : (
                      <Badge variant="outline" className="text-red-500 border-red-500/20 rounded-full">Disabled</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {model.supportsTools && <Badge variant="secondary" className="text-[10px] rounded-full">Tools</Badge>}
                      {model.supportsVision && <Badge variant="secondary" className="text-[10px] rounded-full">Vision</Badge>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
          <DiscoveryRunsSection />

      <ModelDetailModal
        model={selectedModel}
        isOpen={!!selectedModel}
        onClose={() => setSelectedModel(null)}
      />
    </div>
  )
}
