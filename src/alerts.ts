import type { Config, Sujet } from "./lib/config.js";
import { envoyer, type Embed } from "./lib/discord.js";
import type { Store } from "./lib/store.js";
import { enPlageSilencieuse, heures, minutesParis } from "./lib/time.js";
import { rang } from "./scoring.js";

export interface Candidate {
  cle: string;
  sujet: Sujet | null;
  type: "presse" | "wiki" | "agenda" | "agenda_modif" | "rappel" | "vote" | "budget";
  niveau: "haute" | "moyenne" | "basse" | "info";
  embeds: Embed[];
  dernier?: string;             // date du fait le plus récent (péremption du récapitulatif)
  forcerAttente?: boolean;      // ex. premier passage : tout va au récapitulatif
  seance?: { debut: string; objet: string }; // texte budgétaire : regroupé dans le récapitulatif
}

export type Issue = "envoyee" | "en_attente" | "ignoree_doublon" | "ignoree_delai" | "ecartee";

export function minuitParis(now: Date): Date {
  return new Date(now.getTime() - minutesParis(now) * 60_000 - now.getUTCSeconds() * 1000);
}

/** Applique les garde-fous puis envoie, met en attente ou écarte une alerte. */
export async function publier(c: Candidate, cfg: Config, store: Store, now: Date): Promise<Issue> {
  if (await store.alerteExiste(c.cle)) return "ignoree_doublon";
  const g = cfg.regles.garde_fous;
  const sujetId = c.sujet?.id ?? null;

  if (sujetId && (c.type === "presse" || c.type === "wiki")) {
    const prec = await store.derniereAlerte(sujetId, c.type);
    if (prec?.cree_le && now.getTime() - +new Date(prec.cree_le) < heures(g.delai_meme_sujet_heures) && rang(c.niveau) <= rang(prec.niveau))
      return "ignoree_delai";
  }

  const base = { cree_le: now.toISOString(), cle: c.cle, sujet_id: sujetId, type: c.type, niveau: c.niveau, payload: { embeds: c.embeds, dernier: c.dernier ?? null, seance: c.seance ?? null } };
  const { debut, fin } = cfg.regles.plage_silencieuse;
  const silence = enPlageSilencieuse(now, debut, fin, cfg.regles.fuseau);

  if (silence && c.type === "rappel") { await store.enregistrerAlerte({ ...base, mention: false, statut: "ecartee" }); return "ecartee"; }
  if (silence || c.niveau === "basse" || c.forcerAttente) {
    await store.enregistrerAlerte({ ...base, mention: false, statut: "en_attente" });
    return "en_attente";
  }

  const mention = c.niveau === "haute" && (await store.mentionsDepuis(minuitParis(now))) < g.mentions_max_par_jour;
  await envoyer(c.embeds, mention);
  await store.enregistrerAlerte({ ...base, mention, statut: "envoyee" });
  return "envoyee";
}
