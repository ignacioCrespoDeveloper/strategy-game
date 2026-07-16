// =============================================
//  names.js — Random name pools per race
//  Inspired by Total War: Warhammer III and
//  Game of Thrones (original, not direct copies).
// =============================================

var RACE_NAMES = {
  human: {
    lords: [
      'Sir Aldric Vayne',       'Lord Edwyn Crowe',       'Ser Harwin Blackmere',
      'Sir Brennan Coldwater',  'Lord Durran Ashford',    'Ser Caelan Harwick',
      'Lord Aldous Morne',      'Sir Edric Stonebridge',  'Ser Oswin Ravenswood',
      'Lord Rowan Blackthorn',  'Sir Hadwin Greystone',   'Ser Corvin Ashenhall',
      'Lord Edmund Waybrook',   'Sir Gawain Holloway',    'Ser Percival Dunmore',
      'Lord Bertram Ashgate',   'Sir Calder Ironwall',    'Ser Frederick Vane',
      'Lord Godwin Thornwall',  'Sir Harald Grimwater',   'Ser Jasper Ravenwood',
      'Lord Kevan Ashhold',     'Sir Lionel Duskwall',    'Ser Osbert Greyfall',
      'Lord Quinlan Ashwick',   'Sir Raymond Dunhall',    'Ser Roderick Coldgate',
      'Lord Stefan Ironbrook',  'Sir Theron Blackwall',   'Ser Ulric Stormgate',
      'Lord Wulfric Ashcrown',  'Sir Barnard Thorngate',  'Ser Callum Grimwall',
      'Lord Devlin Moorbrook',  'Sir Elric Ironstone',    'Ser Fredric Dungate',
      'Lord Garwin Greygate',   'Sir Hamish Stormwall',   'Ser Ingram Ashbrook',
      'Lord Joran Coldthorn',   'Sir Kendrick Moorwall',  'Ser Lewin Grimbrook',
      'Lord Maddox Irongate',   'Sir Norwin Ashfall',     'Ser Osric Blackbrook',
      'Lord Renwick Coldwall',  'Sir Aldwyn Dunmere',     'Ser Bastian Greymantle',
      'Lord Corwin Ashvale',    'Sir Hadrick Stormwood',
    ],
    cities: [
      'Ashford',     'Coldwater',  'Dunwall',     'Ravenswood',  'Irongate',
      'Greystone',   'Blackmere',  'Stormreach',  'Thornwall',   'Coldbrook',
      'Moorwatch',   'Ashenvale',  'Dunmore',     'Grimwater',   'Waybrook',
      'Ironwood',    'Blackthorn', 'Coldgate',    'Ashwick',     'Stonebridge',
    ],
  },

  dwarf: {
    lords: [
      'Grimli Ironmantle',    'Borin Stonefist',      'Thorgrim Grudgebearer',
      'Ungrim Hammerfall',    'Snorri Copperbeard',   'Burlok Runevault',
      'Kadrin Redmane',       'Thorek Ironbrow',      'Gotrek Axeling',
      'Brok Deepdelve',       'Duregar Copperhelm',   'Kragg Hammerkin',
      'Belegar Ironback',     'Norgrim Deeprock',     'Skalf Grimforge',
      'Thorarin Ironfall',    'Angrund Firemantle',   'Bryndar Copperstone',
      'Garrak Deepvein',      'Helgar Stonecrown',    'Jarnit Ironbreaker',
      'Kararak Deepvault',    'Mordin Copperfall',    'Norrek Ironvein',
      'Barak Stonehelm',      'Drudin Deepforge',     'Durgrim Ironstone',
      'Grimnir Hammerstone',  'Grundar Deephelm',     'Hargrim Ironrock',
      'Ingrak Copperstone',   'Jorik Hammervault',    'Kildrak Deepstone',
      'Ludrak Ironmantle',    'Norgald Deepcrown',    'Oldrak Ironbrow',
      'Pebrak Stonepath',     'Rordrak Copperforge',  'Saltrak Hammerhelm',
      'Tordrak Deepreach',    'Ulfrak Irongate',      'Vordrak Stonefall',
      'Wardrak Deepmantle',   'Xaldrak Copperback',   'Yordrak Ironforge',
      'Zaldrak Stonecrown',   'Bromrak Deepvault',    'Cymrak Hammerfall',
      'Dorsrak Ironhelm',     'Embrak Copperstone',
    ],
    cities: [
      'Karaz-Tor',    'Ironhold',     'Deepforge',    'Coppergate',  'Stonepeak',
      'Hammerfall',   'Grimvault',    'Runeforge',    'Copperhelm',  'Deepcrown',
      'Anvilrock',    'Ironmantle',   'Stonepath',    'Copperfall',  'Deepvein',
      'Hammerstone',  'Grimreach',    'Runevault',    'Irongate',    'Deepstone',
    ],
  },

  orc: {
    lords: [
      'Gorakh Bloodfang',      'Urgath Ironjaw',        'Skragath Headsmasha',
      'Grimtusk Warboss',      'Krakk Boulderfist',     'Dragg Bonecruncha',
      'Warbrak Skulltaker',    'Skaragh Gorespatter',   'Grommak Teefgrinna',
      'Rakash Ironhide',       'Gorlag Skarsnout',      'Kratash Waaghbringer',
      'Skullkrak Bonestompa',  'Dragnash Blooddrinker', 'Skarnak Ironteef',
      'Graknak Boulderbasha',  'Raktusk Gorefist',      'Gornak Skullhamma',
      'Kratnash Ironbelly',    'Skragnak Bloodbasha',   'Drakkash Stonefist',
      'Warkrak Gorechompa',    'Skarnash Bonekrusha',   'Gromjaw Teefbasha',
      'Gortusk Skarface',      'Kraknash Gorespatta',   'Skragbash Waaghboss',
      'Draktusk Bonesplitter', 'Warnash Ironchompa',    'Skaknash Bloodgrunta',
      'Gronkrak Gorebella',    'Raktash Bonehamma',     'Gorjaw Skarsnout',
      'Kragnash Ironteef',     'Skragkrak Gorefist',    'Drakjaw Boulderbasha',
      'Warnak Skullgrunta',    'Gromtusk Bonesplitter', 'Rakjaw Gorehamma',
      'Gortash Skarface',      'Krakhide Ironkrusha',   'Skragtusk Bloodbelly',
      'Draknak Gorespatta',    'Skangash Bonekrusha',   'Grombash Waaghbringer',
      'Gorzag Ironsmasha',     'Urgzob Skullkrak',      'Bolagrak Bonefist',
      'Skardreg Bloodhide',    'Gragnash Ironchompa',
    ],
    cities: [
      'Grimkrump',   'Skarhold',    'Bonekrak',    'Ironsnout',   'Bloodfang',
      'Waaghfort',   'Skullmire',   'Gorehaven',   'Ironteef',    'Bonesmash',
      'Skraghold',   'Bloodkrak',   'Ironjaw',     'Gorespat',    'Skargrunt',
      'Bonekrusha',  'Waaghcamp',   'Skullkrak',   'Ironhide',    'Gorebella',
    ],
  },

  high_elf: {
    lords: [
      'Aelarion Silverwind',    'Caelindra Moonveil',     'Tyriel Starborn',
      'Elindor Dawnweaver',     'Aeltharion Greatsword',  'Corelion Sunfire',
      'Velandriel Highcrown',   'Thalandor Stormcloak',   'Seladris Evenstar',
      'Aelyrian Goldweave',     'Caeldris Swiftblade',    'Veltharion Seafarer',
      'Eladris Silverbrow',     'Thaladriel Farwind',     'Aelorian Brightflame',
      'Sorviel Highmantle',     'Mirethal Goldenspire',   'Faerion Swiftarrow',
      'Lorindel Silverleaf',    'Daelion Morningstar',    'Celaen Windborn',
      'Arenthal Highgate',      'Telvandrel Moonborn',    'Seravien Goldenwind',
      'Alindor Starblade',      'Velithar Seafoam',       'Aeldris Sunmantle',
      'Caelorian Brightblade',  'Sorindel Starweave',     'Faelion Swiftwind',
      'Mirindra Moonfire',      'Daelindra Goldenmere',   'Lorian Highspire',
      'Telvion Silverborn',     'Celaelion Windfire',     'Arethal Morningveil',
      'Velindor Seafarer',      'Aelithar Dawnblade',     'Caerviel Starbrow',
      'Sordaliel Highborn',     'Faelorian Moonweave',    'Mirandel Goldenleaf',
      'Daethal Windspire',      'Lorindra Silverblade',   'Telvandor Morningfire',
      'Celaindra Moonmantle',   'Arenthal Swiftstar',     'Veliadriel Seaflame',
      'Aeldarion Brightborn',   'Caeltharion Dawnspire',
    ],
    cities: [
      'Tor Aelindra',  'Silverbay',    'Moonspire',   'Dawnhaven',   'Highcrown',
      'Evenstar',      'Goldenveil',   'Silverwind',  'Moontower',   'Dawnreach',
      'Brightspire',   'Seafoam',      'Goldenmere',  'Windborn',    'Starblade',
      'Highmantle',    'Moonfire',     'Dawnweave',   'Silverleaf',  'Goldenspire',
    ],
  },

  dark_elf: {
    lords: [
      'Malketh Shadowbane',    'Xelindra Deathweave',   'Darkoth Bloodthorn',
      'Hellebron Cursed',      'Tullaris Dreadbringer', 'Malindra Boneweave',
      'Xeloth Darkmantle',     'Drakar Shadowfang',     'Helkith Bloodveil',
      'Norskai Nightweave',    'Sorveth Darkborn',      'Valkira Deathmantle',
      'Malkira Shadowrend',    'Xeldris Bloodthorn',    'Heldrith Deathborne',
      'Tulkar Shadowblade',    'Malveth Darkweave',     'Norsvel Bloodborn',
      'Sordrith Nightmantle',  'Valketh Shadowfang',    'Maldris Deathweave',
      'Xeloth Darkrune',       'Drakith Bloodveil',     'Helkira Nightborn',
      'Norskai Shadowmantle',  'Sorveth Deathblade',    'Valkira Darkweave',
      'Malvira Bloodthorn',    'Xeldoth Nightfang',     'Darketh Shadowrend',
      'Heldris Deathborne',    'Tulkira Bloodmantle',   'Maldoth Nightweave',
      'Norsveth Shadowborn',   'Sordris Darkfang',      'Valkoth Deathmantle',
      'Malkira Bloodweave',    'Xelveth Nightrend',     'Drakira Shadowthorn',
      'Heldroth Deathveil',    'Tulveth Darkborn',      'Maldrith Bloodfang',
      'Norskirel Nightmantle', 'Sorvira Shadowweave',   'Valkdrith Deathborn',
      'Maldveth Darkrune',     'Xelkira Bloodblade',    'Drakoth Nightfang',
      'Helvorith Shadowveil',  'Tulketh Deathrune',
    ],
    cities: [
      'Naggarond',     'Shadowport',   'Bloodspire',   'Darkmantle',  'Nightveil',
      'Deathwatch',    'Shadowhaven',  'Bloodthorn',   'Darkrend',    'Nightborn',
      'Deathspire',    'Shadowrend',   'Bloodveil',    'Darkweave',   'Nightmantle',
      'Deathhaven',    'Shadowbane',   'Bloodborn',    'Darkfang',    'Nightweave',
    ],
  },
};

function randomRaceName(raceId, type) {
  const pool = RACE_NAMES[raceId]?.[type];
  if (!pool || pool.length === 0) return '';
  return pool[Math.floor(Math.random() * pool.length)];
}
