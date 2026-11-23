// The voiced dialogue of the solo demo's pair where one does all the talking. Voiced with Yandex SpeechKit
// in every bot's voice, silence trimmed: the clips are client-teacher/public/demo/voice/<id>-<voice>.mp3.
// who: 1 — the one who talks, 2 — the quiet one; pause: before the line; ms: how long it lasts in each voice it was voiced in
// (a bot whose own voice is missing speaks in another of the same sex); after: said once the teacher has answered the call;
// write: what the speaker writes on the board as the line ends.

export interface SpokenLine { id: string; who: 1 | 2; pause: number; write: string | null; ms: Record<string, number>; after?: boolean }

export const FEMALE_VOICES = new Set(['dasha', 'lera', 'masha', 'julia', 'jane']);

export const VOICE_OF: Record<string, string> = {"Миша": "kirill", "Тимур": "anton", "Артём": "alexander", "Глеб": "ermil", "Аня": "dasha", "Лена": "lera", "Соня": "masha", "Вика": "jane"};

export const LOPSIDED_PAIR: SpokenLine[] = [
  {"id": "lp01", "who": 1, "pause": 3000, "write": "AD = BC", "ms": {"kirill": 4128, "anton": 4008, "alexander": 3936, "ermil": 3936, "dasha": 4104, "lera": 4176, "masha": 4200, "julia": 3912, "jane": 3816}},
  {"id": "lp02", "who": 1, "pause": 800, "write": "AB = CD", "ms": {"kirill": 4728, "anton": 4296, "alexander": 4272, "ermil": 4632, "dasha": 4272, "lera": 4536, "masha": 4656, "julia": 4152, "jane": 4512}},
  {"id": "lp03", "who": 2, "pause": 600, "write": null, "ms": {"kirill": 2112, "anton": 2064, "alexander": 2112, "ermil": 2040, "dasha": 2136, "lera": 2184, "masha": 2256, "julia": 2136, "jane": 2136}},
  {"id": "lp04", "who": 1, "pause": 300, "write": "AO = OC", "ms": {"kirill": 5880, "anton": 5832, "alexander": 5688, "ermil": 5496, "dasha": 5640, "lera": 5952, "masha": 5784, "julia": 5496, "jane": 5352}},
  {"id": "lp05", "who": 2, "pause": 3000, "write": null, "ms": {"kirill": 1032, "anton": 1032, "alexander": 1032, "ermil": 912, "dasha": 1008, "lera": 1056, "masha": 1056, "julia": 960, "jane": 984}},
  {"id": "lp06", "who": 1, "pause": 800, "write": null, "ms": {"kirill": 672, "anton": 768, "alexander": 672, "ermil": 648, "dasha": 720, "lera": 696, "masha": 792, "julia": 792, "jane": 624}},
  {"id": "lp07", "who": 2, "pause": 800, "write": null, "ms": {"kirill": 1488, "anton": 1440, "alexander": 1488, "ermil": 1368, "dasha": 1440, "lera": 1512, "masha": 1536, "julia": 1440, "jane": 1416}},
  {"id": "lp08", "who": 1, "pause": 400, "write": "BO = OD", "ms": {"kirill": 5232, "anton": 4872, "alexander": 4992, "ermil": 4680, "dasha": 4872, "lera": 5112, "masha": 5400, "julia": 4800, "jane": 4800}},
  {"id": "lp09", "who": 2, "pause": 1500, "write": null, "ms": {"kirill": 672, "anton": 696, "alexander": 624, "ermil": 624, "dasha": 672, "lera": 720, "masha": 696, "julia": 648, "jane": 648}},
  {"id": "lp10", "who": 1, "pause": 10000, "write": null, "ms": {"kirill": 5664, "anton": 5136, "alexander": 5352, "ermil": 5400, "dasha": 5328, "lera": 5424, "masha": 5808, "julia": 4896, "jane": 5472}},
  {"id": "lp11", "who": 2, "pause": 2000, "write": null, "ms": {"kirill": 2976, "anton": 2880, "alexander": 2760, "ermil": 2664, "dasha": 2640, "lera": 2904, "masha": 2976, "julia": 2688, "jane": 2976}},
  {"id": "lp12", "who": 1, "pause": 600, "write": null, "ms": {"kirill": 3024, "anton": 2832, "alexander": 3024, "ermil": 2856, "dasha": 3072, "lera": 3168, "masha": 3336, "julia": 2952, "jane": 3048}},
  {"id": "lp13", "who": 1, "pause": 12000, "write": null, "ms": {"kirill": 3456, "anton": 3312, "alexander": 3408, "ermil": 3264, "dasha": 3384, "lera": 3480, "masha": 3696, "julia": 3264, "jane": 3168}},
  {"id": "lp14", "who": 2, "pause": 1000, "write": null, "ms": {"kirill": 432, "anton": 408, "alexander": 408, "ermil": 312, "dasha": 384, "lera": 384, "masha": 384, "julia": 384, "jane": 360}},
  {"id": "lp15", "who": 1, "pause": 1500, "write": null, "ms": {"kirill": 1152, "anton": 1128, "alexander": 1104, "ermil": 984, "dasha": 1152, "lera": 1152, "masha": 1200, "julia": 1032, "jane": 1080}},
  {"id": "lp16", "who": 2, "pause": 1000, "write": null, "ms": {"kirill": 1944, "anton": 1944, "alexander": 1872, "ermil": 2016, "dasha": 1944, "lera": 1992, "masha": 2088, "julia": 1920, "jane": 1944}},
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
  {"id": "ch01", "ms": {"kirill": 1848, "anton": 1728, "alexander": 1752, "ermil": 1656, "dasha": 1848, "lera": 1896, "masha": 1872, "julia": 1728, "jane": 1680}},
  {"id": "ch02", "ms": {"kirill": 1416, "anton": 1416, "alexander": 1344, "ermil": 1368, "dasha": 1368, "lera": 1464, "masha": 1488, "julia": 1248, "jane": 1344}},
  {"id": "ch03", "ms": {"kirill": 792, "anton": 792, "alexander": 744, "ermil": 768, "dasha": 816, "lera": 840, "masha": 888, "julia": 792, "jane": 816}},
  {"id": "ch04", "ms": {"kirill": 432, "anton": 432, "alexander": 408, "ermil": 432, "dasha": 432, "lera": 480, "masha": 408, "julia": 408, "jane": 408}},
  {"id": "ch05", "ms": {"kirill": 1176, "anton": 1104, "alexander": 1080, "ermil": 1080, "dasha": 1152, "lera": 1128, "masha": 1128, "julia": 1080, "jane": 1080}},
  {"id": "ch06", "ms": {"kirill": 744, "anton": 744, "alexander": 816, "ermil": 720, "dasha": 816, "lera": 864, "masha": 840, "julia": 768, "jane": 696}},
  {"id": "ch07", "ms": {"kirill": 1392, "anton": 1344, "alexander": 1488, "ermil": 1392, "dasha": 1392, "lera": 1392, "masha": 1512, "julia": 1368, "jane": 1368}},
  {"id": "ch08", "ms": {"kirill": 3768, "anton": 3552, "alexander": 3792, "ermil": 3456, "dasha": 3696, "lera": 3816, "masha": 3864, "julia": 3456, "jane": 3288}},
  {"id": "ch09", "ms": {"kirill": 672, "anton": 744, "alexander": 744, "ermil": 600, "dasha": 720, "lera": 768, "masha": 816, "julia": 672, "jane": 696}},
  {"id": "ch10", "ms": {"kirill": 792, "anton": 840, "alexander": 792, "ermil": 768, "dasha": 768, "lera": 888, "masha": 840, "julia": 840, "jane": 792}},
  {"id": "ch11", "ms": {"kirill": 720, "anton": 768, "alexander": 720, "ermil": 696, "dasha": 720, "lera": 816, "masha": 840, "julia": 696, "jane": 696}},
  {"id": "ch12", "ms": {"kirill": 1512, "anton": 1440, "alexander": 1512, "ermil": 1464, "dasha": 1488, "lera": 1560, "masha": 1560, "julia": 1440, "jane": 1416}},
  {"id": "ch13", "ms": {"kirill": 1128, "anton": 1128, "alexander": 1176, "ermil": 960, "dasha": 1128, "lera": 1248, "masha": 1152, "julia": 1128, "jane": 1032}},
  {"id": "ch14", "ms": {"kirill": 1584, "anton": 1512, "alexander": 1560, "ermil": 1464, "dasha": 1608, "lera": 1656, "masha": 1728, "julia": 1536, "jane": 1560}},
  {"id": "ch15", "ms": {"kirill": 1416, "anton": 1440, "alexander": 1440, "ermil": 1296, "dasha": 1536, "lera": 1512, "masha": 1608, "julia": 1344, "jane": 1248}},
  {"id": "ch16", "ms": {"kirill": 984, "anton": 984, "alexander": 960, "ermil": 888, "dasha": 1008, "lera": 984, "masha": 1008, "julia": 888, "jane": 960}},
  {"id": "ch17", "ms": {"kirill": 984, "anton": 984, "alexander": 1032, "ermil": 936, "dasha": 960, "lera": 1080, "masha": 1032, "julia": 984, "jane": 936}},
  {"id": "ch18", "ms": {"kirill": 1056, "anton": 1032, "alexander": 960, "ermil": 936, "dasha": 984, "lera": 1128, "masha": 1176, "julia": 984, "jane": 984}},
  {"id": "ch19", "ms": {"kirill": 1920, "anton": 1872, "alexander": 1896, "ermil": 1848, "dasha": 1920, "lera": 1992, "masha": 2064, "julia": 1848, "jane": 1992}},
  {"id": "ch20", "ms": {"kirill": 1416, "anton": 1416, "alexander": 1440, "ermil": 1320, "dasha": 1488, "lera": 1536, "masha": 1584, "julia": 1416, "jane": 1560}},
  {"id": "ch21", "ms": {"kirill": 1776, "anton": 1632, "alexander": 1704, "ermil": 1680, "dasha": 1728, "lera": 1728, "masha": 1896, "julia": 1632, "jane": 1800}},
  {"id": "ch22", "ms": {"kirill": 912, "anton": 888, "alexander": 792, "ermil": 816, "dasha": 840, "lera": 960, "masha": 936, "julia": 840, "jane": 816}},
  {"id": "ch23", "ms": {"kirill": 1080, "anton": 984, "alexander": 984, "ermil": 912, "dasha": 1008, "lera": 1152, "masha": 1080, "julia": 1008, "jane": 912}},
  {"id": "ch24", "ms": {"kirill": 840, "anton": 840, "alexander": 840, "ermil": 744, "dasha": 792, "lera": 840, "masha": 840, "julia": 768, "jane": 864}},
  {"id": "ch25", "ms": {"kirill": 2016, "anton": 2016, "alexander": 1968, "ermil": 1920, "dasha": 1992, "lera": 2088, "masha": 2160, "julia": 1944, "jane": 1968}},
];

/** П1 «Как курица лапкой»: Миша (1) and his partner (2) check their lists against each other; T is the teacher.
 *  Lines p1-01…p1-31 in order; p1-32 Миша greets a teacher who came in openly, p1-33 asks them instead of the call (15–17);
 *  p1-tq the teacher asks what the question is, p1-ta the ready answer. Text: ~/temp/П1-курица.txt */
/** gap: ms after the line before the next, if set in the voice editor (else the engine's own) */
export interface DialogueLine { id: string; who: 1 | 2 | 'T'; write: string | null; ms: Record<string, number>; text: string; gap?: number }
/** П4 «Трёп»: they begin checking (p4-01…07), drift into chatter by who sits there — м-м p4-08…29 football, ж-ж p4-30…47
 *  the party, ж-м p4-48…69 the rabbit (1 the girl) — and wake up at the end (p4-70…76, one writes out their list);
 *  a teacher coming in openly before that gets p4-77…89 instead: they check for real. Text: ~/temp/П4-трёп.txt */
