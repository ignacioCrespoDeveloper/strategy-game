// =============================================
//  data.js — static game data definitions
// =============================================

const TERRAIN_DEF = {
  plains:   { color: '#2e4a22', border: '#3a6028', label: 'Plains',   move: 1 },
  forest:   { color: '#183018', border: '#20401e', label: 'Forest',   move: 2 },
  mountain: { color: '#4a3e2e', border: '#665540', label: 'Mountain', move: 3 },
  water:    { color: '#0e2840', border: '#1a3a58', label: 'Water',    move: 99 },
  desert:   { color: '#5a4a20', border: '#7a6428', label: 'Desert',   move: 2 },
};

const RESOURCE_DEF = {
  gold: { icon: '💰', color: '#f0c040', label: 'Gold Mine',      income: 2 },
  iron: { icon: '⚙️', color: '#90a8b8', label: 'Iron Deposit',   income: 1 },
  food: { icon: '🌾', color: '#88cc44', label: 'Fertile Fields', income: 2 },
  wood: { icon: '🌲', color: '#b87830', label: 'Lumber Camp',    income: 1 },
};

// ── City size levels (pop-driven, no branches) ─────────────────────
// Cities start as Aldea and grow automatically via population.
// slots   = max building slots (Ayuntamiento always occupies 1)
// influence = hex radius of territory control
const CITY_TYPES = {
  aldea: {
    name: 'Aldea', tier: 0, icon: '🏘️',
    hp: 100, slots: 2, influence: 0,
    popMin: 0,
    income: { gold: 2, food: 1 },
    desc: 'Pequeño asentamiento inicial.',
  },
  pueblo: {
    name: 'Pueblo', tier: 1, icon: '🏙️',
    hp: 150, slots: 3, influence: 1,
    popMin: 200,
    income: { gold: 4, food: 2 },
    desc: 'Asentamiento en crecimiento. Radio 1 hex.',
  },
  ciudad: {
    name: 'Ciudad', tier: 2, icon: '🌆',
    hp: 220, slots: 5, influence: 2,
    popMin: 500,
    income: { gold: 8, food: 4 },
    desc: 'Próspera ciudad. Radio 2 hexes.',
  },
  gran_ciudad: {
    name: 'Gran Ciudad', tier: 3, icon: '🌇',
    hp: 350, slots: 6, influence: 3,
    popMin: 1000,
    income: { gold: 16, food: 8 },
    desc: 'Metrópolis. Centro de poder regional.',
  },
};

// Ordered list for level-up checks (lowest → highest)
const POP_LEVELS = [
  { type: 'aldea',      minPop: 0    },
  { type: 'pueblo',     minPop: 200  },
  { type: 'ciudad',     minPop: 500  },
  { type: 'gran_ciudad', minPop: 1000 },
];

