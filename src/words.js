// Numbers, dates and times as spoken words, for the call context (Appendix E).

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
  "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth",
  "nineteenth", "twentieth", "twenty-first", "twenty-second", "twenty-third", "twenty-fourth", "twenty-fifth",
  "twenty-sixth", "twenty-seventh", "twenty-eighth", "twenty-ninth", "thirtieth", "thirty-first"];

// Cardinal 0..99 in words.
export function numberWords(n) {
  n = Math.trunc(Number(n));
  if (n < 0 || n > 99 || Number.isNaN(n)) return String(n);
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = n % 10;
  return o ? `${t}-${ONES[o]}` : t;
}

// Day of month 1..31 as an ordinal.
export function ordinal(n) {
  return ORDINALS[n] ?? String(n);
}

// Years as two pairs: 2026 -> "twenty twenty-six", 2007 -> "two thousand and seven", 1999 -> "nineteen ninety-nine".
export function yearWords(y) {
  y = Math.trunc(Number(y));
  const hi = Math.floor(y / 100);
  const lo = y % 100;
  if (hi === 20 && lo < 10) return lo ? `two thousand and ${ONES[lo]}` : "two thousand";
  if (lo === 0) return `${numberWords(hi)} hundred`;
  if (lo < 10) return `${numberWords(hi)} oh ${ONES[lo]}`;
  return `${numberWords(hi)} ${numberWords(lo)}`;
}

// 10:30 -> "ten thirty in the morning", 15:05 -> "three oh five in the afternoon", 12:00 -> "twelve o'clock in the afternoon".
export function timeWords(date) {
  const h24 = date.getHours();
  const m = date.getMinutes();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const period = h24 < 5 ? "at night" : h24 < 12 ? "in the morning" : h24 < 17 ? "in the afternoon" : h24 < 21 ? "in the evening" : "at night";
  const minutes = m === 0 ? "o'clock" : m < 10 ? `oh ${ONES[m]}` : numberWords(m);
  return `${numberWords(h12)} ${minutes} ${period}`;
}

// "Wednesday, October seventh, twenty twenty-six, at ten thirty in the morning, Eastern Daylight Time."
export function dateTimeWords(date = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-CA", { weekday: "long" }).format(date);
  const month = new Intl.DateTimeFormat("en-CA", { month: "long" }).format(date);
  const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: "long" })
    .formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "local time";
  return `${weekday}, ${month} ${ordinal(date.getDate())}, ${yearWords(date.getFullYear())}, at ${timeWords(date)}, ${zone}`;
}