export const CHAT: DialogueLine[] = [
  {"id": "p4-01", "who": 1, "write": null, "ms": {"dasha": 1620, "lera": 1620, "masha": 1698, "jane": 1332, "anton": 1515, "alexander": 1646, "ermil": 1384}, "text": "Ну что, сверяемся?"},
  {"id": "p4-02", "who": 2, "write": null, "ms": {"dasha": 1698, "lera": 1776, "masha": 1829, "jane": 1567, "anton": 1698, "alexander": 1698, "ermil": 1489}, "text": "Давай. У тебя сколько?"},
  {"id": "p4-03", "who": 1, "write": null, "ms": {"dasha": 2429, "lera": 2508, "masha": 2638, "jane": 2586, "anton": 2403, "alexander": 2482, "ermil": 2377}, "text": "Четыре. Стороны и диагонали."},
  {"id": "p4-04", "who": 2, "write": null, "ms": {"dasha": 5564, "lera": 5747, "masha": 6008, "jane": 5721, "anton": 5538, "alexander": 5460, "ermil": 5721}, "text": "У меня тоже четыре, только другие. Стороны есть, диагоналей нет. Зато углы."},
  {"id": "p4-05", "who": 1, "write": null, "ms": {"dasha": 5460, "lera": 5669, "masha": 5642, "jane": 5277, "anton": 5277, "alexander": 5486, "ermil": 5172}, "text": "Угол а равен углу цэ — вижу. А внизу что? Это бэ или восьмёрка?"},
  {"id": "p4-06", "who": 2, "write": null, "ms": {"dasha": 2560, "lera": 2717, "masha": 2691, "jane": 2456, "anton": 2560, "alexander": 2508, "ermil": 2586}, "text": "Бэ. Угол бэ равен углу дэ."},
  {"id": "p4-07", "who": 1, "write": null, "ms": {"dasha": 4519, "lera": 4571, "masha": 4702, "jane": 4545, "anton": 4389, "alexander": 4441, "ermil": 4493}, "text": "Ну и почерк. Ладно, значит, вместе у нас… раз, два…"},
  {"id": "p4-08", "who": 2, "write": null, "ms": {"anton": 2377, "alexander": 2325, "ermil": 2247}, "text": "Слушай, а ты в субботу чего не пришёл?"},
  {"id": "p4-09", "who": 1, "write": null, "ms": {"anton": 3500, "alexander": 3579, "ermil": 3448}, "text": "Не пустили, бабушка приезжала. Ну и как сыграли?"},
  {"id": "p4-10", "who": 2, "write": null, "ms": {"anton": 862, "alexander": 888, "ermil": 836}, "text": "Семь — пять."},
  {"id": "p4-11", "who": 1, "write": null, "ms": {"anton": 836, "alexander": 679, "ermil": 705}, "text": "Кто кого?"},
  {"id": "p4-12", "who": 2, "write": null, "ms": {"anton": 758, "alexander": 758, "ermil": 758}, "text": "Они нас."},
  {"id": "p4-13", "who": 1, "write": null, "ms": {"anton": 1881, "alexander": 1985, "ermil": 1776}, "text": "Семь?! А кто на воротах стоял?"},
  {"id": "p4-14", "who": 2, "write": null, "ms": {"anton": 601, "alexander": 627, "ermil": 601}, "text": "Костя."},
  {"id": "p4-15", "who": 1, "write": null, "ms": {"anton": 1776, "alexander": 1646, "ermil": 1855}, "text": "А, ну тогда всё понятно."},
  {"id": "p4-16", "who": 2, "write": null, "ms": {"anton": 7549, "alexander": 7419, "ermil": 7628}, "text": "Да там вообще... А за них ещё Рустам пришёл, здоровый такой. Он точно в восьмом? Кажется, что ему лет восемнадцать."},
  {"id": "p4-17", "who": 1, "write": null, "ms": {"anton": 1280, "alexander": 1332, "ermil": 1306}, "text": "Это который с бородой?"},
  {"id": "p4-18", "who": 2, "write": null, "ms": {"anton": 4833, "alexander": 4937, "ermil": 5016}, "text": "С бородой. Мы говорим: так нечестно. А он: «Борода не играет»."},
  {"id": "p4-19", "who": 1, "write": null, "ms": {"anton": 1463, "alexander": 1541, "ermil": 1463}, "text": "Мда, гениально."},
  {"id": "p4-20", "who": 2, "write": null, "ms": {"anton": 9796, "alexander": 9718, "ermil": 9691}, "text": "А последний гол - просто песня. Костя начал мяч выносить и прямо Максу в спину попал. А от него — под удар их нападающему. Ну и всё, семь — пять."},
  {"id": "p4-21", "who": 1, "write": null, "ms": {"anton": 1933, "alexander": 1776, "ermil": 1985}, "text": "То есть Костя им ещё и помог."},
  {"id": "p4-22", "who": 2, "write": null, "ms": {"anton": 1672, "alexander": 1646, "ermil": 1698}, "text": "Он сказал, это тактика была."},
  {"id": "p4-23", "who": 1, "write": null, "ms": {"anton": 1149, "alexander": 1097, "ermil": 1045}, "text": "Какая тактика?"},
  {"id": "p4-24", "who": 2, "write": null, "ms": {"anton": 2038, "alexander": 2142, "ermil": 2090}, "text": "Не знаю. Он сам не знает."},
  {"id": "p4-25", "who": 1, "write": null, "ms": {"anton": 1254, "alexander": 1280, "ermil": 1176}, "text": "В эту субботу идём?"},
  {"id": "p4-26", "who": 2, "write": null, "ms": {"anton": 2612, "alexander": 2612, "ermil": 2664}, "text": "Идём. Только Костю на ворота не ставим."},
  {"id": "p4-27", "who": 1, "write": null, "ms": {"anton": 1071, "alexander": 1176, "ermil": 1045}, "text": "Давай я встану."},
  {"id": "p4-28", "who": 2, "write": null, "ms": {"anton": 4493, "alexander": 4493, "ermil": 4519}, "text": "Ты? Ты в прошлый раз в воротах спиной стоял, с кем-то по телефону болтал."},
  {"id": "p4-29", "who": 1, "write": null, "ms": {"anton": 1228, "alexander": 1254, "ermil": 1280}, "text": "Это мама звонила!"},
  {"id": "p4-30", "who": 2, "write": null, "ms": {"dasha": 2273, "lera": 2377, "masha": 2560, "jane": 2011}, "text": "Слушай, а ты у Кати до конца была?"},
  {"id": "p4-31", "who": 1, "write": null, "ms": {"dasha": 3657, "lera": 3579, "masha": 3814, "jane": 2978}, "text": "Нет, меня в девять забрали. А что? Что-то было?"},
  {"id": "p4-32", "who": 2, "write": null, "ms": {"dasha": 2900, "lera": 2978, "masha": 3082, "jane": 2769}, "text": "Было. Лёша пришёл. В белой рубашке."},
  {"id": "p4-33", "who": 1, "write": null, "ms": {"dasha": 1933, "lera": 1985, "masha": 2064, "jane": 1959}, "text": "В белой? На день рождения?"},
  {"id": "p4-34", "who": 2, "write": null, "ms": {"dasha": 5198, "lera": 5407, "masha": 5460, "jane": 5486}, "text": "Да. И стоит у стены. Весь вечер стоит. Все танцуют, а он стоит."},
  {"id": "p4-35", "who": 1, "write": null, "ms": {"dasha": 1411, "lera": 1567, "masha": 1489, "jane": 1358}, "text": "Ну! это Лёша."},
  {"id": "p4-36", "who": 2, "write": null, "ms": {"dasha": 6504, "lera": 6792, "masha": 7053, "jane": 6609}, "text": "Подожди. И тут Катя включает ту песню. Ну, которую она всё время слушает. И идёт прямо к нему."},
  {"id": "p4-37", "who": 1, "write": null, "ms": {"dasha": 862, "lera": 888, "masha": 862, "jane": 810}, "text": "Да ладно."},
  {"id": "p4-38", "who": 2, "write": null, "ms": {"dasha": 2247, "lera": 2273, "masha": 2429, "jane": 2351}, "text": "А он отходит и наливает себе сок."},
  {"id": "p4-39", "who": 1, "write": null, "ms": {"dasha": 627, "lera": 653, "masha": 653, "jane": 522}, "text": "Чего?"},
  {"id": "p4-40", "who": 2, "write": null, "ms": {"dasha": 4702, "lera": 4676, "masha": 5016, "jane": 4754}, "text": "Он думал, она к столу идёт. Отошёл, чтобы не мешать. И налил себе сок."},
  {"id": "p4-41", "who": 1, "write": null, "ms": {"dasha": 993, "lera": 1071, "masha": 1019, "jane": 993}, "text": "Не может быть."},
  {"id": "p4-42", "who": 2, "write": null, "ms": {"dasha": 5669, "lera": 5747, "masha": 5982, "jane": 5695}, "text": "Может. Она так и стоит посреди комнаты. Потом говорит: «Лёш, я вообще-то к тебе»."},
  {"id": "p4-43", "who": 1, "write": null, "ms": {"dasha": 601, "lera": 653, "masha": 601, "jane": 601}, "text": "А он?"},
  {"id": "p4-44", "who": 2, "write": null, "ms": {"dasha": 1620, "lera": 1724, "masha": 1724, "jane": 1567}, "text": "А он ей: «Будешь сок?»"},
  {"id": "p4-45", "who": 1, "write": null, "ms": {"dasha": 3265, "lera": 3318, "masha": 3213, "jane": 2534}, "text": "Всё, не могу. И что, танцевали в итоге?"},
  {"id": "p4-46", "who": 2, "write": null, "ms": {"dasha": 5695, "lera": 5825, "masha": 6217, "jane": 6844}, "text": "Танцевали. Он ей на ногу пару раз наступил, вроде. А она потом сказала, что это было мило."},
  {"id": "p4-47", "who": 1, "write": null, "ms": {"dasha": 1829, "lera": 1829, "masha": 1881, "jane": 1776}, "text": "Мило… Ну Катя даёт."},
  {"id": "p4-48", "who": 1, "write": null, "ms": {"dasha": 1802, "lera": 1985, "masha": 2090, "jane": 1855}, "text": "А у нас вчера кролик появился."},
  {"id": "p4-49", "who": 2, "write": null, "ms": {"anton": 1593, "alexander": 1541, "ermil": 1411}, "text": "В смысле — появился."},
  {"id": "p4-50", "who": 1, "write": null, "ms": {"dasha": 3631, "lera": 3866, "masha": 3997, "jane": 3840}, "text": "Родители купили. Младшей сестре, у неё день рождения."},
  {"id": "p4-51", "who": 2, "write": null, "ms": {"anton": 914, "alexander": 1045, "ermil": 862}, "text": "Настоящий?"},
  {"id": "p4-52", "who": 1, "write": null, "ms": {"dasha": 5094, "lera": 5224, "masha": 5433, "jane": 5172}, "text": "Нет, плюшевый. Конечно, настоящий. Серый, уши большие такие."},
  {"id": "p4-53", "who": 2, "write": null, "ms": {"anton": 888, "alexander": 914, "ermil": 810}, "text": "Как назвали?"},
  {"id": "p4-54", "who": 1, "write": null, "ms": {"dasha": 1776, "lera": 1802, "masha": 1829, "jane": 1776}, "text": "Она назвала. Пельмень."},
  {"id": "p4-55", "who": 2, "write": null, "ms": {"anton": 967, "alexander": 1019, "ermil": 888}, "text": "Почему Пельмень?"},
  {"id": "p4-56", "who": 1, "write": null, "ms": {"dasha": 3082, "lera": 3109, "masha": 3187, "jane": 3030}, "text": "Говорит, похож. Сидит — и правда похож."},
  {"id": "p4-57", "who": 2, "write": null, "ms": {"anton": 1463, "alexander": 1437, "ermil": 1515}, "text": "А ты как хотела назвать?"},
  {"id": "p4-58", "who": 1, "write": null, "ms": {"dasha": 2090, "lera": 2142, "masha": 2194, "jane": 2194}, "text": "Граф. Но кто меня спрашивал."},
  {"id": "p4-59", "who": 2, "write": null, "ms": {"anton": 993, "alexander": 1045, "ermil": 993}, "text": "Граф Пельмень."},
  {"id": "p4-60", "who": 1, "write": null, "ms": {"dasha": 5512, "lera": 5695, "masha": 5773, "jane": 5433}, "text": "О. Так и будем звать. Только он ночью провод от зарядки перегрыз. Мой."},
  {"id": "p4-61", "who": 2, "write": null, "ms": {"anton": 888, "alexander": 914, "ermil": 836}, "text": "А мама что?"},
  {"id": "p4-62", "who": 1, "write": null, "ms": {"dasha": 4937, "lera": 5068, "masha": 5381, "jane": 5016}, "text": "Мама говорит: «Сами хотели кролика». А я не хотела! Это сестра хотела."},
  {"id": "p4-63", "who": 2, "write": null, "ms": {"anton": 1515, "alexander": 1541, "ermil": 1515}, "text": "И как теперь без зарядки?"},
  {"id": "p4-64", "who": 1, "write": null, "ms": {"dasha": 2325, "lera": 2429, "masha": 2508, "jane": 2351}, "text": "Взяла папину. Он пока не знает."},
  {"id": "p4-65", "who": 2, "write": null, "ms": {"anton": 1620, "alexander": 1541, "ermil": 1515}, "text": "А его на руки брать можно?"},
  {"id": "p4-66", "who": 1, "write": null, "ms": {"dasha": 7863, "lera": 7967, "masha": 8620, "jane": 8124}, "text": "Можно, только он лягается. Сестра посадила его в кукольную коляску, а он выпрыгнул и под диван. Час доставали."},
  {"id": "p4-67", "who": 2, "write": null, "ms": {"anton": 731, "alexander": 679, "ermil": 627}, "text": "Покажешь?"},
  {"id": "p4-68", "who": 1, "write": null, "ms": {"dasha": 2821, "lera": 3109, "masha": 3213, "jane": 3004}, "text": "Приходи. Только за зарядкой своей в оба смотри."},
  {"id": "p4-69", "who": 2, "write": null, "ms": {"anton": 1593, "alexander": 1567, "ermil": 1593}, "text": "Хорошо, договорились."},
  {"id": "p4-70", "who": 1, "write": null, "ms": {"dasha": 2194, "lera": 2273, "masha": 2456, "jane": 2064, "anton": 2220, "alexander": 2090, "ermil": 2038}, "text": "Ой, смотри, время заканчивается."},
  {"id": "p4-71", "who": 2, "write": null, "ms": {"dasha": 1933, "lera": 2090, "masha": 2168, "jane": 1959, "anton": 2064, "alexander": 1959, "ermil": 2247}, "text": "Мы же так ничего и не проверили."},
  {"id": "p4-72", "who": 1, "write": "AD = BC; AB = CD; AO = OC; BO = OD", "ms": {"dasha": 2821, "lera": 2952, "masha": 3082, "jane": 2769, "anton": 2821, "alexander": 2717, "ermil": 2743}, "text": "Давай я просто своё выпишу. Там всё нормально."},
  {"id": "p4-73", "who": 2, "write": null, "ms": {"dasha": 888, "lera": 940, "masha": 940, "jane": 836, "anton": 940, "alexander": 940, "ermil": 836}, "text": "А мои углы?"},
  {"id": "p4-74", "who": 1, "write": null, "ms": {"dasha": 888, "lera": 940, "masha": 940, "jane": 862, "anton": 914, "alexander": 888, "ermil": 758}, "text": "Это какие?"},
  {"id": "p4-75", "who": 2, "write": null, "ms": {"dasha": 1829, "lera": 2038, "masha": 2011, "jane": 1959, "anton": 1985, "alexander": 1855, "ermil": 1933}, "text": "Угол а равен углу цэ."},
  {"id": "p4-76", "who": 1, "write": "∠A = ∠C", "ms": {"dasha": 1384, "lera": 1358, "masha": 1411, "jane": 1202, "anton": 1280, "alexander": 1358, "ermil": 1280}, "text": "Хорошо, берём."},
  {"id": "p4-77", "who": "T", "write": null, "ms": {"alena": 2691}, "text": "Так, как у вас дела? Проверили уже?"},
  {"id": "p4-78", "who": 1, "write": null, "ms": {"dasha": 3396, "lera": 3474, "masha": 3631, "jane": 3422, "anton": 3370, "alexander": 3396, "ermil": 3161}, "text": "Здравствуйте, Татьяна Алексеевна. Да… почти."},
  {"id": "p4-79", "who": 2, "write": null, "ms": {"dasha": 810, "lera": 836, "masha": 862, "jane": 784, "anton": 731, "alexander": 784, "ermil": 784}, "text": "Проверяем..."},
  {"id": "p4-80", "who": "T", "write": null, "ms": {"alena": 8255}, "text": "Что-то у вас доска совсем пустая. Нужно уже ускоряться. По очереди, по одному наблюдению, и сразу записывайте. Всё понятно?"},
  {"id": "p4-81", "who": 1, "write": null, "ms": {"dasha": 2247, "lera": 2325, "masha": 2273, "jane": 1959, "anton": 2194, "alexander": 2194, "ermil": 2064}, "text": "Да, сейчас. Начинаем."},
  {"id": "p4-82", "who": 2, "write": "AD = BC", "ms": {"dasha": 1280, "lera": 1332, "masha": 1384, "jane": 1332, "anton": 1332, "alexander": 1332, "ermil": 1358}, "text": "А-дэ равно бэ-цэ."},
  {"id": "p4-83", "who": 1, "write": "AB = CD", "ms": {"dasha": 1202, "lera": 1280, "masha": 1332, "jane": 1306, "anton": 1280, "alexander": 1202, "ermil": 1332}, "text": "А-бэ равно цэ-дэ."},
  {"id": "p4-84", "who": 2, "write": "∠A = ∠C", "ms": {"dasha": 3239, "lera": 3500, "masha": 3553, "jane": 3474, "anton": 3265, "alexander": 3291, "ermil": 3370}, "text": "Угол а равен углу цэ. Этого у тебя не было."},
  {"id": "p4-85", "who": 1, "write": "AO = OC", "ms": {"dasha": 3187, "lera": 3291, "masha": 3474, "jane": 3344, "anton": 3344, "alexander": 3161, "ermil": 3187}, "text": "Тогда а-о равно о-цэ. А этого не было у тебя."},
  {"id": "p4-86", "who": 2, "write": "∠B = ∠D", "ms": {"dasha": 3344, "lera": 3500, "masha": 3683, "jane": 3500, "anton": 3422, "alexander": 3318, "ermil": 3500}, "text": "Угол бэ равен углу дэ. Та самая «восьмёрка»."},
  {"id": "p4-87", "who": 1, "write": "BO = OD", "ms": {"dasha": 1411, "lera": 1541, "masha": 1567, "jane": 1437, "anton": 1593, "alexander": 1463, "ermil": 1463}, "text": "Бэ-о равно о-дэ."},
  {"id": "p4-88", "who": 2, "write": null, "ms": {"dasha": 3527, "lera": 3500, "masha": 3788, "jane": 3579, "anton": 3474, "alexander": 3448, "ermil": 3422}, "text": "Смотри: у каждого было по четыре, а вместе — шесть."},
  {"id": "p4-89", "who": 1, "write": null, "ms": {"dasha": 1332, "lera": 1384, "masha": 1411, "jane": 1254, "anton": 1332, "alexander": 1306, "ermil": 1202}, "text": "Да, отлично."},
];

