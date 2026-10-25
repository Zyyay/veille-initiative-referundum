/** Heure de Paris, indépendante du fuseau de la machine (GitHub tourne en UTC). */
export interface ParisParts { y: number; m: number; d: number; h: number; min: number; jour: string }

export function parisParts(date: Date, tz = "Europe/Paris"): ParisParts {
  const f = new Intl.DateTimeFormat("fr-FR", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const y = +p.year, m = +p.month, d = +p.day;
  return { y, m, d, h: +p.hour, min: +p.minute, jour: `${p.year}-${p.month}-${p.day}` };
}

/** Vrai entre `debut` h (inclus) et `fin` h (exclu), à cheval sur minuit. */
export function enPlageSilencieuse(date: Date, debut = 21, fin = 8, tz = "Europe/Paris"): boolean {
  const { h } = parisParts(date, tz);
  return debut > fin ? h >= debut || h < fin : h >= debut && h < fin;
}

/** Minutes écoulées depuis minuit, heure de Paris. */
export function minutesParis(date: Date, tz = "Europe/Paris"): number {
  const { h, min } = parisParts(date, tz);
  return h * 60 + min;
}

export function heures(n: number): number { return n * 3600_000; }

export function formatHeure(date: Date, tz = "Europe/Paris"): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

export function formatDateHeure(date: Date, tz = "Europe/Paris"): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: tz, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
}

export function mediane(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const k = Math.floor(s.length / 2);
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}
