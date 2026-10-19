/**
 * Static "Rate of Steam" card shown in every report (client-provided 2026-10-19), replacing the
 * single flat cost that used to be shown. This is a DISPLAY constant only — shown verbatim, the same
 * in every report; it is deliberately NOT used to recompute any INR figure (per explicit request:
 * "just display as provided, don't sum or do anything more"). One source of truth so the daily
 * Summary and weekly report always show identical text.
 */
export const STEAM_RATE_CARD_TEXT = 'VHP - 2560 | SHP - 2481 | HP - 2402 | MP - 2212';
