# Hawk & Pigeon - Implementation Spec

## High-Level Summary

Web-based 3D chase game (Three.js). Two players, 1v1. One is a pigeon getting fat on street food, one is a hawk trying to kill them. Round ends when pigeon dies, then roles swap. Compete for fattest pigeon / fastest hawk kill on leaderboard.

---

## Match Flow

1. Players join lobby, pick starting roles (or randomize)
2. Both players spawn in NYC environment
3. Pigeon eats food → gets fatter → gets slower
4. Hawk hunts pigeon, manages hunger via ground prey
5. Round ends when:
    - Pigeon dies (hawk collision) → Record pigeon weight + survival time
    - Timer runs out → Pigeon survives, record weight
6. Roles swap, new round starts
7. After X rounds or manual quit → Show final scores

**Scoring:**

- Pigeon score: Total weight at death
- Hawk score: Time to kill
- Global leaderboard: Fattest pigeon ever, fastest kill ever

---

## Player Mechanics

### Pigeon

**Movement:**

- Base fly speed: 1.0 (units/sec, whatever makes sense)
- Turn radius: 2.0 (tight, responsive)
- Weight penalty: Speed multiplier = max(0.5, 1.0 - (weight × 0.05))
    - Example: At 10 weight units, speed = 0.5 (half speed)
- Tree navigation: No penalty
- Tight gaps: Can fit through openings 1.5× pigeon size

**Actions:**

- Fly (WASD + Space/Shift for up/down) + mouse movement for camera looking around.
- Perch (lands on ledge, stops moving, immune while perched? Or just resting?)
- Eat (automatic on collision with food)

**States:**

- Flying
- Perched
- Eating (locked in place for X seconds based on food size)

### Hawk

**Movement:**

- Base fly speed: 2.5 (2.5× pigeon base)
- Turn radius: 5.0 (wide, momentum-based banking)
- Energy boost: When well-fed, speed × 1.2
- Tree collision: 50% slowdown + takes damage (loses energy)
- Dive attack: When descending fast, speed × 1.5, turn radius × 2 (even clumsier)

**Actions:**

- Fly (same controls as pigeon)
- Dive (hold descend key to build speed)
- Eat (automatic on collision with prey)
- Kill pigeon (automatic on collision)

**States:**

- Flying
- Diving
- Eating (locked for X seconds)

**Energy system:**

- Starts at 100 energy
- Drains 1 energy/sec while flying
- At 50 energy: Normal speed
- Below 25 energy: 0.8× speed
- Eating rat: +20 energy (2sec eat time)
- Eating squirrel: +40 energy (4sec eat time, squirrels run away)
- Tree collision: -10 energy

---

## Environment

### Map Structure

Simple NYC block (can expand later):

- 4×4 city block grid
- Building heights: Randomized 3-8 stories
- 1 central park (50×50m) with scattered trees
- Street level with alleys between buildings

**Geometry (low-poly):**

- Buildings: Box primitives with simple window texture
- Trees: Cylinder trunk + cone/sphere canopy
- Ground: Plane with simple pavement texture
- Perchable surfaces: Building ledges, tree branches, park benches

### Cover Types

- **Dense (pigeon advantage):** Tree clusters in park, narrow alleys
- **Medium:** Fire escapes, building corners, benches
- **Open (hawk advantage):** Wide streets, rooftops, park center

### Visual Tracking

- Hawk must maintain line-of-sight to pigeon
- If pigeon breaks LOS for 3+ seconds, hawk loses "lock" (optional UI indicator)
- No minimap, pure visual hunting

---

## Food System

### Pigeon Food

All auto-collect on collision, triggers eating animation:

| Food Type | Weight Gain | Eat Time | Spawn Logic |
| --- | --- | --- | --- |
| Crumb | +0.5 | 0.5s | Common, scattered streets |
| Bagel piece | +2.0 | 2s | Uncommon, park benches |
| Pizza crust | +5.0 | 4s | Rare, random spawn every 60s |

**Spawn rules:**

- Start with 20 crumbs, 5 bagel pieces on map
- Pizza crust: 1 spawns every 60-90s at random street location
- Eaten food respawns after 30s at same location

### Hawk Food

Same auto-collect logic:

