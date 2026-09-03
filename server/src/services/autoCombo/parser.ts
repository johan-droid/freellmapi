export type AutoCategory = 'coding' | 'reasoning' | 'vision' | 'chat' | 'multimodal';
export type AutoTier = 'fast' | 'cheap' | 'floor' | 'reliable' | 'free' | 'pro';
export type AutoVariant = 'coding' | 'fast' | 'cheap' | 'reliable' | 'offline' | 'smart' | 'lkgp' | 'reasoning' | 'vision' | 'chat' | 'multimodal';

export const VALID_CATEGORIES = new Set<string>(['coding','reasoning','vision','chat','multimodal']);
export const VALID_TIERS = new Set<string>(['fast','cheap','floor','reliable','free','pro']);
export const VALID_VARIANTS = new Set<string>(['coding','fast','cheap','reliable','offline','smart','lkgp','reasoning','vision','chat','multimodal','code']);

// Normalize aliases
const CATEGORY_ALIASES: Record<string, AutoCategory> = {
  code: 'coding',
};

const TIER_ALIASES: Record<string, AutoTier> = {};

export interface ParsedAuto {
  isAuto: boolean;
  raw: string;
  category?: AutoCategory;
  tier?: AutoTier;
  variant?: string;
  isValid: boolean;
  error?: string;
}

export function parseAutoPrefix(model: string | undefined | null): ParsedAuto | null {
  if (!model) return null;
  const raw = model.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === 'auto') {
    return { isAuto: true, raw, isValid: true };
  }
  if (!lower.startsWith('auto/') && !lower.startsWith('auto:')) {
    return null;
  }
  // Determine separator: spec uses auto/coding and auto/coding:fast
  // Also support auto:profile legacy but parser isolates auto/ form; auto: is handled separately.
  // If starts with auto: and not containing /, treat as profile alias — not our concern here.
  if (lower.startsWith('auto:') && !lower.includes('/')) {
    return null; // legacy profile, not auto-combo parser
  }
  // Normalize to auto/ form
  let suffix = '';
  if (lower.startsWith('auto/')) suffix = raw.slice('auto/'.length);
  else if (lower.startsWith('auto:')) suffix = raw.slice('auto:'.length);
  else return null;
  suffix = suffix.trim();
  if (!suffix) {
    return { isAuto: true, raw, isValid: true };
  }
  suffix = suffix.toLowerCase();
  // Split tier part
  let categoryPart: string | undefined;
  let tierPart: string | undefined;
  if (suffix.includes(':')) {
    const [cat, tier] = suffix.split(':');
    categoryPart = cat?.trim();
    tierPart = tier?.trim();
  } else {
    categoryPart = suffix.trim();
  }

  // Single token could be category OR tier OR variant like offline/smart/lkgp/fast etc
  // Check if it's a known variant that is not category/tier
  if (!tierPart) {
    const token = categoryPart!;
    // offline, smart, lkgp are standalone variants
    if (['offline','smart','lkgp'].includes(token)) {
      return { isAuto: true, raw, variant: token, isValid: true, category: undefined, tier: undefined };
    }
    if (VALID_CATEGORIES.has(token) || CATEGORY_ALIASES[token]) {
      const cat = (CATEGORY_ALIASES[token] ?? token) as AutoCategory;
      return { isAuto: true, raw, category: cat, isValid: true };
    }
    if (VALID_TIERS.has(token) || TIER_ALIASES[token]) {
      const tier = (TIER_ALIASES[token] ?? token) as AutoTier;
      return { isAuto: true, raw, tier, isValid: true };
    }
    // also allow simple variants like fast, cheap, reliable
    if (VALID_VARIANTS.has(token)) {
      // fast/cheap/reliable could be treated as tier
      if (['fast','cheap','reliable','floor','free','pro'].includes(token)) {
        return { isAuto: true, raw, tier: token as AutoTier, isValid: true };
      }
      // vision/coding etc as category already handled
      return { isAuto: true, raw, variant: token, isValid: true };
    }
    return { isAuto: true, raw, isValid: false, error: `Unknown auto variant: ${token}` };
  } else {
    // composable auto/<category>:<tier>
    const catRaw = categoryPart ?? '';
    const tierRaw = tierPart ?? '';
    if (!catRaw || !tierRaw) {
      return { isAuto: true, raw, isValid: false, error: 'Invalid auto category:tier format' };
    }
    const catNorm = CATEGORY_ALIASES[catRaw] ?? catRaw;
    const tierNorm = TIER_ALIASES[tierRaw] ?? tierRaw;
    if (!VALID_CATEGORIES.has(catNorm)) {
      return { isAuto: true, raw, isValid: false, error: `Unknown category: ${catRaw}` };
    }
    if (!VALID_TIERS.has(tierNorm)) {
      return { isAuto: true, raw, isValid: false, error: `Unknown tier: ${tierRaw}` };
    }
    return { isAuto: true, raw, category: catNorm as AutoCategory, tier: tierNorm as AutoTier, isValid: true };
  }
}

export function isAutoModel(model: string | undefined): boolean {
  if (!model) return false;
  const p = parseAutoPrefix(model);
  if (p && p.isAuto) return true;
  // also handle legacy auto and auto:profile via simple check
  const lower = model.toLowerCase().trim();
  return lower === 'auto' || lower.startsWith('auto:') || lower.startsWith('auto/');
}
