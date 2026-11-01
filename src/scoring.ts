import type { Config, Medias, Sujet } from "./lib/config.js";
import type { Article } from "./lib/store.js";
import { heures, mediane, minuitParis } from "./lib/time.js";
import { jetons, regrouper } from "./lib/text.js";
import { estNational, mediaExclu, poidsMedia } from "./lib/medias.js";

export type Niveau = "haute" | "moyenne" | "basse" | null;

export interface Histoire {
  titre: string; lien: string; source: string; articles: Article[]; dernier: string;
  medias: number;    // médias pondérés de cette seule histoire
}

export interface ScorePresse {
  debut: string; fin: string; dureeH: number;
  articlesFenetre: number; histoires: Histoire[];
  medias: number; mediasNationaux: number;
  reference: number | null;   // null : aucun jour d'historique disponible
  joursReference: number;     // jours effectivement utilisés pour la médiane
  ratio: number | null;       // null : pas de normale, donc pas d'alerte sur le ratio
  bonusWiki: boolean; historiqueJours: number; calibration: boolean; niveau: Niveau;
}

const date = (a: Article) => +new Date(a.publie_le);
const media = (a: Article) => a.source_domaine || a.source_nom;

/**
 * Normale : médiane du nombre d'articles sur la même plage horaire, chacun des N jours précédents,
 * en ne gardant que les jours couverts par l'historique (plage commençant après le premier article collecté).
 * Les jours d'avant la mise en service ne comptent donc pas comme des zéros.
 */
export function reference(articles: Article[], fin: Date, dureeH: number, jours: number, premier: Date | null): { valeur: number | null; jours: number } {
  const comptes: number[] = [];
  for (let d = 1; d <= jours; d++) {
    const f = fin.getTime() - d * 86400_000;
    const debut = f - heures(dureeH);
    if (!premier || debut < premier.getTime()) continue;
    comptes.push(articles.filter((a) => date(a) > debut && date(a) <= f).length);
  }
  return { valeur: comptes.length ? mediane(comptes) : null, jours: comptes.length };
}

export function poidsMedias(arts: Article[], m: Medias): { ponderes: number; nationaux: number } {
  const doms = new Set(arts.map(media).filter(Boolean));
  let ponderes = 0, nationaux = 0;
  for (const d of doms) { ponderes += poidsMedia(d, m); if (estNational(d, m)) nationaux++; }
  return { ponderes, nationaux };
}

export function niveauPresse(m: { ponderes: number; nationaux: number }, nbHistoires: number, ratio: number | null, bonusWiki: boolean, cfg: Config): Niveau {
  const r = cfg.regles.presse;
  const ok = ratio !== null;
  let niv: Niveau =
    ok && m.ponderes >= r.haute.medias_ponderes_min && m.nationaux >= r.haute.medias_nationaux_min && ratio >= r.haute.ratio_min ? "haute"
    : ok && nbHistoires >= r.moyenne.histoires_min && m.ponderes >= r.moyenne.medias_ponderes_min && ratio >= r.moyenne.ratio_min ? "moyenne"
    : null;
  if (bonusWiki) niv = niv === "moyenne" ? "haute" : niv === null ? "basse" : niv;
  return niv;
}

/** Score de la presse publiée entre `debut` et `fin`, comparée à la même plage horaire des jours précédents. */
export function evaluerPresse(tous: Article[], debut: Date, fin: Date, cfg: Config, bonusWiki: boolean, premier: Date | null): ScorePresse {
  const r = cfg.regles.presse;
  const articles = tous.filter((a) => !mediaExclu(a.source_domaine, cfg.medias));
  const dureeH = (fin.getTime() - debut.getTime()) / 3600_000;
  const fenetre = articles.filter((a) => date(a) > debut.getTime() && date(a) <= fin.getTime());
  const ref = reference(articles, fin, dureeH, r.jours_reference, premier);
  const normale = ref.valeur ?? r.reference_sans_historique;
  const ratio = normale === null ? null : fenetre.length / Math.max(normale, r.reference_min);
  const idx = regrouper(fenetre.map((a) => a.titre), r.similarite_titres);
  const map = new Map<number, Article[]>();
  fenetre.forEach((a, i) => map.set(idx[i], [...(map.get(idx[i]) ?? []), a]));
  const histoires: Histoire[] = [...map.values()].map((arts) => {
    const tries = [...arts].sort((a, b) => b.publie_le.localeCompare(a.publie_le));
    return { titre: tries[0].titre, lien: tries[0].lien, source: media(tries[0]), articles: tries, dernier: tries[0].publie_le,
      medias: poidsMedias(tries, cfg.medias).ponderes };
  }).sort((a, b) => b.articles.length - a.articles.length || b.medias - a.medias || b.dernier.localeCompare(a.dernier));
  const medias = poidsMedias(fenetre, cfg.medias);
  const historiqueJours = premier ? Math.max(0, Math.floor((fin.getTime() - premier.getTime()) / 86400_000)) : 0;
  return {
    debut: debut.toISOString(), fin: fin.toISOString(), dureeH,
    articlesFenetre: fenetre.length, histoires, medias: medias.ponderes, mediasNationaux: medias.nationaux,
    reference: ref.valeur, joursReference: ref.jours, ratio, bonusWiki, historiqueJours,
    calibration: ref.jours < r.historique_min_jours,
    niveau: niveauPresse(medias, histoires.length, ratio, bonusWiki, cfg),
  };
}