/** Ч2 «Шестая — самая коварная» (b10, the four where Аня sits): 1–3 whoever, 4 is always Аня. No teacher in it.
 *  Text: ~/temp/Ч2-шестая.txt */
export interface FourLine { id: string; who: 1 | 2 | 3 | 4; write: string | null; ms: Record<string, number>; text: string; gap?: number }
/** What is drawn while a line is said, in the board's pixels: at — how far into the line; thin — a helper line;
 *  ts — when each point of the path comes (a share of the line, as `at`; without it a segment every 300 ms) */
export interface FourDraw { at: number; path?: Pt[]; ts?: number[]; ws?: number[]; thin?: boolean; color?: string; label?: { text: string; at: Pt }; text?: { text: string; at: Pt }; dot?: Pt }
/** A sheet of b2 drawn by hand (voice editor, «Листы»): draw at seconds into the stage; after: once the teacher answered the call
 *  (at: seconds from the answer); call: when they call, s */
export interface SheetDraw { draw: FourDraw[]; after?: FourDraw[]; call?: number }
/** By the part in the pairs: `p1-1` is П1's {1} (Миша) */
export const SHEET_DRAW: Record<string, SheetDraw> = {
  "p1-2": {"draw":[{"at":5,"path":[[921,65],[908,90],[906,100],[904,101],[913,82],[913,79],[915,75],[915,72],[918,69],[918,67],[922,63],[924,64],[924,104],[922,106],[922,114]],"ts":[5,5.185,5.22,5.226,5.351,5.358,5.379,5.393,5.448,5.476,5.573,5.587,5.725,5.733,5.829],"ws":[5,4.4,4.5,4.6,4.6,4.6,4.6,4.6,4.6,4.6,4.5,4.4,4.6,4.6,4.6],"color":"#e03131"},{"at":6.205,"path":[[908,94],[907,93],[921,93]],"ts":[6.205,6.28,6.495],"ws":[5,3.8,3.9],"color":"#e03131"},{"at":6.861,"path":[[946,71],[944,82],[940,93],[938,107],[936,108],[938,79],[943,68],[950,63],[953,61],[958,61],[967,69],[969,76],[969,85],[968,86],[968,89],[958,97],[956,97],[949,101],[940,103],[939,104],[936,104],[935,103]],"ts":[6.861,6.986,7.015,7.068,7.125,7.243,7.311,7.353,7.377,7.45,7.513,7.541,7.589,7.596,7.61,7.666,7.679,7.707,7.748,7.762,7.796,7.839],"ws":[5,4.4,4.5,4.7,4.8,4.8,4.7,4.7,4.6,4.6,4.6,4.6,4.7,4.7,4.7,4.8,4.8,4.8,4.8,4.8,4.7,4.1],"color":"#e03131"},{"at":8.222,"path":[[997,72],[1014,75]],"ts":[8.222,8.422],"color":"#e03131"},{"at":8.647,"path":[[999,81],[1001,83],[1013,83]],"ts":[8.647,8.716,8.813],"ws":[5,4,3.9],"color":"#e03131"},{"at":9.156,"path":[[1051,69],[1050,99],[1050,78],[1051,75],[1051,69],[1053,68],[1053,65],[1058,60],[1067,60],[1071,64],[1071,67],[1067,74],[1058,81],[1069,79],[1075,82],[1079,86],[1081,96],[1075,101],[1065,107],[1051,107],[1046,106]],"ts":[9.156,9.402,9.485,9.492,9.513,9.527,9.534,9.582,9.627,9.659,9.68,9.707,9.76,9.867,9.901,9.936,9.992,10.019,10.054,10.11,10.151],"ws":[5,4.7,4.7,4.7,4.6,4.6,4.6,4.6,4.5,4.5,4.5,4.6,4.5,4.3,4.3,4.3,4.4,4.5,4.6,4.6,4.1],"color":"#e03131"},{"at":10.47,"path":[[1119,68],[1114,63],[1111,63],[1110,61],[1104,61],[1099,64],[1094,68],[1092,74],[1090,79],[1090,93],[1092,94],[1092,97],[1096,103],[1104,110],[1113,110],[1114,108],[1121,107]],"ts":[10.47,10.547,10.568,10.576,10.609,10.637,10.658,10.679,10.692,10.741,10.748,10.755,10.775,10.831,10.873,10.88,10.918],"ws":[5,3.7,3.8,3.8,4,4.1,4.2,4.3,4.4,4.6,4.6,4.6,4.6,4.7,4.6,4.5,5],"color":"#e03131"},{"at":16,"path":[[924,143],[925,142],[924,143],[922,151],[919,156],[917,169],[917,164],[918,161],[918,156],[921,150],[921,144],[924,140],[925,133],[928,131],[932,139],[935,169]],"ts":[16,16.045,16.127,16.155,16.175,16.259,16.349,16.356,16.376,16.39,16.404,16.425,16.46,16.509,16.571,16.698],"ws":[5,3.5,4.4,4.6,4.6,4.8,4.8,4.9,4.9,4.9,4.9,4.9,4.9,4.8,4.8,4.8],"color":"#e03131"},{"at":16.841,"path":[[926,153],[925,151],[924,153],[921,153],[919,154],[917,154],[918,156],[921,157],[932,157]],"ts":[16.841,16.917,16.949,16.987,17.001,17.05,17.161,17.174,17.237],"ws":[5,3.7,3.7,3.4,3.3,3.5,4.4,4.5,4.1],"color":"#e03131"},{"at":17.461,"path":[[956,142],[957,140],[957,149],[956,151],[956,165],[954,167],[954,169],[954,165],[956,163],[956,140],[957,139],[957,136],[960,133],[965,133],[971,138],[968,143],[958,153],[969,153],[971,154],[974,154],[978,158],[979,168],[976,172],[969,175],[956,172],[954,171]],"ts":[17.461,17.507,17.577,17.584,17.626,17.648,17.661,17.702,17.715,17.772,17.785,17.799,17.848,17.889,17.938,17.965,18.028,18.118,18.132,18.153,18.19,18.258,18.285,18.326,18.388,18.41],"ws":[5,4,4.6,4.7,4.8,4.8,4.8,4.9,4.9,4.8,4.8,4.8,4.8,4.8,4.8,4.8,4.8,4.8,4.8,4.8,4.7,4.8,4.9,4.9,4.8,4.2],"color":"#e03131"},{"at":18.66,"path":[[1011,143],[1013,142],[1026,142]],"ts":[18.66,18.749,18.818],"ws":[5,4.4,4.5],"color":"#e03131"},{"at":18.995,"path":[[1004,157],[1010,160],[1024,160]],"ts":[18.995,19.081,19.151],"ws":[5,4.5,4.2],"color":"#e03131"},{"at":19.765,"path":[[1075,142],[1076,140],[1065,142],[1053,153],[1053,156],[1051,157],[1053,168],[1056,171],[1058,171],[1060,172],[1075,172],[1076,171],[1086,169]],"ts":[19.765,19.851,19.948,20.004,20.017,20.025,20.094,20.115,20.122,20.129,20.17,20.17,20.225],"ws":[5,4.2,4.6,4.8,4.8,4.8,4.9,4.9,4.9,4.9,4.9,4.9,4.1],"color":"#e03131"},{"at":20.402,"path":[[1100,147],[1097,167],[1097,150],[1099,149],[1100,139],[1103,133],[1111,135],[1119,142],[1124,151],[1124,157],[1119,165],[1115,169],[1108,172],[1097,172]],"ts":[20.402,20.628,20.746,20.753,20.802,20.865,20.934,20.996,21.044,21.072,21.12,21.141,21.17,21.218],"ws":[5,4.8,4.9,4.9,4.9,4.9,4.9,4.9,4.9,4.9,4.9,4.9,4.9,4.9],"color":"#e03131"},{"at":27,"path":[[936,222],[926,236],[915,246],[915,249],[944,249]],"ts":[27,27.203,27.318,27.408,27.56],"ws":[5,4.7,4.8,4.8,4.8],"color":"#e03131"},{"at":27.851,"path":[[976,206],[971,217],[967,231],[961,240],[968,215],[974,204],[979,210],[979,213],[982,217],[988,242]],"ts":[27.851,27.93,27.964,28.026,28.136,28.22,28.29,28.295,28.31,28.393],"ws":[5,4.3,4.5,4.7,4.9,4.8,4.8,4.8,4.8,4.8],"color":"#e03131"},{"at":28.655,"path":[[968,232],[969,231],[981,231]],"ts":[28.655,28.67,28.744],"ws":[5,2.9,3.2],"color":"#e03131"},{"at":28.973,"path":[[1014,221],[1028,219]],"ts":[28.973,29.089],"ws":[5,4.4],"color":"#e03131"},{"at":29.218,"path":[[1011,231],[1028,231]],"ts":[29.218,29.388],"color":"#e03131"},{"at":29.587,"path":[[1068,219],[1069,218],[1072,218],[1071,225],[1061,239],[1061,242],[1060,243],[1082,243],[1083,242],[1089,242]],"ts":[29.587,29.608,29.658,29.761,29.843,29.889,29.94,30.058,30.065,30.127],"ws":[5,3.3,4.4,4.7,4.8,4.8,4.8,4.8,4.8,4.7],"color":"#e03131"},{"at":30.748,"path":[[1132,203],[1126,200],[1118,200],[1111,201],[1100,207],[1096,211],[1094,218],[1093,219],[1093,226],[1096,238],[1100,246],[1107,253],[1114,256],[1125,256],[1131,254],[1133,251],[1136,251],[1138,250]],"ts":[30.748,30.849,30.881,30.894,30.929,30.942,30.97,30.97,30.984,31.018,31.039,31.074,31.095,31.13,31.151,31.172,31.185,31.199],"ws":[5,4.3,4.4,4.4,4.5,4.6,4.6,4.6,4.7,4.8,4.8,4.9,4.9,4.9,4.9,4.8,4.5,5],"color":"#e03131"},{"at":38,"path":[[954,278],[946,294],[944,301],[942,306],[939,315],[938,317],[938,319],[936,321],[936,324],[936,308],[938,307],[938,300],[939,299],[940,290],[947,278],[947,275],[954,281],[960,292],[960,294],[963,297],[967,314]],"ts":[38,38.512,38.526,38.54,38.561,38.57,38.582,38.596,38.63,38.72,38.727,38.748,38.755,38.783,38.845,38.887,38.95,38.983,38.998,39.012,39.144],"ws":[5,4.5,4.6,4.6,4.6,4.6,4.6,4.6,4.6,4.8,4.8,4.8,4.8,4.8,4.8,4.7,4.7,4.7,4.7,4.7,4.7],"color":"#e03131"},{"at":39.467,"path":[[942,303],[964,303]],"ts":[39.467,39.761],"ws":[5,3.8],"color":"#e03131"},{"at":40.053,"path":[[1007,278],[1000,285],[994,296],[996,306],[1000,310],[1008,310],[1014,308],[1019,304],[1024,299],[1024,296],[1025,294],[1024,286],[1018,281],[1011,276],[1003,276],[1001,278]],"ts":[40.053,40.136,40.184,40.233,40.253,40.295,40.309,40.33,40.35,40.357,40.371,40.408,40.434,40.462,40.496,40.508],"ws":[5,3.9,4.3,4.5,4.6,4.7,4.7,4.8,4.8,4.8,4.8,4.8,4.8,4.7,4.1,3.8],"color":"#e03131"},{"at":40.737,"path":[[1036,288],[1042,289],[1060,289],[1065,290]],"ts":[40.737,40.774,40.836,40.864],"ws":[5,3.6,4.3,4.1],"color":"#e03131"},{"at":41.027,"path":[[1051,297],[1054,297],[1056,299],[1064,299]],"ts":[41.027,41.075,41.086,41.144],"ws":[5,3.6,3.8,5],"color":"#e03131"},{"at":41.461,"path":[[1110,285],[1111,283],[1108,285],[1101,293],[1101,296],[1097,304],[1099,311],[1104,314],[1111,313],[1118,307],[1119,301],[1121,300],[1121,286],[1119,285],[1119,282],[1110,279]],"ts":[41.461,41.509,41.585,41.627,41.64,41.669,41.71,41.744,41.779,41.814,41.835,41.842,41.911,41.926,41.932,41.987],"ws":[5,4,4.4,4.5,4.5,4.6,4.7,4.8,4.8,4.9,4.9,4.9,4.9,4.9,4.9,5],"color":"#e03131"},{"at":42.289,"path":[[1167,278],[1169,278],[1168,276],[1160,278],[1149,288],[1146,293],[1146,304],[1147,307],[1154,313],[1168,313],[1176,307]],"ts":[42.289,42.341,42.382,42.432,42.481,42.501,42.577,42.605,42.667,42.757,42.805],"ws":[5,4.2,4.5,4.6,4.6,4.6,4.7,4.7,4.7,4.8,3.9],"color":"#e03131"},{"at":49,"path":[[947,356],[944,358],[944,364],[943,365],[942,385],[942,365],[946,356],[950,351],[956,351],[957,354],[956,356],[956,358],[950,364],[963,375],[961,376],[961,379],[956,385],[950,388],[944,388],[936,382]],"ts":[49,49.085,49.108,49.115,49.212,49.323,49.386,49.42,49.476,49.503,49.517,49.538,49.607,49.801,49.808,49.823,49.851,49.878,49.906,49.968],"ws":[5,3.9,4,4,4.4,4.7,4.7,4.7,4.7,4.7,4.7,4.7,4.7,4.6,4.6,4.6,4.6,4.7,4.7,3.9],"color":"#e03131"},{"at":50.133,"path":[[990,353],[990,350],[982,357],[978,368],[982,378],[988,382],[990,382],[992,383],[1000,383],[1007,378],[1008,372],[1004,357],[993,344],[989,344]],"ts":[50.133,50.176,50.218,50.261,50.294,50.315,50.329,50.329,50.357,50.398,50.405,50.433,50.481,50.492],"ws":[5,3.6,4.1,4.3,4.5,4.6,4.6,4.6,4.7,4.8,4.8,4.8,4.2,5],"color":"#e03131"},{"at":51.092,"path":[[1033,364],[1036,363],[1063,361]],"ts":[51.092,51.141,51.236],"ws":[5,3.6,3.5],"color":"#e03131"},{"at":51.445,"path":[[1038,372],[1039,374],[1065,372]],"ts":[51.445,51.484,51.601],"ws":[5,3.9,3.9],"color":"#e03131"},{"at":52.201,"path":[[1118,347],[1115,347],[1108,351],[1097,365],[1097,368],[1096,369],[1096,375],[1099,381],[1101,383],[1110,383],[1111,382],[1114,382],[1118,378],[1119,375],[1119,365],[1115,357],[1110,351],[1104,351]],"ts":[52.201,52.234,52.27,52.312,52.327,52.338,52.356,52.382,52.408,52.436,52.45,52.457,52.477,52.484,52.512,52.54,52.56,52.578],"ws":[5,3.3,4,4.4,4.4,4.5,4.6,4.6,4.7,4.7,4.8,4.8,4.8,4.8,4.8,4.8,4.6,5],"color":"#e03131"},{"at":52.816,"path":[[1139,340],[1139,343],[1140,344],[1139,378],[1142,372],[1142,361],[1143,358],[1144,347],[1147,344],[1153,344],[1158,347],[1161,347],[1169,357],[1169,365],[1167,369],[1157,378],[1154,378],[1151,381],[1144,382],[1143,383]],"ts":[52.816,52.887,52.894,53.004,53.068,53.095,53.102,53.157,53.192,53.226,53.255,53.261,53.31,53.351,53.365,53.386,53.393,53.4,53.434,53.453],"ws":[5,3.7,3.8,4.7,4.9,4.9,4.9,4.9,4.9,4.9,4.9,4.9,4.9,4.9,4.9,4.9,4.9,4.9,4.8,5],"color":"#e03131"}]},
};
/** A line's board, from the voice editor: what is wiped as it begins, a card moved, what is drawn */
export interface LineBoard { erase?: boolean; move?: [number, Pt]; draw?: FourDraw[] }
/** Ч1 «Ловушка трапеции» (b10, the other four): 1 Организатор, 2 Сомневающийся (a girl: Лена), 3 Третий, 4 Шутник; T the teacher:
 *  c1-t0 «Какие у вас вопросы?», c1-ta1… the ready answer (drawing as it goes), c1-tok the praise. 38–39 instead of 18–19
 *  when the teacher is in the room as they'd call. Text: ~/temp/Ч1-трапеция.txt */
