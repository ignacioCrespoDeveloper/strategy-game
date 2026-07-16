# ⚔️ Hexfront — Strategy Game Prototype

A browser-based hex-grid strategy game inspired by Total War / Catan.  
No build tools, no dependencies — open `index.html` directly in your browser.

---

## 🚀 Quick start

```bash
# Clone / download, then just open:
open index.html
# or drag index.html into your browser
```

For best results with a local dev server (avoids any CORS quirks):

```bash
# Python
python3 -m http.server 8080

# Node (if you have npx)
npx serve .
```

Then visit `http://localhost:8080`.

---

## 🎮 How to play

| Action | How |
|---|---|
| **Select unit** | Click any unit on the map |
| **Move unit** | Select unit → click "Move Unit" in the panel → click a highlighted hex |
| **View city** | Click any city (🏰) |
| **Build / upgrade** | Click city → use the Build panel on the right |
| **Train units** | Requires Barracks (level 1+) in the city |
| **End turn** | Click "End Turn" — income is collected, AI moves |

### Resources
- 💰 **Gold** — primary currency, used for everything
- ⚙️ **Iron** — for military buildings and elite units
- 🌾 **Food** — for training units
- 🌲 **Wood** — for buildings and early units

Resources are earned by **controlling hexes** containing resource nodes.  
Your zone of control = all hexes adjacent to your units.

---

## 📁 Project structure

```
hexfront/
├── index.html          # Entry point
├── css/
│   ├── main.css        # Layout, HUD, map, toast
│   └── panels.css      # Side panel, unit/city UI
└── js/
    ├── data.js         # All static data (units, buildings, map)
    ├── hex.js          # Hex math (centers, neighbours, BFS, click detection)
    ├── map.js          # Resource map, control zones, income
    ├── units.js        # Unit state, movement, combat
    ├── cities.js       # City state, buildings, training queue
    ├── renderer.js     # Canvas draw calls
    ├── ui.js           # Panel HTML generation
    ├── ai.js           # Enemy AI
    └── game.js         # Main controller, input, turn loop
```

---

## 🔧 Extending the game

### Add a new unit type
Edit `js/data.js` → `UNIT_TYPES`. Add your entry and update `BARRACKS_UNLOCK` to decide which barracks level unlocks it.

### Add a new building
Edit `BUILDING_TYPES` in `js/data.js`. The UI generates buttons automatically.

### Add a new resource
1. Add to `RESOURCE_DEF` in `data.js`
2. Add a spawn in `RESOURCE_SPAWNS`
3. Handle income in `map.js → collectIncome`

### Add multiplayer (future)
The game state in `game.js` is a single plain object — easy to serialise and sync via WebSocket.

---

## 🐛 Known Bugs

| # | Area | Description | Status |
|---|---|---|---|
| 1 | Quests | Sending a lord on a quest and finishing with credits **on the same tile** does nothing. Moving the lord to a different tile first, then sending + finishing works correctly. Root cause unknown — likely a timing issue between the action-complete tick and the credit-finish flow when the lord hasn't moved since the last quest. | **Pinned — needs investigation** |
| 2 | Economy | Gold generation from multiple cities is not being summed correctly — the HUD/overview appears to show only one city's gold rate instead of the total across all player cities. | **Fixed** — overview tick now runs `ProductionService.tick()` for all cities |
| 3 | Cities | City population status (Stable, Prosperous, Declining, etc.) does not update dynamically as population changes — the label appears static and does not reflect the current growth state. | **Fixed** — `getCityStatus()` now incorporates growth rate as a score modifier |
| 4 | Map / Bandits | Bandit camp unit cards in the map tile panel are empty — unit images or icons not rendering inside the camp preview cards. | **Pinned — needs investigation** |
| 5 | Map / Bandits | Attack button on the bandit camp card in the map right panel has very low contrast / nearly invisible styling. | **Fixed** — added `.btn-danger` CSS class (red, high contrast) |
| 6 | Rankings / HUD | Ranking position not shown next to username in the top bar. Rankings data may also be stale. Goal: display as `Username (#3)` in the HUD. | **Fixed** — HUD now saves score + fetches leaderboard async on show, displays `Username (#N)` |

---

## 🗺️ Roadmap ideas

- [ ] Fog of war (unit sight radius)
- [ ] City capture mechanic (garrison units)
- [ ] Tech tree (research with gold)
- [ ] Multiple maps / map editor
- [ ] Save / load (localStorage)
- [ ] WebSocket multiplayer
- [ ] Mobile touch drag-to-scroll