// Unit types
const UNIT_TYPES = {
  // ── Reclutable en cualquier lugar ─────────────────────
  militia: {
    name: 'Milicia', icon: '🪓', img: null,
    hp: 50, atk: 20, def: 15, moves: 2, sight: 2,
    cost: { gold: 15 },
    maintenance: { gold: 1 },
    abilities: ['Melee', 'Levy'],
    desc: 'Campesinos armados. Bajo coste, bajo rendimiento.',
    trainTime: 0, mercenary: false,
  },

  // ── Mercenarios (fuera/dentro de ciudad) ──────────────
  merc_inf: {
    name: 'Mercenario Inf.', icon: '🗡️', img: null,
    hp: 85, atk: 38, def: 28, moves: 2, sight: 2,
    cost: { gold: 70 },
    maintenance: { gold: 4 },
    abilities: ['Melee', 'Mercenario'],
    desc: 'Infantería mercenaria. Cara pero disponible en cualquier lugar.',
    trainTime: 0, mercenary: true,
  },
  merc_arch: {
    name: 'Mercenario Arq.', icon: '🏹', img: null,
    hp: 60, atk: 45, def: 12, moves: 2, sight: 3,
    cost: { gold: 80 },
    maintenance: { gold: 5 },
    abilities: ['Ranged', 'Mercenario'],
    desc: 'Arqueros mercenarios. Buenos sin necesidad de cuarteles.',
    trainTime: 0, mercenary: true,
  },
  merc_cav: {
    name: 'Mercenario Cab.', icon: '🐎', img: null,
    hp: 65, atk: 30, def: 18, moves: 4, sight: 4,
    cost: { gold: 100 },
    maintenance: { gold: 6 },
    abilities: ['Fast', 'Mercenario'],
    desc: 'Caballería ligera de alquiler. Veloz y siempre disponible.',
    trainTime: 0, mercenary: true,
  },

  // ── Unidades entrenables en ciudad ────────────────────
  warrior: {
    name: 'Infantería', icon: '⚔️', img: 'infanteria',
    hp: 100, atk: 40, def: 30, moves: 2, sight: 2,
    cost: { gold: 30, food: 10 },
    maintenance: { gold: 2, food: 1 },
    abilities: ['Melee', 'Fortify'],
    desc: 'Soldado de línea confiable. Columna vertebral del ejército.',
    trainTime: 1,
  },
  archer: {
    name: 'Hondero', icon: '🏹', img: 'honderos',
    hp: 70, atk: 50, def: 15, moves: 2, sight: 3,
    cost: { gold: 40, wood: 10 },
    maintenance: { gold: 3, food: 1 },
    abilities: ['Ranged', 'High Ground'],
    desc: 'Hostigador a distancia con buen campo de visión.',
    trainTime: 1,
  },
  scout: {
    name: 'Caballería', icon: '🐎', img: 'caballeria',
    hp: 60, atk: 20, def: 10, moves: 4, sight: 4,
    cost: { gold: 20, food: 20 },
    maintenance: { gold: 1, food: 2 },
    abilities: ['Fast', 'Recon'],
    desc: 'Explorador veloz. Bajo poder de combate.',
    trainTime: 1,
  },
  knight: {
    name: 'Caballero', icon: '🛡️', img: 'caballeria',
    hp: 140, atk: 55, def: 60, moves: 3, sight: 2,
    cost: { gold: 80, iron: 30 },
    maintenance: { gold: 5, iron: 1 },
    abilities: ['Heavy', 'Charge', 'Fortify'],
    desc: 'Caballería pesada de élite. Carga devastadora.',
    trainTime: 2,
  },
  catapult: {
    name: 'Catapulta', icon: '💥', img: null,
    hp: 50, atk: 80, def: 5, moves: 1, sight: 3,
    cost: { gold: 60, wood: 40, iron: 10 },
    maintenance: { gold: 4, wood: 1 },
    abilities: ['Siege', 'Slow'],
    desc: 'Devastadora contra ciudades y muros.',
    trainTime: 2,
  },
  spearman: {
    name: 'Piquero', icon: '🗡️', img: 'piqueros',
    hp: 90, atk: 35, def: 50, moves: 2, sight: 2,
    cost: { gold: 35, iron: 10 },
    maintenance: { gold: 2, food: 1 },
    abilities: ['Pica', 'Anti-Caballería'],
    desc: 'Especialista defensivo. Muy efectivo contra caballería.',
    trainTime: 1,
  },
};

// Unit types always available for recruitment regardless of city buildings
const ALWAYS_RECRUITABLE = ['militia', 'merc_inf', 'merc_arch', 'merc_cav'];

