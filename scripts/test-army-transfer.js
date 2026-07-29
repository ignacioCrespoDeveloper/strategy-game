// =============================================================
//  scripts/test-army-transfer.js
//
//  Fast, in-process unit tests for the troop-exchange stack math
//  (server/army-transfer-core.js) behind POST /api/army/transfer.
//  The core is deliberately import-free, so this needs no server,
//  no Supabase and no engine-loader — it runs in well under 1s.
//
//  USAGE   node scripts/test-army-transfer.js
//
//  The endpoint's validation layer (same-tile, downed/busy/stanced
//  lords, PWR caps, legendary gate) is NOT covered here — see
//  "Known gap" in TESTING.md for the planned integration scenario.
// =============================================================

import { applyExchange } from '../server/army-transfer-core.js';

let failures = 0;

function section(name) { console.log(`\n── ${name} ──────────────`); }
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else      { console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); failures++; }
}
function stack(units, id) { return units.find(u => u.unitId === id); }

section('Basic moves');
{
  const r = applyExchange([{ unitId: 'spear', count: 5 }], [], [{ unitId: 'spear', count: 2 }], []);
  check('one-way move accepted', r.ok);
  check('source keeps the rest', stack(r.unitsA, 'spear').count === 3);
  check('destination receives the moved models', stack(r.unitsB, 'spear').count === 2);
  check('moved models arrive fresh', stack(r.unitsB, 'spear').currentHp === undefined);
}
{
  const r = applyExchange(
    [{ unitId: 'spear', count: 2 }],
    [{ unitId: 'spear', count: 3 }],
    [{ unitId: 'spear', count: 2 }],
    [{ unitId: 'spear', count: 3 }]);
  check('same-unit two-way swap accepted', r.ok);
  check('swap: A ends with 3', stack(r.unitsA, 'spear').count === 3);
  check('swap: B ends with 2', stack(r.unitsB, 'spear').count === 2);
}
{
  const r = applyExchange([{ unitId: 'spear', count: 5 }], [],
    [{ unitId: 'spear', count: 2 }, { unitId: 'spear', count: 2 }], []);
  check('duplicate move rows aggregate', r.ok && stack(r.unitsB, 'spear').count === 4);
}

section('Damaged front models');
{
  const r = applyExchange([{ unitId: 'spear', count: 5, currentHp: 10 }], [], [{ unitId: 'spear', count: 2 }], []);
  check('partial move leaves the wounded model behind', stack(r.unitsA, 'spear').currentHp === 10);
  check('partial move sends only fresh models', stack(r.unitsB, 'spear').currentHp == null);
}
{
  const r = applyExchange([{ unitId: 'spear', count: 5, currentHp: 10 }], [], [{ unitId: 'spear', count: 2, damaged: true }], []);
  check('damaged:true takes the wounded model along', stack(r.unitsB, 'spear').currentHp === 10);
  check('damaged:true leaves the source fresh', stack(r.unitsA, 'spear').currentHp == null);
}
{
  const r = applyExchange([{ unitId: 'spear', count: 3, currentHp: 7 }], [], [{ unitId: 'spear', count: 3 }], []);
  check('whole-stack move empties the source', stack(r.unitsA, 'spear') === undefined);
  check('whole-stack move always carries the wound', stack(r.unitsB, 'spear').currentHp === 7);
}
{
  const r = applyExchange(
    [{ unitId: 'spear', count: 3, currentHp: 4 }],
    [{ unitId: 'spear', count: 2, currentHp: 9 }],
    [{ unitId: 'spear', count: 3 }], []);
  check('merging two wounded stacks keeps the LOWER hp', stack(r.unitsB, 'spear').currentHp === 4);
  check('merging sums the counts', stack(r.unitsB, 'spear').count === 5);
}
{
  const r = applyExchange(
    [{ unitId: 'spear', count: 3 }],
    [{ unitId: 'spear', count: 2, currentHp: 9 }],
    [{ unitId: 'spear', count: 2 }], []);
  check('fresh models merging in never wash existing damage', stack(r.unitsB, 'spear').currentHp === 9);
}

section('Rejections');
{
  const a = [{ unitId: 'spear', count: 2 }];
  const r = applyExchange(a, [], [{ unitId: 'spear', count: 5 }], []);
  check('over-transfer rejected', !r.ok && typeof r.error === 'string');
  check('rejection leaves inputs untouched', a[0].count === 2);
}
check('unknown unit rejected', !applyExchange([], [], [{ unitId: 'ghost', count: 1 }], []).ok);
check('zero count rejected', !applyExchange([{ unitId: 'spear', count: 2 }], [], [{ unitId: 'spear', count: 0 }], []).ok);
check('negative count rejected', !applyExchange([{ unitId: 'spear', count: 2 }], [], [{ unitId: 'spear', count: -1 }], []).ok);
check('fractional count rejected', !applyExchange([{ unitId: 'spear', count: 2 }], [], [{ unitId: 'spear', count: 1.5 }], []).ok);
check('duplicate rows cannot overdraw in aggregate',
  !applyExchange([{ unitId: 'spear', count: 3 }], [],
    [{ unitId: 'spear', count: 2 }, { unitId: 'spear', count: 2 }], []).ok);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