/** Fenêtre glissante de chaque passage (fenetre_heures). */
export function scorerPresse(articles: Article[], now: Date, cfg: Config, bonusWiki: boolean, premier: Date | null): ScorePresse {
  return evaluerPresse(articles, new Date(now.getTime() - heures(cfg.regles.presse.fenetre_heures)), now, cfg, bonusWiki, premier);
}

/** Début de la nuit écoulée : la veille à nuit.heure_debut (heure de Paris). */
export function debutNuit(now: Date, cfg: Config): Date {
  return new Date(minuitParis(now).getTime() - heures(24 - cfg.regles.presse.nuit.heure_debut));
}

/** Presse de la nuit (veille à heure_debut → maintenant), pour le récapitulatif du matin. */
export function scorerNuit(articles: Article[], now: Date, cfg: Config, premier: Date | null): ScorePresse {
  return evaluerPresse(articles, debutNuit(now, cfg), now, cfg, false, premier);
}

/* ---------- Histoires déjà signalées ---------- */

export interface EmpreinteHistoire {
  sujet_id: string; cree_le: string; niveau: string; medias: number; mots: string[]; guids: string[]; alerte_cle: string;
}

/** Mots d'un sujet (termes de recherche) : présents dans toutes ses histoires, donc non distinctifs. */
export function motsSujet(s: Sujet): Set<string> {
  return new Set([...s.termes_forts, ...s.termes_faibles, ...s.termes_legislatifs].flatMap((t) => [...jetons(t)]));
}

/** Mots distinctifs d'une histoire : ceux repris par au moins deux titres (tous les mots s'il n'y a qu'un titre), hors mots du sujet. */
export function motsHistoire(h: Histoire, exclus: Set<string>, minimum: number): string[] {
  const freq = new Map<string, number>();
  for (const a of h.articles) for (const m of jetons(a.titre)) if (!exclus.has(m)) freq.set(m, (freq.get(m) ?? 0) + 1);
  const repris = [...freq].filter(([, n]) => n >= 2).map(([m]) => m);
  return repris.length >= minimum ? repris : [...freq.keys()];
}

export function empreinte(h: Histoire, sujet: Sujet, niveau: string, alerteCle: string, now: Date, cfg: Config): EmpreinteHistoire {
  return {
    sujet_id: sujet.id, cree_le: now.toISOString(), niveau, medias: h.medias, alerte_cle: alerteCle,
    mots: motsHistoire(h, motsSujet(sujet), cfg.regles.presse.dedoublonnage.mots_communs_min), guids: h.articles.map((a) => a.guid),
  };
}

export function memeHistoire(h: Histoire, e: EmpreinteHistoire, sujet: Sujet, cfg: Config): boolean {
  const d = cfg.regles.presse.dedoublonnage;
  if (h.articles.some((a) => e.guids.includes(a.guid))) return true;
  const mots = motsHistoire(h, motsSujet(sujet), d.mots_communs_min);
  const autres = new Set(e.mots);
  const communs = mots.filter((m) => autres.has(m)).length;
  const plusPetite = Math.min(mots.length, autres.size);
  return plusPetite > 0 && communs >= d.mots_communs_min && communs / plusPetite >= d.similarite_min;
}

/**
 * Retire les histoires déjà signalées (empreintes récentes), sauf si le niveau monte ou si leurs médias pondérés
 * ont été multipliés par hausse_medias_ratio, puis recalcule médias et niveau sur les histoires restantes.
 * Le volume (articles, ratio) reste celui de toute la fenêtre.
 */
export function retirerDejaSignalees(sc: ScorePresse, recentes: EmpreinteHistoire[], sujet: Sujet, cfg: Config): { score: ScorePresse; retirees: Histoire[] } {
  const d = cfg.regles.presse.dedoublonnage;
  const retirees: Histoire[] = [];
  const nouvelles = sc.histoires.filter((h) => {
    const deja = recentes.some((e) => memeHistoire(h, e, sujet, cfg) && rang(sc.niveau) <= rang(e.niveau) && h.medias < e.medias * d.hausse_medias_ratio);
    if (deja) retirees.push(h);
    return !deja;
  });
  if (!retirees.length) return { score: sc, retirees };
  const medias = poidsMedias(nouvelles.flatMap((h) => h.articles), cfg.medias);
  return {
    retirees,
    score: { ...sc, histoires: nouvelles, medias: medias.ponderes, mediasNationaux: medias.nationaux,
      niveau: nouvelles.length ? niveauPresse(medias, nouvelles.length, sc.ratio, sc.bonusWiki, cfg) : null },
  };
}

const ORDRE: Record<string, number> = { info: 0, basse: 1, moyenne: 2, haute: 3 };
export const rang = (n: string | null | undefined) => ORDRE[n ?? ""] ?? -1;
