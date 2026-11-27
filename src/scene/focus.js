/*
 * Focus: scenes open with just the main asset and its own site (roads, river, landscape, trees, traffic).
 * The neighbourhood around it (houses, townhouses, apartment blocks, the background skyline) is built only
 * when Surroundings is switched on, so pages load and run faster. The choice is remembered.
 */
const KEY = 'p2s:surroundings';
export function surroundingsOn() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
export function setSurroundingsOn(on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* storage off */ } }