// ── Building tree ───────────────────────────────────────────────────
// Each building has:
//   bonus[i]       = resource/population bonuses when at level i+1
//   hpBonus[i]     = city HP added at level i+1 (defense buildings)
//   upgradesFrom   = parent building key that this REPLACES (same slot)
//   upgradesTo     = array of child building keys available after this
//   terrainReq     = 'coast'|'mountain'|'forest'|'plains' needed in influence radius
//   popReq         = minimum city population required to build
//   fixed          = always present (Ayuntamiento), cannot be manually built/removed
//   trains         = { level: [unitType, ...] } units unlocked at each level
//   buildTime      = turns to complete construction
//   maintenance    = { resource: amount } cost per turn while built
//
// Slot rules:
//   - Building new root building uses 1 slot
//   - Building upgradesFrom=X replaces X (0 net slots)
//   - Leveling up same building uses 0 slots
const BUILDING_TYPES = {

  // ── CIVIL ─────────────────────────────────────────────────────
  town_hall: {
    name: 'Ayuntamiento', icon: '🏛️', img: 'village_3', category: 'civil',
    fixed: true,
    cost: [], maxLevel: 1,
    upgradesTo: ['plaza', 'tribunal'],
    buildTime: 0,
    maintenance: {},
    bonus: [{}],
    effect: ['Centro administrativo. Slot fijo.'],
    desc: 'Sede del gobierno. Siempre presente desde el inicio.',
  },
  plaza: {
    name: 'Plaza Pública', icon: '🏟️', img: 'village_1', category: 'civil',
    upgradesFrom: 'town_hall',
    cost: [{ gold: 50, wood: 20 }], maxLevel: 1,
    upgradesTo: ['university'],
    buildTime: 2,
    maintenance: { gold: 1 },
    bonus: [{ pop: 3, gold: 1 }],
    effect: ['+3 pop/t, +1 💰/t'],
    desc: 'Centro social. Atrae y retiene población.',
  },
  tribunal: {
    name: 'Tribunal', icon: '⚖️', img: 'religion_2', category: 'civil',
    upgradesFrom: 'town_hall',
    cost: [{ gold: 80, wood: 25 }], maxLevel: 1,
    upgradesTo: ['senate'],
    buildTime: 2,
    maintenance: { gold: 1 },
    bonus: [{ gold: 1 }],
    effect: ['Reduce corrupción, -10% costo edificios'],
    desc: 'Administración de justicia y eficiencia gubernamental.',
  },
  university: {
    name: 'Universidad', icon: '🎓', img: 'religion_3', category: 'civil',
    upgradesFrom: 'plaza',
    cost: [{ gold: 200, wood: 60 }], maxLevel: 1,
    popReq: 500,
    buildTime: 3,
    maintenance: { gold: 2 },
    bonus: [{ gold: 2, food: 1 }],
    effect: ['+1 Investigación/t, +2 💰/t'],
    desc: 'Centro del saber. Requiere 500 hab.',
  },
  senate: {
    name: 'Senado', icon: '🏛️', img: 'religion_4', category: 'civil',
    upgradesFrom: 'tribunal',
    cost: [{ gold: 250, wood: 80 }], maxLevel: 1,
    popReq: 700,
    buildTime: 3,
    maintenance: { gold: 2 },
    bonus: [{ gold: 3 }],
    effect: ['Decretos globales, +3 💰/t'],
    desc: 'Asamblea de gobierno. Requiere 700 hab.',
  },

  // ── MILITARY ──────────────────────────────────────────────────
  barracks: {
    name: 'Barracas', icon: '⚔️', img: 'barracks_1', category: 'military',
    cost: [{ gold: 50, wood: 20 }], maxLevel: 1,
    upgradesTo: ['barracks_inf', 'barracks_arch', 'barracks_cav'],
    buildTime: 2,
    maintenance: { food: 1 },
    bonus: [{}],
    trains: { 1: ['warrior', 'spearman', 'scout'] },
    effect: ['Entrena Guerreros, Piqueros, Caballería ligera'],
    desc: 'Instalación básica de entrenamiento militar.',
  },
  barracks_inf: {
    name: 'Bar. Infantería', icon: '🗡️', img: 'barracks_2', category: 'military',
    upgradesFrom: 'barracks',
    cost: [{ gold: 80, iron: 30 }, { gold: 200, iron: 70 }], maxLevel: 2,
    upgradesTo: ['elite_barracks', 'combat_academy'],
    buildTime: 2,
    maintenance: { food: 1, iron: 1 },
    bonus: [{}, {}],
    trains: { 1: ['warrior', 'spearman'], 2: ['warrior', 'spearman', 'knight'] },
    effect: ['Entrena Guerreros y Piqueros', '+Caballeros (Inf. Pesada)'],
    desc: 'Especializada en infantería pesada.',
  },
  barracks_arch: {
    name: 'Bar. Arqueros', icon: '🏹', img: 'archery_range_1', category: 'military',
    upgradesFrom: 'barracks',
    cost: [{ gold: 70, wood: 30 }, { gold: 180, wood: 60 }], maxLevel: 2,
    upgradesTo: ['archer_tower'],
    buildTime: 2,
    maintenance: { food: 1, wood: 1 },
    bonus: [{}, {}],
    trains: { 1: ['archer'], 2: ['archer'] },
    effect: ['Entrena Honderos', '+Rango armas distancia'],
    desc: 'Especializada en unidades a distancia.',
  },
  barracks_cav: {
    name: 'Caballeriza', icon: '🐎', img: 'stable_2', category: 'military',
    upgradesFrom: 'barracks',
    terrainReq: 'plains',
    cost: [{ gold: 90, food: 40 }, { gold: 220, food: 80 }], maxLevel: 2,
    upgradesTo: ['royal_stable'],
    buildTime: 2,
    maintenance: { food: 2 },
    bonus: [{}, {}],
    trains: { 1: ['scout'], 2: ['scout', 'knight'] },
    effect: ['Entrena Caballería', '+Caballería Pesada'],
    desc: 'Cría y entrena caballos. Requiere llanuras en radio.',
  },
  elite_barracks: {
    name: 'Cuartel Élite', icon: '🛡️', img: 'barracks_3', category: 'military',
    upgradesFrom: 'barracks_inf',
    cost: [{ gold: 250, iron: 80 }], maxLevel: 1,
    buildTime: 3,
    maintenance: { food: 2, iron: 1 },
    bonus: [{}],
    trains: { 1: ['warrior', 'spearman', 'knight', 'catapult'] },
    effect: ['Entrena Catapultas. Unidades +15 XP inicial'],
    desc: 'Instalación de élite para veteranos.',
  },
  combat_academy: {
    name: 'Academia', icon: '📚', img: 'tournaments_1', category: 'military',
    upgradesFrom: 'barracks_inf',
    cost: [{ gold: 200, wood: 50 }], maxLevel: 1,
    buildTime: 3,
    maintenance: { gold: 1, food: 1 },
    bonus: [{ gold: 1 }],
    trains: { 1: ['warrior', 'spearman', 'knight'] },
    effect: ['Unidades +20 XP inicial, +1 💰/t'],
    desc: 'Academia de combate. Forma guerreros excepcionales.',
  },
  archer_tower: {
    name: 'Torre Arqueros', icon: '🗼', img: 'archery_range_3', category: 'military',
    upgradesFrom: 'barracks_arch',
    cost: [{ gold: 220, iron: 40, wood: 40 }], maxLevel: 1,
    buildTime: 3,
    maintenance: { iron: 1 },
    bonus: [{}],
    trains: { 1: ['archer', 'catapult'] },
    effect: ['Defiende ciudad automáticamente. Entrena Catapultas'],
    desc: 'Torre de guardia y defensa a distancia.',
  },
  royal_stable: {
    name: 'Real Caballeriza', icon: '🏇', img: 'stable_3', category: 'military',
    upgradesFrom: 'barracks_cav',
    cost: [{ gold: 280, food: 100 }], maxLevel: 1,
    buildTime: 3,
    maintenance: { food: 3 },
    bonus: [{}],
    trains: { 1: ['scout', 'knight'] },
    effect: ['Caballería -25% costo. Caballeros élite'],
    desc: 'La mejor cría de caballos del reino.',
  },

  // ── DEFENSE ──────────────────────────────────────────────────
  walls: {
    name: 'Muralla', icon: '🧱', img: 'capital_1', category: 'defense',
    cost: [{ gold: 80, iron: 20 }], maxLevel: 1,
    upgradesTo: ['walls_reinforced', 'moat'],
    buildTime: 2,
    maintenance: { iron: 1 },
    hpBonus: [50],
    bonus: [{}],
    effect: ['+50 HP ciudad'],
    desc: 'Murallas de piedra que protegen la ciudad.',
  },
  walls_reinforced: {
    name: 'Muralla Reforzada', icon: '🏰', img: 'capital_2', category: 'defense',
    upgradesFrom: 'walls',
    cost: [{ gold: 180, iron: 60 }, { gold: 380, iron: 130 }], maxLevel: 2,
    upgradesTo: ['fortress'],
    buildTime: 2,
    maintenance: { iron: 2 },
    hpBonus: [100, 200],
    bonus: [{}, {}],
    effect: ['+100 HP ciudad', '+200 HP, guarnición automática'],
    desc: 'Reforzadas con torreones y merlones.',
  },
  moat: {
    name: 'Foso', icon: '💧', category: 'defense',
    upgradesFrom: 'walls',
    cost: [{ gold: 120, wood: 40 }], maxLevel: 1,
    buildTime: 1,
    maintenance: { wood: 1 },
    hpBonus: [30],
    bonus: [{}],
    effect: ['+30 HP, atacantes gastan +1 movimiento'],
    desc: 'Foso de agua alrededor de la ciudad.',
  },
  fortress: {
    name: 'Fortaleza', icon: '🏯', img: 'capital_4', category: 'defense',
    upgradesFrom: 'walls_reinforced',
    cost: [{ gold: 480, iron: 200 }], maxLevel: 1,
    buildTime: 3,
    maintenance: { iron: 2, gold: 1 },
    hpBonus: [300],
    bonus: [{}],
    effect: ['+300 HP, guarnición permanente, daño a sitiadores'],
    desc: 'Bastión inexpugnable. La mayor defensa posible.',
  },

  // ── FOOD ────────────────────────────────────────────────────
  farm: {
    name: 'Granja', icon: '🌱', category: 'food',
    cost: [{ gold: 30, wood: 20 }], maxLevel: 1,
    upgradesTo: ['irrigation', 'ganaderia'],
    buildTime: 1,
    maintenance: {},
    bonus: [{ pop: 3, food: 3 }],
    effect: ['+3 pop/t, +3 🌾/t'],
    desc: 'Cultivos básicos. Primera fuente de alimentos.',
  },
  irrigation: {
    name: 'Campo de Riego', icon: '🌿', category: 'food',
    upgradesFrom: 'farm',
    terrainReq: 'plains',
    cost: [{ gold: 80, food: 20 }, { gold: 200, food: 40 }], maxLevel: 2,
    upgradesTo: ['central_granary'],
    buildTime: 2,
    maintenance: { gold: 1 },
    bonus: [{ pop: 7, food: 6 }, { pop: 13, food: 10 }],
    effect: ['+7 pop/t, +6 🌾/t', '+13 pop/t, +10 🌾/t'],
    desc: 'Sistema de riego. Requiere llanura en radio.',
  },
  ganaderia: {
    name: 'Ganadería', icon: '🐄', img: 'stable_1', category: 'food',
    upgradesFrom: 'farm',
    cost: [{ gold: 60, food: 15 }, { gold: 150, food: 30 }], maxLevel: 2,
    buildTime: 1,
    maintenance: {},
    bonus: [{ pop: 5, food: 4 }, { pop: 9, food: 6 }],
    effect: ['+5 pop/t, +4 🌾/t', '+9 pop/t, +6 🌾/t'],
    desc: 'Cría de ganado. Fuente alimentaria diversa.',
  },
  central_granary: {
    name: 'Granero Central', icon: '🌾', category: 'food',
    upgradesFrom: 'irrigation',
    cost: [{ gold: 180, food: 60 }], maxLevel: 1,
    buildTime: 2,
    maintenance: { gold: 1 },
    bonus: [{ pop: 5, food: 5 }],
    effect: ['+5 pop/t, +5 🌾/t, inmune a hambruna'],
    desc: 'Reserva masiva. Ciudades cercanas no pasan hambre.',
  },

  // ── INDUSTRY ─────────────────────────────────────────────────
  mine: {
    name: 'Mina', icon: '⛏️', category: 'industry',
    terrainReq: 'mountain',
    cost: [{ gold: 60, wood: 30 }], maxLevel: 1,
    upgradesTo: ['mine_iron', 'mine_gold'],
    buildTime: 2,
    maintenance: { food: 1 },
    bonus: [{ iron: 1 }],
    effect: ['+1 ⚙️/t'],
    desc: 'Requiere montaña en radio. Extrae minerales.',
  },
  mine_iron: {
    name: 'Mina de Hierro', icon: '🔩', img: 'blacksmith_1', category: 'industry',
    upgradesFrom: 'mine',
    cost: [{ gold: 100, iron: 10 }, { gold: 240, iron: 30 }], maxLevel: 2,
    upgradesTo: ['forge'],
    buildTime: 2,
    maintenance: { food: 1 },
    bonus: [{ iron: 2 }, { iron: 3 }],
    effect: ['+2 ⚙️/t', '+3 ⚙️/t'],
    desc: 'Especializada en extracción de hierro.',
  },
  mine_gold: {
    name: 'Mina de Oro', icon: '⭐', category: 'industry',
    upgradesFrom: 'mine',
    cost: [{ gold: 80 }, { gold: 200 }], maxLevel: 2,
    buildTime: 2,
    maintenance: { gold: 1 },
    bonus: [{ gold: 4 }, { gold: 7 }],
    effect: ['+4 💰/t', '+7 💰/t'],
    desc: 'Extrae valiosos filones de oro.',
  },
  forge: {
    name: 'Forja', icon: '🔨', img: 'blacksmith_3', category: 'industry',
    upgradesFrom: 'mine_iron',
    cost: [{ gold: 140, iron: 30 }, { gold: 300, iron: 70 }], maxLevel: 2,
    buildTime: 3,
    maintenance: { food: 1, wood: 1 },
    bonus: [{ iron: 2 }, { iron: 3 }],
    effect: ['+2 ⚙️/t, unidades +5 ATK', '+3 ⚙️/t, unidades +10 ATK'],
    desc: 'Funde hierro para armas y armaduras.',
  },
  lumber_camp: {
    name: 'Leñador', icon: '🌲', category: 'industry',
    terrainReq: 'forest',
    cost: [{ gold: 40, food: 10 }], maxLevel: 1,
    upgradesTo: ['sawmill'],
    buildTime: 1,
    maintenance: {},
    bonus: [{ wood: 2 }],
    effect: ['+2 🌲/t'],
    desc: 'Requiere bosque en radio. Extrae madera.',
  },
  sawmill: {
    name: 'Aserradero', icon: '🪚', img: 'workshop_1', category: 'industry',
    upgradesFrom: 'lumber_camp',
    cost: [{ gold: 80, wood: 20 }, { gold: 180, wood: 50 }], maxLevel: 2,
    buildTime: 2,
    maintenance: { food: 1 },
    bonus: [{ wood: 3 }, { wood: 5 }],
    effect: ['+3 🌲/t', '+5 🌲/t'],
    desc: 'Procesa madera con mayor eficiencia.',
  },

  // ── ECONOMY ──────────────────────────────────────────────────
  market: {
    name: 'Mercado', icon: '🏪', img: 'workshop_1', category: 'economy',
    cost: [{ gold: 40, wood: 15 }], maxLevel: 1,
    upgradesTo: ['bazaar'],
    buildTime: 1,
    maintenance: {},
    bonus: [{ gold: 3 }],
    effect: ['+3 💰/t'],
    desc: 'Comercio local. Genera ingresos de oro.',
  },
  bazaar: {
    name: 'Bazar', icon: '🛍️', img: 'workshop_2', category: 'economy',
    upgradesFrom: 'market',
    cost: [{ gold: 100 }, { gold: 250 }], maxLevel: 2,
    buildTime: 2,
    maintenance: { gold: 1 },
    bonus: [{ gold: 6 }, { gold: 10 }],
    effect: ['+6 💰/t', '+10 💰/t'],
    desc: 'Gran mercado con alto flujo comercial.',
  },
  port: {
    name: 'Puerto', icon: '⚓', img: 'trade_port_1', category: 'economy',
    terrainReq: 'coast',
    cost: [{ gold: 120, wood: 50 }], maxLevel: 1,
    upgradesTo: ['fishing_port', 'trade_port'],
    buildTime: 2,
    maintenance: { wood: 1 },
    bonus: [{ gold: 5 }],
    effect: ['+5 💰/t, movilidad naval'],
    desc: 'Requiere costa en radio. Rutas marítimas.',
  },
  fishing_port: {
    name: 'Pto. Pesquero', icon: '🐟', img: 'fishing_port_1', category: 'economy',
    upgradesFrom: 'port',
    cost: [{ gold: 100, wood: 30 }, { gold: 230, wood: 70 }], maxLevel: 2,
    buildTime: 2,
    maintenance: { wood: 1 },
    bonus: [{ food: 6, gold: 2 }, { food: 10, gold: 2 }],
    effect: ['+6 🌾/t, +2 💰/t', '+10 🌾/t, +2 💰/t, inmune hambruna'],
    desc: 'Pesca masiva. Gran fuente alimentaria costera.',
  },
  trade_port: {
    name: 'Pto. Comercial', icon: '🚢', img: 'trade_port_3', category: 'economy',
    upgradesFrom: 'port',
    cost: [{ gold: 150, wood: 40 }, { gold: 340, wood: 90 }], maxLevel: 2,
    buildTime: 3,
    maintenance: { gold: 1, wood: 1 },
    bonus: [{ gold: 8 }, { gold: 14 }],
    effect: ['+8 💰/t', '+14 💰/t, rutas ultramar'],
    desc: 'Comercio marítimo de alto rendimiento.',
  },
};

