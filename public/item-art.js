// Explicit item ID to generated transparent PNG mapping.
// Keeping IDs and URLs paired here makes missing catalog entries visible and testable.
export const ITEM_ART_URLS = Object.freeze({
  unpublished: '/assets/generated/items/unpublished.png',
  dataset: '/assets/generated/items/dataset.png',
  preprint: '/assets/generated/items/preprint.png',
  src_code: '/assets/generated/items/src_code.png',
  wind: '/assets/generated/items/wind.png',
  funding_tip: '/assets/generated/items/funding_tip.png',
  inside: '/assets/generated/items/inside.png',
  card: '/assets/generated/items/card.png',
  wechat: '/assets/generated/items/wechat.png',
  coop: '/assets/generated/items/coop.png',
  promise: '/assets/generated/items/promise.png',
  compute: '/assets/generated/items/compute.png',
  reagent: '/assets/generated/items/reagent.png',
  receipt: '/assets/generated/items/receipt.png',
  coffee_ticket: '/assets/generated/items/coffee_ticket.png',
  stomach_pill: '/assets/generated/items/stomach_pill.png',
  canvas_pack: '/assets/generated/items/canvas_pack.png',
  foam_earplugs: '/assets/generated/items/foam_earplugs.png',
  coffee_thermos: '/assets/generated/items/coffee_thermos.png',
  badge_wallet: '/assets/generated/items/badge_wallet.png',
  noise_headphones: '/assets/generated/items/noise_headphones.png',
  field_recorder: '/assets/generated/items/field_recorder.png',
  padded_case: '/assets/generated/items/padded_case.png',
  citation_scanner: '/assets/generated/items/citation_scanner.png',
  digital_notebook: '/assets/generated/items/digital_notebook.png',
  custom_lab_pack: '/assets/generated/items/custom_lab_pack.png',
  lightweight_laptop: '/assets/generated/items/lightweight_laptop.png',
  gpu_workstation: '/assets/generated/items/gpu_workstation.png',
  remote_terminal: '/assets/generated/items/remote_terminal.png',
  literature_assistant: '/assets/generated/items/literature_assistant.png',
  experiment_tracker: '/assets/generated/items/experiment_tracker.png',
  data_cleaner: '/assets/generated/items/data_cleaner.png',
  portable_ssd: '/assets/generated/items/portable_ssd.png',
  encrypted_ssd: '/assets/generated/items/encrypted_ssd.png',
  backup_device: '/assets/generated/items/backup_device.png',
});

const ESCAPED_SIZE_CLASSES = new Set(['item-icon-large', 'item-icon-medium', 'item-icon-small']);

const escapeAttribute = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

/** Render a decorative icon slot. Unknown IDs deliberately get no image source. */
export function itemIconHtml(item, sizeClass = 'item-icon-medium') {
  const id = String(item?.id || '');
  const src = Object.hasOwn(ITEM_ART_URLS, id) ? ITEM_ART_URLS[id] : null;
  const size = ESCAPED_SIZE_CLASSES.has(sizeClass) ? sizeClass : 'item-icon-medium';
  const image = src
    ? `<img class="item-icon" src="${src}" alt="" aria-hidden="true" loading="lazy" decoding="async" data-item-id="${escapeAttribute(id)}">`
    : '';
  return `<span class="item-icon-slot ${size}" data-item-id="${escapeAttribute(id)}" aria-hidden="true">${image}</span>`;
}