export type TrapLine = Omit<FourLine, 'who'> & { who: FourLine['who'] | 'T' };
export const TRAP: TrapLine[] = [
  {"id":"c1-01","who":1,"write":null,"ms":{"alexander":1802,"anton":1802,"kirill":1802,"ermil":1750},"text":"О, все тут? Всех слышно?"},
  {"id":"c1-02","who":2,"write":null,"ms":{"kirill":2325,"anton":2351,"alexander":2325,"ermil":2116,"dasha":2273,"lera":2273,"masha":2403,"jane":2168},"text":"Слышно. Только у кого-то эхо."},
  {"id":"c1-03","who":4,"write":null,"ms":{"kirill":2429,"anton":2299,"alexander":2325,"ermil":2403,"dasha":2377,"lera":2534,"masha":2482,"jane":2325},"text":"Это не эхо. Это брат за стенкой."},
  {"id":"c1-04","who":1,"write":null,"ms":{"kirill":2952,"anton":2795,"alexander":2900,"ermil":2664},"text":"Ладно. Карточки по кругу. Кто первый?"},
  {"id":"c1-05","who":3,"write":null,"ms":{"kirill":2691,"anton":2534,"alexander":2456,"ermil":2560,"dasha":2508,"lera":2612,"masha":2664,"jane":2403},"text":"Давай ты. Ты всё равно уже командуешь."},
  {"id":"c1-06","who":1,"write":null,"ms":{"kirill":9038,"anton":8255,"alexander":8542,"ermil":8620},"text":"Я не командую, я организую. Первая. А-бэ параллельна цэ-дэ, и а-бэ равно цэ-дэ. Первый признак. Да."},
  {"id":"c1-07","who":2,"write":null,"ms":{"kirill":5721,"anton":5407,"ermil":5355,"alexander":5486,"dasha":5747,"lera":5616,"jane":5773,"masha":6060},"text":"Согласен. Вторая моя. Стороны попарно равны. Второй признак, тоже да."},
  {"id":"c1-08","who":3,"write":null,"ms":{"kirill":6557,"anton":6243,"alexander":6531,"ermil":6139,"dasha":6322,"lera":6661,"masha":7262,"jane":6374},"text":"Третья. А-бэ параллельна цэ-дэ, бэ-цэ равно а-дэ. Ну да. Почти как первая."},
  {"id":"c1-09","who":1,"write":null,"ms":{"kirill":1881,"anton":1829,"alexander":1802,"ermil":1855},"text":"Кидай в «да», быстрее закончим."},
  {"id":"c1-10","who":2,"write":null,"ms":{"kirill":8202,"anton":7523,"alexander":7393,"ermil":8098,"dasha":7549,"lera":7680,"masha":8098,"jane":7941},"text":"Подождите. В первой одна и та же пара — и параллельна, и равна. А тут параллельна одна пара, а равна другая."},
  {"id":"c1-11","who":3,"write":null,"ms":{"kirill":627,"anton":575,"alexander":627,"ermil":653,"dasha":653,"lera":653,"masha":653,"jane":575},"text":"И что?"},
  {"id":"c1-12","who":2,"write":null,"ms":{"kirill":2586,"anton":2482,"alexander":2534,"ermil":2560,"dasha":2534,"lera":2691,"masha":2691,"jane":2560},"text":"Не знаю что. Но это не то же самое."},
  {"id":"c1-13","who":1,"write":null,"ms":{"kirill":2273,"anton":2116,"alexander":2090,"ermil":2220},"text":"Ну нарисуй тогда, раз не то же."},
  {"id":"c1-14","who":2,"write":null,"ms":{"kirill":3474,"anton":3318,"alexander":3239,"ermil":3213,"dasha":3474,"lera":3474,"masha":3683,"jane":3370},"text":"Сейчас… Нет. Опять параллелограмм получился."},
  {"id":"c1-15","who":1,"write":null,"ms":{"kirill":2403,"anton":2325,"alexander":2325,"ermil":2273},"text":"Вот. Не получается — значит, да."},
  {"id":"c1-16","who":2,"write":null,"ms":{"kirill":3396,"anton":3318,"alexander":3448,"ermil":3344,"dasha":3239,"lera":3500,"masha":3631,"jane":3318},"text":"Это значит, что у меня не получается. А не что «да»."},
  {"id":"c1-17","who":4,"write":null,"ms":{"kirill":2664,"anton":2664,"alexander":2664,"ermil":2534,"dasha":2717,"lera":2795,"masha":2873,"jane":2638},"text":"Красиво сказано. Записываю в цитаты."},
  {"id":"c1-18","who":1,"write":null,"ms":{"kirill":5695,"anton":5329,"alexander":5433,"ermil":5460},"text":"Слушайте, время идёт, а мы на третьей карточке. Давайте учителя позовём и дальше."},
  {"id":"c1-t0","who":"T","write":null,"ms":{"alena":1959,"filipp":1959},"text":"Да. Какие у вас вопросы?"},
  {"id":"c1-19","who":1,"write":null,"ms":{"kirill":9038,"anton":8202,"alexander":8359,"ermil":8150},"text":"Карточка три. Очень похоже на первый признак, но не то же самое. А нарисовать, чтобы получился не параллелограмм, не можем."},
  {"id":"c1-ta1","who":"T","write":null,"ms":{"alena":4989,"filipp":5616},"text":"Это непростой вопрос. На него можно ответить, нарисовав то, что дано в условии."},
  {"id":"c1-ta2","who":"T","write":null,"ms":{"alena":5460,"filipp":5930},"text":"Смотрите. Нарисуем две параллельные прямые — ведь а-бэ параллельна цэ-дэ."},
  {"id":"c1-ta3","who":"T","write":null,"ms":{"alena":2873,"filipp":3213},"text":"На одной отметим а и бэ. Вот так."},
  {"id":"c1-ta4","who":"T","write":null,"ms":{"alena":2508,"filipp":2638},"text":"На другой — точку цэ. Например, здесь."},
  {"id":"c1-ta5","who":"T","write":null,"ms":{"alena":4702,"filipp":5120},"text":"Осталось понять, где может быть точка дэ, чтобы а-дэ равнялось бэ-цэ."},
  {"id":"c1-ta6","who":"T","write":null,"ms":{"filipp":1567,"alena":1515},"text":"Теперь подумайте сами."},
  {"id":"c1-20","who":2,"write":null,"ms":{"kirill":8960,"anton":8411,"alexander":8359,"ermil":8281,"dasha":8490,"masha":9143,"lera":8725,"jane":8751},"text":"Точно, дэ может быть здесь и здесь. И когда здесь, это трапеция! Равнобокая. Боковые стороны равны, а основания параллельны."},
  {"id":"c1-tok","who":"T","write":null,"ms":{"alena":1254,"filipp":1358},"text":"Молодец, правильно."},
  {"id":"c1-21","who":3,"write":null,"ms":{"kirill":4467,"anton":4075,"alexander":4180,"ermil":4206,"dasha":4075,"lera":4310,"masha":4493,"jane":4127},"text":"Ой. И правда. Параллельна одна пара, а равна другая."},
  {"id":"c1-22","who":1,"write":null,"ms":{"kirill":3657,"anton":3500,"alexander":3448,"ermil":3605},"text":"Ладно. Перекладываю в «не обязательно». Ты был прав."},
  {"id":"c1-22f","who":1,"write":null,"ms":{"kirill":3788,"anton":3657,"alexander":3553,"ermil":3762},"text":"Ладно. Перекладываю в «не обязательно». Ты была права."},
  {"id":"c1-23","who":3,"write":null,"ms":{"kirill":5303,"anton":4963,"alexander":4937,"ermil":4911,"dasha":4989,"lera":5120,"masha":5486,"jane":5120},"text":"Четвёртая моя. Диагонали делятся пополам. Это третий признак. Да."},
  {"id":"c1-24","who":4,"write":null,"ms":{"anton":5355,"kirill":5930,"alexander":5251,"ermil":5460,"dasha":5172,"lera":5486,"masha":5564,"jane":5251},"text":"Пятую и шестую — все вместе. Пятая: а-о равно о-цэ, а бэ-о не равно о-дэ."},
  {"id":"c1-25","who":2,"write":null,"ms":{"kirill":6844,"anton":6322,"alexander":6296,"ermil":6504,"dasha":6478,"lera":6583,"masha":6975,"jane":6870},"text":"Тут осторожно. Если бы обе диагонали делились пополам — был бы параллелограмм. А тут только одна."},
  {"id":"c1-26","who":1,"write":null,"ms":{"kirill":2873,"anton":2795,"alexander":2743,"ermil":2717},"text":"Значит, нет? Только теперь сразу с рисунком."},
  {"id":"c1-27","who":2,"write":null,"ms":{"kirill":6844,"anton":6400,"alexander":6269,"ermil":6478,"dasha":6557,"lera":6713,"masha":6896,"jane":6687},"text":"Вот такой. Как воздушный змей. Одна диагональ делит другую пополам, а сама пополам не делится."},
  {"id":"c1-28","who":4,"write":null,"ms":{"kirill":1907,"anton":1959,"ermil":1750,"alexander":1985,"dasha":1933,"lera":1985,"masha":2038,"jane":1881},"text":"Змей. А с хвостом можно?"},
  {"id":"c1-29","who":2,"write":null,"ms":{"kirill":1149,"anton":1176,"alexander":1176,"ermil":1045,"dasha":1176,"lera":1176,"masha":1176,"jane":1149},"text":"Можно с хвостом."},
  {"id":"c1-30","who":3,"write":null,"ms":{"kirill":6034,"anton":5799,"alexander":5642,"ermil":5825,"dasha":5904,"lera":6087,"masha":6269,"jane":5878},"text":"Шестая. Противоположные углы равны. Это вроде свойство. А признака такого не было."},
  {"id":"c1-31","who":1,"write":null,"ms":{"kirill":1437,"anton":1463,"alexander":1411,"ermil":1254},"text":"Значит, не обязательно?"},
  {"id":"c1-32","who":2,"write":null,"ms":{"kirill":7549,"anton":6922,"alexander":7079,"ermil":7053,"dasha":7131,"lera":7236,"jane":6975,"masha":7680},"text":"После тройки я без рисунка ничего не кладу. Давайте нарисуем, где углы так равны, а это не параллелограмм."},
  {"id":"c1-33","who":4,"write":null,"ms":{"kirill":4441,"anton":4310,"ermil":4545,"alexander":4258,"dasha":4389,"lera":4336,"jane":4415,"masha":4519},"text":"Не выходит. Все параллелограммы получаются, или углы не равны."},
  {"id":"c1-34","who":3,"write":null,"ms":{"kirill":862,"anton":914,"alexander":888,"dasha":862,"ermil":836,"lera":993,"jane":862,"masha":940},"text":"У меня тоже."},
  {"id":"c1-35","who":1,"write":null,"ms":{"kirill":1646,"anton":1541,"alexander":1593,"ermil":1384},"text":"Тогда да? Рискнём?"},
  {"id":"c1-36","who":2,"write":null,"ms":{"kirill":2508,"anton":2403,"alexander":2429,"ermil":2456,"dasha":2403,"lera":2586,"masha":2586,"jane":2560},"text":"Рискнём. Но я потом спрошу, почему."},
  {"id":"c1-37","who":4,"write":null,"ms":{"kirill":1567,"anton":1620,"alexander":1489,"ermil":1567,"dasha":1541,"lera":1593,"masha":1724,"jane":1567},"text":"Всё, все шесть разложили."},
  {"id":"c1-38","who":1,"write":null,"ms":{"kirill":5433,"anton":5120,"alexander":5198,"ermil":5094},"text":"Слушайте, время идёт, а мы на третьей карточке. Татьяна Алексеевна, можно вопрос?"},
  {"id":"c1-39","who":1,"write":null,"ms":{"kirill":9038,"anton":8202,"alexander":8359,"ermil":8150},"text":"Карточка три. Очень похоже на первый признак, но не то же самое. А нарисовать, чтобы получился не параллелограмм, не можем."},
];
/** Ч1's board from the voice editor (empty: as in demoBots.ts) */
export const TRAP_BOARD: Record<string, LineBoard> = {
  "c1-06": {"move":[1,[60,250]]},
  "c1-07": {"move":[2,[305,250]]},
  "c1-09": {"move":[3,[550,250]]},
  "c1-14": {"draw":[{"at":0.036,"path":[[900,590],[936,590],[972,590],[1008,590],[1044,590],[1080,590],[1096,558],[1112,526],[1128,494],[1144,462],[1160,430],[1124,430],[1088,430],[1052,430],[1016,430],[980,430],[964,462],[948,494],[932,526],[916,558],[900,590]],"ts":[0.036,0.036,0.036,0.036,0.036,0.036,0.085,0.135,0.184,0.233,0.283,0.332,0.382,0.431,0.48,0.53,0.579,0.629,0.678,0.728,0.777]}]},
  "c1-ta2": {"erase":true,"draw":[{"at":0.378,"path":[[850,590],[888,590],[925,590],[963,590],[1000,590],[1038,590],[1075,590],[1113,590],[1150,590],[1188,590],[1225,590],[1263,590],[1300,590]],"ts":[0.378,0.378,0.378,0.378,0.378,0.378,0.378,0.378,0.378,0.378,0.378,0.378,0.378]},{"at":0.65,"path":[[850,430],[888,430],[925,430],[963,430],[1000,430],[1038,430],[1075,430],[1113,430],[1150,430],[1188,430],[1225,430],[1263,430],[1300,430]],"ts":[0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65,0.65]}]},
  "c1-ta3": {"draw":[{"at":0.275,"dot":[900,590]},{"at":0.275,"label":{"text":"A","at":[900,618]}},{"at":0.511,"dot":[1100,590]},{"at":0.511,"label":{"text":"B","at":[1100,618]}}]},
  "c1-ta4": {"draw":[{"at":0.468,"dot":[1160,430]},{"at":0.468,"label":{"text":"C","at":[1160,402]}}]},
  "c1-20": {"draw":[{"at":0.185,"dot":[960,430]},{"at":0.185,"label":{"text":"D","at":[960,402]}},{"at":0.325,"dot":[840,430]},{"at":0.325,"label":{"text":"D","at":[840,402]}},{"at":0.66,"path":[[840,430],[852,462],[864,494],[876,526],[888,558],[900,590],[940,590],[980,590],[1020,590],[1060,590],[1100,590],[1112,558],[1124,526],[1136,494],[1148,462],[1160,430],[1120,430],[1080,430],[1040,430],[1000,430],[960,430],[920,430],[880,430],[840,430]],"ts":[0.66,0.66,0.66,0.66,0.66,0.66,0.666,0.672,0.678,0.684,0.69,0.696,0.702,0.708,0.714,0.719,0.723,0.727,0.73,0.734,0.738,0.742,0.745,0.749]}]},
  "c1-22": {"move":[3,[830,250]]},
  "c1-22f": {"move":[3,[830,250]]},
  "c1-23": {"move":[4,[550,250]]},
  "c1-27": {"erase":true,"move":[5,[1075,250]],"draw":[{"at":0.057,"path":[[880,520],[920,520],[960,520],[1000,520],[1040,520],[1080,520],[1120,520]],"ts":[0.057,0.057,0.057,0.057,0.057,0.057,0.057]},{"at":0.057,"label":{"text":"A","at":[862,520]}},{"at":0.179,"label":{"text":"C","at":[1140,520]}},{"at":0.208,"path":[[940,508],[940,532]],"ts":[0.208,0.208]},{"at":0.208,"path":[[1060,508],[1060,532]],"ts":[0.208,0.208]},{"at":0.297,"path":[[1000,460],[1000,494],[1000,528],[1000,562],[1000,596],[1000,630]],"ts":[0.297,0.297,0.297,0.297,0.297,0.297]},{"at":0.297,"label":{"text":"B","at":[1000,440]}},{"at":0.409,"label":{"text":"D","at":[1000,652]}},{"at":0.45,"path":[[880,520],[910,505],[940,490],[970,475],[1000,460],[1030,475],[1060,490],[1090,505],[1120,520],[1096,542],[1072,564],[1048,586],[1024,608],[1000,630],[976,608],[952,586],[928,564],[904,542],[880,520]],"ts":[0.45,0.45,0.45,0.45,0.45,0.467,0.484,0.501,0.518,0.532,0.546,0.559,0.573,0.587,0.6,0.614,0.627,0.641,0.655]}]},
  "c1-29": {"draw":[{"at":0.104,"path":[[1000,668],[985,698],[1000,713],[1015,728],[990,758],[1010,788]],"ts":[0.104,0.104,0.242,0.379,0.653,0.928]}]},
  "c1-33": {"draw":[{"at":0.062,"path":[[1290,440],[1278,474],[1266,508],[1254,542],[1242,576],[1230,610],[1269,610],[1307,610],[1346,610],[1384,610],[1423,610],[1461,610],[1500,610],[1496,572],[1492,534],[1488,496],[1484,458],[1480,420],[1442,424],[1404,428],[1366,432],[1328,436],[1290,440]],"ts":[0.062,0.062,0.062,0.062,0.062,0.062,0.085,0.109,0.132,0.155,0.178,0.201,0.224,0.256,0.289,0.321,0.353,0.386,0.418,0.451,0.483,0.515,0.548]}]},
  "c1-35": {"move":[6,[60,410]]},
};

