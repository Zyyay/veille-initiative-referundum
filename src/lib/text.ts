import type { Sujet } from "./config.js";

const STOP = new Set(
  "les des une un le la de du et en au aux pour par sur dans avec sans que qui est son ses leur leurs plus pas ce cette ces il elle ils elles on nous vous a ne se sa".split(" "),
);

export function normaliser(s: string): string {
  return ` ${s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function contientTerme(texteNorm: string, terme: string): boolean {
  const t = normaliser(terme);
  return t.trim().length > 0 && texteNorm.includes(t);
}

export interface Rattachement { ok: boolean; forts: string[]; faibles: string[] }

/** Règle : au moins un terme fort, ou au moins deux termes faibles distincts. */
export function rattacher(texte: string, sujet: Sujet, avecLegislatif = false): Rattachement {
  const n = normaliser(texte);
  const fortsListe = [...sujet.termes_forts, ...(avecLegislatif ? sujet.termes_legislatifs : [])];
  const forts = fortsListe.filter((t) => contientTerme(n, t));
  const faibles = [...new Set(sujet.termes_faibles.filter((t) => contientTerme(n, t)).map((t) => normaliser(t).trim()))];
  return { ok: forts.length > 0 || faibles.length >= 2, forts, faibles };
}

export function jetons(s: string): Set<string> {
  return new Set(normaliser(s).trim().split(" ").filter((w) => w.length > 2 && !STOP.has(w)));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Regroupement glouton des titres proches en « histoires ». Renvoie l'index d'histoire de chaque élément. */
export function regrouper(titres: string[], seuil = 0.5): number[] {
  const reps: Set<string>[] = [];
  return titres.map((t) => {
    const j = jetons(t);
    const k = reps.findIndex((r) => jaccard(r, j) >= seuil);
    if (k >= 0) return k;
    reps.push(j);
    return reps.length - 1;
  });
}

export function domaine(url: string | undefined): string {
  if (!url) return "";
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

/** Retire le suffixe « - Nom du média » que Google News ajoute aux titres. */
export function nettoyerTitre(titre: string, source?: string): string {
  if (source && titre.endsWith(` - ${source}`)) return titre.slice(0, -(source.length + 3)).trim();
  return titre.replace(/\s+-\s+[^-]{2,60}$/, "").trim();
}

export function tronquer(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
