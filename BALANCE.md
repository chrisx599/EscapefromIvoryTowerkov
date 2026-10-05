# Probability balance audit

Developer reference only. The player interface uses narrative outcomes, resource costs and progress requirements, not these formulas or hidden outcome forecasts.

## Versions and scope

- Baseline: commit `10541b7a37224ce8666e9c4a9969a37d757c9855`, archived before concurrent edits
- New raids: `probabilityVersion: 4`; pure formulas live in `src/raid-balance.js`
- New research: `balanceVersion: 2`; pure formulas live in `src/research-factors.js`, paid action/state transitions in `src/research.js`
- Career envelope remains version 2. Existing v3 raids retain old formulas, context depth progression, generated encounters, RNG and settlement; they are not silently restarted
- Already active research projects without the v2 marker retain original experiment/review rules, costs and minimum two-run submission, while future XP/method awards use the new learning budgets. This does not promise byte-identical legacy research trajectories. Already-ready manuscripts stay ready. Titles, earned papers, milestones, equipment and funds are not revoked
- Legacy XP converts to a minimum earned-level floor `min(10, 1+floor(XP/3))`; raw XP remains intact. Repeated migration neither increases that floor nor grants milestones again
- This is a local game simulation and regression audit, not a claim of player enjoyment, a security boundary against edited saves, or a wall-clock playtime estimate

## RNG, reproducibility and interpretation

Game outcomes use saved xorshift32 state: `x ^= x<<13; x ^= x>>>17; x ^= x<<5`, then unsigned `x/2^32`. Research and raids own separate saved streams. Views do not draw. Action validation precedes payment and RNG mutation. A failed promotion is a committed result; an immediately blocked retry draws nothing. A supported decision still consumes the action's draw. No statistical sample uses small consecutive seeds directly: the audit avalanches `index+1 XOR imul(stream+1,0x9e3779b9)` with multipliers `0x21f0aaad` and `0x735a2d97`. Paired before/after cohorts use identical seed families, but changed branching can consume different numbers of draws.

Reproduce from the repository root (Node 22+):

```sh
node --test tools/balance-audit.test.mjs
node tools/balance-simulation.mjs --seeds 1000 --json /tmp/balance-after.json
node tools/balance-simulation.mjs --seeds 64 --sections economy --json /tmp/economy-after.json
mkdir -p /tmp/ivory-balance-baseline
# Read-only Git export, not a checkout/reset of the working tree:
git archive 10541b7a37224ce8666e9c4a9969a37d757c9855 | tar -x -C /tmp/ivory-balance-baseline
node tools/balance-simulation.mjs --root /tmp/ivory-balance-baseline --seeds 1000 --json /tmp/balance-before.json
node tools/balance-simulation.mjs --root /tmp/ivory-balance-baseline --seeds 64 --sections economy --json /tmp/economy-before.json
```

`--sections` supports `raids,research,starter,promotion,progression,recovery,learning,economy`; the expensive coupled `economy` audit is opt-in. JSON includes source SHA-256 fingerprints, seed/policy metadata, min/mean/p50/p90/p99/max, actual completion counts and relevant tail counts. Percentiles are nearest-rank sample percentiles. At n=1,000, a roughly 50% observed rate has about ±3.1 percentage-point binomial 95% sampling error. At n=64, p99 equals the sample maximum; neither is a population worst-case guarantee.

Fixtures: beginner is stage 0/level 1, default equipped starter inventory at conference; mid is stage 3/earned level 4 at visit with remote terminal, literature assistant, experiment tracker and portable SSD; late is stage 6/earned level 7 at industry with remote terminal, literature assistant, data cleaner, custom lab pack and encrypted SSD. The same earned levels are maintained with migration floors in the new model. These are representative equipment/title snapshots, not claims that these tiers use equal-cost gear or venue. Tier-to-tier changes therefore combine progression with venue difficulty. Within a tier, difficulty comparisons share gear and skill.

The raid policy uses only the visible standard search, targets four or eight searches, takes whatever fits, resolves the first legal non-exit option and extracts when the target is reached or remaining will cannot fund another search. Neutral options are shuffled before display, so this is a blind fixed-slot policy, not an oracle selecting a hidden best check. No supplies or backup protection are added. Resource recovery uses the same visible search at free easy conference, four-search outings, real settlement, shop purchases and surplus sales. Automatic or exhaustion-shortened eight-search outings remain in the statistics; they are never replaced with artificial eight-search states. Narrative encounter pacing and story callbacks are included.

