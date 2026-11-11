// The voiced dialogue of the solo demo's pair where one does all the talking. Voiced with Yandex SpeechKit
// in every bot's voice, silence trimmed: the clips are client-teacher/public/demo/voice/<id>-<voice>.mp3.
// who: 1 — the one who talks, 2 — the quiet one; pause: before the line; ms: how long it lasts in each voice it was voiced in
// (a bot whose own voice is missing speaks in another of the same sex); after: said once the teacher has answered the call;
// write: what the speaker writes on the board as the line ends.

export interface SpokenLine { id: string; who: 1 | 2; pause: number; write: string | null; ms: Record<string, number>; after?: boolean }

export const FEMALE_VOICES = new Set(['dasha', 'lera', 'masha', 'julia']);

export const VOICE_OF: Record<string, string> = {"Миша": "kirill", "Тимур": "anton", "Артём": "alexander", "Глеб": "ermil", "Аня": "dasha", "Лена": "lera", "Соня": "masha", "Вика": "julia"};

export const LOPSIDED_PAIR: SpokenLine[] = [
  {"id": "lp01", "who": 1, "pause": 3000, "write": "AD = BC", "ms": {"kirill": 4128, "anton": 4008, "alexander": 3936, "ermil": 3936, "dasha": 4104, "lera": 4176, "masha": 4200, "julia": 3912}},
  {"id": "lp02", "who": 1, "pause": 800, "write": "AB = CD", "ms": {"kirill": 4728, "anton": 4296, "alexander": 4272, "ermil": 4632, "dasha": 4272, "lera": 4536, "masha": 4656, "julia": 4152}},
  {"id": "lp03", "who": 2, "pause": 600, "write": null, "ms": {"kirill": 2112, "anton": 2064, "alexander": 2112, "ermil": 2040, "dasha": 2136, "lera": 2184, "masha": 2256, "julia": 2136}},
  {"id": "lp04", "who": 1, "pause": 300, "write": "AO = OC", "ms": {"kirill": 5880, "anton": 5832, "alexander": 5688, "ermil": 5496, "dasha": 5640, "lera": 5952, "masha": 5784, "julia": 5496}},
  {"id": "lp05", "who": 2, "pause": 3000, "write": null, "ms": {"kirill": 1032, "anton": 1032, "alexander": 1032, "ermil": 912, "dasha": 1008, "lera": 1056, "masha": 1056, "julia": 960}},
  {"id": "lp06", "who": 1, "pause": 800, "write": null, "ms": {"kirill": 672, "anton": 768, "alexander": 672, "ermil": 648, "dasha": 720, "lera": 696, "masha": 792, "julia": 792}},
  {"id": "lp07", "who": 2, "pause": 800, "write": null, "ms": {"kirill": 1488, "anton": 1440, "alexander": 1488, "ermil": 1368, "dasha": 1440, "lera": 1512, "masha": 1536, "julia": 1440}},
  {"id": "lp08", "who": 1, "pause": 400, "write": "BO = OD", "ms": {"kirill": 5232, "anton": 4872, "alexander": 4992, "ermil": 4680, "dasha": 4872, "lera": 5112, "masha": 5400, "julia": 4800}},
  {"id": "lp09", "who": 2, "pause": 1500, "write": null, "ms": {"kirill": 672, "anton": 696, "alexander": 624, "ermil": 624, "dasha": 672, "lera": 720, "masha": 696, "julia": 648}},
  {"id": "lp10", "who": 1, "pause": 10000, "write": null, "ms": {"kirill": 5664, "anton": 5136, "alexander": 5352, "ermil": 5400, "dasha": 5328, "lera": 5424, "masha": 5808, "julia": 4896}},
  {"id": "lp11", "who": 2, "pause": 2000, "write": null, "ms": {"kirill": 2976, "anton": 2880, "alexander": 2760, "ermil": 2664, "dasha": 2640, "lera": 2904, "masha": 2976, "julia": 2688}},
  {"id": "lp12", "who": 1, "pause": 600, "write": null, "ms": {"kirill": 3024, "anton": 2832, "alexander": 3024, "ermil": 2856, "dasha": 3072, "lera": 3168, "masha": 3336, "julia": 2952}},
  {"id": "lp13", "who": 1, "pause": 12000, "write": null, "ms": {"kirill": 3456, "anton": 3312, "alexander": 3408, "ermil": 3264, "dasha": 3384, "lera": 3480, "masha": 3696, "julia": 3264}},
  {"id": "lp14", "who": 2, "pause": 1000, "write": null, "ms": {"kirill": 432, "anton": 408, "alexander": 408, "ermil": 312, "dasha": 384, "lera": 384, "masha": 384, "julia": 384}},
  {"id": "lp15", "who": 1, "pause": 1500, "write": null, "ms": {"kirill": 1152, "anton": 1128, "alexander": 1104, "ermil": 984, "dasha": 1152, "lera": 1152, "masha": 1200, "julia": 1032}},
  {"id": "lp16", "who": 2, "pause": 1000, "write": null, "ms": {"kirill": 1944, "anton": 1944, "alexander": 1872, "ermil": 2016, "dasha": 1944, "lera": 1992, "masha": 2088, "julia": 1920}},
];

