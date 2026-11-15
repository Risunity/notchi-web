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
  {
    id: 'bg_01',
    name: 'Ripple Wings',
    rarity: 'epic',
    weight: 50,
    description: 'Dynamic flowing wing motifs with subtle ambient illumination crafted for Notchi overlay.',
    badgeId: 'badge_ripple_wings',
    previewColor: 'linear-gradient(135deg, #312e81, #09090b)',
    image: '/images/rewards/bg_01_teaser.webp',
  },
  {
    id: 'bg_02',
    name: 'Midnight Bloom',
    rarity: 'epic',
    weight: 50,
    description: 'Dark floral botanical aesthetic with layered nocturnal accents for a clean, sleek desktop look.',
    badgeId: 'badge_midnight_bloom',
    previewColor: 'linear-gradient(135deg, #1e1b4b, #09090b)',
    image: '/images/rewards/bg_02_teaser.webp',
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
