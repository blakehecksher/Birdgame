# 2026-02-15 0015 — Netcode Plan Review & Assumptions

## Unstated Assumptions (Making Them Explicit)

### Game Design Assumptions

1. **2-5 simultaneous players maximum**
   - Bandwidth/CPU calculations assume small sessions
   - Collision checks are O(n²) player-vs-player, acceptable for small n
   - More than 5 players would need spatial partitioning

2. **Asymmetric roles are balanced for ~equal skill players**
   - Hawk should catch pigeon ~50% of the time in fair conditions
   - Currently tuned for local play (zero latency)
   - Online play with 50-100ms RTT may shift this balance significantly

3. **Rounds are short (3 minutes)**
   - Network issues during a single round are acceptable if rare
   - A dropped connection can just end the round (no complex reconnect-and-resume)
   - Bandwidth costs over 3 minutes are negligible even at higher rates

4. **Visual accuracy matters more than competitive fairness**
   - This is a casual party game, not an esport
   - Players tolerate "that felt close" more than "my opponent teleported"
   - Prioritize smoothness over precision

### Network Architecture Assumptions

5. **Host has stable connection and adequate device**
   - Host is authoritative for all simulation
   - If host lags/drops, game is unplayable for everyone
   - No host migration, no dedicated servers
   - **Question: Is this intentional? Should we handle host quality better?**

6. **WebRTC data channels are the only transport**
   - No fallback to WebSocket relay if P2P fails
   - NAT traversal assumed to work (PeerJS uses public STUN/TURN)
   - **Question: Have you tested this across different ISPs/firewalls?**

7. **Browser performance is "modern enough"**
   - Assumes stable 30fps minimum on all devices (mobile included)
   - Assumes WebGL is hardware-accelerated
   - Assumes WebRTC implementation is not severely broken
   - **Question: What's your oldest target device/browser?**

8. **Players are cooperating, not adversarial**
   - No anti-cheat considerations
   - Clients could manipulate input or timing, but we assume they don't
   - **Question: Playing with friends only, or public matchmaking eventually?**

### Technical Implementation Assumptions

9. **PeerJS abstracts WebRTC complexity adequately**
   - Assuming reliable DataChannel works as expected
   - Assuming `reliable: false` is actually unreliable-unordered (needs verification)
   - Assuming no major PeerJS bugs in reconnection logic
   - **Question: Have you tested reliable vs unreliable channels in PeerJS?**

10. **Current collision detection is correct**
    - Ellipsoid checks are accurate enough
    - No tunneling issues (fast-moving objects passing through each other)
    - Collision radii are already well-tuned for local play
    - **Question: Have you seen any tunneling/pass-through issues locally?**

11. **Fixed timestep won't break existing systems**
    - Assuming UI, audio, camera can stay on variable deltaTime
    - Assuming NPC AI is deterministic enough to run fixed-step
    - Assuming no hidden frame-rate dependencies in third-party code (Three.js)
    - **Question: Are there any known frame-rate-dependent behaviors?**

12. **Bandwidth is effectively unlimited**
    - Assuming nobody is on metered mobile data during play
    - Assuming residential upload (host) can handle 5-10 KB/s per client
    - Assuming residential download (clients) can handle 5-10 KB/s
    - **Question: Are mobile data users a concern?**

### Player Experience Assumptions

13. **Players understand this is P2P, not server-based**
    - Expectations are tempered (not expecting CS2 netcode)
    - Players accept that host has slight advantage
    - Players accept that high ping = worse experience
    - **Question: Will you show RTT/ping in the UI?**

14. **Close calls should favor the attacker (hawk)**
    - Standard FPS philosophy: shooter sees hit = hit registers
    - Pigeon might feel "I dodged that" but hawk sees catch = catch counts
    - **Question: Is this acceptable, or should it feel more "fair" to pigeon?**

15. **Jitter is more annoying than latency**
    - Players tolerate 100ms of consistent delay
    - Players hate unpredictable 0-200ms jumps
    - Smooth motion beats perfectly accurate position
    - **Question: Agree with this priority?**

---

## Questions I Need Answered

### Scope & Constraints

**Q1: What platforms/browsers/devices MUST work?**
- Desktop: Chrome/Firefox/Safari on Windows/Mac/Linux?
- Mobile: iOS Safari, Android Chrome? Minimum OS versions?
- VR/console: Any future plans that affect architecture?