## Raid v4: exact rules

All raid formulas below are percentage points, rounded to one decimal after bounding. `C(x,a,b)` clamps to `[a,b]`. Skill levels are integer 1–10 and `f(L)=(L-1)/(L+2)`. Thus every further level gives less benefit. Inputs are bounded: risk `R` 0–100, depth `D` 0–4, past searches `N` 0–40, `w=C(will/willMax,0,1)`, `l=C(load/capacity,0,1)`, fatigue `F=C((.35-w)/.35,0,1)`, load pressure `H=C((l-.6)/.4,0,1)`, familiarity `A=min(C(stage,0,7),C(venueMinStage,0,7))`.

| Venue | Unlock | Entry fee | Base risk B | Search growth V | Search difficulty Z | Extra drop | dataset/code/compute/wind weights |
|---|---:|---:|---:|---:|---:|---:|---|
| Conference | 0 | 0 | 5 | 8 | 0 | 0 | 4/3/2/1 |
| Visit | 2 | 40 | 12 | 12 | 8 | 25 | 5/4/1/2 |
| Industry | 4 | 80 | 20 | 16 | 16 | 50 | 2/3/6/2 |

| Difficulty | Search dS | Risk dR | Event dE | Extra dX | Scatter dF | Partial dP |
|---|---:|---:|---:|---:|---:|---:|
| Easy | +6 | -3 | +7 | 0 | -2 | -1 |
| Normal | 0 | 0 | 0 | 0 | 0 | 0 |
| Hard | -8 | +4 | -9 | +18 | +4 | +3 |

**Search**: `C(56+24f(research)+G+.5A+dS-Z+contextS-.1R-2D-1.2max(N-2,0)-10max(.5-w,0)-6max(l-.65,0),12,84)`. Gear `G` sums laptop 1/GPU 2/remote 3; scanner 1.5/literature assistant 1/experiment tracker 1/data cleaner 2, capped at 4. Context search is capped -25…25. Searches always cost one will, even on a miss.

Default novice starter equipment includes the laptop: first-search easy/normal/hard acquisition is 63/57/49%. For one standard search with no intervening event, full extraction is 85.9/81.7/73.2% and scatter is 4.9/7.5/12.3%. Without the laptop the first-search figures are 62/56/48%; these exact-state examples are not the multi-action cohort averages.

**Risk after a search**: `C(R+max(1,V+dR+contextR+.7D+.25max(N-3,0)-2f(engineering)),0,100)`. Context risk is capped -10…10. Search uses pre-action state; risk changes before encounter resolution; standard search then increases depth by .5 up to 4.

**Extraction**:

- Scatter `C(4+.25B+.18R+.0012R²+1.4D+.45max(N-2,0)+5H+3F+dF+contextF-3.5f(engineering)-storage-.25A,3,42)`
- Partial `C(9+.18R+.65D+.3max(N-2,0)+3H+2F+dP+contextP-3.5f(expression)-support,6,36)`
- Full `100-scatter-partial`, hence at least 22 and no more than 91
- Storage is 3 with encrypted SSD, otherwise 0; support is bounded 0–8. Context scatter/partial are bounded -5…5/-8…8 and exclude the legacy depth term, so depth is counted once
- One extraction draw selects scatter, then partial, then full. Full keeps all carried items; partial loses at most one lowest-value unprotected research material; scatter loses all unprotected carried items. Specified backup materials survive. Permanent equipped gear is not lost

**Neutral event checks**: `C(base-5+18f(relevant skill)+evidence+gear+communication+trust+dE+contextCheck+.25A-.08R-.8D-3F-1.5H-eventDifficulty,18,88)`. Base is seeded 50–71 and choices are shuffled once at encounter creation. Evidence has cap 12; relevant held material contributes 3 (NPC wind/coop; resource dataset/code; technical code/compute; route wind). Gear cap is 8, communication cap 5 (earplugs 3, headphones 5), trust -6…6, context check -12…12, combined venue/event/check difficulty 0–25. Legacy-shaped checked choices in new raids use their base without the -5 adjustment and a bounded skill scale up to 24 instead of 18. Explicit non-random exchanges/legacy purchased abilities remain deterministic when their requirements are met; they are not ordinary checks.

