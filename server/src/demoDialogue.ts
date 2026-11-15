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

/** П1 «Спорим на шоколадку?»: Миша (1) and his partner (2) check their lists against each other; T is the teacher.
 *  Lines p1-01…p1-33 in order; p1-34 Миша greets a teacher who came in openly, p1-35 asks them instead of the call (17–19);
 *  p1-tq the teacher asks what the question is, p1-ta the ready answer. Text: ~/temp/П1-шоколадка.txt */
export interface DialogueLine { id: string; who: 1 | 2 | 'T'; write: string | null; ms: Record<string, number>; text: string }
export const CHOCOLATE: DialogueLine[] = [
  {"id": "p1-01", "who": 2, "write": null, "ms": {"alexander": 2273}, "text": "Привет. Ну что, сверяемся?"},
  {"id": "p1-02", "who": 1, "write": null, "ms": {"kirill": 1698}, "text": "Давай. У тебя сколько?"},
  {"id": "p1-03", "who": 2, "write": null, "ms": {"alexander": 7236}, "text": "Пять. Стороны, диагонали, угол. А у тебя… Ты чего так написал? Как курица лапкой."},
  {"id": "p1-04", "who": 1, "write": null, "ms": {"kirill": 5642}, "text": "Да я без планшета сегодня. Мы к тёте в гости приехали, с её компа мышкой рисую."},
  {"id": "p1-05", "who": 2, "write": null, "ms": {"alexander": 2116}, "text": "Понятно, ладно, разберу."},
  {"id": "p1-06", "who": 2, "write": null, "ms": {"alexander": 8464}, "text": "Так. А-дэ равно бэ-цэ — есть. А-бэ равно цэ-дэ — есть. Углы есть… А это что? А-бэ равно а-о?"},
  {"id": "p1-07", "who": 1, "write": null, "ms": {"kirill": 2926}, "text": "Ну да. Посмотри на чертёж — одинаковые."},
  {"id": "p1-08", "who": 2, "write": null, "ms": {"alexander": 3291}, "text": "Хм, похожи, конечно. Но мне кажется, что они не равны."},
  {"id": "p1-09", "who": 1, "write": null, "ms": {"kirill": 3239}, "text": "Почему не равны? Палец приложи — одинаковые."},
  {"id": "p1-10", "who": 2, "write": null, "ms": {"alexander": 9796}, "text": "Да как я его тут приложу? Я ещё вот по клеткам смотрю. А-бэ — это два вправо, четыре вверх. А-о — пять вправо, два вверх. Разные."},
  {"id": "p1-11", "who": 1, "write": null, "ms": {"kirill": 9744}, "text": "Как ты так сравниваешь? У тебя и вправо, и вверх разное количество каждый раз. А длина может быть одна и та же. Наискосок ведь."},
  {"id": "p1-12", "who": 2, "write": null, "ms": {"alexander": 3944}, "text": "Нет. Так не бывает. Да и видно, что разные немного."},
  {"id": "p1-13", "who": 1, "write": null, "ms": {"kirill": 1750}, "text": "Одинаковые. Спорим?"},
  {"id": "p1-14", "who": 2, "write": null, "ms": {"alexander": 1437}, "text": "Спорим. На что?"},
  {"id": "p1-15", "who": 1, "write": null, "ms": {"kirill": 1019}, "text": "На шоколадку."},
  {"id": "p1-16", "who": 2, "write": null, "ms": {"alexander": 549}, "text": "Идёт."},
  {"id": "p1-17", "who": 2, "write": null, "ms": {"alexander": 2795}, "text": "Давай учителя позовём тогда, как ещё узнать?"},
  {"id": "p1-18", "who": 1, "write": null, "ms": {"kirill": 679}, "text": "Давай."},
  {"id": "p1-19", "who": 2, "write": null, "ms": {"alexander": 10005}, "text": "Мы сверяемся: у Миши записано, что а-бэ равно а-о, а я думаю, что не равны, раз по клеткам вправо и вверх не совпадают. Как правильно?"},
  {"id": "p1-20", "who": 2, "write": null, "ms": {"alexander": 3422}, "text": "Два в квадрате плюс четыре в квадрате… двадцать."},
  {"id": "p1-21", "who": 1, "write": null, "ms": {"kirill": 9169}, "text": "А пять в квадрате плюс два в квадрате — двадцать девять. Да, точно, не равны. Ладно, теперь понятно. Вычёркиваю."},
  {"id": "p1-22", "who": 2, "write": null, "ms": {"alexander": 1176}, "text": "С тебя шоколадка."},
  {"id": "p1-23", "who": 1, "write": null, "ms": {"kirill": 3527}, "text": "Подожди. Ты говорил «так не бывает». А бывает."},
  {"id": "p1-24", "who": 2, "write": null, "ms": {"alexander": 2456}, "text": "Ну… ладно. Половина шоколадки."},
  {"id": "p1-25", "who": 1, "write": null, "ms": {"kirill": 6766}, "text": "Половина. Давай теперь общий список. По очереди: кто сказал, тот и пишет. Начинай."},
  {"id": "p1-26", "who": 2, "write": "AD = BC", "ms": {"alexander": 1332}, "text": "А-дэ равно бэ-цэ."},
  {"id": "p1-27", "who": 1, "write": "AB = CD", "ms": {"kirill": 1254}, "text": "А-бэ равно цэ-дэ."},
  {"id": "p1-28", "who": 2, "write": "AO = OC", "ms": {"alexander": 3971}, "text": "А-о равно о-цэ. Пять и два, пять и два — тут не поспоришь."},
  {"id": "p1-29", "who": 1, "write": "BO = OD", "ms": {"kirill": 4885}, "text": "Бэ-о равно о-дэ. Три и два, три и два. Этого у меня не было."},
  {"id": "p1-30", "who": 2, "write": "∠A = ∠C", "ms": {"alexander": 1855}, "text": "Угол а равен углу цэ."},
  {"id": "p1-31", "who": 1, "write": "∠B = ∠D", "ms": {"kirill": 3866}, "text": "И угол бэ равен углу дэ. А этого не было у тебя."},
  {"id": "p1-32", "who": 2, "write": null, "ms": {"alexander": 1593}, "text": "Всё равно шесть получилось."},
  {"id": "p1-33", "who": 1, "write": null, "ms": {"kirill": 1515}, "text": "Только теперь все честные."},
  {"id": "p1-34", "who": 1, "write": null, "ms": {"kirill": 2508}, "text": "Ой, здравствуйте, Татьяна Алексеевна."},
  {"id": "p1-35", "who": 1, "write": null, "ms": {"kirill": 8725}, "text": "Татьяна Алексеевна, а у меня записано, что а-бэ равно а-о. На глаз одинаковые, а по клеткам разные. Как правильно?"},
  {"id": "p1-tq", "who": "T", "write": null, "ms": {"alena": 1149, "filipp": 1176}, "text": "Какой у вас вопрос?"},
  {"id": "p1-ta", "who": "T", "write": null, "ms": {"alena": 12617, "filipp": 13140}, "text": "Глаз обманывает, это правда. Но и по клеткам сразу не скажешь, тут Миша прав. Вспомните теорему Пифагора: клетки — это катеты, а ваши отрезки — гипотенузы. Посчитайте."},
];

