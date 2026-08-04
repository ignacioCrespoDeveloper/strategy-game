// =============================================
//  story-quests.js — 150 curated one-off story vignettes
//
//  Layered on top of the existing discovery system as an upgraded
//  narrative layer — these do NOT change reward math, roll odds, or
//  server logic. Each story has a title (shown as the report's headline,
//  replacing the generic def name) and a short D&D-style vignette (shown
//  in place of the generic pooled narrative from quest-narratives.js).
//
//  Composition (by design, not by forced roll odds):
//    bandit  (15) — combat encounters. Shown for category:'combat'.
//    lore    (45) — atmosphere only, no reward. Shown for category:'nothing'.
//    reward  (75) — story + the normal reward already resolved server-side.
//                   Shown for category:'resource'|'item'|'trade'.
//    jackpot (15) — rare, dramatic, big-reward finds.
//                   Shown for category:'legendary'.
//
//  See pickStoryQuest() at the bottom — called from lord-screen.js's
//  _applyQuestResult() in place of pickQuestNarrative() when a story is
//  available for the resolved category.
// =============================================

var STORY_QUESTS = {

  // ── Bandit (15) — combat encounters ──────────────────────────
  bandit: [
    { title: 'The Toll Road', story: "A collapsed bridge forces travelers onto a narrow forest track — and someone has noticed. Your scouts count six armed men lounging in the treeline, waiting for the next caravan fool enough to pass this way." },
    { title: "Widow's Crossing", story: "The ferryman at the crossing hasn't been seen in days. In his place: a band of deserters wearing his coat, taking tolls at knifepoint from anyone desperate enough to still use the ford." },
    { title: "The Poacher's Camp", story: "Snares line the woods for half a mile before your scouts find their makers — a rough gang living off stolen game, quick to violence when startled and unwilling to share their kills." },
    { title: 'Smoke on the Ridge', story: "A thin column of smoke marks a camp your scouts almost walked past. Closer inspection reveals raiders sorting through saddlebags that were never theirs to begin with." },
    { title: 'The False Shrine', story: "Pilgrims have been vanishing on the road to the old shrine. Your scouts find why: a gang dressed as monks, luring travelers in with false blessings and closing the door behind them." },
    { title: 'Blood on the Millwheel', story: "The old mill has new tenants. Grain sacks lie slashed and empty in the yard, and men with stolen blades watch the road from the loft window, waiting for the next delivery." },
    { title: 'The Broken Wagon Gang', story: "A wagon lies overturned at the crossroads, its wheel deliberately sabotaged. The bandits who did it are still nearby, waiting for the next passing cart to stop and help." },
    { title: 'Nightfire Raiders', story: "They strike only after dark and vanish before dawn. Your scouts finally traced their fires to a hollow a mile off the road, and counted enough men to make the raids make sense." },
    { title: 'The Tax Collectors', story: "Men in stolen city livery have been \"collecting tribute\" from farmsteads that owe nothing to anyone. Your scouts confirmed it — no seal, no writ, just extortion backed by steel." },
    { title: 'Ambush at the Narrows', story: "The trail narrows to single file between two boulders — a perfect kill box, and someone has clearly thought of that before. Fresh blood on the stones says they've used it more than once." },
    { title: 'The Salt Road Thieves', story: "Salt caravans have been disappearing on this stretch for a month. Your scouts found the culprits: a well-organised crew with a hidden cache and no shortage of confidence in their position." },
    { title: "Grave Robbers' Den", story: "The old barrow mounds have been dug open, and the diggers haven't left. They've made camp among the bones, armed and openly unwilling to share whatever they've pulled out of the dark." },
    { title: 'The Drowned Bridge Gang', story: "They flood the low bridge deliberately, forcing travelers to detour straight through their ambush point. Clever, patient, and profitable — right up until now." },
    { title: 'Hunters of the Hunted', story: "Not bandits by trade, but deserters turned predator, preying on refugees fleeing some other war for whatever coin and goods they still carry on their backs." },
    { title: "The Charcoal Burners' Secret", story: "The charcoal camp's smoke was a signal, not an accident — a waystation for a raiding band quietly moving stolen goods through the territory, one cart at a time." },
  ],

  // ── Lore (45) — atmosphere only, no reward ───────────────────
  lore: [
    { title: 'The Weeping Statue', story: "A moss-covered statue of some forgotten saint weeps rainwater from carved stone eyes. Your men leave a small offering out of habit, though none of them believe it will matter." },
    { title: 'The Silent Bell', story: "A church bell hangs cracked in a ruined tower, its clapper long gone. No one in the nearest village remembers what it once rang for, or why it stopped." },
    { title: 'The Card Game', story: "Your men find three skeletons seated around a table, playing cards frozen mid-game by time. No one wants to guess aloud how the hand ended." },
    { title: 'The Talking Crow', story: "A crow perched on a fence post says something uncannily like a name before flying off. Your scouts couldn't agree afterward on whose name it had been." },
    { title: 'The Empty Cradle', story: "A cottage stands untouched by weather or time, a cradle rocking gently though no wind stirs inside. Your men leave without stepping through the door." },
    { title: "The Traveler's Boots", story: "A pair of fine boots sit neatly by the roadside, laces tied, as if their owner simply stepped out of them and walked on barefoot into the trees." },
    { title: 'The Second Moon', story: "For one night, your scouts swear they saw two moons in the sky. By morning there was only one again, and no one back at camp believed a word of it." },
    { title: 'The Singing Well', story: "A well on an abandoned farmstead hums a faint tune whenever the wind passes over it just right. Your men listened for the better part of an hour and learned nothing more." },
    { title: 'The Painted Cave', story: "Handprints cover a shallow cave wall, ochre-red and unmistakably ancient. Whoever left them is long gone, and whatever they meant went with them." },
    { title: "The Fisherman Who Wasn't", story: "A man sits at the riverbank with a line in the water and no hook tied to it. He nods politely as your scouts pass and says nothing else at all." },
    { title: 'The Wrong Direction', story: "A signpost points confidently toward a village that, by every map your scouts carry, doesn't exist in that direction — or possibly anywhere at all." },
    { title: 'The Sleeping Orchard', story: "An orchard blooms out of season, heavy with fruit no one in the party dares to eat. It smells faintly of honey, and faintly of something underneath that." },
    { title: "The Widow's Watch", story: "An old woman waits daily at the crossroads for a husband who died, by her own cheerful account, forty years past. She waves warmly as your scouts pass by." },
    { title: 'The Buried Door', story: "A stone door, unmistakably man-made, is set flush into a hillside with no path leading to it and no visible way to pry it open." },
    { title: 'The Quiet Battlefield', story: "Grass grows unnaturally green over an old battlefield. No birds sing here, and your men were glad enough to move on before the light started to fade." },
    { title: 'The Hollow Log', story: "A hollow log serves as den to a family of foxes who watch your scouts pass with an unsettling, almost judgemental composure, as if keeping score." },
    { title: "The Merchant's Ghost", story: "A cart sits abandoned mid-road, its goods untouched, the horse long gone. Locals say the merchant simply vanished one morning, mid-step, mid-sentence." },
    { title: 'The Star-Fallen Field', story: "A shallow crater, glass-smooth at its center, marks where something fell from the sky some years back. Whatever it was, it isn't there anymore." },
    { title: 'The Uninvited Guest', story: "Your men find a table set for a feast that never happened — plates untouched, candles burned down to nothing. No sign anywhere of the intended host." },
    { title: 'The Echoing Ravine', story: "Shout into this ravine and you'll hear your words come back seven times, each a little different, the last one not quite sounding like your own voice." },
    { title: 'The Kind Stranger', story: "A traveler shares his fire and his stories for an evening, then is gone by dawn without a trace in the morning frost — no footprints, no cold ashes, nothing." },
    { title: 'The Patient Spider', story: "A web the size of a cart spans two trees at the treeline, its owner nowhere in sight. Your scouts gave it a wide and notably respectful berth." },
    { title: 'The Forgotten Garden', story: "Behind a collapsed wall, a garden still blooms in perfect rows, tended by absolutely no one your scouts could find, question, or explain." },
    { title: 'The Coinless Toll', story: "A rope stretches taut across the road with no one present to demand payment for crossing it. Your men crossed anyway. Nothing happened. Probably nothing." },
    { title: 'The Two Wells', story: "Twin wells sit ten paces apart. One draws water sweet as spring rain; the other, bitter as bile. No one can say why, or which of the two was dug first." },
    { title: 'The Sleeping Giant', story: "A hill shaped uncannily like a slumbering figure looms over the valley below. Local children dare each other to walk its \"spine.\" Your men did not." },
    { title: 'The Last Letter', story: "A sealed letter, addressed to no one your scouts recognize, sits pinned to a tree trunk by a dagger. They left it exactly as they found it." },
    { title: 'The Wandering Light', story: "A pale light drifts through the marsh at dusk, always at a careful distance, never once drawing closer. Your scouts did not attempt to follow it." },
    { title: 'The Frozen Waterfall', story: "A waterfall stands frozen solid despite the warm season, ice glittering strangely in the afternoon sun. It had thawed completely by the time anyone thought to check again." },
    { title: 'The Empty Chapel', story: "Pews still stand in neat, dustless rows in a chapel with no roof and no congregation. Someone, evidently, has been sweeping the floor quite recently." },
    { title: 'The Speaking Stone', story: "A standing stone, carved with worn runes, seems to hum faintly whenever touched. Your scouts collectively decided it was wiser not to touch it a second time." },
    { title: "The Beekeeper's Silence", story: "Hives stand in perfect, humming rows, thick with activity — but the beekeeper's cottage nearby has clearly stood empty for years by the state of the dust." },
    { title: 'The Drunk Ghost', story: "Villagers swear a spectral figure stumbles home from the tavern at the exact same hour every night, humming an old tune, and vanishes at his own front door." },
    { title: 'The Riddle Post', story: "A wooden post is carved with a riddle no one in three generations has managed to solve. Your scouts added their own failed guess to the long tally scratched beneath it." },
    { title: "The Patient Fisherman's Boat", story: "An empty rowboat drifts in slow, unhurried circles on a still pond, oars shipped neatly, no one aboard, and no shore nearby it could plausibly have drifted from." },
    { title: 'The Midnight Market', story: "Locals speak of a market that appears only at midnight and sells things ordinary money can't otherwise buy. Your scouts arrived at noon and found only an empty field." },
    { title: 'The Counting Crows', story: "A murder of crows perches along a long fence, each bird facing the road, silent and unmoving, as if diligently keeping count of who passes and when." },
    { title: 'The Untouched Feast', story: "Wild boar rooted through half the farmland nearby, and yet one particular field of turnips stands entirely untouched, ringed by stones no farmer ever placed there." },
    { title: 'The Old Toll Keeper', story: "A toll booth stands empty on a bridge no one uses anymore. A ledger inside logs travelers going back over a century — the last entry, decades old, unfinished." },
    { title: 'The Hummingbird Shrine', story: "A tiny shrine, no taller than a boot, is surrounded by dozens of dead hummingbirds arranged with obvious, deliberate care. No one your scouts asked would explain why." },
    { title: 'The Split Oak', story: "Lightning split an ancient oak clean down the middle, and yet it still grows, leaves thick and green on both halves, as if refusing to acknowledge the wound." },
    { title: 'The Empty Armor', story: "A full suit of plate armor stands upright in a forest clearing, rusted shut at every joint, no bones inside. Someone built it there, deliberately, for reasons long lost." },
    { title: 'The Traveling Song', story: "A folk tune drifts down from somewhere in the hills, always just out of sight of its source. Your scouts caught themselves humming it for days afterward, unable to say where they'd first heard it." },
    { title: "The Dry Riverbed's Message", story: "Stones arranged in a long-dry riverbed spell out words in a language none of your scholars recognize. The river itself hasn't flowed in living memory." },
    { title: 'The Patient Toll', story: "An old woman sits by a narrow footbridge, asking each traveler to name their greatest fear before crossing. Your scouts paid the toll in words and crossed unharmed, if a little unsettled." },
  ],

  // ── Reward (75) — story + the normal resolved reward ─────────
  reward: [
    // Mining / treasure
    { title: "The Miser's Floorboard", story: "Beneath the collapsed floor of an old cottage, a loose board hides a strongbox its owner never lived to spend — coin still good, lock long since given up." },
    { title: 'The Vein No One Found', story: "A rockslide exposed what centuries of prospectors somehow missed entirely — a seam running clean and rich just beneath the surface, easy pickings for anyone willing to dig." },
    { title: "The Smuggler's Cache", story: "Hidden behind a false wall in an old smuggler's den, crates of goods sit exactly where they were left, untouched by either thieves or time." },
    { title: "The Dwarf's Marker", story: "A carved stone, half-buried and weathered smooth, marks a cache left by dwarven traders generations past — still sealed, still full, still theirs by right of finding." },
    { title: 'The Drowned Chest', story: "Low water reveals what the river usually keeps hidden: an iron-bound chest wedged between two rocks, waiting patiently for someone determined enough to reach it." },
    { title: "The Beggar King's Hoard", story: "Local legend spoke of a beggar who died rich and thoroughly mad. Your scouts found his \"throne\" at last — a chair stuffed to bursting with coin." },
    { title: 'The Collapsed Vault', story: "An old strongroom, sealed shut by a rockslide decades back, finally gives up its contents to a few hours of determined, careful digging." },
    { title: "The Traveling Merchant's Loss", story: "Wagon tracks lead to a ravine, and at the bottom, cargo scattered but largely salvageable. The merchant himself, sadly, is long past caring either way." },
    { title: "The Miner's Last Strike", story: "A skeleton still grips a pickaxe, buried beside the very vein it struck rich moments before the tunnel came down around him." },
    { title: 'The Tithe Box', story: "An old shrine's donation box, forgotten and long untended, has quietly accumulated a small fortune from decades of passing, hopeful pilgrims." },
    { title: 'The Hidden Strongroom', story: "Behind a bookshelf that swings open on a hidden hinge, a lord's forgotten strongroom sits exactly as he left it, dust thick on every coin." },
    { title: "The Prospector's Gamble", story: "A dead man's claim marker still stands watch over a vein he never got the chance to work. His tools remain; the ore is, remarkably, still there." },
    { title: 'The Sunken Cargo', story: "A shipwreck, long since silted into a riverbank, still holds cargo in its hull — preserved rather better, in the end, than the ship itself." },
    { title: 'The Counting House Ruins', story: "The burnt-out shell of an old counting house hides a strongbox the fire never quite reached, buried safely under fallen beams and ash." },
    { title: "The Well-Digger's Surprise", story: "Digging a new well, laborers struck something considerably harder than stone — a buried cache, forgotten by whoever hid it there so carefully." },
    // Farming / nature
    { title: 'The Untouched Meadow', story: "No plow has touched this meadow in generations, but the soil beneath is as rich as any farmer in the region could reasonably dream of." },
    { title: "The Hunter's Trail", story: "Game trails converge here from every direction at once — a hunting ground so rich your scouts filled their packs before midday and still had ground to cover." },
    { title: 'The Ancient Grove', story: "Trees here grow taller and straighter than anywhere else in the region, their wood prized by builders who know precisely where to look for it." },
    { title: 'The Forgotten Terraces', story: "Old farming terraces, cut into a hillside generations ago and long abandoned, still hold soil richer than anything currently under cultivation nearby." },
    { title: 'The Salt Flats', story: "A dried lakebed leaves behind crystallized salt in thick, easily harvestable sheets — a resource worth every bit as much as coin in the right markets." },
    { title: 'The Wildflower Bloom', story: "An unusual bloom of medicinal herbs covers the hillside this season, valuable to any apothecary willing to pay well for genuinely fresh stock." },
    { title: "The Beaver's Dam", story: "An engineered wetland, built patiently over generations by beavers, has created a small ecosystem thick with fish and fowl ready for the taking." },
    { title: 'The Windfall Orchard', story: "A late storm knocked half an old orchard's fruit to the ground — still good, still valuable, and simply waiting on someone to gather it up." },
    { title: 'The Clay Pit', story: "Fine potter's clay, rare in this part of the region, sits exposed along a creek bank in quantities enough to supply a workshop for months." },
    { title: 'The Migrating Herd', story: "A herd passing through offers a rare hunting opportunity — meat and hide enough to fill several wagons before they move on for the season." },
    { title: 'The Old Vineyard', story: "Wild grapevines, descendants of some long-abandoned vineyard, still produce fruit sweet enough to be worth the effort of a proper harvest." },
    { title: 'The Stone Circle Quarry', story: "Whoever quarried stone here generations ago left behind far more cut blocks than they ever used — ready-made material, just sitting and waiting." },
    { title: 'The Deep Spring', story: "A spring bubbling up mineral-rich water has drawn game for years, and occasionally coin-paying travelers chasing its supposed healing properties." },
    { title: 'The Reed Marsh', story: "Thick stands of reed, prized for thatching and weaving alike, grow entirely untouched in a marsh most travelers avoid on account of the mud." },
    { title: 'The Honey Cliffs', story: "Wild bees have colonized the cliff face in real numbers, their combs heavy with honey that no one nearby has yet dared to harvest." },
    // Ruins / relics
    { title: 'The Buried Chapel', story: "A chapel, swallowed whole by a landslide generations back, is finally uncovered — its offering box, remarkably, still sealed and still full." },
    { title: "The Scholar's Cache", story: "A hidden library niche, somehow untouched by looters, holds scrolls of modest interest and a small hoard the scholar clearly meant to protect." },
    { title: "The Watchtower's Secret", story: "An old watchtower, abandoned since a war long since forgotten by everyone but the stones, still holds the paymaster's chest in its lower room." },
    { title: 'The Broken Idol', story: "A shattered statue's hollow base conceals a small treasure — offerings left, once upon a time, by worshippers of a god no one now remembers." },
    { title: 'The Sealed Crypt', story: "A crypt, sealed against grave robbers with rather more care than skill, finally yields to patient work — and a modest collection of grave goods." },
    { title: 'The Fallen Garrison', story: "The ruins of an old border fort still hold a paymaster's strongbox, quietly forgotten when the garrison was finally recalled and never returned." },
    { title: "The Priest's Cellar", story: "Beneath a long-burned chapel, a cellar survived entirely intact — sacramental silver and coin both untouched by the fire that took everything above." },
    { title: "The Bandit King's Grave", story: "Local legend named this mound a bandit chief's final resting place. Your scouts found the legend was, for once, entirely and profitably true." },
    { title: 'The Sunken Shrine', story: "A shrine, half-submerged by a shifted riverbed, still holds votive offerings cast in a metal that has stubbornly refused to corrode." },
    { title: 'The Old Customs House', story: "A ruined customs post from a border that no longer exists on any map still holds uncollected tariffs, patiently waiting in its strongbox." },
    { title: "The Mapmaker's Tower", story: "A collapsed tower once held a cartographer's workshop — the maps inside are of little use now, but the coin box survived entirely intact." },
    { title: 'The Forgotten Reliquary', story: "A small stone reliquary, tucked into a quiet cliffside shrine, holds both a relic and its accompanying offerings — untouched for generations." },
    { title: 'The Siege Cache', story: "Behind a wall breached in some long-forgotten siege, a defender's hidden supply cache sits exactly where it was hastily stashed and never retrieved." },
    { title: 'The Drowned Village', story: "A village, lost to flooding decades past, gives up a strongbox from its sunken tavern — the coin inside still perfectly good despite the water." },
    { title: "The Hermit's Legacy", story: "A hermit's cave, long since abandoned, held more than mere solitude — a modest hoard, quietly accumulated over an entire lifetime of simple living." },
    // Trade / people
    { title: 'The Grateful Farmer', story: "A farmer, saved from a charging boar by your scouts' timely arrival, insists on paying them in coin he can genuinely ill afford to lose." },
    { title: 'The Retired Soldier', story: "An old veteran, visibly impressed by your lord's banner, offers a portion of his modest savings in exchange for news of the wars he once fought." },
    { title: 'The Traveling Tinker', story: "A tinker, low on supplies but rich in favors owed across the region, trades a genuinely useful sum for safe escort through the next valley." },
    { title: "The Widow's Gratitude", story: "A widow whose roof your scouts helped repair insists on paying rather more than the work was worth, and simply will not be argued back down." },
    { title: 'The Nervous Trader', story: "A trader, thoroughly spooked by recent bandit rumors, pays generously for an escort through the danger zone — cheaper, he reasons, than losing the whole wagon." },
    { title: 'The Debt Collector', story: "A merchant's agent, owed money by a debtor who's since fled the region, offers a fair cut of whatever your scouts can help him recover." },
    { title: "The Fortune Teller's Truth", story: "A wandering fortune teller, oddly precise about your lord's recent battles, offers good coin for the privilege of reading your future as well." },
    { title: 'The Guild Scout', story: "A trade guild's scout, quietly mapping safer routes through the territory, pays well for accurate information about roads and hazards nearby." },
    { title: 'The Repentant Thief', story: "A thief, caught entirely red-handed but showing what looks like genuine remorse, buys his freedom with everything he'd stolen and a bit more besides." },
    { title: "The Pilgrim's Offering", story: "A group of pilgrims, grateful for clear directions to their shrine, pool together a genuinely respectable donation as thanks for the help." },
    { title: "The Cartographer's Fee", story: "A mapmaker, out verifying old surveys, pays for confirmation of local terrain features and safe passage through the surrounding area." },
    { title: "The Ferryman's Bonus", story: "The local ferryman, whose business has suffered badly from nearby bandit activity, pays generously for scouts willing to help clear the threat." },
    { title: 'The Runaway Noble', story: "A minor noble, traveling incognito and rather low on funds, reveals himself gratefully once safe and pays handsomely for discretion and aid." },
    { title: "The Herbalist's Trade", story: "A traveling herbalist trades a genuinely valuable sum for local knowledge of the rare plants known to grow throughout the territory." },
    { title: 'The Insurance Agent', story: "A merchant consortium's representative pays steadily for verified reports on road conditions — dry paperwork, but decent, dependable coin." },
    // Misc adventure
    { title: 'The Puzzle Box', story: "An old puzzle box, found gathering dust in a market stall's forgotten inventory, finally yields its hidden compartment of coin to a patient scout." },
    { title: 'The Lucky Dice', story: "A gambler's abandoned kit, oddly, still holds his winnings intact — apparently he left in rather more of a hurry than a simple loss would explain." },
    { title: "The Shipwreck Survivor's Cache", story: "A survivor, long since moved on from the area, left behind a small cache of salvaged goods near the old wreck site." },
    { title: 'The Escaped Menagerie', story: "An exotic animal, escaped from some traveling show passing through, is worth a fair bounty to the beast-keeper desperate to recover it alive." },
    { title: "The Duelist's Stake", story: "The loser of an old duel, it seems, never returned to collect his forfeited stake. It's still sitting exactly where the second left it, untouched." },
    { title: "The Alchemist's Overflow", story: "An alchemist's failed experiment left behind, oddly enough, a small quantity of something genuinely valuable amid the general wreckage." },
    { title: 'The Race Winnings', story: "An old racing circuit's long-forgotten prize purse, sealed and entirely untouched, sits patiently in the ruins of the judge's booth." },
    { title: "The Smuggler's Toll", story: "A smuggler, caught and hanged years back by the look of the old gallows nearby, left his very last shipment stashed and permanently unclaimed." },
    { title: 'The Festival Aftermath', story: "A festival ground, long cleared of revelers, still holds a lost coin purse or two buried in the trampled grass if you know where to look." },
    { title: "The Cartwright's Payment", story: "A cartwright, paid well in advance for work he never lived to finish, left the coin sitting entirely untouched in his quiet workshop." },
    { title: "The Traveling Circus's Loss", story: "A circus wagon, broken down and long abandoned, still holds the day's take — the performers, it seems, never stayed to collect it." },
    { title: "The Duelist's Honor", story: "A dueling ground's long-forgotten prize chest sits waiting by old tradition for a victor who, as it turns out, never came back to claim it." },
    { title: 'The Lost Payroll', story: "A mercenary company's payroll wagon, ambushed and abandoned generations back, still holds its long-overdue wages, patient and undisturbed." },
    { title: 'The Tax Cart', story: "An old tax collection cart, waylaid before it ever reached the treasury, gave up its cargo to whoever found it first. Apparently, that's you." },
    { title: 'The Second-Hand Fortune', story: "A pawnbroker's stall, abandoned mid-transaction, holds rather more value in its unclaimed goods than its owner ever quite let on." },
  ],

  // ── Jackpot (15) — rare, dramatic, exceptional finds ─────────
  jackpot: [
    { title: "The Dragon's Forgotten Hoard", story: "Deep in a collapsed cave, past bones bleached white and stone scorched black, lies a hoard no dragon has claimed in a generation — and no one alive left to stop you taking it." },
    { title: "The Emperor's Lost Crown", story: "Buried alongside a king whose empire crumbled to dust and legend both, a crown of impossible craftsmanship waits in a tomb no living map remembers the location of." },
    { title: "The Archmage's Vault", story: "Wards long since faded to nothing, a vault once sealed by real magic now guards only silence — and treasures accumulated over the course of an extraordinarily long life." },
    { title: 'The Sunken Treasure Fleet', story: "A storm centuries past sank an entire treasure fleet in these shallow waters. Low tide, for the first time in living memory, finally reveals the wreckage." },
    { title: "The God-King's Tomb", story: "Legends called him a living god in his time. His tomb, untouched by thirty generations of graverobbers too frightened to try their luck, finally opens." },
    { title: "The Philosopher's Near-Stone", story: "Not the true philosopher's stone, but an alchemist's genuine masterwork all the same — gold transmuted by real, hard-won skill, hoarded and long forgotten in a hidden laboratory." },
    { title: 'The War Chest of a Fallen Kingdom', story: "An entire kingdom's treasury, hidden away before its final and total defeat, has waited centuries in the dark for someone to finally find the right hill." },
    { title: 'The Elven Reliquary', story: "A relic of the elder days, crafted by hands no longer living in this world, sits in a shrine that time itself seems to have quietly avoided." },
    { title: "The Pirate Lord's Last Prize", story: "The most successful raider in the sea's long history buried one final prize before vanishing forever from every record — and left, oddly, an accurate map behind." },
    { title: 'The Vault of the Last Duke', story: "A duke who saw his own line's end coming hid his entire fortune rather than let his enemies inherit a single coin of it. They never found it. You did." },
    { title: 'The Dwarven Forge-Hoard', story: "A master smith's life's work — weapons, gold, and gems collected over three centuries of relentless labor — sits undisturbed in a forge sealed shut by the mountain itself." },
    { title: "The Serpent Throne's Treasure", story: "A cult that once worshipped something ancient and serpentine left behind a hoard equal to their considerable fervor, right around the time their god stopped answering." },
    { title: "The Merchant Prince's Secret", story: "The wealthiest trader in the region's entire history vanished with his fortune rather than pay his debts. His hiding place, it turns out, was rather better than his morals." },
    { title: "The Crusader's Reward", story: "A holy order, wiped out to the very last knight defending this mountain pass, died with their entire war chest still strapped tight to the packhorses." },
    { title: "The First King's Cache", story: "Before the current dynasty, before even the wars that shaped this land as it now stands, a forgotten king hid his treasury against enemies who found him anyway. He lost. The gold, remarkably, remained." },
  ],
};

// Category → story tier mapping. Combat maps to bandit stories, nothing
// maps to no-reward lore, resource/item/trade share the reward pool,
// legendary maps to the rare jackpot pool.
// ('item' was 'event' until 2026-08-04 — see js/data/items.js.)
var STORY_QUEST_TIER_BY_CATEGORY = {
  combat:    'bandit',
  nothing:   'lore',
  resource:  'reward',
  item:      'reward',
  trade:     'reward',
  legendary: 'jackpot',
};

// Returns a random { title, story } for the given discovery category, or
// null if no story tier applies (e.g. 'intelligence' scan records).
function pickStoryQuest(category) {
  const tier = STORY_QUEST_TIER_BY_CATEGORY[category];
  const pool = tier ? STORY_QUESTS[tier] : null;
  if (!pool || pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}