**Encounter pacing**: no event while an event is pending, next search consumes the last will, a one-search cooldown is active, four events have occurred, or the pool is exhausted. A ready story callback or the second opening eligible search is guaranteed; after the first event, three dry eligible searches force the next. Otherwise chance is `C(10+B+.5*riskAfterSearch+contextEncounter+15*dryStreak,5,80)` (dry-streak bonus applies after the first encounter). These guarantees schedule encounters, not successful event outcomes.

**Material draw**: weight is `venueWeight*(1+C(specialtyBonus,0,50)/100)*fieldMultiplier`. V4 doubles prior specialty bonuses: wind scanner 20; compute laptop 8/GPU 16/remote 24; dataset literature assistant/data cleaner 16; code tracker 16. Choose the first material proportional to weights. After a successful search, independently draw an extra material with probability `C(venueExtra+dX+contextExtra,0,75)`; context extra is capped -15…20. A material with normalized weight `q` therefore has hit probability `searchProbability * [q+extraProbability*q*(1-q)]`. Bags can reject excess loot, so a raw hit is not necessarily a returned item.

Fields last two searches, then transition once via saved RNG to a different non-arrival field. Their search/encounter/risk/partial/scatter modifiers are: arrival 0/0/0/0/0; exchange +6/+10/+2/+2/0; sidepath -4/-10/-2/-2/-1; lab +8/+5/+2/0/+2; checkpoint -5/+12/+3/+4/+1; archive +5/-4/+1/-1/0. Field material/event weights and two-search event momentum are explicit fixed tables in `probability-raid.js` (`FIELD_CONDITIONS`, `MOMENTUM`), not new RNG multipliers on view. Existing cautious/deep action IDs remain compatible but are not used to prove recovery or present-day pacing.

## Research v2: exact rules

Use probability fractions in this section. Clamp scalar inputs to quality/evidence 0–100, skill 1–10, preparation 0–2, equipment 0–12, headroom 0–2, methods 0–30, scope 0–2, support 0–6, stage 0–8. Define `s(L)=(L-1)/(L+3)` and `d(x,k)=x/(x+k)`. `T` is 1 for automatic/matching topic fit, `Q,E` quality/evidence, `P` preparation, `K` experiment gear, `M` method practice, `U` title plus preserved legacy support, `S` scope, `J` stage.

Experiment success:

`C(.435+.075s(engineering)+.065s(research)+.07d(K,5)+.03*headroom/2+.05P/2+.035T+.075d(M,10)+.045Q/100+.035E/100+.02U/6-.035S-.004J,.30,.85)`

Successful quality gain is `13+floor(3s(engineering)+3s(research)+5d(K,5)+2P+2T+2d(M,10)+U)`; unsuccessful gain is `8+floor(1.5s(engineering)+1.5s(research)+P+U/2)`. Successful evidence gain is `14+floor(5s(research)+3d(K,5)+2P+3d(M,10))`; unsuccessful gain is `6+floor(2s(research)+P)`. Both project totals cap at 100. Failure still records useful diagnostic work; it does not count as a successful experiment.

Minimum submission runs are `3+scope`, then at least one additional real run after every returned review. Ordinary review acceptance is zero until `Q>=60+5S` and `E>=40+10S`. Once eligible:

`C(.20+.24Q/100+.23E/100+.08s(expression)+.045P/2+.035T+.06d(M,10)+.025d(K,5)+.025s(research)-.035S-.004J-typePenalty,.20,.90)`

Type penalty is replicate 0/evaluate .02/finetune .04. A failed review is rejection while Q<60 or E<45, otherwise revision. There is no deterministic ordinary acceptance even at maximum quality/evidence.

**Finite supported tail, explicitly separate from ordinary chance**: at most five new paid experimental rounds. Subsequent actions reuse that project's data with zero cards/fee, quality gain at least 15 and evidence gain at least 20, and no XP or method-practice award. After at least four prior failed reviews, six total runs, Q≥80 and E≥65, the next revised review is accepted through support. Actual worst-draw action tests reach publication readiness within `7+scope` runs. This is a deliberate no-softlock exception, not an ordinary probability of 100% disguised as a random check.