export const SIXTH: FourLine[] = [
  {"id": "c2-01", "who": 1, "write": null, "ms": {"anton": 2116, "alexander": 2142, "ermil": 2038, "lera": 2168, "masha": 2194, "jane": 2142}, "text": "Первая — да, первый признак."},
  {"id": "c2-02", "who": 2, "write": null, "ms": {"anton": 6818, "alexander": 6740, "ermil": 7027, "lera": 7053, "masha": 7210, "jane": 7131}, "text": "Вторая... Так... Какие у нас ещё признаки?... Это второй признак - переносим в да."},
  {"id": "c2-03", "who": 3, "write": null, "ms": {"anton": 5982, "alexander": 6113, "ermil": 5642, "lera": 6217, "masha": 6609, "jane": 6217}, "text": "Третья — на первую похожа, только пара букв переставлена местами. Скорее всего - да."},
  {"id": "c2-04", "who": 1, "write": null, "ms": {"anton": 3422, "alexander": 3605, "ermil": 3448, "lera": 3579, "masha": 3788, "jane": 3187}, "text": "Тогда странно, а почему их в один признак не объединить?"},
  {"id": "c2-05", "who": 3, "write": null, "ms": {"anton": 3448, "alexander": 3344, "ermil": 3396, "lera": 3605, "masha": 3631, "jane": 3527}, "text": "Не знаю, не догадались, наверно. Надо нарисовать."},
  {"id": "c2-06", "who": 3, "write": null, "ms": {"anton": 7262, "alexander": 7288, "ermil": 7445, "lera": 7758, "masha": 7993, "jane": 7628}, "text": "Одна прямая... Вторая... Вот а-бэ. И одинаковая с ней цэ-дэ. Вроде как, параллелограмм."},
  {"id": "c2-07", "who": 1, "write": null, "ms": {"anton": 2743, "alexander": 2664, "ermil": 2691, "lera": 2795, "masha": 2926, "jane": 2795}, "text": "А если в другую сторону наклонить? Вот так."},
  {"id": "c2-08", "who": 3, "write": null, "ms": {"anton": 3944, "alexander": 4049, "ermil": 3814, "lera": 4101, "masha": 4389, "jane": 3971}, "text": "Точно! Тогда не параллелограмм. Значит, третья — нет."},
  {"id": "c2-09", "who": 4, "write": null, "ms": {"dasha": 2952}, "text": "Четвёртая — да, это просто третий признак."},
  {"id": "c2-10", "who": 2, "write": null, "ms": {"anton": 2900, "alexander": 2769, "ermil": 2900, "lera": 3004, "masha": 3082, "jane": 2847}, "text": "Пятая. Диагонали — только одна пополам."},
  {"id": "c2-11", "who": 1, "write": null, "ms": {"anton": 4859, "alexander": 4780, "ermil": 4807, "lera": 5198, "masha": 5303, "jane": 5068}, "text": "Неверно, скорее всего. Это же от прошлого вопроса половину условия убрали."},
  {"id": "c2-12", "who": 3, "write": null, "ms": {"anton": 6296, "alexander": 6269, "ermil": 6269, "lera": 6661, "masha": 6713, "jane": 6296}, "text": "Давай нарисую. Эта пополам. А этот не равен этому. Ну да, не похож на параллелограмм."},
  {"id": "c2-13", "who": 1, "write": null, "ms": {"anton": 5198, "alexander": 5224, "ermil": 5146, "lera": 5407, "masha": 5616, "jane": 5251}, "text": "Так, шестая. Угол а равен углу цэ, угол бэ равен углу дэ."},
  {"id": "c2-14", "who": 2, "write": null, "ms": {"anton": 4545, "alexander": 4441, "ermil": 4362, "lera": 4780, "masha": 4833, "jane": 4545}, "text": "Это свойство. Но признаков таких не было. Значит не обязательно?"},
  {"id": "c2-15", "who": 3, "write": null, "ms": {"anton": 3396, "alexander": 3213, "ermil": 3422, "lera": 3527, "masha": 3631, "jane": 3605}, "text": "Если не обязательно, надо пример нарисовать. Нарисуй."},
  {"id": "c2-16", "who": 2, "write": null, "ms": {"anton": 8882, "alexander": 8647, "ermil": 8777, "lera": 9404, "masha": 9639, "jane": 9091}, "text": "Сейчас попробую. Вот первый угол. От этого луча второй. От этого — третий под таким же углом. Не, четвёртый угол первому не равен."},
  {"id": "c2-17", "who": 1, "write": null, "ms": {"anton": 10031, "alexander": 9796, "ermil": 10031, "lera": 10449, "masha": 10606, "jane": 10449}, "text": "Может, по-другому? Нарисую сразу равные противоположные углы. Один... второй... Тут они пересекаются. Тоже оставшиеся углы не равны."},
  {"id": "c2-18", "who": 3, "write": null, "ms": {"anton": 1855, "alexander": 1802, "ermil": 1672, "lera": 1985, "masha": 1985, "jane": 1776}, "text": "Да как это нарисовать-то можно?"},
  {"id": "c2-19", "who": 1, "write": null, "ms": {"anton": 3135, "alexander": 3109, "ermil": 3187, "lera": 3422, "masha": 3474, "jane": 3213}, "text": "Аня, а ты что думаешь? Ты что-то совсем молчишь."},
  {"id": "c2-20", "who": 4, "write": null, "ms": {"dasha": 6635}, "text": "Тоже пока не знаю. Может, просто посчитать? Ну углов четыре, вместе — триста шестьдесят."},
  {"id": "c2-21", "who": 1, "write": null, "ms": {"anton": 1646, "alexander": 1724, "ermil": 1698, "lera": 1750, "masha": 1750, "jane": 1672}, "text": "Да, но это везде так."},
  {"id": "c2-22", "who": 4, "write": null, "ms": {"dasha": 5825}, "text": "А равен цэ, бэ равен дэ. Значит, а плюс бэ — это половина. Сто восемьдесят."},
  {"id": "c2-23", "who": 2, "write": null, "ms": {"anton": 1750, "alexander": 1855, "ermil": 1646, "lera": 1933, "masha": 1959, "jane": 1646}, "text": "Интересно, и что с этого?"},
  {"id": "c2-24", "who": 4, "write": null, "ms": {"dasha": 9509}, "text": "А и бэ стоят на одной стороне а-бэ. Если в сумме сто восемьдесят — это односторонние углы. Значит, а-дэ параллельна бэ-цэ."},
  {"id": "c2-25", "who": 3, "write": null, "ms": {"anton": 3004, "alexander": 2978, "ermil": 2900, "lera": 3187, "masha": 3239, "jane": 2900}, "text": "Точно! Эврика! А со второй парой так же!"},
  {"id": "c2-26", "who": 4, "write": null, "ms": {"dasha": 4441}, "text": "Так же. Обе пары параллельны. Это просто параллелограмм по определению."},
  {"id": "c2-27", "who": 1, "write": null, "ms": {"anton": 1306, "alexander": 1358, "ermil": 1280, "lera": 1384, "masha": 1437, "jane": 1123}, "text": "Шестая — да!"},
  {"id": "c2-28", "who": 2, "write": null, "ms": {"anton": 1750, "alexander": 1802, "ermil": 1802, "lera": 1802, "masha": 1829, "jane": 1750}, "text": "Ура! Шесть из шести!"},
  {"id": "c2-29", "who": 3, "write": null, "ms": {"anton": 1176, "alexander": 1071, "ermil": 1045, "lera": 1254, "masha": 1202, "jane": 1123}, "text": "Давайте пятюню!"},
  {"id": "c2-30", "who": 1, "write": null, "ms": {"anton": 2038, "alexander": 1881, "ermil": 1881, "lera": 2116, "masha": 2194, "jane": 1776}, "text": "Аня, что ты раньше молчала?"},
  {"id": "c2-31", "who": 4, "write": null, "ms": {"dasha": 3997}, "text": "Тоже не знала, как решать. Только когда начала объяснять, все сложилось."},
];
/** Ч2's board from the voice editor (empty: as in demoBots.ts) */
export const SIXTH_BOARD: Record<string, LineBoard> = {
};