// Compact terrain map builder
const _T = s => s.split(' ').map(c => ({ p:'plains', f:'forest', m:'mountain', w:'water', d:'desert' }[c]));

// Terrain map: 18 rows × 24 cols — continent surrounded by ocean
const TERRAIN_MAP = [
  _T('w w w w w w w w w w w w w w w w w w w w w w w w'), // 0
  _T('w w w w w p p p p p p p p w w w w w w w w w w w'), // 1
  _T('w w w w p p f f p p p p p p p w w w w w w w w w'), // 2
  _T('w w w p p f f f p m m p p p p p p w w w w w w w'), // 3
  _T('w w p p f f p p p m m m p p p p p p w w w w w w'), // 4
  _T('w w p p p p p p p p m p p p p f f p p p w w w w'), // 5
  _T('w p p p p p p d d p p p p p f f f p p p p w w w'), // 6
  _T('w p p p d d d d p p p p p f f p p p p p p p w w'), // 7
  _T('w w p p d d p p p p p p p p p p p p p p m p w w'), // 8
  _T('w w p p p p p p p p p p p p p p p m m p p p w w'), // 9
  _T('w w w p p p p p p p p p p p p p m m p p p p w w'), // 10
  _T('w w w p p p p p p p p f f p p p m p p p p w w w'), // 11
  _T('w w w w p p p p p p f f f p p p p p p p w w w w'), // 12
  _T('w w w w p p p p p f f p p p p p p p w w w w w w'), // 13
  _T('w w w w w p p p p p p p p p p p w w w w w w w w'), // 14
  _T('w w w w w w p p p p p p p w w w w w w w w w w w'), // 15
  _T('w w w w w w w p p p p w w w w w w w w w w w w w'), // 16
  _T('w w w w w w w w w w w w w w w w w w w w w w w w'), // 17
];

