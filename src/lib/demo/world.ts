// A deterministic pretend player base for demo mode: names, skill, loadouts, habits.

export type Rng = () => number;

/** mulberry32: small, fast, seedable. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

export function weighted<T>(r: Rng, xs: readonly T[], weight: (x: T) => number): T {
  let total = 0;
  for (const x of xs) total += weight(x);
  let roll = r() * total;
  for (const x of xs) {
    roll -= weight(x);
    if (roll <= 0) return x;
  }
  return xs[xs.length - 1];
}

export function poisson(r: Rng, mean: number): number {
  if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * gaussian(r)));
  const l = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= r();
  } while (p > l);
  return k - 1;
}

export function gaussian(r: Rng): number {
  return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
}

export type WeaponClass = 'rifle' | 'dmr' | 'sniper' | 'smg' | 'shotgun' | 'pistol' | 'melee' | 'explosive' | 'vehicle';

export interface Weapon {
  cause: string;
  cls: WeaponClass;
  /** Relative popularity. */
  weight: number;
}

export const WEAPONS: Weapon[] = [
  { cause: 'Id.Item.AK74M', cls: 'rifle', weight: 22 },
  { cause: 'Id.Item.M4', cls: 'rifle', weight: 20 },
  { cause: 'Id.Item.WEPN_029', cls: 'rifle', weight: 9 },
  { cause: 'Id.Item.TAR21', cls: 'rifle', weight: 8 },
  { cause: 'Id.Item.A91', cls: 'rifle', weight: 6 },
  { cause: 'Id.Item.KH2002', cls: 'rifle', weight: 5 },
  { cause: 'Id.Item.MP43', cls: 'smg', weight: 6 },
  { cause: 'Id.Item.SKS', cls: 'dmr', weight: 7 },
  { cause: 'Id.Item.SVDM', cls: 'dmr', weight: 6 },
  { cause: 'Id.Item.SV98', cls: 'sniper', weight: 7 },
  { cause: 'Id.Item.M500', cls: 'shotgun', weight: 4 },
  { cause: 'Id.Item.MK22', cls: 'pistol', weight: 2 },
  { cause: 'Id.Item.Glock17', cls: 'pistol', weight: 3 },
  { cause: 'Id.Item.CombatBow', cls: 'dmr', weight: 0.6 },
];

export const SIDEARMS = WEAPONS.filter((w) => w.cls === 'pistol');

export const EXPLOSIVES: Weapon[] = [
  { cause: 'Id.Item.RPG7', cls: 'explosive', weight: 6 },
  { cause: 'Id.Item.M67Grenade', cls: 'explosive', weight: 8 },
  { cause: 'Id.Item.C4Explosive', cls: 'explosive', weight: 3 },
  { cause: 'Id.Item.Claymore', cls: 'explosive', weight: 2 },
  { cause: 'Id.Item.ATMine', cls: 'explosive', weight: 1 },
  { cause: 'Id.Item.IED.Explosive', cls: 'explosive', weight: 1 },
  { cause: 'Id.Item.Crowbar', cls: 'melee', weight: 1.2 },
  { cause: 'Id.Item.Fists', cls: 'melee', weight: 0.4 },
];

export const VEHICLES: Weapon[] = [
  { cause: 'Id.Vehicle.WeaponExtension.TNK_01.Heavy', cls: 'vehicle', weight: 5 },
  { cause: 'Id.Vehicle.WeaponExtension.TNK_01.MachineGun', cls: 'vehicle', weight: 3 },
  { cause: 'Id.Vehicle.WeaponExtension.WHL_05.RingTurret', cls: 'vehicle', weight: 4 },
  { cause: 'Id.Vehicle.WeaponExtension.WHL_05.RingMinigun', cls: 'vehicle', weight: 2 },
  { cause: 'Id.Vehicle.WeaponExtension.ROT_03.MountedMachineGun', cls: 'vehicle', weight: 2.5 },
  { cause: 'Id.Vehicle.WeaponExtension.ROT_03.RocketPods', cls: 'vehicle', weight: 2 },
  { cause: 'Id.Vehicle.WeaponExtension.ROT_02.30mmCannon', cls: 'vehicle', weight: 1.5 },
  { cause: 'Id.Vehicle.WeaponExtension.TNK_01.Artillery', cls: 'vehicle', weight: 1.5 },
  { cause: 'Vehicle.Variant.Stationary.Mortar', cls: 'vehicle', weight: 2 },
  { cause: 'Vehicle.Variant.Land.Wheeled.Humvee.MachineGun', cls: 'vehicle', weight: 1 },
];

/** Distance range in metres and base headshot chance per weapon class. */
export const CLASS_PROFILE: Record<WeaponClass, { min: number; max: number; hs: number }> = {
  rifle: { min: 12, max: 320, hs: 0.2 },
  dmr: { min: 40, max: 520, hs: 0.3 },
  sniper: { min: 90, max: 1150, hs: 0.46 },
  smg: { min: 4, max: 90, hs: 0.14 },
  shotgun: { min: 2, max: 35, hs: 0.08 },
  pistol: { min: 3, max: 60, hs: 0.16 },
  melee: { min: 1, max: 3, hs: 0 },
  explosive: { min: 3, max: 260, hs: 0 },
  vehicle: { min: 20, max: 1400, hs: 0 },
};

