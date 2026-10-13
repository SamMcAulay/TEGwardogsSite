import { describe, expect, test } from 'vitest';
import { classKills, weaponClass } from './weapon-classes';

describe('weapon classes', () => {
  test('known weapons are classed whatever their case; unknown and vehicle ones are not', () => {
    expect(weaponClass('Id.Item.WEPN_029')).toBe('assault'); // Galil
    expect(weaponClass('id.item.mosin')).toBe('sniper');
    expect(weaponClass('Id.Item.SVDM')).toBe('marksman');
    expect(weaponClass('Id.Item.WEPN_030')).toBeNull();
    expect(weaponClass('Id.Vehicle.WeaponExtension.TNK_01.Artillery')).toBeNull();
  });

  test('kills add up per class, and every class is present', () => {
    const k = classKills([
      { cause: 'Id.Item.M4', kills: 10 },
      { cause: 'Id.Item.AK74M', kills: 5 },
      { cause: 'Id.Item.M67Grenade', kills: 2 },
      { cause: 'Id.Item.WEPN_030', kills: 99 },
    ]);
    expect(k).toEqual({ assault: 15, smg: 0, sniper: 0, marksman: 0, lmg: 0, shotgun: 0, pistol: 0, explosive: 2 });
  });
});
