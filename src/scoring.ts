import type { Config } from "./lib/config.js";
import type { Article } from "./lib/store.js";
import { heures, mediane } from "./lib/time.js";
import { regrouper } from "./lib/text.js";

export type Niveau = "haute" | "moyenne" | "basse" | null;

export interface Histoire { titre: string; articles: Article[]; dernier: string }

export interface ScorePresse {
  articlesFenetre: number; histoires: Histoire[]; medias: number; reference: number; ratio: number;
  bonusWiki: boolean; historiqueJours: number; calibration: boolean; niveau: Niveau;
}

/** Nombre d'articles dans la même fenêtre horaire, chacun des N jours précédents : on en prend la médiane. */
export function reference(articles: Article[], now: Date, fenetreH: number, jours: number): number {
  const comptes: number[] = [];
  for (let d = 1; d <= jours; d++) {
    const fin = now.getTime() - d * 86400_000;
    const debut = fin - heures(fenetreH);
    comptes.push(articles.filter((a) => { const t = +new Date(a.publie_le); return t > debut && t <= fin; }).length);
  }
  return mediane(comptes);
}

export function poidsMedias(arts: Article[], nationaux: string[]): number {
  const nat = new Set(nationaux);
  const doms = new Set(arts.map((a) => a.source_domaine || a.source_nom).filter(Boolean));
  let p = 0;
  for (const d of doms) p += nat.has(d) ? 1 : 0.5;
  return p;
}

export function niveauPresse(medias: number, nbHistoires: number, ratio: number, bonusWiki: boolean, cfg: Config): Niveau {
  const r = cfg.regles.presse;
  let niv: Niveau = medias >= r.haute.medias_min && ratio >= r.haute.ratio_min ? "haute"
    : nbHistoires >= r.moyenne.histoires_min && ratio >= r.moyenne.ratio_min ? "moyenne" : null;
  if (bonusWiki) niv = niv === "moyenne" ? "haute" : niv === null ? "basse" : niv;
  return niv;
}

export function scorerPresse(articles: Article[], now: Date, cfg: Config, bonusWiki: boolean, premier: Date | null): ScorePresse {
  const r = cfg.regles.presse;
  const debut = now.getTime() - heures(r.fenetre_heures);
  const fenetre = articles.filter((a) => { const t = +new Date(a.publie_le); return t > debut && t <= now.getTime(); });
  const ref = reference(articles, now, r.fenetre_heures, r.jours_reference);
  const ratio = fenetre.length / Math.max(ref, 1);
  const idx = regrouper(fenetre.map((a) => a.titre), r.similarite_titres);
  const map = new Map<number, Article[]>();
  fenetre.forEach((a, i) => map.set(idx[i], [...(map.get(idx[i]) ?? []), a]));
  const histoires: Histoire[] = [...map.values()]
    .map((arts) => ({ titre: arts[0].titre, articles: arts, dernier: arts.map((a) => a.publie_le).sort().at(-1)! }))
    .sort((a, b) => b.articles.length - a.articles.length);
  const medias = poidsMedias(fenetre, cfg.medias.medias_nationaux);
  const historiqueJours = premier ? Math.max(0, Math.floor((now.getTime() - premier.getTime()) / 86400_000)) : 0;
  return {
    articlesFenetre: fenetre.length, histoires, medias, reference: ref, ratio, bonusWiki, historiqueJours,
    calibration: historiqueJours < r.historique_min_jours,
    niveau: niveauPresse(medias, histoires.length, ratio, bonusWiki, cfg),
  };
}

const ORDRE: Record<string, number> = { info: 0, basse: 1, moyenne: 2, haute: 3 };
export const rang = (n: string | null | undefined) => ORDRE[n ?? ""] ?? -1;
