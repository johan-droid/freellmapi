import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { PageHeader } from '@/components/page-header'

export default function ProvidersPage() {
  const { data: providers, isLoading } = useQuery<any[]>({
    queryKey: ['providers'],
    queryFn: () => apiFetch('/api/providers')
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Providers"
        description="Manage dynamic model providers and discovery."
      />

      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {providers?.map(provider => (
            <div key={provider.id} className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-semibold text-lg">{provider.displayName}</h3>
              <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                 <p>Accounts: {provider.accountCount}</p>
                 <p>Credentials: {provider.credentialCount}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
