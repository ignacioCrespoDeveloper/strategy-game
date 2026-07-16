// =============================================
//  quest-narratives.js — Atmospheric text for quest reports
//  Total War: Warhammer / Game of Thrones tone.
// =============================================

var QUEST_NOTHING_NARRATIVES = {
  forest: [
    "Your scouts pressed deep into the ancient woodland, following game trails and dry creek beds. Three days of searching turned up old campsites, a rusted helmet half-buried in leaves, and nothing else. If anything stirs in these trees, it kept well out of sight.",
    "The canopy swallowed the light and muffled all sound. Your men moved carefully through the underbrush, finding nothing but silence and shadows. Whatever secrets this forest holds, it was not willing to share them today.",
    "A thorough sweep of the woodland revealed little of value — the tracks of wild boar, a collapsed hunter's blind, bark carved with runes too faded to read. Your men returned to camp empty-handed.",
  ],
  plains: [
    "Your outriders fanned across the open country in a wide arc, riding hard from dawn to dusk. The plains offered nothing but dry grass, old cart ruts, and a horizon that never changed. They returned with little to report.",
    "Three days of sweeping the flatlands yielded no discovery of note. A merchant had passed this way recently — judging by the wheel ruts — but was long gone. The land lay quiet and unremarkable.",
    "Your scouts combed the fields methodically, quadrant by quadrant. Whatever riches or dangers might once have lived here, they have moved on. The plains gave nothing.",
  ],
  hills: [
    "Your men climbed every ridge and descended into every gully, their boots worn raw by the end of it. The hills were empty — old stone walls overgrown with moss, a dry well, and the wind. Nothing of use.",
    "A thorough search of the high ground turned up a few rusted arrowheads and the bones of a horse, but nothing worth reporting. The hills keep their secrets well.",
    "Your scouts picked their way through the rocky terrain for two days, finding only the tracks of mountain goats and an abandoned shepherd's hut stripped of everything useful.",
  ],
  marsh: [
    "Your scouts waded through hours of bog and briar, their legs black with mud by midday. The swamp concealed nothing — or perhaps concealed everything. They returned feverish and empty-handed.",
    "The marsh is a treacherous place to search. Every step sounded like a footfall, and every shadow might be anything. In the end, your men found only bad water and biting insects.",
    "The search party emerged from the wetlands cursing and soaked. Three hours of probing the deeper channels with poles yielded nothing but a waterlogged chest too rotten to open.",
  ],
  mountain: [
    "The altitude made the search slow and punishing. Your men checked the passes and probed the cliff faces for cave entrances, finding nothing beyond the usual signs of old mining — abandoned shafts, broken pick handles, slag piles.",
    "Cold, thin air and treacherous footing made the mountain search gruelling. Your scouts came back half-frozen with nothing to show for it. If something is hidden in these peaks, it will take more time to find.",
    "The peaks offered silence and hardship in equal measure. Your men found the ruins of a watchtower on the high ridge — ancient, stripped to its foundations — and nothing else of note.",
  ],
  desert: [
    "The heat turned the horizon into a mirage, and your scouts rode in circles through empty dunes for two days. They found the bleached bones of a camel, a shattered oil jar, and sand. Nothing else.",
    "The desert gave nothing. Your outriders spread wide and swept the terrain carefully, but the sands had swallowed whatever might once have been here. They returned parched and frustrated.",
    "Hours of searching under the merciless sun. Your men tracked every shadow, every rock formation that might hide something. They found old fire rings and dried bones. The desert was empty.",
  ],
};

