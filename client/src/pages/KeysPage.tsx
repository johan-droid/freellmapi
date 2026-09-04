import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { PageHeader } from '@/components/page-header'
import type { ApiKey, Platform } from '../../../shared/types'
import { Plus, Download } from 'lucide-react'
import { useI18n } from '@/i18n'
import type { HealthData } from '@/components/keys/shared'
import { QuotaSignalsSection } from '@/components/keys/quota-signals-section'
import { UnifiedKeySection } from '@/components/keys/unified-key-section'
import { ClientProfilesSection } from '@/components/keys/client-profiles-section'
import { ProxySettingsSection } from '@/components/keys/proxy-settings-section'
import { BackupsSection } from '@/components/keys/backups-section'
import { AnthropicSection } from '@/components/keys/anthropic-section'
import { ProviderList } from '@/components/keys/provider-list'
import { ProviderChecklistSection } from '@/components/keys/provider-checklist-section'
import { AddKeyDialog } from '@/components/keys/add-key-dialog'
import { ExportKeysDialog } from '@/components/keys/export-keys-dialog'
import { AgentCompatibilitySection } from '@/components/keys/agent-compatibility-section'

type KeysTab = 'providers' | 'quotaSignals' | 'apiKey' | 'anthropic' | 'agents'
const KEYS_TABS: { id: KeysTab; labelKey: string }[] = [
  { id: 'providers', labelKey: 'keys.tabProviders' },
  { id: 'quotaSignals', labelKey: 'keys.tabQuotaSignals' },
  { id: 'apiKey', labelKey: 'keys.tabApiKey' },
  { id: 'anthropic', labelKey: 'keys.tabAnthropic' },
  { id: 'agents', labelKey: 'keys.tabAgents' },
]

export default function KeysPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<KeysTab>('providers')
  const [addOpen, setAddOpen] = useState(false)
  const [addPlatform, setAddPlatform] = useState<Platform | ''>('')
  const [exportOpen, setExportOpen] = useState(false)

  const openAddKey = (platform: Platform | '' = '') => {
    setAddPlatform(platform)
    setAddOpen(true)
  }

  const { data: keys = [] } = useQuery<ApiKey[]>({
    queryKey: ['keys'],
    queryFn: () => apiFetch('/api/keys'),
  })

  const { data: healthData } = useQuery<HealthData>({
    queryKey: ['health'],
    queryFn: () => apiFetch('/api/health'),
    refetchInterval: 30000,
  })

  const checkAll = useMutation({
    mutationFn: () => apiFetch('/api/health/check-all', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  return (
    <div>
      <PageHeader
        title={t('keys.pageTitle')}
        description={t('keys.pageDescription')}
        actions={
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
              {(tab === 'providers' || tab === 'quotaSignals') && keys.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => checkAll.mutate()} disabled={checkAll.isPending} className="text-xs">
                  {checkAll.isPending ? t('keys.checking') : t('keys.checkAll')}
                </Button>
              )}
              {keys.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setExportOpen(true)} className="text-xs">
                  <Download className="size-3.5" />
                  {t('keys.export')}
                </Button>
              )}
              {tab === 'providers' && (
                <Button size="sm" onClick={() => openAddKey()} className="text-xs">
                  <Plus className="size-3.5" />
                  {t('keys.addKey')}
                </Button>
              )}
            </div>
            <div className="overflow-x-auto pb-1 sm:pb-0">
              <SegmentedControl
                value={tab}
                onValueChange={setTab}
                options={KEYS_TABS.map(tb => ({ value: tb.id, label: t(tb.labelKey) }))}
                ariaLabel={t('keys.pageTitle')}
              />
            </div>
          </div>
        }
      />

      <div className="space-y-6 sm:space-y-8">
        {tab === 'apiKey' && (
          <>
            <UnifiedKeySection />
            <ClientProfilesSection />
            <ProxySettingsSection />
            <BackupsSection />
          </>
        )}

        {tab === 'anthropic' && <AnthropicSection />}
        {tab === 'agents' && <AgentCompatibilitySection />}

        {tab === 'quotaSignals' && (
          <QuotaSignalsSection states={(healthData?.quotaStates ?? []).slice(0, 24)} />
        )}

        {tab === 'providers' && (
          <>
            <ProviderChecklistSection onAddKey={platform => openAddKey(platform as Platform)} />
            <ProviderList onAddKey={() => openAddKey()} />
          </>
        )}
      </div>

      <AddKeyDialog open={addOpen} onOpenChange={setAddOpen} initialPlatform={addPlatform || undefined} />
      {exportOpen && <ExportKeysDialog open={exportOpen} onOpenChange={setExportOpen} />}
    </div>
  )
}