/** The pair that argues whether AB = AO and calls the teacher: {1} is always Миша, {2} whoever sits with him */
export const DISPUTE_PAIR: SpokenLine[] = [
  {"id": "ab01", "who": 1, "pause": 2000, "write": "AD = BC", "ms": {"kirill": 1152}},
  {"id": "ab02", "who": 2, "pause": 1000, "write": "AB = CD", "ms": {"alexander": 1032, "dasha": 1056}},
  {"id": "ab03", "who": 1, "pause": 1500, "write": "∠A = ∠C", "ms": {"kirill": 1968}},
  {"id": "ab04", "who": 2, "pause": 2000, "write": null, "ms": {"alexander": 4296, "dasha": 4368}},
  {"id": "ab05", "who": 1, "pause": 600, "write": null, "ms": {"kirill": 4752}},
  {"id": "ab06", "who": 2, "pause": 400, "write": null, "ms": {"alexander": 1104, "dasha": 1128}},
  {"id": "ab07", "who": 1, "pause": 500, "write": null, "ms": {"kirill": 1368}},
  {"id": "ab08", "who": 2, "pause": 1200, "write": null, "ms": {"alexander": 3720, "dasha": 3768}},
  {"id": "ab09", "who": 1, "pause": 600, "write": null, "ms": {"kirill": 528}},
  {"id": "ab10", "who": 2, "pause": 0, "write": null, "ms": {"alexander": 2808, "dasha": 2784}, "after": true},
  {"id": "ab11", "who": 1, "pause": 800, "write": "AO = OC", "ms": {"kirill": 4488}, "after": true},
  {"id": "ab12", "who": 2, "pause": 1500, "write": "BO = OD", "ms": {"alexander": 1224, "dasha": 1176}, "after": true},
];