export interface DemoPlayer {
  steamId: string;
  name: string;
  /** 0.4 (fodder) .. 2.6 (cracked). Weights who gets the kill. */
  skill: number;
  /** Chance per hour of prime time that they log on. */
  activity: number;
  region: 'NA' | 'EU' | 'OCE';
  primary: Weapon;
  sidearm: Weapon;
  /** Chance a kill comes from a vehicle. */
  vehicleBias: number;
}

const PREFIX = [
  'Grim',
  'Iron',
  'Silent',
  'Rusty',
  'Dusty',
  'Feral',
  'Rogue',
  'Salty',
  'Frosty',
  'Lucky',
  'Crimson',
  'Hollow',
  'Stale',
  'Tactical',
  'Sergeant',
  'Captain',
  'Major',
  'Private',
  'Corporal',
  'Grumpy',
  'Sleepy',
  'Angry',
  'Old',
  'Big',
  'Lil',
  'Dad',
  'Uncle',
  'Mister',
  'Doc',
  'Chief',
  'Ghost',
  'Shadow',
  'Steel',
  'Wet',
  'Mild',
  'Loud',
  'Sneaky',
  'Burnt',
  'Soggy',
  'Budget',
  'Spicy',
  'Cold',
  'Tired',
  'Retired',
  'Weekend',
  'Midnight',
  'Night',
];
const NOUN = [
  'Wolf',
  'Badger',
  'Goose',
  'Hammer',
  'Anvil',
  'Mongoose',
  'Moose',
  'Otter',
  'Falcon',
  'Viper',
  'Bison',
  'Toaster',
  'Kettle',
  'Walrus',
  'Pickle',
  'Sandwich',
  'Accountant',
  'Plumber',
  'Dentist',
  'Actuary',
  'Manager',
  'Intern',
  'Forklift',
  'Spreadsheet',
  'Taxman',
  'Commuter',
  'Barista',
  'Engineer',
  'Medic',
  'Sapper',
  'Gunner',
  'Pilot',
  'Brick',
  'Crowbar',
  'Mortar',
  'Hound',
  'Raven',
  'Heron',
  'Ferret',
  'Lynx',
  'Bear',
  'Yak',
  'Pelican',
  'Tractor',
];
const HANDLES = [
  'xX_Sn1per_Xx',
  'NoScopeNorman',
  'Kev',
  'dave',
  'Steve_IRL',
  'Pvt. Parts',
  'Mortgage Payer',
  'Standup Meeting',
  'OOO Until Monday',
  'PTO Enjoyer',
  'Per My Last Email',
  'Quarterly Review',
  'K1ngOfTheHill',
  'Zestafona Zeus',
  'Ozeti Outlaw',
  'Bakurani Bandit',
  'Valkyra Main',
  'LonestarLarry',
  'ManticoreMike',
  'ClaymoreCarl',
  'Tank Dad',
  'Heli Harold',
  'AmmoCrate',
  'HBlockHero',
  'BarbedWireBarry',
  'Gepard Gary',
  'Littlebird',
  'Wingman',
  'Sierra-6',
  'Hotel-2',
  'Oscar Mike',
  'Actual',
  'Overwatch',
  'Bravo Six',
  'Charlie',
  'Delta Dan',
  'Echo',
  'Foxtrot',
  'Tango',
];
const TAGS = ['', '', '', '', '', '[TEG] ', '[TEG] ', '[EMP] ', '[9to5] ', '[OVT] ', '[HR] ', '[WFH] ', '[DAD] '];

export function buildPlayers(count: number, seed = 1917): DemoPlayer[] {
  const r = rng(seed);
  const used = new Set<string>();
  const players: DemoPlayer[] = [];
  for (let i = 0; i < count; i++) {
    let name = '';
    for (let tries = 0; tries < 20; tries++) {
      const style = r();
      if (style < 0.12) name = pick(r, HANDLES) + (r() < 0.5 ? '' : String(Math.floor(r() * 99)));
      else if (style < 0.8) name = pick(r, PREFIX) + (r() < 0.35 ? ' ' : '') + pick(r, NOUN);
      else name = pick(r, NOUN) + String(Math.floor(r() * 9000 + 100));
      name = pick(r, TAGS) + name;
      if (!used.has(name.toLowerCase())) break;
    }
    used.add(name.toLowerCase());
    const skill = Math.min(2.6, Math.max(0.4, Math.exp(gaussian(r) * 0.38)));
    const regionRoll = r();
    players.push({
      steamId: String(76561198000000000n + BigInt(Math.floor(r() * 900_000_000) + 10_000_000)),
      name,
      skill,
      activity: Math.min(0.95, 0.04 + Math.pow(r(), 2.2) * 0.9),
      region: regionRoll < 0.46 ? 'NA' : regionRoll < 0.86 ? 'EU' : 'OCE',
      primary: weighted(
        r,
        WEAPONS.filter((w) => w.cls !== 'pistol'),
        (w) => w.weight,
      ),
      sidearm: weighted(r, SIDEARMS, (w) => w.weight),
      vehicleBias: Math.pow(r(), 3) * 0.5,
    });
  }
  return players;
}