var QUEST_DEF_NARRATIVES = {
  bandit_camp: [
    "Moving upwind to mask their scent, your scouts identified signs of a hostile encampment — fire rings, watchmen's perches, refuse piles that told of a permanent presence. They pulled back and reported: raiders, organised and armed.",
    "A plume of smoke on the horizon led your outriders to a concealed camp. Armed men lounged around a firepit and sharpened blades. Not merchants. Your scouts withdrew unseen and brought the news.",
  ],
  goblin_camp: [
    "The smell reached your scouts before the sound did — rot, offal, and something acrid the men couldn't name. A goblin camp, poorly hidden, swarming with small green shapes that moved fast and quarrelled constantly.",
    "Faint drums and high-pitched wailing drew your outriders to a camp of goblins. They had fortified their position with crude stakes and stolen timber. Numerous, but disorganised.",
  ],
  wolf_rider_camp: [
    "Tracks in the mud told the story before your scouts reached the camp — wolf paws, each the size of a man's palm, circling a cluster of hide tents. Wolf riders, resting between raids.",
    "Your men heard the howling long before they saw the fires. A warband of wolf riders had made camp in a clearing, their mounts chained to iron stakes, the riders cleaning weapons by firelight.",
  ],
  ogre_camp: [
    "The ground was littered with the bones of cattle and something larger that your men chose not to examine. At the camp's centre sat an ogre of considerable size, surrounded by two others. Your scouts retreated before they could be smelled.",
    "A camp built from the wreckage of at least three wagons. The ogres had made it their own — crude and brutal, like its inhabitants. Your scouts counted three before withdrawing.",
  ],
  mercenary_company: [
    "Your outriders came across a professional military encampment — tents in neat rows, horses picketed, sentries posted with discipline. These were not bandits. A mercenary company, operating in the area.",
    "The camp bore the signs of a well-organised fighting force: standardised equipment, posted guards, and a banner your men didn't recognise. Sell-swords, most likely — and willing to talk terms.",
  ],
  orc_warcamp: [
    "The sound of drums and roaring carried for miles. Your scouts crept to within sight of a greenskin warcamp — dozens of orcs sharpening blades and battering each other bloody for sport. A WAAAGH in the making.",
    "Your outriders found the warcamp the hard way — nearly stumbling into a patrol. They pulled back and reported: a full orc warband, war standards raised, preparing to march on something.",
  ],
  dark_elf_raiders: [
    "Silent movement in the shadows resolved itself into something worse — a dark elf raiding party, resting before their next strike. Black armour, blades like obsidian, and cold eyes that missed nothing.",
    "Your scouts picked up the trail of corpses first — a farmstead, a courier, a small patrol, all taken apart with the precision that only druchii show. The raiding party was camped nearby, confident no one would find them.",
  ],
  dwarf_expedition: [
    "A heavily armed column of dwarfs had made camp with characteristic efficiency — perimeter stakes, fire watch, and at least three crossbowmen on rotation. Whether they were traders, explorers, or something else was unclear.",
    "Your outriders found a dwarf expedition dug into a defensive perimeter. Their mood was difficult to read — suspicious of strangers, as always, but not openly hostile. Contact was possible.",
  ],
  beast_lair: [
    "The tracks led into a rocky outcrop that stank of blood and animal musk. Something large had made its lair here — large enough that your scouts went no further and came back to report instead.",
    "Stripped carcasses hung from the branches of the nearest trees. Something had been feeding well for weeks. Your scouts circled the lair at distance and counted at least three sets of enormous tracks.",
  ],
  dragon_cult: [
    "Your scouts found the shrine long before they found the cult — stone draconids set in a ring around a blackened fire pit, still warm. The cultists appeared from the treeline moments later, armed and fanatical.",
    "A Dragon Cult encampment, hidden well but not well enough. Robed figures, ritual weapons, and the bones of something serpentine arranged with obvious reverence. They knew your men were there before the scouts did.",
  ],
  ancient_ruins: [
    "Beyond a ridge choked with thornbush, your men found the remains of something ancient — walls of worked stone, archways still standing, glyphs carved in a script no living scholar can read. Whatever once stood here was built to last.",
    "Following a half-remembered map scratched in charcoal on leather, your scouts located the ruin. It was larger than expected. Most of the upper floors had collapsed inward, but the lower chambers were accessible — and almost certainly not empty.",
  ],
  merchant_caravan: [
    "A dust cloud on the road resolved itself into a merchant caravan — wagons laden with goods, a small armed escort, and a merchant lord who seemed pleased to see a lord's banner. Trade was possible.",
    "Your outriders flagged down a caravan working its way through the territory. The merchant was cautious at first, but the sight of coin loosened his tongue and his prices.",
  ],
  ancient_relic: [
    "Deep in a collapsed chamber beneath a ruined shrine, your scouts found something that made the hair on their necks stand. An object of obvious age and obvious power — whatever it was, it radiated significance. They wrapped it in cloth and brought it back carefully.",
    "The find was unexpected. Beneath three feet of ash and rubble, your men uncovered an artifact that predates the current age — perhaps predates recorded history. Its purpose was unclear, but its worth was not.",
  ],
  bog_crystal: [
    "Probing the peat beds with long poles, your scouts struck something hard at unexpected depth. Careful excavation revealed a formation of crystalline mineral unlike anything they had seen in the field — pure, cold, and faintly luminous.",
    "The surface of the bog gave no sign of what lay beneath. Sheer luck — one man's boot breaking through a patch of frozen mud — revealed it. A cluster of bog crystals, old as the swamp itself.",
  ],
  iron_vein: [
    "Following a dry gully inland, your scouts found exposed rock faces stripped bare by old flooding. The rust-red streaks running through the grey stone told their own story — iron, and plenty of it.",
    "Your men found a natural vein of iron ore exposed along a hillside, untouched and unworked. Rich enough to be worth the effort of extraction.",
  ],
  fertile_fields: [
    "Past the main road and off the beaten path, your scouts stumbled on a stretch of land that clearly used to be farmed. Deep soil, good drainage, and signs that grain once grew here in abundance. With some work, it could again.",
    "The land here is richer than it looks. Your outriders reported black earth, shallow roots, and the remnants of old field rows. Fertile ground, left fallow.",
  ],
  timber_cache: [
    "A stand of old-growth timber, hidden behind a ridge and untouched by any saw. Your scouts estimated the yield at several hundred logs of high-quality hardwood. Whoever logged this valley before missed it entirely.",
    "A collapsed logging operation from a previous generation had left behind a large cache of cut and cured timber. Most of it was still good. Your men earmarked the find for collection.",
  ],
  abandoned_mine: [
    "A rotted sign and a caved-in shaft entrance marked the spot. Someone had worked this seam before and either run out of coin or been driven off. With fresh timber and effort, it could run again.",
    "Your scouts found the mine by following an old cart track to its end. The entrance had been deliberately sealed — not by collapse, but by someone who intended to come back. They never did.",
  ],
  coin_cache: [
    "Beneath a flat rock marked with an X that your men nearly walked past, they found a sealed iron box. Inside: coin, old denomination, slightly tarnished, but good. Someone's savings, long abandoned.",
    "An old hiding spot, cleverly chosen and well-hidden. A leather satchel wedged under the roots of a dead tree held a modest cache of coin — probably the stash of a soldier who never returned.",
  ],
  lost_treasure: [
    "The rumour of a buried hoard brought your scouts to a particular hill. Three days of searching turned up nothing until the last hour of the last day. Whatever was buried here was buried deep and deliberately. Worth the effort.",
    "Your men followed a sequence of old landmarks that appeared to lead somewhere specific. The find at the end was better than expected — a chest, not large, but heavy, and full of coin and valuables.",
  ],
};

