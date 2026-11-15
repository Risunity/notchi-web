export type RewardRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface RewardItem {
  readonly id: string;
  readonly name: string;
  readonly rarity: RewardRarity;
  readonly weight: number; // Raw integer weight for random roll
  readonly quota?: number; // Optional maximum total quota
  readonly description: string;
  readonly badgeId: string;
  readonly previewColor: string;
  readonly image?: string;
  readonly compactImage?: string;
}

export const REWARDS_CATALOG: readonly RewardItem[] = [
  // --- 1. LEGENDARY (Limit 7 di dunia) ---
  {
    id: 'bg_07',
    name: 'The Deadline Cat',
    rarity: 'legendary',
    weight: 50, // 5%
    quota: 7, // Terbatas hanya 7 kali klaim!
    description: 'A legendary determined cat racing against the clock, granted exclusively to the first 7 achievers.',
    badgeId: 'badge_deadline_cat',
    previewColor: 'linear-gradient(135deg, #b45309, #09090b)',
    image: '/images/rewards/bg_07_teaser.webp',
  },

  // --- 2. EPIC (7.5% per item -> Total 15%) ---
  {
    id: 'bg_01',
    name: 'Ripple Wings',
    rarity: 'epic',
    weight: 75, // 7.5%
    description: 'Dynamic flowing wing motifs with subtle ambient illumination crafted for Notchi overlay.',
    badgeId: 'badge_ripple_wings',
    previewColor: 'linear-gradient(135deg, #1e1b4b, #09090b)',
    image: '/images/rewards/bg_01_teaser.webp',
  },
  {
    id: 'bg_05',
    name: 'Misty Meadows',
    rarity: 'epic',
    weight: 75, // 7.5%
    description: 'Soft rolling meadows veiled in early dawn fog, blending calm nature tones with modern elegance.',
    badgeId: 'badge_misty_meadows',
    previewColor: 'linear-gradient(135deg, #064e3b, #09090b)',
    image: '/images/rewards/bg_05_teaser.webp',
  },

  // --- 3. RARE (15% per item -> Total 30%) ---
  {
    id: 'bg_02',
    name: 'Midnight Bloom',
    rarity: 'rare',
    weight: 150, // 15%
    description: 'Dark floral botanical aesthetic with layered nocturnal accents for a clean, sleek desktop look.',
    badgeId: 'badge_midnight_bloom',
    previewColor: 'linear-gradient(135deg, #1e1b4b, #09090b)',
    image: '/images/rewards/bg_02_teaser.webp',
  },
  {
    id: 'bg_06',
    name: 'The Silent Chorus',
    rarity: 'rare',
    weight: 150, // 15%
    description: 'An enigmatic twilight silhouette resonating in muted harmony across your notch perimeter.',
    badgeId: 'badge_silent_chorus',
    previewColor: 'linear-gradient(135deg, #312e81, #09090b)',
    image: '/images/rewards/bg_06_teaser.webp',
  },

  // --- 4. COMMON (25% per item -> Total 50%) ---
  {
    id: 'bg_03',
    name: 'Feline Brotherhood',
    rarity: 'common',
    weight: 250, // 25%
    description: 'A heartwarming trio of loyal feline companions resting in quiet harmony, bringing warm ambient charm to your desktop.',
    badgeId: 'badge_feline_brotherhood',
    previewColor: 'linear-gradient(135deg, #334155, #09090b)',
    image: '/images/rewards/bg_03_teaser.webp',
  },
  {
    id: 'bg_04',
    name: 'Nightmare Cloud',
    rarity: 'common',
    weight: 250, // 25%
    description: 'Surreal dark cloud formations draped in midnight mist for a deep atmospheric presence.',
    badgeId: 'badge_nightmare_cloud',
    previewColor: 'linear-gradient(135deg, #18181b, #09090b)',
    image: '/images/rewards/bg_04_teaser.webp',
  },
] as const;

export function getRewardById(id: string): RewardItem | undefined {
  return REWARDS_CATALOG.find((item) => item.id === id);
}

export function calculateDropRates(): { id: string; name: string; rarity: RewardRarity; percentage: number }[] {
  const totalWeight = REWARDS_CATALOG.reduce((acc, item) => acc + item.weight, 0);
  return REWARDS_CATALOG.map((item) => ({
    id: item.id,
    name: item.name,
    rarity: item.rarity,
    percentage: Math.round((item.weight / totalWeight) * 1000) / 10,
  }));
}