**Q2: What's your target player geography?**
- Same city (< 20ms RTT)?
- Same country (< 80ms RTT)?
- Cross-country US (80-150ms RTT)?
- International (> 150ms RTT)?

**Q3: What's your tolerance for bandwidth usage?**
- Is 10-15 KB/s per client acceptable?
- Do you care about mobile data caps?
- Can we assume symmetric upload/download?

**Q4: What's your risk tolerance for complexity?**
- Are you comfortable with a fixed-timestep refactor (Phase 4)?
- Would you rather stay simple and just tune parameters?
- Do you have time/interest to test complex changes, or keep it minimal?

### Player Experience

**Q5: How important is competitive fairness vs. fun?**
- Is this friends-only casual, or will strangers play together?
- Should hawk/pigeon win rates stay 50/50 online, or is 60/40 acceptable?
- Do you want visible feedback (RTT display, "lag compensation active" indicator)?

**Q6: What does "good enough" look like?**
- No complaints from friends during playtests?
- Smooth enough that lag is rarely mentioned?
- Competitive enough for local tournaments?

**Q7: Which is more frustrating: false positives or false negatives?**
- False negative: "I hit them but it didn't count" (current problem)
- False positive: "They didn't touch me but I got caught" (risk of over-correction)

### Technical Constraints

**Q8: Have you tested WebRTC unreliable channels in PeerJS?**
- Does `reliable: false` actually work?
- Have you measured packet loss tolerance in testing?

**Q9: Can the host be assumed to be the "best" device?**
- Will mobile devices ever host, or only join?
- Should we detect and warn if host device is low-performance?

**Q10: What's your deployment model?**
- Static build on GitHub Pages (current)?
- Could you add a signaling server for better TURN/STUN?
- Any plans for a lightweight relay server if P2P fails?

### Monitoring & Iteration

**Q11: Can you collect anonymous telemetry?**
- Would help tune parameters based on real usage
- Could identify network quality thresholds
- Privacy concerns if public?

**Q12: How will you test the changes?**
- Do you have a group of friends who can playtest?
- Can you simulate network conditions (latency/jitter/loss)?
- Will you roll out incrementally or all-at-once?

---

## Realistic Expectations for PeerJS/WebRTC P2P Gaming

### The Good News

**WebRTC P2P can work well for small, casual multiplayer games.** Here's what you can realistically expect:

#### Same-City Play (< 30ms RTT)
- **Excellent.** Almost indistinguishable from local play.
- Collision will feel tight, motion will be smooth.
- Your current architecture would work with minimal tuning.

#### Same-Coast Play (30-80ms RTT)
- **Good to Very Good** with proper netcode.
- With Phases 1-2 (reduced buffer, tighter reconciliation), this should feel responsive.
- Hawk catches will occasionally feel "close" but mostly fair.
- This is where most of your US friends will fall.

#### Cross-Country US (80-150ms RTT)
Example: You in one state, friend in Washington, another in NYC, another in New Mexico.

- **Playable but noticeable** without lag compensation.
- ~100ms RTT means ~220ms effective latency with current 120ms buffer.
- **With Phases 1-5 (full plan):** Should feel acceptable. Hawk catches might feel slightly "laggy" but not broken.
- **Without lag comp (Phase 5):** Hawk will miss catches that looked good; pigeon will get caught "unfairly."
- Jitter and packet loss matter more than average RTT here.

#### International (> 150ms RTT)
- **Frustrating.** Even with perfect netcode, 200ms+ RTT breaks fast-paced action.
- Lag compensation helps but can't fix fundamental "I'm playing in the past" feel.
- Not worth optimizing for unless you have international friend groups.

### WebRTC vs. Dedicated Servers

You asked about CS2 comparison. Here's the honest breakdown:

| Aspect | CS2 (Dedicated Server) | Your Game (P2P WebRTC) |
|--------|------------------------|------------------------|
| **Latency** | 10-50ms to server, symmetric | 20-150ms peer-to-peer, asymmetric (host advantage) |
| **Tick Rate** | 64-128Hz | 30-60Hz realistic max |
| **Netcode Maturity** | 20+ years of iteration | Built from scratch |
| **Lag Compensation** | Server-authoritative rewind, proven | DIY, untested at scale |
| **Bandwidth** | Optimized delta compression | Naive full-state sync |
| **Cheating** | Server validates everything | Trust-based (fine for friends) |
| **Scale** | 10-64 players | 2-5 players max |
| **Infrastructure Cost** | $$$$ (server hosting) | $0 (P2P) |