export const CHOCOLATE: DialogueLine[] = [
  {"id":"p1-01","who":2,"write":null,"ms":{"alexander":2142,"kirill":2038,"anton":2142,"ermil":2011,"dasha":2168,"lera":2142,"masha":2377,"jane":2011},"text":"Привет. Ну что, сверяемся?"},
  {"id":"p1-02","who":1,"write":null,"ms":{"kirill":1698,"anton":1698,"alexander":1698,"ermil":1489},"text":"Давай. У тебя сколько?"},
  {"id":"p1-03","who":2,"write":null,"ms":{"kirill":6060,"anton":5538,"alexander":5878,"lera":6034,"ermil":5198,"masha":6296,"dasha":5904,"jane":5564},"text":"Пять. Стороны, диагонали, угол. А у тебя? Ты чего написал, как курица лапкой?"},
  {"id":"p1-04","who":1,"write":null,"ms":{"kirill":5512,"anton":5094,"alexander":5172,"ermil":5198},"text":"Да я без планшета сегодня. Мы к тёте в гости приехали, с её компа мышкой рисую."},
  {"id":"p1-05","who":2,"write":null,"ms":{"kirill":2142,"anton":2038,"alexander":2038,"lera":2220,"ermil":1985,"dasha":2142,"masha":2247,"jane":2064},"text":"Понятно. Ладно, разберу."},
  {"id":"p1-06","who":2,"write":null,"ms":{"alexander":8542,"kirill":8777,"anton":8542,"lera":8803,"ermil":8411,"dasha":8594,"masha":9117,"jane":8150},"text":"Так. А-дэ равно бэ-цэ, есть. А-бэ равно цэ-дэ, есть. Углы, правильно… А это что? А-бэ равно а-о?"},
  {"id":"p1-07","who":1,"write":null,"ms":{"anton":2952,"kirill":3004,"alexander":2978,"ermil":2743},"text":"Ну да. Посмотри на чертёж, — одинаковые."},
  {"id":"p1-08","who":2,"write":null,"ms":{"alexander":2978,"kirill":3187,"anton":3109,"lera":3213,"ermil":3109,"dasha":3082,"masha":3239,"jane":3265},"text":"Похожи, конечно. Но мне кажется, что они не равны."},
  {"id":"p1-09","who":1,"write":null,"ms":{"kirill":3291,"anton":3187,"alexander":3213,"ermil":3109},"text":"Почему не равны? Палец приложи, — одинаковые."},
  {"id":"p1-10","who":2,"write":null,"ms":{"alexander":9718,"anton":9874,"kirill":10501,"lera":10240,"ermil":9691,"dasha":9796,"masha":10240,"jane":10005},"text":"Да как я его тут приложу? Я ещё вот по клеткам смотрю. А-бэ — это два вправо, четыре вверх. А-о, — пять вправо, два вверх. Разные."},
  {"id":"p1-11","who":1,"write":null,"ms":{"kirill":9848,"anton":8803,"alexander":9012,"ermil":9273},"text":"Как ты так сравниваешь? У тебя и вправо, и вверх разное количество каждый раз. А длина может быть одна и та же. Наискосок ведь."},
  {"id":"p1-12","who":2,"write":null,"ms":{"kirill":3997,"alexander":3866,"anton":3840,"lera":3944,"ermil":3840,"dasha":3762,"masha":3997,"jane":3840},"text":"Нет. Так не бывает. Да и видно, что разные немного."},
  {"id":"p1-13","who":1,"write":null,"ms":{"kirill":1724,"anton":1724,"alexander":1593,"ermil":1620},"text":"А мне видно, что одинаковые."},
  {"id":"p1-14","who":2,"write":null,"ms":{"kirill":1358,"anton":1254,"alexander":1411,"lera":1437,"ermil":1358,"dasha":1332,"masha":1384,"jane":1358},"text":"Ну и как мы узнаем?"},
  {"id":"p1-15","who":1,"write":null,"ms":{"kirill":2299,"anton":2116,"alexander":2220,"ermil":2168},"text":"Не знаю. Давай учителя позовём."},
  {"id":"p1-16","who":2,"write":null,"ms":{"kirill":653,"anton":601,"alexander":627,"lera":653,"ermil":575,"dasha":653,"masha":627,"jane":627},"text":"Давай."},
  {"id":"p1-17","who":2,"write":null,"ms":{"alexander":9326,"anton":9273,"kirill":10083,"ermil":9796,"dasha":9378,"lera":9639,"masha":10266,"jane":9430},"text":"Мы сверяемся. У Миши записано, что а-бэ равно а-о, а я думаю, что не равны, раз по клеткам вправо и вверх не совпадают. Как правильно?"},
  {"id":"p1-18","who":2,"write":null,"ms":{"kirill":3553,"alexander":3422,"anton":3396,"lera":3527,"ermil":3370,"dasha":3527,"masha":3788,"jane":3448},"text":"Два в квадрате плюс четыре в квадрате… двадцать."},
  {"id":"p1-19","who":1,"write":null,"ms":{"anton":8359,"kirill":8908,"alexander":8359,"ermil":7993},"text":"А пять в квадрате плюс два в квадрате — двадцать девять. Да, точно, не равны. Ладно, теперь понятно. Вычёркиваю."},
  {"id":"p1-20","who":2,"write":null,"ms":{"kirill":1776,"anton":1620,"alexander":1672,"ermil":1593,"dasha":1855,"lera":1829,"masha":1881,"jane":1750},"text":"Видишь? Я же говорил."},
  {"id":"p1-21","who":1,"write":null,"ms":{"kirill":9509,"anton":8438,"alexander":8673,"ermil":9064},"text":"Ты говорил, что вправо-вверх не совпадает, значит, не равны. А бывает, что не совпадает, а длина одна. Просто тут не совпало."},
  {"id":"p1-21f","who":1,"write":null,"ms":{"kirill":9535,"anton":8490,"alexander":8725,"ermil":9117},"text":"Ты говорила, что вправо-вверх не совпадает, значит, не равны. А бывает, что не совпадает, а длина одна. Просто тут не совпало."},
  {"id":"p1-22","who":2,"write":null,"ms":{"kirill":4258,"alexander":3997,"anton":3788,"ermil":3892,"dasha":3997,"lera":4153,"masha":4232,"jane":3918},"text":"Ну… да. По одним клеткам не скажешь. Посчитать надо."},
  {"id":"p1-23","who":1,"write":null,"ms":{"kirill":5721,"anton":5433,"alexander":5381,"ermil":5355},"text":"Давай теперь общий список. По очереди. Кто сказал, тот и пишет. Начинай."},
  {"id":"p1-24","who":2,"write":"AD = BC","ms":{"kirill":1306,"alexander":1332,"anton":1332,"lera":1358,"ermil":1358,"dasha":1306,"masha":1384,"jane":1332},"text":"А-дэ равно бэ-цэ."},
  {"id":"p1-25","who":1,"write":"AB = CD","ms":{"kirill":1254,"ermil":1306,"anton":1254,"alexander":1202},"text":"А-бэ равно цэ-дэ."},
  {"id":"p1-26","who":2,"write":"AO = OC","ms":{"alexander":4441,"kirill":4780,"ermil":4415,"anton":4545,"dasha":4310,"lera":4571,"masha":4545,"jane":4180},"text":"А-о, равно о-цэ. Пять и два, пять и два, — тут не поспоришь."},
  {"id":"p1-27","who":1,"write":"BO = OD","ms":{"kirill":5146,"anton":4728,"ermil":4650,"alexander":4571},"text":"Бэ-о равно о-дэ. Три и два, три и два. Этого у меня не было."},
  {"id":"p1-28","who":2,"write":"∠A = ∠C","ms":{"kirill":2142,"alexander":1985,"anton":1959,"ermil":1985,"dasha":1959,"lera":2142,"masha":2011,"jane":1881},"text":"Угол. А. равен углу цэ."},
  {"id":"p1-29","who":1,"write":"∠B = ∠D","ms":{"kirill":3866,"anton":3553,"alexander":3474,"ermil":3709},"text":"И угол бэ равен углу дэ. А этого не было у тебя."},
  {"id":"p1-30","who":2,"write":null,"ms":{"kirill":1698,"alexander":1593,"anton":1620,"ermil":1515,"dasha":1620,"lera":1724,"masha":1802,"jane":1567},"text":"Всё равно шесть получилось."},
  {"id":"p1-31","who":1,"write":null,"ms":{"kirill":1567,"anton":1593,"alexander":1567,"ermil":1489},"text":"Только теперь все честные."},
  {"id":"p1-32","who":1,"write":null,"ms":{"kirill":2351,"anton":2351,"alexander":2247,"ermil":2194},"text":"Ой! Здравствуйте, Татьяна Алексеевна."},
  {"id":"p1-33","who":1,"write":null,"ms":{"kirill":8411,"anton":7811,"alexander":7784,"ermil":7628},"text":"Татьяна Алексеевна, у меня записано, что а-бэ равно а о. На глаз одинаковые, а по клеткам разные. Как правильно?"},
  {"id":"p1-tq","who":"T","write":null,"ms":{"alena":1149,"filipp":1176},"text":"Какой у вас вопрос?"},
  {"id":"p1-ta","who":"T","write":null,"ms":{"alena":20193,"filipp":21812},"text":"Мы не можем утверждать, что отрезки равны, потому что так кажется из чертежа. Но то, что количество клеток вправо и вверх не совпадает, тоже не доказательство, что а-бэ не равно а-о. Тут Миша прав. Вспомните теорему Пифагора: клетки, — это катеты, а ваши отрезки, — гипотенузы. Посчитайте."},
];

/** A point of the figure in cells: A is (0, 0), x to the right, y up; B (2, 4), C (10, 4), D (8, 0), O (5, 2) */
export type Pt = [number, number];
/** Drawn while a line is said, `at` that part of the way through it: a broken line, a right-angle mark
 *  (corner, then a point on each side), a filled triangle, a number */