const RESOURCE_SPAWNS = [
  { c:6,  r:3,  type:'wood' },
  { c:13, r:7,  type:'wood' },
  { c:15, r:6,  type:'wood' },
  { c:10, r:13, type:'wood' },
  { c:4,  r:5,  type:'gold' },
  { c:12, r:10, type:'gold' },
  { c:8,  r:12, type:'gold' },
  { c:17, r:5,  type:'gold' },
  { c:8,  r:5,  type:'food' },
  { c:13, r:8,  type:'food' },
  { c:5,  r:13, type:'food' },
  { c:10, r:9,  type:'food' },
  { c:9,  r:4,  type:'iron' },
  { c:10, r:5,  type:'iron' },
  { c:17, r:9,  type:'iron' },
  { c:20, r:8,  type:'iron' },
];

const CITY_SPAWNS = [
  { c:5,  r:2,  name:'Dawnfort',   owner:'player'  },
  { c:19, r:9,  name:'Ashrock',    owner:'enemy'   },
  { c:11, r:7,  name:'Ironhold',   owner:'neutral' },
  { c:15, r:4,  name:'Silvergate', owner:'neutral' },
];

const INITIAL_UNITS = [
  // Player army — all start grouped at Dawnfort (c:5, r:2)
  { type:'warrior',  c:5, r:2, owner:'player' },
  { type:'warrior',  c:5, r:2, owner:'player' },
  { type:'warrior',  c:5, r:2, owner:'player' },
  { type:'archer',   c:5, r:2, owner:'player' },
  { type:'archer',   c:5, r:2, owner:'player' },
  { type:'spearman', c:5, r:2, owner:'player' },
  { type:'spearman', c:5, r:2, owner:'player' },
  { type:'scout',    c:5, r:2, owner:'player' },
  { type:'scout',    c:5, r:2, owner:'player' },
  // Enemy army — grouped
  { type:'warrior',  c:19, r:9, owner:'enemy' },
  { type:'warrior',  c:19, r:9, owner:'enemy' },
];

const COLS = 24;
const ROWS = 18;