| Project | Start funding ×(scope+1) | Initial material | Paid-round fee ×(scope+1) | Paid compute cards | Publication credit/grant ×(scope+1) |
|---|---:|---|---:|---:|---|
| Replicate | 30 | dataset 1, code 1 | 18 | 1 | 30 / 80 |
| Evaluate | 40 | dataset 1, wind 1 | 24 | 1 | 45 / 100 |
| Finetune | 80 | dataset 1, code 1 | 48 | 1 | 80 / 180 |

Modern compute cards cost one per paid round at every scope. Higher scope still requires stronger equipment, skills, more initial runs, harder checks and scaled funding. This was calibrated after a preliminary scope-scaled-card build doubled resource grind. Legacy active projects retain one-plus-scope cards and the original 30/40/80 ×(scope+1) fees.

Initial quality is `min(100,25+min(8,literatureBonus)+4P+2*titleRank+legacyInitialSupport)`; evidence is `5P`. Title rank is 0 before stage 1, 1 at stages 1–2, 2 at 3–5, 3 at 6–8. Raw materials substitute only at project start (unpublished→dataset; preprint/inside/funding_tip→wind), providing preparation for that input. Unused old prepared notes remain; support never duplicates material.

New XP level thresholds are `[0,3,9,18,30,45,63,84,108,135]`. Paid experimental rounds award 2/1/1/1/0 engineering and research XP; only the first two submissions award expression XP; publication adds two research and expression XP. Lifetime per-project caps are engineering 5/research 7/expression 4. Scope 0/1/2 learning stops at XP 29/83/135, therefore level 4/7/10, without reducing preexisting earned XP/levels. Method practice increases only on the first five paid rounds and caps at 10/20/30 by scope; old larger practice values are preserved. Abandoning consumes resources and preserves only genuinely earned bounded learning. Raids still award up to three research and expression XP per settlement based on real searches/replies.

## Promotion probability, retries and prerequisites

Prerequisite stages (papers/credit/engineering+research level) remain: master 1/30/2, PhD 2/75/2, postdoc 4/180/3, lecturer 6/300/3, associate professor 9/550/4, professor 12/850/4, distinguished scholar 16/1200/5, academician 20/1700/5. Expression requires max(1, required skill−1). Portfolio requires strong papers (Q≥80,E≥65) OR highest method practice: 1/2,1/4,2/7,2/10,3/14,4/18,5/24,6/30 respectively. Scope unlocks at stages 3/6, subject to real capacity/skill prerequisites. GPU capacity 2 unlocks at stage 1; remote capacity 3 at stage 3, before the level-5 promotion gates.

For next stage `J`, let paper surplus `p` be papers minus required, credit surplus `c` be `(credit-required)/max(1,required)`, skill surplus `k` be average of the three levels minus required, representative ratio `r` be strong papers/required, and practice ratio `m` be highest method/required. Bound p 0–1000, c 0–100, k 0–9, r/m 0–1. With prior failures `f`:

`C(.53+.06d(p,3)+.05d(c,1)+.045d(k,3)+.04r+.035m-.006J+.04C(f,0,2),.48,.82)`

Failure preserves title, papers, funds and prerequisites, then locks retries until advancement rises by two since the failed attempt. Publishing adds two; settling an outing with at least three actual searches adds two even after imperfect extraction. Empty deployment, fewer than three searches, views, time, reload, repeated clicks and duplicate settlement add none. `promotion={target,attempts,failures,lastProgress,lastOutcome}` and advancement are saved. The fourth qualified attempt receives supported acceptance, requiring genuinely new progress after all three failures. One-time grant ledger is independent: grants 180/220/280/340/400/460/520/600 are paid once per newly earned title.

## Measured results

<!-- RESULTS: generated from fixed-seed action-level JSON; final one-card modern rule -->

### Raid outcomes (1,000 careers per row)

Returned loot counts include all settled carried/protected items, not merely successful searches. Tail tuples are p50/p90/p99/max. Scatter is total unprotected-item loss; a zero-loot return also includes empty or partially lost bags. All four-search policies reached four searches; the eight-search cohorts include early exhaustion.

