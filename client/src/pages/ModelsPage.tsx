import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { PageHeader } from '@/components/page-header'

export default function ModelsPage() {
  const { data: models, isLoading } = useQuery<any[]>({
    queryKey: ['models'],
    queryFn: () => apiFetch('/api/models')
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Models"
        description="View and manage discovered models."
      />

      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted text-muted-foreground border-b">
              <tr>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Model ID</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Badges</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {models?.map(model => (
                <tr key={model.id}>
                  <td className="px-4 py-3">{model.platform}</td>
                  <td className="px-4 py-3 font-mono">{model.modelId}</td>
                  <td className="px-4 py-3">{model.displayName}</td>
                  <td className="px-4 py-3">
                    {model.enabled ? (
                      <span className="text-green-500">Active</span>
                    ) : (
                      <span className="text-red-500">Disabled</span>
                    )}
                  </td>
                  <td className="px-4 py-3 flex gap-2">
                    {model.deprecated && <span className="bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded text-xs">Deprecated</span>}
                    {model.dynamic && <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs">Dynamic</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