/** ticks: equal segments marked, [from, to, how many strokes] */
export interface Draw { at: number; path?: Pt[]; angle?: [Pt, Pt, Pt]; fill?: Pt[]; label?: { at: Pt; text: string }; ticks?: [Pt, Pt, number][] }

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
  // «и то же самое»: the equal sides marked with strokes, the right angles
  'p2-23': [
    { at: 0.1, ticks: [[[0, 0], [5, 0], 1], [[5, 4], [10, 4], 1]] }, { at: 0.25, ticks: [[[5, 0], [5, 2], 2], [[5, 2], [5, 4], 2]] },
    { at: 0.4, angle: [[5, 0], [0, 0], [5, 2]] }, { at: 0.45, angle: [[5, 4], [10, 4], [5, 2]] },
  ],
  // the other one: «дорисовываю треугольники. Эти стороны равны, эти равны, угол прямой»
  'p2-26': [
    { at: 0.12, path: [[2, 4], [2, 2], [5, 2]] }, { at: 0.3, path: [[5, 2], [8, 2], [8, 0]] },
    { at: 0.44, ticks: [[[2, 2], [5, 2], 1], [[5, 2], [8, 2], 1]] }, { at: 0.53, ticks: [[[2, 4], [2, 2], 2], [[8, 2], [8, 0], 2]] },
    { at: 0.62, angle: [[2, 2], [2, 4], [5, 2]] }, { at: 0.66, angle: [[8, 2], [8, 0], [5, 2]] },
  ],
  // «эту высоту из бэ и эту из дэ»
  'p2-31': [{ at: 0.45, path: [[2, 4], [2, 0]] }, { at: 0.75, path: [[8, 0], [8, 4]] }],
  // «вот этот и вот этот треугольники»
  'p2-33': [{ at: 0.3, fill: [[0, 0], [2, 0], [2, 4]] }, { at: 0.65, fill: [[10, 4], [8, 4], [8, 0]] }],
};

/** П2 «Давай я быстро объясню»: the strong one (1) explains, the other (2) gets it; T is the teacher coming in openly.
 *  p2-01…p2-36 in order, p2-25f «сама» for a girl; on a visit p2-tq, 37, 38, p2-tb, 39. Every line in all eight voices.
 *  Text: ~/temp/П2-объясню.txt */
export const EXPLAIN: DialogueLine[] = [
  {"id":"p2-01","who":1,"write":null,"ms":{"anton":1567,"ermil":1384,"alexander":1593,"kirill":1567,"dasha":1646,"lera":1620,"jane":1332,"masha":1724},"text":"Ну что, сверяемся?"},
  {"id":"p2-02","who":2,"write":null,"ms":{"kirill":4833,"anton":4571,"alexander":4493,"ermil":4519,"dasha":4676,"lera":4833,"masha":4963,"jane":4545},"text":"Давай. Только сразу скажу я вообще не очень понял как тут равное искать."},
  {"id":"p2-03","who":2,"write":null,"ms":{"kirill":6870,"anton":6478,"alexander":6426,"ermil":6426,"dasha":6609,"masha":7079,"lera":6713,"jane":6609},"text":"Одну пару сторон нашёл и всё. Остальные наискосок идут. Вроде похожи а может и нет."},
  {"id":"p2-04","who":2,"write":null,"ms":{"kirill":3030,"anton":2847,"alexander":2926,"ermil":2795,"dasha":2795,"lera":3030,"masha":3030,"jane":2873},"text":"А как равные углы искать совсем не понимаю."},
  {"id":"p2-05","who":1,"write":null,"ms":{"kirill":3239,"anton":3213,"ermil":3344,"alexander":3213,"dasha":3213,"lera":3318,"masha":3396,"jane":3187},"text":"Да, вижу. А-дэ равно бэ-цэ. Это правильно."},
  {"id":"p2-06","who":2,"write":null,"ms":{"kirill":1829,"anton":1724,"ermil":1620,"alexander":1776,"dasha":1620,"lera":1855,"masha":1855,"jane":1776},"text":"Ого а у тебя сколько всего."},
  {"id":"p2-07","who":1,"write":null,"ms":{"kirill":6687,"anton":6269,"alexander":6165,"ermil":6113,"dasha":6374,"lera":6400,"masha":6844,"jane":6374},"text":"Да тут не очень сложно давай быстро объясню. Нам ведь обоим нужно понимать. Спросить могут любого."},
  {"id":"p2-08","who":2,"write":null,"ms":{"kirill":1933,"anton":1881,"alexander":1829,"ermil":1620,"dasha":1881,"lera":1907,"masha":1881,"jane":1724},"text":"Давай. Только не быстро."},
  {"id":"p2-09","who":1,"write":null,"ms":{"kirill":3866,"anton":3683,"alexander":3709,"ermil":3291,"dasha":3918,"lera":3866,"masha":3997,"jane":3213},"text":"Хорошо не быстро. Смотри. ты помнишь теорему Пифагора?"},
  {"id":"p2-10","who":2,"write":null,"ms":{"kirill":4180,"alexander":4023,"anton":4101,"dasha":4101,"ermil":4101,"lera":4389,"masha":4545,"jane":4284},"text":"Ну так, не очень. Там как-то стороны треугольника между собой связаны."},
  {"id":"p2-11","who":1,"write":null,"ms":{"kirill":5721,"anton":5512,"alexander":5277,"ermil":5486,"dasha":5642,"lera":5773,"masha":6191,"jane":5433},"text":"Да, прямоугольного… О, придумал проще! Помнишь первый признак равенства треугольников?"},
  {"id":"p2-12","who":2,"write":null,"ms":{"kirill":3265,"anton":3135,"alexander":3109,"ermil":3082,"dasha":3161,"lera":3265,"masha":3396,"jane":3187},"text":"Конечно. По двум сторонам и углу между ними."},
  {"id":"p2-13","who":1,"write":null,"ms":{"kirill":8934,"anton":8046,"alexander":8333,"ermil":8411,"dasha":8176,"lera":8307,"masha":8856,"jane":8516},"text":"Он самый. Теперь смотри на а-бэ и цэ-дэ. Давай вот такой треугольник построим к а-бэ и вот такой к цэ-дэ."},
  {"id":"p2-14","who":2,"write":null,"ms":{"kirill":862,"anton":914,"alexander":836,"ermil":836,"dasha":862,"lera":940,"masha":914,"jane":888},"text":"Ага, вижу."},
  {"id":"p2-15","who":1,"write":null,"ms":{"kirill":3448,"anton":3265,"alexander":3187,"ermil":3265,"dasha":3265,"lera":3370,"masha":3579,"jane":3213},"text":"Вот эти стороны у них по четыре клетки а эти по две."},
  {"id":"p2-16","who":2,"write":null,"ms":{"kirill":575,"anton":522,"alexander":522,"ermil":470,"dasha":522,"lera":522,"masha":496,"jane":496},"text":"Да."},
  {"id":"p2-17","who":1,"write":null,"ms":{"anton":4389,"kirill":4702,"alexander":4206,"ermil":4545,"lera":4598,"dasha":4467,"masha":4676,"jane":4989},"text":"А вот эти углы прямые по девяносто градусов. Значит равны между собой."},
  {"id":"p2-18","who":2,"write":null,"ms":{"anton":914,"kirill":967,"alexander":967,"ermil":888,"dasha":914,"masha":993,"lera":1071,"jane":914},"text":"Есть такое."},
  {"id":"p2-19","who":1,"write":null,"ms":{"kirill":7967,"anton":7367,"alexander":7340,"ermil":7314,"dasha":7393,"lera":7732,"masha":7915,"jane":7628},"text":"Ну и всё. Значит треугольники равны и оставшиеся стороны у них тоже равны. То есть а-бэ равно цэ-дэ."},
  {"id":"p2-20","who":2,"write":null,"ms":{"kirill":3474,"anton":3422,"alexander":3396,"ermil":3396,"dasha":3448,"lera":3579,"masha":3683,"jane":3370},"text":"Ага, точно. Крутяк! Так просто оказывается!"},
  {"id":"p2-21","who":1,"write":null,"ms":{"kirill":7340,"anton":6740,"alexander":6975,"ermil":6661,"dasha":6949,"lera":7053,"masha":7471,"jane":6870},"text":"Да. А теперь такие же треугольники можно дорисовать к диагонали а-цэ. Вот один а вот второй."},
  {"id":"p2-22","who":2,"write":null,"ms":{"kirill":470,"alexander":444,"anton":444,"lera":470,"ermil":444,"dasha":470,"masha":470,"jane":470},"text":"Так."},
  {"id":"p2-23","who":1,"write":null,"ms":{"anton":3239,"kirill":3318,"alexander":3135,"ermil":3291,"dasha":3109,"lera":3396,"masha":3422,"jane":3396},"text":"И то же самое. Получаем что а-о равно о-цэ."},
  {"id":"p2-24","who":2,"write":null,"ms":{"kirill":5355,"anton":4885,"ermil":4937,"alexander":4937,"dasha":4963,"lera":5172,"masha":5460,"jane":4989},"text":"Гениально! Кажется я уловил идею. Так ведь и про вторую диагональ можно."},
  {"id":"p2-25","who":1,"write":null,"ms":{"kirill":2116,"anton":2090,"alexander":2064,"ermil":2116,"lera":2247,"dasha":2168,"masha":2247,"jane":2194},"text":"Да, то же самое. Попробуй сам."},
  {"id":"p2-25f","who":1,"write":null,"ms":{"kirill":2220,"anton":2168,"alexander":2090,"ermil":2168,"dasha":2220,"lera":2351,"masha":2299,"jane":2220},"text":"Да, то же самое. Попробуй сама."},
  {"id":"p2-26","who":2,"write":null,"ms":{"anton":7445,"kirill":8202,"ermil":7288,"alexander":7497,"dasha":7549,"lera":7889,"masha":8150,"jane":7732},"text":"Так… дорисовываю треугольники. Эти стороны равны эти равны угол прямой. Значит бэ-о равно о-дэ."},
  {"id":"p2-27","who":1,"write":null,"ms":{"kirill":3709,"anton":3605,"alexander":3553,"ermil":3683,"dasha":3527,"masha":3762,"lera":3762,"jane":3736},"text":"Да, всё правильно. Таким же образом можно и про углы."},
  {"id":"p2-28","who":2,"write":null,"ms":{"kirill":967,"alexander":1071,"anton":1045,"ermil":967,"dasha":1045,"lera":1097,"masha":1123,"jane":993},"text":"Это про какие?"},
  {"id":"p2-29","who":1,"write":null,"ms":{"kirill":5512,"anton":5224,"alexander":5042,"ermil":4911,"dasha":5172,"lera":5329,"masha":5616,"jane":5172},"text":"Про противоположные. Что угол а равен углу цэ. Видишь одинаковые?"},
  {"id":"p2-30","who":2,"write":null,"ms":{"kirill":4206,"anton":3944,"alexander":3997,"ermil":4127,"dasha":4049,"lera":4206,"masha":4284,"jane":4023},"text":"Да, похожи. Нет… не соображу какие треугольники взять."},
  {"id":"p2-31","who":1,"write":null,"ms":{"kirill":4780,"anton":4493,"alexander":4467,"ermil":4415,"dasha":4598,"lera":4519,"masha":4911,"jane":4519},"text":"Смотри. Давай проведём эту высоту из бэ и эту из дэ."},
  {"id":"p2-32","who":2,"write":null,"ms":{"kirill":627,"anton":601,"alexander":653,"ermil":601,"dasha":601,"lera":679,"masha":627,"jane":627},"text":"Вижу."},
  {"id":"p2-33","who":1,"write":null,"ms":{"kirill":2664,"anton":2482,"ermil":2534,"alexander":2560,"dasha":2560,"lera":2612,"masha":2743,"jane":2612},"text":"Теперь вот этот и вот этот треугольники."},
  {"id":"p2-34","who":2,"write":null,"ms":{"kirill":6296,"anton":5930,"alexander":5747,"ermil":5695,"dasha":5878,"lera":6113,"masha":6243,"jane":5904},"text":"Точно! Снова две стороны и угол между ними. Значит угол а равен углу цэ."},
  {"id":"p2-35","who":1,"write":null,"ms":{"kirill":5486,"anton":5329,"alexander":5120,"ermil":5068,"dasha":5120,"lera":5538,"masha":5773,"jane":5251},"text":"Да. Когда по клеткам считаешь это самый простой способ пристраивать такие треугольники."},
  {"id":"p2-36","who":2,"write":null,"ms":{"kirill":2900,"anton":2900,"alexander":2900,"ermil":2795,"dasha":2952,"lera":3109,"masha":3213,"jane":2821},"text":"Спасибо классный способ! Теперь всё понятно."},
  {"id":"p2-37","who":2,"write":null,"ms":{"kirill":7497,"anton":7079,"alexander":6975,"ermil":7053,"dasha":7236,"lera":7497,"masha":7889,"jane":7602},"text":"Здравствуйте Татьяна Алексеевна. Мне сначала вообще было непонятно. А сейчас объясняют и вроде ясно становится."},
  {"id":"p2-38","who":1,"write":null,"ms":{"kirill":3944,"anton":3709,"alexander":3683,"ermil":3840,"lera":3762,"dasha":3814,"masha":4075,"jane":3944},"text":"Достраиваем треугольники по клеткам и смотрим первый признак."},
  {"id":"p2-39","who":2,"write":null,"ms":{"kirill":2064,"anton":2038,"alexander":2064,"ermil":1985,"dasha":2038,"lera":2142,"masha":2168,"jane":1881},"text":"Так. На чём мы остановились?"},
  {"id":"p2-tq","who":"T","write":null,"ms":{"alena":1567,"filipp":1567},"text":"Как вы тут? Как дела?"},
  {"id":"p2-tb","who":"T","write":null,"ms":{"alena":2534,"filipp":2743},"text":"Отлично. Разбирайтесь, не буду мешать."},
];