| Tier / venue | Difficulty | Target | Mean loot before→after | Loot tail before→after | Scatter % before→after | New zero-return % | New early-stop % | Event success % before→after |
|---|---|---:|---|---|---|---:|---:|---|
| beginner/conference | easy | 4 | 2.884→2.518 | 3/4/5/5→3/4/5/5 | 4.4→12.4 | 14.2 | 0.0 | 73.2→63.5 |
| beginner/conference | easy | 8 | 4.994→3.382 | 6/7/8/8→4/6/8/8 | 9.9→29.5 | 29.9 | 21.8 | 71.0→61.1 |
| beginner/conference | normal | 4 | 2.802→2.104 | 3/4/5/5→2/4/5/5 | 7.6→16.0 | 20.4 | 0.0 | 62.2→55.5 |
| beginner/conference | normal | 8 | 4.798→2.564 | 5/7/8/9→3/6/7/8 | 13.9→38.6 | 39.2 | 31.4 | 60.2→52.4 |
| beginner/conference | hard | 4 | 3.211→1.631 | 3/5/6/7→1/4/6/6 | 12.6→30.1 | 36.9 | 0.0 | 50.8→44.5 |
| beginner/conference | hard | 8 | 4.920→2.040 | 6/7/8/9→1/5/7/8 | 19.8→42.4 | 44.7 | 45.4 | 49.1→41.5 |
| mid/visit | easy | 4 | 3.631→3.293 | 4/6/7/8→4/6/7/8 | 4.7→16.2 | 16.8 | 0.0 | 70.3→66.3 |
| mid/visit | easy | 8 | 6.042→4.159 | 7/9/10/10→5/8/9/10 | 11.5→35.2 | 35.2 | 21.1 | 69.7→64.4 |
| mid/visit | normal | 4 | 3.622→2.731 | 4/6/7/8→3/5/7/8 | 8.4→22.2 | 23.5 | 0.0 | 59.6→57.4 |
| mid/visit | normal | 8 | 5.853→3.144 | 7/9/9/10→3/8/9/10 | 14.6→43.0 | 43.3 | 32.1 | 58.6→55.0 |
| mid/visit | hard | 4 | 4.187→2.258 | 4/7/8/9→2/5/7/9 | 10.6→30.7 | 34.0 | 0.0 | 48.9→48.0 |
| mid/visit | hard | 8 | 6.173→2.945 | 7/9/10/10→3/7/9/10 | 17.3→41.6 | 42.3 | 44.6 | 48.1→45.3 |
| late/industry | easy | 4 | 4.619→3.777 | 5/7/9/9→4/7/8/9 | 4.5→15.8 | 17.1 | 0.0 | 70.2→65.5 |
| late/industry | easy | 8 | 7.464→4.686 | 9/11/12/13→5/10/11/12 | 15.2→37.4 | 37.4 | 12.8 | 68.1→61.3 |
| late/industry | normal | 4 | 4.613→3.092 | 5/7/9/9→3/6/8/9 | 6.9→21.3 | 23.4 | 0.0 | 59.8→58.3 |
| late/industry | normal | 8 | 7.497→4.033 | 9/11/12/12→4/9/11/12 | 16.7→39.1 | 39.4 | 16.6 | 58.3→54.6 |
| late/industry | hard | 4 | 5.178→2.328 | 6/8/9/9→2/6/7/9 | 9.8→32.8 | 37.3 | 0.0 | 46.9→48.1 |
| late/industry | hard | 8 | 8.105→3.280 | 10/11/12/13→3/8/11/12 | 15.8→41.7 | 42.7 | 24.8 | 46.1→45.3 |

Equal-state search/event/extraction probabilities are monotone in difficulty. Actual aggregate failure rates need not be strictly ordered: hard runs can find less, carry less, or end sooner, changing later pressure. The empirical table deliberately retains those effects rather than forcing a monotonic headline.

### Research distributions (1,000 papers per row)

Research does not inherit raid easy/normal/hard settings. It uses project type, scope, title and real skill/equipment inputs. Applying raid difficulty to research would invent a control the game does not have. These resource-fed single-paper cohorts use actual purchases and actions, without resource censoring; spending includes initial materials/start fee, purchased cards and all paid experiments, before publication grants.

