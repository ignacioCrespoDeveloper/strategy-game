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

## 🗺️ Roadmap ideas

- [ ] Fog of war (unit sight radius)
- [ ] City capture mechanic (garrison units)
- [ ] Tech tree (research with gold)
- [ ] Multiple maps / map editor
- [ ] Save / load (localStorage)
- [ ] WebSocket multiplayer
- [ ] Mobile touch drag-to-scroll
