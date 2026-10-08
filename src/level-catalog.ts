/** Verified offline catalogue v3; campaign seeds remain stable. */
import type { Level } from './puzzle';
import { LEVELS_001_100 } from './levels/levels-001-100';
import { LEVELS_101_200 } from './levels/levels-101-200';
import { LEVELS_201_300 } from './levels/levels-201-300';
import { LEVELS_301_400 } from './levels/levels-301-400';
import { LEVELS_401_500 } from './levels/levels-401-500';
import { LEVELS_501_600 } from './levels/levels-501-600';
export const LEVEL_CATALOG: Level[] = [...LEVELS_001_100, ...LEVELS_101_200, ...LEVELS_201_300, ...LEVELS_301_400, ...LEVELS_401_500, ...LEVELS_501_600];