| Tier / project | Runs mean before→after | Runs p50/p90/p99/max before→after | New review attempts p50/p90/p99/max | Gross spend mean before→after | New spend p50/p90/p99/max | New free repair runs mean | Explicit supported acceptance % |
|---|---|---|---|---|---|---:|---:|
| beginner/replicate | 3.949→4.941 | 4/5/6/7→5/7/7/7 | 3/5/5/5 | 475.41→470.53 | 510/510/510/510 | 0.447 | 11.6 |
| beginner/evaluate | 4.127→4.982 | 4/5/6/7→5/7/7/7 | 3/5/5/5 | 517.70→483.84 | 525/525/525/525 | 0.472 | 12.5 |
| mid/replicate | 2.109→5.150 | 2/3/3/4→5/7/8/8 | 2/4/5/5 | 529.62→600.34 | 630/630/630/630 | 0.459 | 2.8 |
| mid/evaluate | 2.165→5.194 | 2/3/3/4→5/7/8/8 | 2/4/5/5 | 578.00→652.82 | 685/685/685/685 | 0.492 | 3.4 |
| mid/finetune | 2.311→5.281 | 2/3/3/4→5/7/8/8 | 2/4/5/5 | 897.08→987.57 | 1030/1030/1030/1030 | 0.553 | 4.6 |
| late/replicate | 2.005→5.852 | 2/2/2/4→6/7/9/9 | 2/3/5/5 | 721.35→750.00 | 750/750/750/750 | 0.852 | 1.4 |
| late/evaluate | 2.027→5.887 | 2/2/3/4→6/7/9/9 | 2/3/5/5 | 793.10→845.00 | 845/845/845/845 | 0.887 | 1.7 |
| late/finetune | 2.062→5.915 | 2/2/3/4→6/7/9/9 | 2/3/5/5 | 1196.04→1350.00 | 1350/1350/1350/1350 | 0.915 | 2.2 |

The new novice loop takes more experimental/review actions, while its mean currency spend is slightly lower. This is intentional resource-tail protection, not evidence that every dimension became harder. In starter-budget cohorts, both projects published in all 1,000 seeds without resupply: worst gross spend 510/525, minimum funding after the publication grant 370/375. Baseline evaluate exhausted the 800 shop-only budget in 2/1,000 seeds; each recovered with one real free outing. A capped stochastic failure tail should not require restarting a career.

### Qualified promotions, learning and recovery

| Promotion starting tier | First-attempt pass % | Attempts p50/p90/p99/max | Mean attempts | Supported fourth-attempt % |
|---|---:|---|---:|---:|
| beginner | 62.8 | 1/3/4/4 | 1.564 | 4.3 |
| mid | 60.8 | 1/3/4/4 | 1.608 | 5.2 |
| late | 59.4 | 1/3/4/4 | 1.642 | 6.2 |

Baseline qualified promotions all passed in one attempt. The promotion fixtures meet the actual next-stage gates, with strong papers and method practice; they do not measure the time to earn eligibility. Every failure is followed by a real four-search free outing and a save/reload. All 3,000 new promotion paths succeeded within four qualified attempts; immediate retries were blocked without changing saved state.

Twenty repeated paid/publication projects at fixed basic scope end at levels 4/4/4 and method 10 in all 1,000 seeds; advanced scope ends at levels 7/7/7 and method 20; frontier median levels are 9/10/8, method 30. These finite-gain studies and the zero-XP free-repair test detect trivial-project and free-repair farming. Earned higher legacy levels are preserved rather than clamped down.

Starting from zero funds with starter permanent equipment, all 1,000 recovery careers published the first replicate paper. Free four-search easy outings: mean 6.678, p50/p90/p99/max 7/9/11/14. Funding after publication: minimum 80, p50/p90/p99/max 125/175/200/225. This proves an available tested recovery route, not a deterministic maximum for all random streams. No synthetic resources, hidden cautious action, fee subsidy or inventory mutation is used during the recovery.

In the separately resource-fed progression gate audit, all 1,000 fresh careers reached stage 8: papers p50/p90/p99/max 20/22/23/23, total promotion attempts 12/15/18/21. Actual purchased GPU/remote capacity and natural XP crossed the later gates. Funding was deliberately ample in this audit; its 23213.55 mean gross expenditure is not an estimate of ordinary economic pacing.