var QUEST_CATEGORY_NARRATIVES = {
  resource: [
    "After a methodical sweep of the area, your scouts returned with something useful — a natural resource worth claiming.",
    "Fortune favoured your men today. A patient search of the terrain revealed something the land had been hiding.",
  ],
  combat: [
    "Your scouts moved cautiously, reading the signs as they went. By the time they returned, their report was clear: something dangerous had made a home here.",
    "The search was uneventful until it wasn't. Your outriders came back with a warning — and a location.",
  ],
  event: [
    "The search led your men somewhere unexpected. What they found there was unlike anything they had encountered before.",
    "Your scouts followed a thread of evidence — old stories, faded tracks, rumour — to something that warranted a closer look.",
  ],
  trade: [
    "The road was quiet when your outriders took it. It did not stay quiet. They found what they were looking for, and then some.",
    "An unexpected encounter on the road proved profitable. Your men made contact and reported back.",
  ],
  legendary: [
    "Whatever your men expected to find, it was not this. The discovery was significant enough that they double-checked before riding back to report.",
    "Your scouts returned shaken and certain of what they had seen. The find was extraordinary.",
  ],
};

function pickQuestNarrative(def, terrainId) {
  if (!def || def.category === 'nothing') {
    const pool = QUEST_NOTHING_NARRATIVES[terrainId] || QUEST_NOTHING_NARRATIVES.plains;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const defPool = QUEST_DEF_NARRATIVES[def.id];
  if (defPool && defPool.length > 0) {
    return defPool[Math.floor(Math.random() * defPool.length)];
  }
  const catPool = QUEST_CATEGORY_NARRATIVES[def.category];
  if (catPool && catPool.length > 0) {
    return catPool[Math.floor(Math.random() * catPool.length)];
  }
  return "Your scouts returned from their search with a report.";
}