**Bottom line:** Your game will never feel as tight as CS2, but it doesn't need to. CS2 is a competitive esport; yours is a casual party game. Different standards.

### Realistic Targets for Your Friend Group

Based on rough US geography:

- **Washington ↔ NYC:** ~80ms RTT
- **Washington ↔ New Mexico:** ~60ms RTT
- **Washington ↔ Oklahoma:** ~65ms RTT
- **NYC ↔ New Mexico:** ~70ms RTT
- **Your location ↔ each friend:** varies

**If you're in the middle (Oklahoma/New Mexico):** You'd make a great host. Everyone under 80ms.

**If you're on a coast (Washington/NYC):** Cross-country friends will be 80-120ms.

#### What This Means

**With just Phases 0-2 (low-risk tuning):**
- Same region (< 50ms): Great, no complaints.
- Cross-region (50-100ms): Acceptable, occasional "close call" frustration.
- Cross-country (100-150ms): Playable but laggy. Hawk misses obvious catches.

**With Phases 0-5 (full plan):**
- Same region (< 50ms): Excellent.
- Cross-region (50-100ms): Good, competitive.
- Cross-country (100-150ms): Acceptable for casual play. Not competitive but fun.

**With any implementation:**
- Jitter/packet loss on WiFi: Occasional stutters, but interpolation smooths it.
- Mobile host: Risky. Desktop host strongly recommended.
- Host migration: Not supported. If host drops, game ends.

### The Elephant in the Room: Host Advantage

P2P with host authority means **the host has a structural advantage:**

- Host's inputs are applied instantly (no network delay).
- Host sees other players' true positions (clients see 60-120ms old positions).
- Host's collision checks are authoritative.

**In practice:**
- If host plays hawk: ~5-10% higher catch rate vs. equivalent skill client hawk.
- If host plays pigeon: ~5-10% higher survival rate vs. equivalent skill client hawk.

**Mitigation:**
- Lag compensation (Phase 5) helps client hawks a lot.
- You could rotate host each round to balance.
- Or embrace it: host picks teams, balances by skill.

### What You Should Tell Your Friends

> "This is a P2P browser game, so there's some latency. If we're on the same coast, it feels great. Cross-country is playable but you might see some lag on fast movements. Whoever hosts has a tiny advantage, so we can rotate. Don't play on mobile data or crappy WiFi."

### What You Should NOT Expect

**Don't expect:**
- Frame-perfect competitive gameplay at 100ms+ RTT
- Perfect hit registration across all network conditions
- Smooth performance with packet loss > 5%
- Mobile host to handle 4 desktop clients reliably
- International play (> 200ms) to feel good

**Do expect:**
- Fun, chaotic party game vibes
- Occasional "WTF, I dodged that!" moments
- Need to pick a good host (desktop, wired, central location)
- Some network troubleshooting with friends ("turn off your VPN")

---

## Recommendation Summary

### Minimum Viable Improvement (Phases 0-2 only)
- **Effort:** 1-2 weeks
- **Risk:** Very low
- **Result:** 50-70% reduction in complaints for < 100ms RTT

If your friend group is mostly same-region, **stop here**. Don't over-engineer.

### Competitive Improvement (Phases 0-5)
- **Effort:** 4-8 weeks (Phase 4 is a big refactor)
- **Risk:** Medium (Phase 4 can introduce regressions)
- **Result:** Playable and fun up to ~120ms RTT

If your friend group is cross-country, **do this**. Worth the investment.

### Overkill (Phases 0-6 + extras)
- **Effort:** 10+ weeks
- **Risk:** High (complexity debt)
- **Result:** Marginal gains over Phase 5

Only if you're building a commercial product. Not worth it for friends.

---

## Next Steps

1. **Answer the questions above** so I can refine the plan.
2. **Define your target quality bar:** "Good enough for cross-country friends" vs. "polished for strangers."
3. **Decide on scope:** Phases 0-2 (safe), 0-5 (ambitious), or custom.
4. I'll integrate this analysis + your answers into a final implementation plan.