### Coupled full-career economy (64 seeds per build)

Start with the real 800 funds and starter equipment. Buy GPU at stage 1 and remote terminal at stage 3 when affordable. Complete replicate first, then prioritize unlocked finetune projects, applying for promotion whenever eligible; after a failed promotion earn a new paper. Whenever funding/materials are insufficient, play and settle a free easy conference outing with four visible standard searches, sell surplus and purchase the next required inputs. This policy is deliberately reproducible and shop-first, not claimed optimal. It has no injected resources and does not spend event/gear money it has not earned. Actions include real research, purchases, surplus sales, searches, event responses and extraction.

| Metric | Baseline mean | New mean | Baseline p50/p90/p99/max | New p50/p90/p99/max |
|---|---:|---:|---|---|
| projects | 20 | 20.75 | 20/20/20/20 | 20/22/23/23 |
| attempts | 8 | 12.656 | 8/8/8/8 | 12/16/19/19 |
| raids | 96.141 | 157.625 | 96/101/107/107 | 156/176/189/189 |
| actions | 1242.578 | 1823.875 | 1244/1303/1372/1372 | 1813/2021/2161/2161 |
| expense | 19140.469 | 21649.75 | 19090/19600/19990/19990 | 21338/23376/24706/24706 |
| funding | 1190.547 | 1182.984 | 1195/1230/1265/1265 | 1180/1219/1229/1229 |

All 64 careers completed in both builds; no deadlocks were observed. Final median outings rise 96→156 (1.63×), and median total actions 1244→1813 (1.46×). An earlier, rejected tuning with one-plus-scope modern compute cards required a median 230 outings; the one-card rule above is the final measured model. This raises check difficulty and progression work without retaining that much extra resource repetition.

## Coverage and remaining limits

- Independent regression tests cover finite bounds and exact probability sums; difficulty, fatigue, load, risk and skill monotonicity; saturated experimental/review failure; genuine first papers; zero-funding recovery; earned promotion retries; repeated reloads; zero-search non-progression; settlement replay; no-XP/no-method free repair; basic-scope learning caps; old earned levels/titles/ready papers; full progression unlock gates; deterministic simulation replay; worst-draw supported-review bounds
- At least 1,000 seeds cover every representative raid difficulty/search-length and research-type tier, promotion tier, recovery and repeated-learning case. Full coupled careers use 64 seeds; increase the economy sample for a release-grade population-tail estimate
- Natural first-paper failures, encounter failures, early forced extraction and zero-return raids remain visible in totals. No successful-only conditioning is used for headline rates. Per-paper cohorts funded above 800 are explicitly labeled; starter and coupled-economy cohorts use their real budgets
- First-paper maximum resource cost is structurally bounded by five paid rounds. Free-resupply recovery is probabilistic, not absolutely bounded: a player can suffer repeated unlucky raids. Equipment is permanent, conference entry is free, ordinary loot chances have a positive floor and recovered materials can be sold, so lack of cash alone is not an absorbing state
- A 200-outing per-paper safety limit, 100 equipment-recovery limit, 100 research-action limit and 80-paper full-progression limit cause a reported failure rather than a simulated infinite loop. None was reached in the reported final cohorts. Warehouse overflow is never silently substituted for usable stash: each required purchase is checked against actual stash before continuing, and short resupply sorties sell surplus. Full warehouses require real user inventory decisions outside this specific policy
- New research has deliberate deterministic progress from failed experiments and eventual institutional support; ordinary experimental success and review acceptance still fail at high skill. Publishing and qualified promotion are the only ways to progress their corresponding outcomes; snapshots cannot manufacture them
- Legacy active research preserves prior probability/resource contracts, while future XP/method awards use the new learning budgets. This audit does not claim byte-identical legacy research trajectories. Existing v3 raid rules have separate exact-trajectory compatibility tests
- This audit does not measure human choice adaptation, boredom, timing, strategic trading, every equipment build, legacy talent strategy, or long-run optimal play. Browser and aggregate suite results are separate release checks. Playtesting remains necessary before treating the selected pace as fun
