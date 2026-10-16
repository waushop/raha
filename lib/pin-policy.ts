// Rejects the PINs an attacker tries first. The space is only a million, so
// the predictable corner of it matters: repeated digits, sequences, patterns,
// well-known favourites and anything that reads as a date.
const COMMON = new Set([
  "123456", "654321", "111111", "000000", "123123", "112233", "121212", "123321", "159753", "789456",
  "147258", "159357", "123654", "101010", "202020", "696969", "131313", "100000", "110110", "112112",
  "111222", "222333", "333444", "444555", "555666", "666777", "777888", "888999", "121314", "102030",
  "123412", "135790", "246810", "147852", "258456", "369258", "321654", "456123", "654987", "987456",
  "111000", "000111", "123000", "000123", "007007", "420420", "777777", "888888", "999999", "555555",
]);

function isRepeated(pin: string): boolean {
  return /^(\d)\1{5}$/.test(pin);
}

function isSequence(pin: string): boolean {
  const d = pin.split("").map(Number);
  const up = d.every((v, i) => i === 0 || v === (d[i - 1] + 1) % 10);
  const down = d.every((v, i) => i === 0 || v === (d[i - 1] + 9) % 10);
  return up || down;
}

function isPattern(pin: string): boolean {
  // abcabc, ababab, aabbcc, abccba
  return /^(\d{3})\1$/.test(pin) || /^(\d{2})\1\1$/.test(pin) || /^(\d)\1(\d)\2(\d)\3$/.test(pin) || pin === pin.split("").reverse().join("");
}

function isDateLike(pin: string): boolean {
  const n = (s: string) => Number(s);
  const ddmmyy = n(pin.slice(0, 2)) >= 1 && n(pin.slice(0, 2)) <= 31 && n(pin.slice(2, 4)) >= 1 && n(pin.slice(2, 4)) <= 12;
  const yymmdd = n(pin.slice(2, 4)) >= 1 && n(pin.slice(2, 4)) <= 12 && n(pin.slice(4, 6)) >= 1 && n(pin.slice(4, 6)) <= 31;
  const mmddyy = n(pin.slice(0, 2)) >= 1 && n(pin.slice(0, 2)) <= 12 && n(pin.slice(2, 4)) >= 1 && n(pin.slice(2, 4)) <= 31;
  // A plausible year (1920–2039) at either end, e.g. 1988xx or xx2012.
  const yyyy = /^(19[2-9]\d|20[0-3]\d)/.test(pin) || /(19[2-9]\d|20[0-3]\d)$/.test(pin);
  return ddmmyy || yymmdd || mmddyy || yyyy;
}

/** Null when the PIN is acceptable, otherwise a short reason for the user. */
export function pinWeakness(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return "PIN must be 6 digits";
  if (isRepeated(pin)) return "Not the same digit six times";
  if (isSequence(pin)) return "Not a straight sequence";
  if (isPattern(pin)) return "Too much of a pattern — mix the digits up";
  if (COMMON.has(pin)) return "That PIN is one of the most common ones";
  if (isDateLike(pin)) return "Looks like a date — pick something nobody could guess from your birthday";
  return null;
}
