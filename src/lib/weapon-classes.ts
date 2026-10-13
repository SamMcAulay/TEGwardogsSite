// Weapon classes for milestone badges, from the kill feed's cause ids. Client-safe.
// Only weapons we can name are classed; unknown ids (WEPN_030 and friends) count towards no class
// until someone says what they are. Vehicle kills are Warcon's own count, not a class here.

export type WeaponClass = 'assault' | 'smg' | 'sniper' | 'marksman' | 'lmg' | 'shotgun' | 'pistol' | 'explosive';

export const WEAPON_CLASS_LABELS: Record<WeaponClass, string> = {
  assault: 'Assault rifles',
  smg: 'SMGs',
  sniper: 'Sniper rifles',
  marksman: 'Marksman rifles',
  lmg: 'LMGs',
  shotgun: 'Shotguns',
  pistol: 'Pistols',
  explosive: 'Explosives',
};

/** Lower-cased cause id to class. */
const CLASSES: Record<string, WeaponClass> = {
  'id.item.m4': 'assault',
  'id.item.ak74m': 'assault',
  'id.item.wepn_029': 'assault', // Galil
  'id.item.tar21': 'assault',
  'id.item.a91': 'assault',
  'id.item.kh2002': 'assault',
  'id.item.mp9': 'smg',
  'id.item.vector': 'smg',
  'id.item.smg_03': 'smg',
  'id.item.mosin': 'sniper',
  'id.item.sv98': 'sniper',
  'id.item.mk22': 'sniper',
  'id.item.svdm': 'marksman',
  'id.item.sks': 'marksman',
  'id.item.m249': 'lmg',
  'id.item.lmg_02': 'lmg',
  'id.item.m500': 'shotgun',
  'id.item.mp43': 'shotgun',
  'id.item.glock17': 'pistol',
  'id.item.m67grenade': 'explosive',
  'id.item.c4explosive': 'explosive',
  'id.item.claymore': 'explosive',
  'id.item.rpg7': 'explosive',
  'id.item.launcher_04': 'explosive',
  'id.item.atmine': 'explosive',
  'id.item.ied.explosive': 'explosive',
};

/**
 * Rifles and machine guns, in Warcon's exact spelling (its cause filter is case-sensitive): the
 * guns the longest-shot records search. Explosives, vehicles and unknown weapons are left out,
 * since their "distance" is measured from wherever the shooter stands (a mine can read 5 km).
 */
export const RECORD_CAUSES = [
  'Id.Item.M4', 'Id.Item.AK74M', 'Id.Item.WEPN_029', 'Id.Item.TAR21', 'Id.Item.A91', 'Id.Item.KH2002',
  'Id.Item.Mosin', 'Id.Item.SV98', 'Id.Item.MK22',
  'Id.Item.SVDM', 'Id.Item.SKS',
  'Id.Item.M249', 'Id.Item.LMG_02',
] as const;

export function weaponClass(cause: string): WeaponClass | null {
  return CLASSES[cause.toLowerCase()] ?? null;
}

/** Kills per class from a player's per-weapon kills; every class present, 0 when unused. */
export function classKills(weapons: { cause: string; kills: number }[]): Record<WeaponClass, number> {
  const out = Object.fromEntries(Object.keys(WEAPON_CLASS_LABELS).map((k) => [k, 0])) as Record<WeaponClass, number>;
  for (const w of weapons) {
    const c = weaponClass(w.cause);
    if (c) out[c] += w.kills;
  }
  return out;
}