/** The questions of the text-only calls, said when the teacher comes (voice-tools/gen_asks.py) */
export const ASKS: { id: string; text: string; ms: Record<string, number> }[] = [
  {"id": "q1", "text": "А стороны и отрезки — это разве не одно и то же?", "ms": {"kirill": 3048, "anton": 2856, "alexander": 2832, "ermil": 2712, "dasha": 2952, "lera": 3000, "masha": 3192, "jane": 2880}},
  {"id": "q2", "text": "Можно записывать только полные углы параллелограмма или и уголки, на которые их делят диагонали?", "ms": {"kirill": 6192, "anton": 5808, "alexander": 5880, "ermil": 6216, "dasha": 5784, "lera": 5952, "masha": 6336, "jane": 5568}},
  {"id": "q3", "text": "Не помню, как записывается равенство углов. Напишите, пожалуйста", "ms": {"kirill": 4200, "anton": 3984, "alexander": 3888, "ermil": 4008, "dasha": 4104, "lera": 4320, "masha": 4368, "jane": 4104}},
  {"id": "q4", "text": "В сторонах уверены, а углы на клетках не посчитать. Как быть?", "ms": {"kirill": 4104, "anton": 3984, "alexander": 4032, "ermil": 3768, "dasha": 3960, "lera": 4080, "masha": 4272, "jane": 3960}},
];

/** П3 «Хоть ножницы нарисуй»: vertical angles, a bet, a draw. Text: ~/temp/П3-ножницы.txt (voice-tools/gen_p3.py) */
export const SCISSORS: DialogueLine[] = [
  {"id":"p3-01","who":1,"write":null,"ms":{"alexander":2638,"anton":2743,"ermil":2691,"kirill":2847,"lera":2926,"dasha":2952,"jane":2508,"masha":3187},"text":"Ну что, сверяемся? У тебя что есть?"},
  {"id":"p3-02","who":2,"write":null,"ms":{"kirill":2795,"anton":2664,"alexander":2795,"ermil":2743,"dasha":2821,"lera":2873,"masha":3056,"jane":3004},"text":"Стороны и диагонали. Четыре штуки."},
  {"id":"p3-03","who":1,"write":null,"ms":{"kirill":4284,"alexander":3971,"anton":4075,"ermil":4153,"dasha":3971,"masha":4180,"lera":4049,"jane":3840},"text":"Ага, вижу. Я тоже их нашёл и ещё две пары углов."},
  {"id":"p3-04","who":2,"write":"AD = BC|AB = CD","ms":{"kirill":4153,"anton":3866,"alexander":3997,"ermil":4075,"dasha":3892,"masha":4310,"lera":4075,"jane":3971},"text":"О, интересно. Давай, я стороны выписываю, а ты диагонали."},
  {"id":"p3-05","who":1,"write":"AO = OC|BO = OD","ms":{"anton":2247,"kirill":2508,"alexander":2220,"ermil":2325,"dasha":2090,"lera":2403,"masha":2299,"jane":2194},"text":"А-о равно о-цэ, бэ-о равно о-дэ."},
  {"id":"p3-06","who":2,"write":null,"ms":{"kirill":5799,"anton":5590,"alexander":5538,"ermil":5329,"dasha":5460,"lera":5904,"masha":6060,"jane":5590},"text":"А это что такое? Угол а-о-бэ равен углу цэ-о-дэ. Это не считается."},
  {"id":"p3-07","who":1,"write":null,"ms":{"kirill":601,"anton":601,"alexander":653,"ermil":601,"dasha":653,"lera":679,"masha":653,"jane":627},"text":"Почему?"},
  {"id":"p3-08","who":2,"write":null,"ms":{"anton":4807,"kirill":4963,"alexander":4650,"ermil":4885,"lera":4989,"dasha":4728,"masha":5042,"jane":4963},"text":"Это вертикальные. Они всегда равны, в любой фигуре. Хоть ножницы нарисуй."},
  {"id":"p3-09","who":1,"write":null,"ms":{"kirill":3840,"anton":3709,"alexander":3683,"ermil":3631,"dasha":3709,"lera":3788,"jane":3814,"masha":3892},"text":"Ну и что? Задание — записать, что равно. Они равны."},
  {"id":"p3-10","who":2,"write":null,"ms":{"kirill":5747,"anton":5433,"ermil":5538,"alexander":5407,"lera":5773,"dasha":5538,"masha":6034,"jane":5642},"text":"Тогда ещё давай запишем, что а-о-цэ равно бэ-о-дэ. По сто восемьдесят градусов."},
  {"id":"p3-11","who":1,"write":null,"ms":{"kirill":914,"anton":914,"alexander":914,"ermil":888,"dasha":914,"lera":1019,"masha":940,"jane":940},"text":"Это другое."},
  {"id":"p3-12","who":2,"write":null,"ms":{"kirill":914,"anton":862,"alexander":914,"ermil":810,"dasha":862,"lera":967,"masha":940,"jane":888},"text":"Чем другое?"},
  {"id":"p3-13","who":1,"write":null,"ms":{"kirill":5590,"anton":5433,"alexander":5381,"ermil":5564,"dasha":5590,"lera":5721,"masha":6034,"jane":5642},"text":"Тем, что… ну это просто прямые, там вообще ничего не нужно. А здесь диагонали есть."},
  {"id":"p3-14","who":2,"write":null,"ms":{"kirill":1384,"anton":1332,"alexander":1254,"ermil":1280,"dasha":1228,"lera":1306,"masha":1384,"jane":1254},"text":"Так они у всех есть."},
  {"id":"p3-15","who":1,"write":null,"ms":{"kirill":1959,"anton":2038,"alexander":1933,"ermil":1959,"dasha":2064,"lera":2142,"masha":2299,"jane":1855},"text":"Слушай, ты всегда так споришь?"},
  {"id":"p3-16","who":2,"write":null,"ms":{"kirill":1176,"anton":1176,"alexander":1149,"ermil":1202,"dasha":1176,"lera":1254,"masha":1280,"jane":1228},"text":"Только когда прав."},
  {"id":"p3-17","who":1,"write":null,"ms":{"kirill":2011,"anton":1985,"alexander":1933,"ermil":1985,"dasha":1985,"lera":2064,"masha":2090,"jane":1724},"text":"А вот и не прав. Спорим?"},
  {"id":"p3-17f","who":1,"write":null,"ms":{"kirill":2090,"anton":2090,"alexander":2038,"ermil":1959,"dasha":2090,"masha":2168,"lera":2116,"jane":1750},"text":"А вот и не права. Спорим?"},
  {"id":"p3-18","who":2,"write":null,"ms":{"kirill":1750,"anton":1698,"alexander":1672,"ermil":1646,"dasha":1776,"lera":1776,"masha":1881,"jane":1776},"text":"Спорим. На шоколадку."},
  {"id":"p3-19","who":1,"write":null,"ms":{"kirill":1567,"anton":1620,"alexander":1541,"ermil":1541,"dasha":1620,"lera":1672,"jane":1541,"masha":1750},"text":"Идёт. А кто прав-то?"},
  {"id":"p3-20","who":2,"write":null,"ms":{"kirill":993,"anton":967,"alexander":940,"ermil":888,"dasha":967,"lera":1019,"masha":1019,"jane":914},"text":"Давай позовём."},
  {"id":"p3-21","who":1,"write":null,"ms":{"kirill":7314,"anton":6766,"alexander":6635,"ermil":6766,"dasha":6740,"lera":7105,"masha":7314,"jane":7053},"text":"Мы спорим, можно ли записать, что угол а-о-бэ равен углу цэ-о-дэ. Я думаю, можно, они же равны."},
  {"id":"p3-22","who":2,"write":null,"ms":{"anton":5642,"kirill":6087,"alexander":5486,"ermil":5956,"dasha":5642,"lera":5799,"masha":6191,"jane":5695},"text":"А я думаю, что это вертикальные углы, и к параллелограмму они отношения не имеют. Кто прав?","gap":2500},
  {"id":"p3-23","who":1,"write":null,"ms":{"kirill":1593,"anton":1593,"alexander":1541,"ermil":1437,"lera":1646,"dasha":1593,"masha":1593,"jane":1515},"text":"Оба правы. Это как?"},
  {"id":"p3-24","who":2,"write":null,"ms":{"kirill":1045,"anton":1045,"alexander":1071,"ermil":967,"dasha":1071,"lera":1123,"masha":1019,"jane":1019},"text":"Ничья, значит."},
  {"id":"p3-25","who":1,"write":null,"ms":{"kirill":1672,"anton":1593,"alexander":1593,"ermil":1567,"dasha":1593,"lera":1646,"masha":1698,"jane":1646},"text":"Тогда шоколадку пополам."},
  {"id":"p3-26","who":2,"write":null,"ms":{"kirill":1541,"anton":1541,"alexander":1489,"ermil":1463,"dasha":1541,"lera":1672,"masha":1672,"jane":1567},"text":"Каждый себе по половинке."},
  {"id":"p3-27","who":1,"write":"∠AOB = ∠COD *|∠BOC = ∠AOD *","ms":{"kirill":11076,"anton":10109,"alexander":10005,"ermil":10266,"dasha":10501,"lera":10762,"masha":11311,"jane":10527},"text":"Ладно. Правда, но не про параллелограмм. Давай оставим, но со звёздочкой. Если в четвёрке будем обсуждать, зададим ребятам этот вопрос. Пускай тоже подумают."},
  {"id":"p3-28","who":2,"write":null,"ms":{"kirill":1750,"anton":1724,"alexander":1698,"ermil":1620,"dasha":1776,"lera":1829,"masha":1802,"jane":1724},"text":"Ага, пусть помучаются."},
  {"id":"p3-29","who":1,"write":null,"ms":{"kirill":2403,"anton":2299,"alexander":2299,"ermil":2220,"dasha":2377,"lera":2482,"masha":2638,"jane":2508},"text":"Сколько мы всего насобирали, получается?"},
  {"id":"p3-30","who":2,"write":null,"ms":{"kirill":3187,"anton":2926,"alexander":3082,"ermil":3109,"dasha":3004,"lera":3213,"masha":3318,"jane":3109},"text":"Четыре по отрезкам и два про углы со звёздочкой."},
  {"id":"p3-31","who":1,"write":null,"ms":{"kirill":3448,"anton":3291,"alexander":3239,"ermil":3448,"dasha":3318,"lera":3396,"masha":3553,"jane":3161},"text":"А интересно, про какие углы тогда в задании написано?"},
  {"id":"p3-32","who":2,"write":null,"ms":{"kirill":3396,"anton":3318,"ermil":3291,"alexander":3213,"dasha":3396,"lera":3474,"jane":3004,"masha":3579},"text":"Надо подумать. Просто углы параллелограмма, может быть?"},
  {"id":"p3-33","who":1,"write":null,"ms":{"kirill":3161,"anton":3030,"alexander":3135,"ermil":3135,"dasha":3030,"lera":3187,"masha":3187,"jane":3082},"text":"А и бэ точно не равны, а вот а и цэ..."},
  {"id":"p3-34","who":2,"write":null,"ms":{"kirill":1071,"anton":1019,"alexander":1045,"ermil":967,"dasha":1045,"lera":1097,"masha":1097,"jane":1045},"text":"По-моему, равны."},
  {"id":"p3-35","who":1,"write":"∠A = ∠C","ms":{"kirill":5538,"anton":5277,"alexander":5277,"ermil":5224,"dasha":5381,"lera":5564,"masha":5825,"jane":5407},"text":"По-моему, тоже. Не знаю почему, но давай запишем. Нам же только найти нужно."},
  {"id":"p3-36","who":2,"write":"∠B = ∠D","ms":{"kirill":3866,"anton":3605,"alexander":3605,"ermil":3814,"dasha":3579,"lera":3840,"jane":3683,"masha":3918},"text":"Согласен. И, кажется, ещё угол бэ равен углу дэ."},
  {"id":"p3-37","who":1,"write":null,"ms":{"kirill":2952,"anton":2691,"alexander":2612,"ermil":2664,"dasha":2900,"lera":2900,"masha":2821,"jane":2534},"text":"Да, давай, выглядят очень похожими."},
  {"id":"p3-38","who":1,"write":null,"ms":{"kirill":2429,"anton":2247,"alexander":2273,"ermil":2247,"dasha":2325,"lera":2456,"masha":2612,"jane":2377},"text":"Ой, здравствуйте, Татьяна Алексеевна."},
  {"id":"p3-39","who":1,"write":null,"ms":{"kirill":7654,"anton":7027,"alexander":7131,"ermil":6713,"dasha":7079,"lera":7523,"masha":7967,"jane":7158},"text":"Идёт. Давай спросим. Татьяна Алексеевна, можно записать, что угол а-о-бэ равен углу цэ-о-дэ?"},
  {"id":"p3-40","who":2,"write":null,"ms":{"kirill":5669,"anton":5224,"alexander":5094,"ermil":5303,"dasha":5355,"lera":5460,"masha":5747,"jane":5251},"text":"А я говорю, это вертикальные, они у любых двух прямых равны. Это не про параллелограмм.","gap":2500},
  {"id":"p3-tq","who":"T","write":null,"ms":{"alena":1149,"filipp":1176},"text":"Какой у вас вопрос?"},
  {"id":"p3-ta","who":"T","write":null,"ms":{"alena":15256,"filipp":15778},"text":"Вертикальные углы действительно равны, тут не поспоришь. Но диагонали любого четырёхугольника, пересекаясь, дают равные вертикальные углы. А в этом задании мы ищем то, что характерно именно для параллелограмма. Так что вы оба правы.","gap":5000},
];
/** П3's board from the voice editor: drawn over the two sheets of b2 (the first one's on the left) */
export const SCISSORS_BOARD: Record<string, LineBoard> = {
};