/** A point of the figure in cells: A is (0, 0), x to the right, y up; B (2, 4), C (10, 4), D (8, 0), O (5, 2) */
export type Pt = [number, number];
/** Drawn while a line is said, `at` that part of the way through it: a broken line, a right-angle mark
 *  (corner, then a point on each side), a filled triangle, a number */
export interface Draw { at: number; path?: Pt[]; angle?: [Pt, Pt, Pt]; fill?: Pt[]; label?: { at: Pt; text: string } }

/** П2: the triangles and heights they talk about, drawn on their board as they say it */
export const EXPLAIN_DRAW: Record<string, Draw[]> = {
  // «вот такой треугольник построим к а-бэ и вот такой к цэ-дэ»
  'p2-13': [{ at: 0.45, path: [[0, 0], [0, 4], [2, 4]] }, { at: 0.75, path: [[10, 4], [10, 0], [8, 0]] }],
  // «эти стороны у них по четыре клетки, а эти — по две»
  'p2-15': [
    { at: 0.1, label: { at: [-0.5, 2], text: '4' } }, { at: 0.2, label: { at: [10.5, 2], text: '4' } },
    { at: 0.6, label: { at: [0.7, 4.6], text: '2' } }, { at: 0.7, label: { at: [9.3, -0.6], text: '2' } },
  ],
  // «эти углы прямые»
  'p2-17': [{ at: 0.2, angle: [[0, 4], [0, 0], [2, 4]] }, { at: 0.35, angle: [[10, 0], [10, 4], [8, 0]] }],
  // «такие же треугольники к диагонали а-цэ. Вот один, а вот второй»
  'p2-21': [{ at: 0.6, path: [[0, 0], [5, 0], [5, 2]] }, { at: 0.82, path: [[5, 2], [5, 4], [10, 4]] }],
  // the other one: «дорисовываю треугольники»
  'p2-26': [{ at: 0.12, path: [[2, 4], [2, 2], [5, 2]] }, { at: 0.3, path: [[5, 2], [8, 2], [8, 0]] }],
  // «эту высоту из бэ и эту из дэ»
  'p2-31': [{ at: 0.45, path: [[2, 4], [2, 0]] }, { at: 0.75, path: [[8, 0], [8, 4]] }],
  // «вот этот и вот этот треугольники»
  'p2-33': [{ at: 0.3, fill: [[0, 0], [2, 0], [2, 4]] }, { at: 0.65, fill: [[10, 4], [8, 4], [8, 0]] }],
};

