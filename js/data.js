// =============================================
//  data.js — static game data definitions
// =============================================

const TERRAIN_DEF = {
  plains:   { color: '#2e4a22', border: '#3a6028', label: 'Plains',   move: 1 },
  forest:   { color: '#183018', border: '#20401e', label: 'Forest',   move: 1 },
  mountain: { color: '#4a3e2e', border: '#665540', label: 'Mountain', move: 1 },
  water:    { color: '#0e2840', border: '#1a3a58', label: 'Water',    move: 99 },
  desert:   { color: '#5a4a20', border: '#7a6428', label: 'Desert',   move: 1 },
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
// Stats: atk=melee attack, def=melee defence, arm=missile armour, ap=armour pierce,
//        rng=range (0=melee), role=class, bonusVs={role:mult}, charge=cav charge bonus
const UNIT_TYPES = {
  // ── Reclutable en cualquier lugar ─────────────────────
  militia: {
    name: 'Milicia', icon: '🪓', img: 'milicia',
    hp: 80, atk: 28, def: 12, arm: 5, ap: 0, rng: 0, moves: 4, sight: 2,
    role: 'infantry',
    cost: { gold: 15 },
    maintenance: { gold: 1 },
    abilities: ['Melee', 'Levy'],
    desc: 'Campesinos armados. Bajo coste, bajo rendimiento.',
    trainTime: 0, mercenary: false,
  },

  // ── General (líder como unidad) ──────────────────────
  commander: {
    name: 'General', icon: '👑', img: null,
    hp: 120, atk: 40, def: 28, arm: 15, ap: 8, rng: 0, moves: 6, sight: 4,
    role: 'infantry',
    cost: {}, maintenance: {},
    abilities: ['Liderazgo', 'Inspira'],
    desc: 'Tu líder en persona. Inspira a las tropas cercanas y fortalece las ciudades bajo su mando.',
    trainTime: 0, mercenary: false,
  },

  // ── Mercenarios ───────────────────────────────────────
  merc_inf: {
    name: 'Mercenario Inf.', icon: '🗡️', img: 'merc_inf',
    hp: 85, atk: 38, def: 28, arm: 15, ap: 0, rng: 0, moves: 4, sight: 2,
    role: 'infantry',
    cost: { gold: 70 },
    maintenance: { gold: 4 },
    abilities: ['Melee', 'Mercenario'],
    desc: 'Infantería mercenaria. Cara pero disponible en cualquier lugar.',
    trainTime: 0, mercenary: true,
  },
  merc_arch: {
    name: 'Mercenario Arq.', icon: '🏹', img: 'merc_arch',
    hp: 65, atk: 38, def: 10, arm: 8, ap: 0, rng: 3, moves: 4, sight: 3,
    role: 'ranged', firesFirst: true,
    cost: { gold: 80 },
    maintenance: { gold: 5 },
    abilities: ['Ranged', 'Fires First', 'Mercenario'],
    desc: 'Arqueros mercenarios. Buenos sin necesidad de cuarteles.',
    trainTime: 0, mercenary: true,
  },
  merc_cav: {
    name: 'Mercenario Cab.', icon: '🐎', img: 'merc_cav',
    hp: 70, atk: 45, def: 18, arm: 10, ap: 0, rng: 0, moves: 8, sight: 4,
    role: 'cavalry', charge: 0.30,
    cost: { gold: 100 },
    maintenance: { gold: 6 },
    abilities: ['Fast', 'Charge +30%', 'Mercenario'],
    desc: 'Caballería ligera de alquiler. Veloz y siempre disponible.',
    trainTime: 0, mercenary: true,
  },

  // ── Unidades de la Plaga (Lord of Plagues) ───────────
  infected: {
    name: 'Infectado', icon: '🧟', img: null,
    hp: 55, atk: 20, def: 8, arm: 0, ap: 0, rng: 0, moves: 4, sight: 2,
    role: 'infantry',
    cost: { food: 10 },
    maintenance: {},
    abilities: ['Melee', 'Levy'],
    desc: 'Cuerpos infectados. Baratos y numerosos, pero muy débiles.',
    trainTime: 0, mercenary: false,
  },
  plague_bearer: {
    name: 'Portador de Plaga', icon: '☠', img: null,
    hp: 80, atk: 28, def: 12, arm: 5, ap: 0, rng: 0, moves: 4, sight: 2,
    role: 'infantry',
    cost: { food: 20, gold: 10 },
    maintenance: { food: 1 },
    abilities: ['Melee', 'Contagio'],
    desc: 'Infantería principal de la plaga. Barata y numerosa.',
    trainTime: 1, mercenary: false,
  },
  abomination: {
    name: 'Abominación', icon: '💀', img: null,
    hp: 200, atk: 35, def: 15, arm: 10, ap: 5, rng: 0, moves: 2, sight: 2,
    role: 'infantry',
    cost: { food: 60, gold: 40 },
    maintenance: { food: 2 },
    abilities: ['Tanque', 'Lento', 'Alta Resistencia'],
    desc: 'Masa de carne corrompida. Muy resistente pero extremadamente lenta.',
    trainTime: 2, mercenary: false,
  },
  lord_abomination: {
    name: 'Gran Abominación', icon: '💀', img: null,
    hp: 350, atk: 55, def: 20, arm: 15, ap: 10, rng: 0, moves: 1, sight: 2,
    role: 'infantry',
    cost: { food: 150, gold: 100 },
    maintenance: { food: 5 },
    abilities: ['Tanque Elite', 'Lentísimo', 'Aplastamiento'],
    desc: 'La creación final de la plaga. Imparable. Solo pueden existir unos pocos.',
    trainTime: 3, mercenary: false,
  },

  // ── Unidades entrenables en ciudad ────────────────────
  warrior: {
    name: 'Infantería', icon: '⚔️', img: 'infanteria',
    hp: 110, atk: 50, def: 30, arm: 20, ap: 0, rng: 0, moves: 4, sight: 2,
    role: 'infantry',
    cost: { gold: 30, food: 10 },
    maintenance: { gold: 2, food: 1 },
    abilities: ['Melee', 'Fortify'],
    desc: 'Soldado de línea confiable. Columna vertebral del ejército.',
    trainTime: 1,
  },
  archer: {
    name: 'Hondero', icon: '🏹', img: 'hondero',
    hp: 65, atk: 30, def: 8, arm: 5, ap: 0, rng: 2, moves: 6, sight: 3,
    role: 'ranged', firesFirst: true,
    cost: { gold: 30, wood: 10 },
    maintenance: { gold: 2, food: 1 },
    abilities: ['Ranged', 'Fires First'],
    desc: 'Hostigador con honda. Rápido, barato, dispara primero.',
    trainTime: 1,
  },
  archer_bow: {
    name: 'Arquero', icon: '🏹', img: 'arquero',
    hp: 75, atk: 38, def: 12, arm: 10, ap: 0, rng: 3, moves: 4, sight: 3,
    role: 'ranged', firesFirst: true,
    cost: { gold: 50, wood: 15 },
    maintenance: { gold: 3, food: 1 },
    abilities: ['Ranged', 'Fires First', 'Long Range'],
    desc: 'Arquero de largo alcance. 2 rondas de fuego antes del cuerpo a cuerpo.',
    trainTime: 1,
  },
  crossbow: {
    name: 'Ballestero', icon: '🎯', img: 'ballestero',
    hp: 85, atk: 55, def: 18, arm: 14, ap: 40, rng: 2, moves: 4, sight: 2,
    role: 'ranged', firesFirst: true,
    cost: { gold: 70, iron: 20, wood: 10 },
    maintenance: { gold: 4, iron: 1 },
    abilities: ['Ranged', 'Fires First', 'Armor Pierce'],
    desc: 'Penetra armaduras (AP 40). Contra-élite. Destruye piqueros.',
    trainTime: 2,
  },
  scout: {
    name: 'Cab. Ligera', icon: '🐎', img: 'cab_ligera',
    hp: 95, atk: 68, def: 22, arm: 14, ap: 0, rng: 0, moves: 8, sight: 4,
    role: 'cavalry', charge: 0.40,
    bonusVs: { pikemen: 0.35 },
    cost: { gold: 40, food: 20 },
    maintenance: { gold: 2, food: 2 },
    abilities: ['Fast', 'Charge +40%', 'Recon'],
    desc: 'Caballería ágil. Aplasta arqueros (×2.2). Débil vs piqueros (×0.35).',
    trainTime: 1,
  },
  knight: {
    name: 'Cab. Pesada', icon: '🛡️', img: 'cab_pesada',
    hp: 140, atk: 88, def: 42, arm: 20, ap: 10, rng: 0, moves: 8, sight: 2,
    role: 'cavalry', charge: 0.65,
    bonusVs: { pikemen: 0.25 },
    cost: { gold: 80, iron: 30 },
    maintenance: { gold: 5, iron: 1 },
    abilities: ['Heavy', 'Charge +65%', 'Fortify'],
    desc: 'Caballería de élite. Carga brutal. Vulnerable a piqueros (×0.25) y ballesteros.',
    trainTime: 2,
  },
  catapult: {
    name: 'Catapulta', icon: '💥', img: 'catapulta',
    hp: 50, atk: 80, def: 5, arm: 0, ap: 100, rng: 4, moves: 2, sight: 3,
    role: 'siege',
    cost: { gold: 60, wood: 40, iron: 10 },
    maintenance: { gold: 4, wood: 1 },
    abilities: ['Siege', 'Slow', 'AP 100'],
    desc: 'Devastadora contra ciudades y muros. Ignora toda armadura. Frágil en campo.',
    trainTime: 2,
  },
  spearman: {
    name: 'Piquero', icon: '🗡️', img: 'piquero',
    hp: 120, atk: 45, def: 35, arm: 18, ap: 0, rng: 0, moves: 4, sight: 2,
    role: 'pikemen',
    bonusVs: { cavalry: 2.2 },
    cost: { gold: 35, iron: 10 },
    maintenance: { gold: 2, food: 1 },
    abilities: ['Pica', 'Anti-Caballería'],
    desc: 'Formación de picas. Destroza caballería (×2.2). Vulnerable a arqueros.',
    trainTime: 1,
  },
};

// Unit types always available for recruitment regardless of city buildings
const ALWAYS_RECRUITABLE = ['militia', 'merc_inf', 'merc_arch', 'merc_cav'];

// ── Unit leveling ───────────────────────────────────────────────────
// XP thresholds to reach each level (0-indexed: [0]=lvl2, [1]=lvl3, [2]=lvl4)
const UNIT_XP_THRESHOLDS = [100, 300, 600];

// Stat multipliers applied to UNIT_TYPES base values at each level (1-indexed)
const UNIT_LEVEL_BONUSES = [
  { atk:1.00, def:1.00, arm:1.00, maxHp:1.00 }, // Level 1
  { atk:1.12, def:1.10, arm:1.08, maxHp:1.15 }, // Level 2: +12% atk, +10% def, +15% HP
  { atk:1.25, def:1.22, arm:1.18, maxHp:1.30 }, // Level 3
  { atk:1.40, def:1.35, arm:1.30, maxHp:1.50 }, // Level 4
];

// ── Rasgos de líder ─────────────────────────────────────────────────
const TRAITS = {
  estratega: { name: 'Estratega', icon: '🎯', desc: '+25% XP ganada en combate.',            effect: { combatXpMult: 1.25 } },
  guerrero:  { name: 'Guerrero',  icon: '⚔',  desc: '+20% ATK al comandar un ejército.',      effect: { commanderAtkBonus: 0.20 } },
  mercader:  { name: 'Mercader',  icon: '💰', desc: '+3 oro/turno por ciudad propia.',        effect: { goldPerCity: 3 } },
  piadoso:   { name: 'Piadoso',   icon: '✝',  desc: '+5 crecimiento de población/turno.',    effect: { popGrowthBonus: 5 } },
  cruel:     { name: 'Cruel',     icon: '💀', desc: '+30 XP extra por cada unidad enemiga eliminada.', effect: { killXpBonus: 30 } },
};

// ── Eventos aleatorios ───────────────────────────────────────────────
// NOTE: FACTIONS and KINGDOMS are defined in js/data/kingdoms.js
const EVENTS = [
  {
    id: 'plaga',
    icon: '☠',
    title: 'La Plaga Llega',
    desc: 'Una enfermedad se extiende por tus ciudades. El pueblo clama por ayuda.',
    choices: [
      { text: 'Gastar 50 oro en medicamentos',     effect: { gold: -50 },     result: 'La plaga fue contenida. El pueblo te lo agradece.' },
      { text: 'Ignorarla — que los fuertes sobrevivan', effect: { popLoss: 50 }, result: 'La plaga cobra muchas vidas. La población decrece.' },
    ],
  },
  {
    id: 'mercader_visitante',
    icon: '💰',
    title: 'Mercader Extranjero',
    desc: 'Un rico mercader llega a tus ciudades con una propuesta irresistible.',
    choices: [
      { text: 'Comprar sus mercancías (−30💰, +60🌲)', effect: { gold: -30, wood: 60 }, result: 'Excelente trato. Tus almacenes se llenan de madera.' },
      { text: 'Cobrar impuesto de tránsito (+25💰)',   effect: { gold: 25 },           result: 'El mercader parte con cara larga, tú con más oro.' },
      { text: 'Dejarlo pasar sin más',                 effect: {},                     result: 'El mercader sigue su camino sin incidentes.' },
    ],
  },
  {
    id: 'desercion',
    icon: '🏃',
    title: 'Deserción en las Filas',
    desc: 'Las largas marchas han quebrado el espíritu de algunos soldados.',
    choices: [
      { text: 'Pagar primas de fidelidad (−40💰)',        effect: { gold: -40 },       result: 'El oro habló. Los soldados permanecen en sus puestos.' },
      { text: 'Ejecutar a los desertores como ejemplo',   effect: { unitHpLoss: 15 },  result: 'Lección de hierro. La moral cae, pero la disciplina se mantiene.' },
    ],
  },
  {
    id: 'cosecha_abundante',
    icon: '🌾',
    title: 'Cosecha Abundante',
    desc: 'Este año las lluvias han sido generosas. Tus campos producen más que nunca.',
    choices: [
      { text: 'Almacenar el excedente (+50🌾)',   effect: { food: 50 },  result: 'Tus graneros rebosan. El invierno no te preocupa.' },
      { text: 'Vender el excedente (+35💰)',       effect: { gold: 35 }, result: 'Oro fácil. Los mercados agradecen la oferta.' },
    ],
  },
  {
    id: 'espias_descubiertos',
    icon: '👁',
    title: 'Espías Descubiertos',
    desc: 'Tu guardia ha capturado espías enemigos infiltrados en la capital.',
    choices: [
      { text: 'Interrogarlos y ejecutarlos (+20💰)', effect: { gold: 20 }, result: 'Información valiosa extraída. El enemigo pierde sus ojos.' },
      { text: 'Ofrecerles trabajo para ti',          effect: {},           result: 'Los espías cambian de bando. Información a cambio de vida.' },
    ],
  },
  {
    id: 'veta_mineral',
    icon: '⛏',
    title: 'Veta de Mineral Descubierta',
    desc: 'Tus exploradores encontraron una rica veta de hierro en las montañas cercanas.',
    choices: [
      { text: 'Excavar de inmediato (−30🌲, +50⚙️)', effect: { wood: -30, iron: 50 }, result: '¡Mineral extraído! El hierro fluye a tus forjas.' },
      { text: 'Registrar para después',               effect: {},                     result: 'La veta queda marcada. La aprovecharás más adelante.' },
    ],
  },
  {
    id: 'festival',
    icon: '🎉',
    title: 'Festival de la Victoria',
    desc: 'El pueblo propone celebrar los recientes éxitos con un gran festival.',
    choices: [
      { text: 'Organizar el festival (−35💰, +30 pop)', effect: { gold: -35, popGrowth: 30 }, result: '¡El pueblo celebra! La moral sube y la población crece.' },
      { text: 'Cancelarlo — hay trabajo que hacer',     effect: {},                            result: 'Tus ciudadanos murmuran, pero obedecen.' },
    ],
  },
  {
    id: 'bandidos',
    icon: '⚔',
    title: 'Bandidos en los Caminos',
    desc: 'Una banda de salteadores interrumpe el comercio entre tus ciudades.',
    choices: [
      { text: 'Enviar tropas a cazarlos (−25💰)',  effect: { gold: -25 }, result: 'Los bandidos fueron dispersados. El comercio se restablece.' },
      { text: 'Ignorarlos — no son prioridad',     effect: { gold: -15 }, result: 'Los bandidos siguen operando y cobran su peaje de facto.' },
    ],
  },
];

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
    trains: { 1: ['archer', 'archer_bow'], 2: ['archer', 'archer_bow', 'crossbow'] },
    effect: ['Entrena Honderos y Arqueros', '+Ballesteros (Lv 2)'],
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
    trains: { 1: ['archer', 'archer_bow', 'crossbow', 'catapult'] },
    effect: ['Defiende ciudad automáticamente. Todas las unidades distancia + Catapultas'],
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

// ── Building trees by developmentType ─────────────────────────────────
// BUILDING_TREES.standard aliases BUILDING_TYPES — no duplication.
// Each Legendary Lord that has a unique city type adds a new key here.
const BUILDING_TREES = {
  standard: BUILDING_TYPES,

  infected: {
    // ── Fixed root — always present in infected cities ────────────
    infection_pit: {
      name: 'Fosa de Infección', icon: '☠', img: null, category: 'civil',
      fixed: true,
      cost: [], maxLevel: 1,
      upgradesTo: ['mass_grave', 'plague_lab'],
      buildTime: 0,
      maintenance: {},
      bonus: [{}],
      effect: ['Centro de la infección. Inamovible.'],
      desc: 'El corazón putrefacto de la ciudad. Propaga la plaga hacia fuera.',
    },

    // ── Military tier 1 ──────────────────────────────────────────
    mass_grave: {
      name: 'Fosa Común', icon: '💀', img: null, category: 'military',
      upgradesFrom: 'infection_pit',
      cost: [{ food: 30 }], maxLevel: 1,
      upgradesTo: ['plague_lab'],
      buildTime: 1,
      maintenance: {},
      bonus: [{}],
      trains: { 1: ['infected', 'plague_bearer'] },
      effect: ['Entrena Infectados y Portadores de Plaga.'],
      desc: 'Reclutamiento masivo de portadores. Coste mínimo.',
    },

    // ── Military tier 2 ──────────────────────────────────────────
    plague_lab: {
      name: 'Laboratorio de Plaga', icon: '🧪', img: null, category: 'military',
      upgradesFrom: 'mass_grave',
      cost: [{ food: 60, gold: 30 }], maxLevel: 1,
      upgradesTo: ['abomination_lab'],
      buildTime: 2,
      maintenance: { food: 1 },
      bonus: [{}],
      trains: { 1: ['infected', 'plague_bearer', 'abomination'] },
      effect: ['Entrena Abominaciones. Mejora unidades de plaga.'],
      desc: 'Experimentos con la plaga. Crea criaturas más poderosas.',
    },

    // ── Military tier 3 (elite) ───────────────────────────────────
    abomination_lab: {
      name: 'Laboratorio de Abominaciones', icon: '💀', img: null, category: 'military',
      upgradesFrom: 'plague_lab',
      cost: [{ food: 120, gold: 80 }], maxLevel: 1,
      buildTime: 3,
      maintenance: { food: 3 },
      bonus: [{}],
      trains: { 1: ['infected', 'plague_bearer', 'abomination', 'lord_abomination'] },
      effect: ['Entrena la Gran Abominación. Máximo nivel militar de la plaga.'],
      desc: 'La creación definitiva. Solo los más corrompidos sobreviven el proceso.',
    },
  },
};

// Europe terrain map — 72 cols × 46 rows
// col 0 = ~10°W, col 71 = ~61°E | row 0 = ~71°N, row 45 = ~26°N
const TERRAIN_MAP = (() => {
  const C = 72, R = 46;
  const m = Array.from({length: R}, () => Array(C).fill('water'));
  const f = (r0, r1, c0, c1, t) => {
    for (let r = r0; r <= Math.min(r1, R-1); r++)
      for (let c = c0; c <= Math.min(c1, C-1); c++)
        m[r][c] = t;
  };

  // ── 1. LAND BASE ──────────────────────────────
  f(0,  14, 22, 35, 'plains');  // Scandinavia
  f(0,  13, 36, 48, 'plains');  // Finland
  f(0,  25, 49, 71, 'plains');  // Russia / East
  f(13, 20, 4,  14, 'plains');  // British Isles
  f(17, 27, 7,  20, 'plains');  // France
  f(22, 33, 4,  20, 'plains');  // Iberian Peninsula
  f(14, 22, 19, 36, 'plains');  // Germany + Poland
  f(14, 23, 37, 52, 'plains');  // Ukraine + Belarus
  f(20, 34, 21, 29, 'plains');  // Italy
  f(21, 33, 29, 41, 'plains');  // Balkans + Greece
  f(20, 28, 40, 58, 'plains');  // Anatolia / Turkey
  f(18, 23, 53, 64, 'plains');  // Caucasus region
  f(27, 35, 48, 57, 'plains');  // Levant
  f(34, 45, 4,  59, 'desert');  // North Africa / Sahara

  // ── 2. SEAS & WATER ───────────────────────────
  f(0,  45, 0,  3,  'water');   // Atlantic margin
  f(4,  12, 32, 37, 'water');   // Gulf of Bothnia
  f(12, 17, 23, 39, 'water');   // Baltic Sea
  f(12, 18, 11, 22, 'water');   // North Sea
  f(18, 21, 7,  10, 'water');   // English Channel
  f(23, 26, 4,  8,  'water');   // Bay of Biscay
  f(25, 33, 19, 22, 'water');   // Tyrrhenian Sea
  f(22, 30, 27, 31, 'water');   // Adriatic Sea
  f(29, 35, 27, 33, 'water');   // Ionian Sea
  f(28, 35, 37, 43, 'water');   // Aegean Sea
  f(30, 38, 7,  19, 'water');   // Western Mediterranean
  f(28, 38, 43, 57, 'water');   // Eastern Mediterranean
  f(26, 30, 39, 53, 'water');   // Black Sea
  f(14, 27, 60, 65, 'water');   // Caspian Sea

  // ── 3. MOUNTAIN RANGES ────────────────────────
  f(0,  14, 22, 26, 'mountain'); // Norwegian spine
  f(13, 16, 7,  10, 'mountain'); // Scottish Highlands
  f(22, 24, 10, 15, 'mountain'); // Pyrenees
  f(23, 26, 14, 17, 'mountain'); // Massif Central
  f(21, 25, 19, 28, 'mountain'); // Alps
  f(22, 32, 23, 27, 'mountain'); // Apennines
  f(20, 24, 33, 40, 'mountain'); // Carpathians
  f(23, 30, 29, 34, 'mountain'); // Dinaric Alps
  f(29, 33, 34, 38, 'mountain'); // Rhodopes / Balkans
  f(19, 24, 41, 54, 'mountain'); // Pontic mountains (N.Turkey)
  f(25, 28, 44, 52, 'mountain'); // Taurus mountains
  f(18, 22, 53, 64, 'mountain'); // Caucasus
  f(34, 37, 8,  16, 'mountain'); // Atlas mountains

  // ── 4. FORESTS ────────────────────────────────
  f(0,  14, 27, 35, 'forest');  // Scandinavian forests (E of mountains)
  f(0,  13, 36, 48, 'forest');  // Finnish boreal
  f(13, 19, 37, 49, 'forest');  // Baltic states / Belarus
  f(17, 21, 22, 31, 'forest');  // Central European forest belt
  f(14, 19, 4,  7,  'forest');  // Ireland
  f(16, 20, 10, 13, 'forest');  // English / Welsh woodland
  f(19, 22, 8,  12, 'forest');  // Brittany / Normandy
  f(21, 23, 19, 23, 'forest');  // Black Forest
  f(23, 27, 30, 33, 'forest');  // Balkan forests
  f(22, 26, 44, 50, 'forest');  // Anatolian interior

  // ── 5. ISLANDS & PENINSULA RE-ASSERTS ─────────
  f(26, 33, 22, 28, 'plains');  // Italian peninsula
  f(22, 32, 23, 27, 'mountain');// Apennines re-assert
  f(31, 35, 22, 26, 'plains');  // Southern Italy + Sicily
  f(27, 31, 19, 21, 'plains');  // Sardinia
  f(25, 28, 20, 22, 'plains');  // Corsica
  f(30, 34, 33, 36, 'plains');  // Greek peninsula
  f(30, 33, 34, 36, 'mountain');// Greek mountains
  f(22, 24, 43, 46, 'plains');  // Crimea
  f(14, 17, 22, 25, 'plains');  // Denmark
  f(15, 17, 26, 29, 'plains');  // Skåne (southern Sweden)
  f(35, 36, 33, 38, 'plains');  // Crete
  f(28, 29, 47, 49, 'plains');  // Cyprus
  f(28, 33, 5,  19, 'plains');  // Southern Iberia re-assert
  f(28, 30, 38, 40, 'plains');  // Istanbul / Bosphorus
  f(33, 37, 19, 22, 'desert');  // Tunisia re-assert

  return m;
})();

const RESOURCE_SPAWNS = [
  // Wood — forests of Scandinavia, Central Europe, Baltic
  { c:30, r:8,  type:'wood' },
  { c:40, r:8,  type:'wood' },
  { c:25, r:18, type:'wood' },
  { c:43, r:16, type:'wood' },
  { c:7,  r:16, type:'wood' },
  // Gold — river valleys and trade routes
  { c:13, r:25, type:'gold' },
  { c:35, r:18, type:'gold' },
  { c:45, r:20, type:'gold' },
  { c:22, r:27, type:'gold' },
  { c:8,  r:30, type:'gold' },
  // Food — fertile plains
  { c:22, r:26, type:'food' },
  { c:10, r:17, type:'food' },
  { c:9,  r:28, type:'food' },
  { c:41, r:19, type:'food' },
  { c:18, r:25, type:'food' },
  { c:33, r:19, type:'food' },
  // Iron — mountain deposits
  { c:25, r:23, type:'iron' },
  { c:34, r:21, type:'iron' },
  { c:20, r:18, type:'iron' },
  { c:9,  r:16, type:'iron' },
  { c:24, r:5,  type:'iron' },
];

const CITY_SPAWNS = [
  { c:22, r:29, name:'Roma',        owner:'neutral' },
  { c:11, r:19, name:'Londinium',   owner:'neutral' },
  { c:13, r:22, name:'Lutetia',     owner:'neutral' },
  { c:29, r:23, name:'Vindobona',   owner:'neutral' },
  { c:7,  r:32, name:'Hispalis',    owner:'neutral' },
  { c:41, r:21, name:'Borysthenes', owner:'neutral' },
  { c:35, r:32, name:'Athenae',     owner:'neutral' },
  { c:39, r:29, name:'Byzantium',   owner:'neutral' },
  { c:20, r:35, name:'Carthago',    owner:'neutral' },
];

const INITIAL_UNITS = [];

const COLS = 72;
const ROWS = 46;