/** Short work talk heard at any group's board (ch<NN>): «подожди, я пишу», «а это мы уже записали?»… */
export const CHATTER: { id: string; ms: Record<string, number> }[] = [
  {"id": "ch01", "ms": {"kirill": 1848, "anton": 1728, "alexander": 1752, "ermil": 1656, "dasha": 1848, "lera": 1896, "masha": 1872, "julia": 1728}},
  {"id": "ch02", "ms": {"kirill": 1416, "anton": 1416, "alexander": 1344, "ermil": 1368, "dasha": 1368, "lera": 1464, "masha": 1488, "julia": 1248}},
  {"id": "ch03", "ms": {"kirill": 792, "anton": 792, "alexander": 744, "ermil": 768, "dasha": 816, "lera": 840, "masha": 888, "julia": 792}},
  {"id": "ch04", "ms": {"kirill": 432, "anton": 432, "alexander": 408, "ermil": 432, "dasha": 432, "lera": 480, "masha": 408, "julia": 408}},
  {"id": "ch05", "ms": {"kirill": 1176, "anton": 1104, "alexander": 1080, "ermil": 1080, "dasha": 1152, "lera": 1128, "masha": 1128, "julia": 1080}},
  {"id": "ch06", "ms": {"kirill": 744, "anton": 744, "alexander": 816, "ermil": 720, "dasha": 816, "lera": 864, "masha": 840, "julia": 768}},
  {"id": "ch07", "ms": {"kirill": 1392, "anton": 1344, "alexander": 1488, "ermil": 1392, "dasha": 1392, "lera": 1392, "masha": 1512, "julia": 1368}},
  {"id": "ch08", "ms": {"kirill": 3768, "anton": 3552, "alexander": 3792, "ermil": 3456, "dasha": 3696, "lera": 3816, "masha": 3864, "julia": 3456}},
  {"id": "ch09", "ms": {"kirill": 672, "anton": 744, "alexander": 744, "ermil": 600, "dasha": 720, "lera": 768, "masha": 816, "julia": 672}},
  {"id": "ch10", "ms": {"kirill": 792, "anton": 840, "alexander": 792, "ermil": 768, "dasha": 768, "lera": 888, "masha": 840, "julia": 840}},
  {"id": "ch11", "ms": {"kirill": 720, "anton": 768, "alexander": 720, "ermil": 696, "dasha": 720, "lera": 816, "masha": 840, "julia": 696}},
  {"id": "ch12", "ms": {"kirill": 1512, "anton": 1440, "alexander": 1512, "ermil": 1464, "dasha": 1488, "lera": 1560, "masha": 1560, "julia": 1440}},
  {"id": "ch13", "ms": {"kirill": 1128, "anton": 1128, "alexander": 1176, "ermil": 960, "dasha": 1128, "lera": 1248, "masha": 1152, "julia": 1128}},
  {"id": "ch14", "ms": {"kirill": 1584, "anton": 1512, "alexander": 1560, "ermil": 1464, "dasha": 1608, "lera": 1656, "masha": 1728, "julia": 1536}},
  {"id": "ch15", "ms": {"kirill": 1416, "anton": 1440, "alexander": 1440, "ermil": 1296, "dasha": 1536, "lera": 1512, "masha": 1608, "julia": 1344}},
  {"id": "ch16", "ms": {"kirill": 984, "anton": 984, "alexander": 960, "ermil": 888, "dasha": 1008, "lera": 984, "masha": 1008, "julia": 888}},
  {"id": "ch17", "ms": {"kirill": 984, "anton": 984, "alexander": 1032, "ermil": 936, "dasha": 960, "lera": 1080, "masha": 1032, "julia": 984}},
  {"id": "ch18", "ms": {"kirill": 1056, "anton": 1032, "alexander": 960, "ermil": 936, "dasha": 984, "lera": 1128, "masha": 1176, "julia": 984}},
  {"id": "ch19", "ms": {"kirill": 1920, "anton": 1872, "alexander": 1896, "ermil": 1848, "dasha": 1920, "lera": 1992, "masha": 2064, "julia": 1848}},
  {"id": "ch20", "ms": {"kirill": 1416, "anton": 1416, "alexander": 1440, "ermil": 1320, "dasha": 1488, "lera": 1536, "masha": 1584, "julia": 1416}},
  {"id": "ch21", "ms": {"kirill": 1776, "anton": 1632, "alexander": 1704, "ermil": 1680, "dasha": 1728, "lera": 1728, "masha": 1896, "julia": 1632}},
  {"id": "ch22", "ms": {"kirill": 912, "anton": 888, "alexander": 792, "ermil": 816, "dasha": 840, "lera": 960, "masha": 936, "julia": 840}},
  {"id": "ch23", "ms": {"kirill": 1080, "anton": 984, "alexander": 984, "ermil": 912, "dasha": 1008, "lera": 1152, "masha": 1080, "julia": 1008}},
  {"id": "ch24", "ms": {"kirill": 840, "anton": 840, "alexander": 840, "ermil": 744, "dasha": 792, "lera": 840, "masha": 840, "julia": 768}},
  {"id": "ch25", "ms": {"kirill": 2016, "anton": 2016, "alexander": 1968, "ermil": 1920, "dasha": 1992, "lera": 2088, "masha": 2160, "julia": 1944}},
];