/** П2 «Давай я быстро объясню»: the strong one (1) explains, the other (2) gets it; T is the teacher coming in openly.
 *  p2-01…p2-36 in order, p2-25f «сама» for a girl; on a visit p2-tq, 37, 38, p2-tb, 39. Every line in all eight voices.
 *  Text: ~/temp/П2-объясню.txt */
export const EXPLAIN: DialogueLine[] = [
  {"id": "p2-01", "who": 1, "write": null, "ms": {"kirill": 1567, "anton": 1515, "alexander": 1672, "ermil": 1384, "dasha": 1646, "lera": 1620, "masha": 1724, "julia": 1437}, "text": "Ну что, сверяемся?"},
  {"id": "p2-02", "who": 2, "write": null, "ms": {"kirill": 4989, "anton": 4885, "alexander": 4807, "ermil": 4728, "dasha": 4989, "lera": 5120, "masha": 5251, "julia": 4754}, "text": "Давай. Только сразу скажу: я вообще не очень понял, как тут равное искать."},
  {"id": "p2-03", "who": 2, "write": null, "ms": {"kirill": 7027, "anton": 6687, "alexander": 6661, "ermil": 6687, "dasha": 6818, "lera": 6818, "masha": 6818, "julia": 6583}, "text": "Одну пару сторон нашёл, и всё. Остальные наискосок идут. Вроде похожи, а может, и нет."},
  {"id": "p2-04", "who": 2, "write": null, "ms": {"kirill": 3004, "anton": 2795, "alexander": 2821, "ermil": 2821, "dasha": 2795, "lera": 2847, "masha": 3004, "julia": 2717}, "text": "А как равные углы искать — совсем не понимаю."},
  {"id": "p2-05", "who": 1, "write": null, "ms": {"kirill": 3527, "anton": 3474, "alexander": 3396, "ermil": 3527, "dasha": 3370, "lera": 3553, "masha": 3579, "julia": 3318}, "text": "Да, вижу. А-дэ равно бэ-цэ. Это правильно."},
  {"id": "p2-06", "who": 2, "write": null, "ms": {"kirill": 2011, "anton": 1907, "alexander": 1881, "ermil": 1829, "dasha": 1907, "lera": 2090, "masha": 2038, "julia": 1933}, "text": "Ого, а у тебя сколько всего."},
  {"id": "p2-07", "who": 1, "write": null, "ms": {"kirill": 6766, "anton": 6348, "alexander": 6243, "ermil": 6217, "dasha": 6557, "lera": 6609, "masha": 6949, "julia": 6269}, "text": "Да тут не очень сложно, давай быстро объясню. Нам ведь обоим нужно понимать. Спросить могут любого."},
  {"id": "p2-08", "who": 2, "write": null, "ms": {"kirill": 1855, "anton": 1881, "alexander": 1750, "ermil": 1724, "dasha": 1829, "lera": 1881, "masha": 1907, "julia": 1829}, "text": "Давай. Только не быстро."},
  {"id": "p2-09", "who": 1, "write": null, "ms": {"kirill": 4206, "anton": 3840, "alexander": 4023, "ermil": 3396, "dasha": 4284, "lera": 4153, "masha": 4232, "julia": 3736}, "text": "Хорошо, не быстро. Смотри, ты помнишь теорему Пифагора?"},
  {"id": "p2-10", "who": 2, "write": null, "ms": {"kirill": 4545, "anton": 4284, "alexander": 4310, "ermil": 4336, "dasha": 4493, "lera": 4650, "masha": 4833, "julia": 4336}, "text": "Ну так, не очень. Там как-то стороны треугольника между собой связаны."},
  {"id": "p2-11", "who": 1, "write": null, "ms": {"kirill": 6400, "anton": 6139, "alexander": 5721, "ermil": 5982, "dasha": 6165, "lera": 6165, "masha": 6452, "julia": 5773}, "text": "Да, прямоугольного… О, придумал проще! Помнишь первый признак равенства треугольников?"},
  {"id": "p2-12", "who": 2, "write": null, "ms": {"kirill": 3265, "anton": 3135, "alexander": 3109, "ermil": 3056, "dasha": 3161, "lera": 3265, "masha": 3396, "julia": 3030}, "text": "Конечно. По двум сторонам и углу между ними."},
  {"id": "p2-13", "who": 1, "write": null, "ms": {"kirill": 8934, "anton": 8046, "alexander": 8333, "ermil": 8411, "dasha": 8176, "lera": 8307, "masha": 8882, "julia": 7863}, "text": "Он самый. Теперь смотри на а-бэ и цэ-дэ. Давай вот такой треугольник построим к а-бэ и вот такой к цэ-дэ."},
  {"id": "p2-14", "who": 2, "write": null, "ms": {"kirill": 1280, "anton": 1228, "alexander": 1254, "ermil": 1123, "dasha": 1254, "lera": 1306, "masha": 1280, "julia": 1176}, "text": "Ага, вижу."},
  {"id": "p2-15", "who": 1, "write": null, "ms": {"kirill": 3997, "anton": 3840, "alexander": 3892, "ermil": 3683, "dasha": 3997, "lera": 4023, "masha": 4336, "julia": 3788}, "text": "Вот эти стороны у них по четыре клетки, а эти — по две."},
  {"id": "p2-16", "who": 2, "write": null, "ms": {"kirill": 549, "anton": 522, "alexander": 575, "ermil": 470, "dasha": 575, "lera": 601, "masha": 575, "julia": 470}, "text": "Да."},
  {"id": "p2-17", "who": 1, "write": null, "ms": {"kirill": 5094, "anton": 4911, "alexander": 4859, "ermil": 5042, "dasha": 5042, "lera": 5094, "masha": 5224, "julia": 4911}, "text": "А вот эти углы прямые, по девяносто градусов. Значит, равны между собой."},
  {"id": "p2-18", "who": 2, "write": null, "ms": {"kirill": 967, "anton": 914, "alexander": 914, "ermil": 888, "dasha": 914, "lera": 993, "masha": 993, "julia": 967}, "text": "Есть такое."},
  {"id": "p2-19", "who": 1, "write": null, "ms": {"kirill": 8255, "anton": 7628, "alexander": 7784, "ermil": 7706, "dasha": 7811, "lera": 8072, "masha": 8333, "julia": 7471}, "text": "Ну и всё. Значит, треугольники равны, и оставшиеся стороны у них тоже равны. То есть а-бэ равно цэ-дэ."},
  {"id": "p2-20", "who": 2, "write": null, "ms": {"kirill": 4153, "anton": 4023, "alexander": 4101, "ermil": 3840, "dasha": 4180, "lera": 4362, "masha": 4362, "julia": 3918}, "text": "Ага, точно. Крутяк! Так просто, оказывается!"},
  {"id": "p2-21", "who": 1, "write": null, "ms": {"kirill": 7314, "anton": 6766, "alexander": 6922, "ermil": 6713, "dasha": 6975, "lera": 7079, "masha": 7471, "julia": 6713}, "text": "Да. А теперь такие же треугольники можно дорисовать к диагонали а-цэ. Вот один, а вот второй."},
  {"id": "p2-22", "who": 2, "write": null, "ms": {"kirill": 470, "anton": 444, "alexander": 444, "ermil": 627, "dasha": 470, "lera": 470, "masha": 470, "julia": 418}, "text": "Так."},
  {"id": "p2-23", "who": 1, "write": null, "ms": {"kirill": 3605, "anton": 3396, "alexander": 3474, "ermil": 3448, "dasha": 3396, "lera": 3579, "masha": 3762, "julia": 3318}, "text": "И то же самое. Получаем, что а-о равно о-цэ."},
  {"id": "p2-24", "who": 2, "write": null, "ms": {"kirill": 5277, "anton": 4911, "alexander": 4780, "ermil": 4937, "dasha": 4963, "lera": 5172, "masha": 5486, "julia": 4807}, "text": "Гениально! Кажется, я уловил идею. Так ведь и про вторую диагональ можно."},
  {"id": "p2-25", "who": 1, "write": null, "ms": {"kirill": 2560, "anton": 2429, "alexander": 2508, "ermil": 2403, "dasha": 2560, "lera": 2586, "masha": 2586, "julia": 2429}, "text": "Да, то же самое. Попробуй сам."},
  {"id": "p2-25f", "who": 1, "write": null, "ms": {"kirill": 2612, "anton": 2534, "alexander": 2508, "ermil": 2482, "dasha": 2560, "lera": 2638, "masha": 2664, "julia": 2456}, "text": "Да, то же самое. Попробуй сама."},
  {"id": "p2-26", "who": 2, "write": null, "ms": {"kirill": 8411, "anton": 7811, "alexander": 7811, "ermil": 7680, "dasha": 7889, "lera": 8150, "masha": 8438, "julia": 7602}, "text": "Так… дорисовываю треугольники. Эти стороны равны, эти равны, угол прямой. Значит, бэ-о равно о-дэ."},
  {"id": "p2-27", "who": 1, "write": null, "ms": {"kirill": 4127, "anton": 3840, "alexander": 3866, "ermil": 3971, "dasha": 3866, "lera": 4075, "masha": 4101, "julia": 3840}, "text": "Да, всё правильно. Таким же образом можно и про углы."},
  {"id": "p2-28", "who": 2, "write": null, "ms": {"kirill": 967, "anton": 1019, "alexander": 993, "ermil": 967, "dasha": 1045, "lera": 1097, "masha": 1123, "julia": 1071}, "text": "Это про какие?"},
  {"id": "p2-29", "who": 1, "write": null, "ms": {"kirill": 5695, "anton": 5590, "alexander": 5433, "ermil": 5198, "dasha": 5512, "lera": 5669, "masha": 5878, "julia": 5224}, "text": "Про противоположные. Что угол а равен углу цэ. Видишь, одинаковые?"},
  {"id": "p2-30", "who": 2, "write": null, "ms": {"kirill": 4571, "anton": 4284, "alexander": 4415, "ermil": 4258, "dasha": 4467, "lera": 4545, "masha": 4702, "julia": 4284}, "text": "Да, похожи. Нет, не соображу, какие треугольники взять."},
  {"id": "p2-31", "who": 1, "write": null, "ms": {"kirill": 4859, "anton": 4467, "alexander": 4519, "ermil": 4441, "dasha": 4571, "lera": 4519, "masha": 4885, "julia": 4336}, "text": "Смотри. Давай проведём эту высоту из бэ и эту из дэ."},
  {"id": "p2-32", "who": 2, "write": null, "ms": {"kirill": 627, "anton": 575, "alexander": 601, "ermil": 549, "dasha": 601, "lera": 653, "masha": 627, "julia": 601}, "text": "Вижу."},
  {"id": "p2-33", "who": 1, "write": null, "ms": {"kirill": 2664, "anton": 2482, "alexander": 2560, "ermil": 2534, "dasha": 2586, "lera": 2612, "masha": 2717, "julia": 2482}, "text": "Теперь вот этот и вот этот треугольники."},
  {"id": "p2-34", "who": 2, "write": null, "ms": {"kirill": 6374, "anton": 5982, "alexander": 6008, "ermil": 5799, "dasha": 6060, "lera": 6348, "masha": 6478, "julia": 5799}, "text": "Точно! Снова две стороны и угол между ними. Значит, угол а равен углу цэ."},
  {"id": "p2-35", "who": 1, "write": null, "ms": {"kirill": 6008, "anton": 5669, "alexander": 5799, "ermil": 5381, "dasha": 5773, "lera": 6060, "masha": 6296, "julia": 5616}, "text": "Да. Когда по клеткам считаешь, это самый простой способ — пристраивать такие треугольники."},
  {"id": "p2-36", "who": 2, "write": null, "ms": {"kirill": 3239, "anton": 3161, "alexander": 3161, "ermil": 2978, "dasha": 3344, "lera": 3396, "masha": 3553, "julia": 3213}, "text": "Спасибо, классный способ! Теперь всё понятно."},
  {"id": "p2-37", "who": 2, "write": null, "ms": {"kirill": 7680, "anton": 7393, "alexander": 7340, "ermil": 7210, "dasha": 7576, "lera": 7811, "masha": 8307, "julia": 7340}, "text": "Здравствуйте, Татьяна Алексеевна. Мне сначала вообще было непонятно. А сейчас объясняют — и вроде ясно становится."},
  {"id": "p2-38", "who": 1, "write": null, "ms": {"kirill": 3944, "anton": 3605, "alexander": 3683, "ermil": 3657, "dasha": 3814, "lera": 3762, "masha": 4101, "julia": 3631}, "text": "Достраиваем треугольники по клеткам и смотрим первый признак."},
  {"id": "p2-39", "who": 2, "write": null, "ms": {"kirill": 2090, "anton": 1959, "alexander": 1959, "ermil": 2011, "dasha": 2038, "lera": 2142, "masha": 2142, "julia": 1802}, "text": "Так. На чём мы остановились?"},
  {"id": "p2-tq", "who": "T", "write": null, "ms": {"alena": 1620, "filipp": 1567}, "text": "Как вы тут? Как дела?"},
  {"id": "p2-tb", "who": "T", "write": null, "ms": {"alena": 2926, "filipp": 3056}, "text": "Отлично. Разбирайтесь, не буду мешать."},
];
