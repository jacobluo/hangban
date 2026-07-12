import { describe, expect, it } from 'vitest';

import { joinGeoNames } from './geonames';

const cities =
  '1795565\tShenzhen\tShenzhen\tShenzhen,Shumchun\t22.54554\t114.0683\tP\tPPLA\tCN\t\t30\t\t\t\t12528300\t\t\tAsia/Shanghai\t2024-01-01';
const aliases = [
  '1\t1795565\tzh\t深圳\t1\t0\t0\t0\t\t',
  '2\t1795565\ten\tShenzhen\t1\t0\t0\t0\t\t',
  '3\t1795565\tfr\tChenzen\t0\t0\t0\t0\t\t',
  '4\t1795565\tzh\t舊深圳\t0\t0\t0\t1\t\t',
].join('\n');

describe('joinGeoNames', () => {
  it('joins preferred Chinese and searchable English aliases', () => {
    expect(joinGeoNames(cities, aliases)).toEqual([
      expect.objectContaining({
        geonamesId: 1795565,
        name: 'Shenzhen',
        localizedName: '深圳',
        aliases: expect.arrayContaining(['Shenzhen', 'Shumchun', '深圳']),
      }),
    ]);
  });

  it('ignores unsupported languages and historic names', () => {
    const [city] = joinGeoNames(cities, aliases);
    expect(city?.aliases).not.toContain('Chenzen');
    expect(city?.aliases).not.toContain('舊深圳');
  });

  it('uses a non-historic Chinese fallback when GeoNames has no preferred flag', () => {
    const officialShenzhenAliases = [
      '7352217\t1795565\tzh\t深圳\t\t\t\t\t\t',
      '20309089\t1795565\tzh\t宝安\t\t\t\t1\t1914\t1979',
      '20309091\t1795565\tzh\t新安\t\t\t\t1\t\t1914',
    ].join('\n');

    expect(joinGeoNames(cities, officialShenzhenAliases)[0]).toMatchObject({
      localizedName: '深圳',
      aliases: expect.not.arrayContaining(['宝安', '新安']),
    });
  });
});
