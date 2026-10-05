# Warehouse and event update (v0.13)

- Warehouse capacity is counted per individual stored unit. The grid now renders one unit per tile, including duplicate items; equipped gear remains outside storage capacity.
- Batch mode selects units, not whole item stacks. Reserved supplies cannot be selected or sold. The backend validates the entire batch before changing anything; stale or malformed batches fail atomically. Existing request receipts keep network retries idempotent.
- Organize groups visible items by category/name without changing inventory quantities or save rules. Refresh returns to default ordering.
- Shop tabs group materials, equipment and supplies. Buying/equipping retains existing rank, cost and capacity rules.
- Expansion is one compact capacity line and one priced button, with a short insufficient-funds status.
- v9 probability rules and legacy-save compatibility remain documented in BALANCE.md. No probability forecasts were added to player choices.

Validation commands: npm test; node tools/warehouse-browser.mjs; node tools/balance-browser.mjs. Set CHROME_PATH to a locally installed supported Chromium/HeadlessShell executable when needed.

## Encounter and research flavor

24 ordinary encounter scenes now have 144 authored success/failure cards, alongside 22 richer story outcomes and 52 experiment/review/publication narratives. Options remain brief and neutral; no hidden outcome is advertised. Flavor uses existing persisted state, with no extra gameplay RNG draw. Active v3 raids retain baseline narration and byte-exact action/view/RNG transcripts through a separate legacy adapter. Existing saved events are not regenerated.
