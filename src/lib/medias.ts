import type { Medias } from "./config.js";

/** Un domaine de la liste couvre aussi ses sous-domaines (france3-regions.francetvinfo.fr → francetvinfo.fr). */
export const couvre = (liste: string[], dom: string) => !!dom && liste.some((x) => dom === x || dom.endsWith(`.${x}`));

/** Domaines exclus explicitement, ou médias étrangers repérés par leur suffixe, sauf s'ils sont listés comme nationaux ou en liste blanche. */
export function mediaExclu(dom: string, m: Medias): boolean {
  if (!dom) return false;
  if (couvre(m.domaines_exclus, dom)) return true;
  if (couvre(m.medias_nationaux, dom) || couvre(m.liste_blanche, dom)) return false;
  return couvre(m.suffixes_exclus, dom);
}

export const estNational = (dom: string, m: Medias) => couvre(m.medias_nationaux, dom);

export function poidsMedia(dom: string, m: Medias): number {
  if (estNational(dom, m)) return m.poids.nationaux;
  if (m.liste_blanche_active && !couvre(m.liste_blanche, dom)) return m.poids.hors_liste_blanche;
  return m.poids.autres;
}
