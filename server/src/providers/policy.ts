import {
  getAllProviderDefinitions,
  getProviderDefinition,
  type ProviderDefinition,
  type ProviderJurisdictionClass,
  type ProviderRegion,
} from './definitions/index.js';
import { getDb } from '../db/index.js';

export interface ProviderEligibilityOptions {
  jurisdiction?: ProviderJurisdictionClass | 'all';
  allowChina?: boolean;
  region?: ProviderRegion;
  networkOnly?: boolean;
  localOnly?: boolean;
}

/**
 * Retrieves the current China-provider policy from system settings.
 * Defaults to 'exclude' if not configured.
 */
export function getChinaProviderPolicy(): 'exclude' | 'allow' {
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT value_json FROM app_settings WHERE key = 'china_provider_policy'")
      .get() as { value_json: string } | undefined;
    if (row?.value_json) {
      const parsed = JSON.parse(row.value_json);
      if (parsed === 'allow' || parsed === 'exclude') return parsed;
    }
  } catch {
    // Fallback on error or uninitialized DB
  }
  return 'exclude';
}

/**
 * Returns eligible providers according to structured jurisdiction, regional policies,
 * and regional exclusion settings.
 */
export function getEligibleProviders(options: ProviderEligibilityOptions = {}): ProviderDefinition[] {
  const allProviders = getAllProviderDefinitions();
  const policy = getChinaProviderPolicy();
  const allowChina = options.allowChina ?? (policy === 'allow');

  return allProviders.filter(provider => {
    // China Provider Exclusion Check
    const jurLower = provider.jurisdiction.toLowerCase();
    if (!allowChina && jurLower === 'china') {
      return false;
    }

    if (options.jurisdiction && options.jurisdiction !== 'all') {
      if (provider.jurisdiction !== options.jurisdiction) {
        return false;
      }
    }

    if (options.region && provider.region !== options.region) {
      return false;
    }

    if (options.networkOnly && !provider.routing.networkDependency) {
      return false;
    }

    if (options.localOnly && provider.routing.networkDependency) {
      return false;
    }

    return true;
  });
}

/**
 * Checks if a specific provider slug is eligible under current regional policy.
 */
export function isProviderEligible(providerId: string, options?: ProviderEligibilityOptions): boolean {
  const eligible = getEligibleProviders(options);
  return eligible.some(p => p.id === providerId || p.aliases.includes(providerId));
}
