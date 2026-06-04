import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'

export function ModelDetailModal({ model, isOpen, onClose }: { model: any | null, isOpen: boolean, onClose: () => void }) {
  if (!model) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-card/95 backdrop-blur-md">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <DialogTitle className="text-2xl">{model.displayName}</DialogTitle>
              <DialogDescription className="font-mono text-sm">{model.platform} · {model.modelId}</DialogDescription>
            </div>
            <div className="flex gap-2 flex-wrap justify-end">
              {model.enabled ? (
                <Badge variant="outline" className="text-green-500 border-green-500/20 rounded-full">Active</Badge>
              ) : (
                <Badge variant="outline" className="text-red-500 border-red-500/20 rounded-full">Disabled</Badge>
              )}
              {model.deprecated && <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-500 rounded-full">Deprecated</Badge>}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          <section className="space-y-2">
            <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">Capabilities</h4>
            <div className="flex flex-wrap gap-2">
              <Badge variant={model.supportsTools ? "default" : "secondary"} className="rounded-full">
                {model.supportsTools ? "✓ Tools" : "✗ Tools"}
              </Badge>
              <Badge variant={model.supportsVision ? "default" : "secondary"} className="rounded-full">
                {model.supportsVision ? "✓ Vision" : "✗ Vision"}
              </Badge>
              <Badge variant={model.supportsStreaming ? "default" : "secondary"} className="rounded-full">
                {model.supportsStreaming ? "✓ Streaming" : "✗ Streaming"}
              </Badge>
              {model.isFree && <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500 rounded-full">Free</Badge>}
            </div>
          </section>

          <section className="space-y-2">
            <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">Availability (Accounts & Credentials)</h4>
            <div className="rounded-xl border bg-muted/20 p-4">
              {model.providerAccounts && model.providerAccounts.length > 0 ? (
                <ul className="space-y-3">
                  {model.providerAccounts.map((acc: any) => (
                    <li key={acc.id} className="text-sm border-l-2 border-primary/20 pl-3">
                      <div className="font-medium">{acc.label} <span className="text-muted-foreground">({acc.emailHint})</span></div>
                      <div className="text-muted-foreground mt-1">
                        {acc.credentials?.filter((c: any) => c.enabled).length || 0} active credentials
                      </div>
                      {acc.quota && (
                        <div className="text-xs mt-1 text-muted-foreground flex gap-2 flex-wrap">
                          {acc.quota.rpmLimit && <span>RPM: {acc.quota.rpmLimit}</span>}
                          {acc.quota.tpmLimit && <span>TPM: {acc.quota.tpmLimit}</span>}
                          <Badge variant="outline" className="text-[10px]">{acc.quota.quotaStatus || 'Unknown quota'}</Badge>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No account linkage data available yet.</p>
              )}
            </div>
          </section>

          <section className="space-y-2">
            <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">Discovery</h4>
            <div className="rounded-xl border bg-muted/20 p-4 text-sm grid grid-cols-2 gap-4">
              <div>
                <span className="text-muted-foreground block text-xs">Source</span>
                <span className="font-medium">{model.discoveredSource || 'Bootstrap / Built-in'}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs">Dynamic Update</span>
                <span className="font-medium">{model.dynamic ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