| Prey Type | Energy Gain | Eat Time | Behavior |
| --- | --- | --- | --- |
| Rat (small) | +15 | 2s | Stationary, some poisoned (-20 energy) |
| Rat (large) | +30 | 3s | Stationary |
| Squirrel | +40 | 4s | Runs away when hawk is close (5m range) |
| Dumb pigeon (AI) | +50 | 5s | Flies in simple loops, slow |

**Spawn rules:**

- 10 rats scattered on streets (3 poisoned, visually identical)
- 5 squirrels in park
- 3 AI pigeons flying lazy circles
- Respawn 15s after eaten

---

## Technical Requirements

### Engine: Three.js

**Why:** Web-based, no install, easy to share link with friends.

### Rendering

- Low-poly geometric city (keep triangle count low)
- Simple lighting: Directional sun, bright blue sky
- Third-person camera for both players:
    - Follow cam 5 units behind, 2 units above player
    - Smooth interpolation, collision with buildings

### Physics

**Go with easiest implementation:**

- Arcade flight controls (not full physics sim)
- Collision detection: Bounding boxes/spheres for players, food, buildings
- Simplified hitboxes for trees (cylinder for trunk, sphere for canopy)

### Networking

**Pick whichever is simpler:**

- **Option B:** WebRTC peer-to-peer
    - One player hosts, other connects
    - Simpler setup, no server needed
    - Trust-based (fine for friends)

**Data sync:**

- Player positions: 20 ticks/sec
- Food pickups: Event-based (immediate)
- Deaths/scoring: Event-based

### Controls

- WASD: Forward/back/strafe
- Space: Ascend
- Shift: Descend
- Mouse: Look/turn direction
- (Optional) Mouse click: Boost/special action

---

## Minimum Viable Product

### Must-Have (Phase 1)

- [ ]  Two players can connect and see each other
- [ ]  Basic flight controls for both pigeon and hawk
- [ ]  Simple 2×2 block city with 1 small park
- [ ]  Collision detection: Player vs player, player vs food, player vs buildings
- [ ]  Pigeon eating mechanics + weight gain + speed penalty
- [ ]  Hawk eating mechanics + energy system
- [ ]  Round end on pigeon death, display scores
- [ ]  Role swap between rounds

### Should-Have (Phase 2)

- [ ]  Full 4×4 city block
- [ ]  Tree collision slowdown for hawk
- [ ]  Dive attack speed boost
- [ ]  Proper camera collision with buildings
- [ ]  Audio cues (hawk screech, pigeon coo, eating sounds)
- [ ]  HUD: Current weight (pigeon), energy (hawk), timer

### Nice-to-Have (Phase 3)

- [ ]  Leaderboard (persistent, needs database)
- [ ]  AI prey (dumb pigeons, running squirrels)
- [ ]  Poisoned rats
- [ ]  Visual polish (better textures, particles for eating)
- [ ]  Spectator mode
- [ ]  Multiple map variants

---

## Open Questions for Implementation

1. **Perching:** Should perched pigeon be immune to hawk attacks, or just resting? (Suggest: Not immune, just stationary)
    1. Perched pigeon is not immune to hawk attacks but would allow staying in tree.
2. **Death feedback:** Hawk catches pigeon → instant round end, or brief "got caught" animation?
    1. Some got caught animation or something. Think fromsoft’s dark souls “YOU DIED”
3. **Respawn location:** New round starts both players at same spawn points, or randomized?
    1. Randomized
4. **Weight visualization:** Does pigeon model actually scale up visually?
    1. Absolutely yes. Just make the whole thing scale by some factor. Make it ridiculous and easy for now.
5. **Hawk vision mode:** Any visual indicator when hawk has "lock" on pigeon? (Optional aim reticle when close?)
    1. This seems hard so no.

---

## Implementation Priority

**Start here:**

1. Get two players moving in a basic 3D space
2. Add simple collision (player vs player = death)
3. Add one food type for pigeon
4. Add weight gain → speed penalty
5. Add round timer and scoring

**Then add:**
6. Full map with buildings
7. Hawk energy system + food
8. Tree obstacles
9. Audio and polish

**Finally:**
10. Leaderboard
11. AI prey