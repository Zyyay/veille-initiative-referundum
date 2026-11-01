import type { Config, Sujet } from "./lib/config.js";
import { envoyer, modifier, type Embed } from "./lib/discord.js";
import type { Store } from "./lib/store.js";
import { enPlageSilencieuse, heures, minuitParis } from "./lib/time.js";
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

export type Issue = "envoyee" | "modifiee" | "en_attente" | "ignoree_doublon" | "ignoree_delai" | "ecartee";

/** Applique les garde-fous puis envoie, met en attente ou écarte une alerte. */
export async function publier(c: Candidate, cfg: Config, store: Store, now: Date): Promise<Issue> {
  if (await store.alerteExiste(c.cle)) return "ignoree_doublon";
  const g = cfg.regles.garde_fous;
  const sujetId = c.sujet?.id ?? null;
  const prec = sujetId && (c.type === "presse" || c.type === "wiki") ? await store.derniereAlerte(sujetId, c.type) : null;
  const depuisPrec = prec?.cree_le ? now.getTime() - +new Date(prec.cree_le) : Infinity;

  if (prec && depuisPrec < heures(g.delai_meme_sujet_heures) && rang(c.niveau) <= rang(prec.niveau)) return "ignoree_delai";

  const base = { cree_le: now.toISOString(), cle: c.cle, sujet_id: sujetId, type: c.type, niveau: c.niveau, payload: { embeds: c.embeds, dernier: c.dernier ?? null, seance: c.seance ?? null } };
  const { debut, fin } = cfg.regles.plage_silencieuse;
  const silence = enPlageSilencieuse(now, debut, fin, cfg.regles.fuseau);

  if (silence && c.type === "rappel") { await store.enregistrerAlerte({ ...base, mention: false, statut: "ecartee" }); return "ecartee"; }
  if (silence || c.niveau === "basse" || c.forcerAttente) {
    await store.enregistrerAlerte({ ...base, mention: false, statut: "en_attente" });
    return "en_attente";
  }

  // Orange puis rouge sur le même sujet en peu de temps : pas de seconde notification ; le message orange est remplacé si possible.
  const escalade = c.type === "presse" && c.niveau === "haute" && prec?.niveau === "moyenne" && prec.statut === "envoyee"
    && depuisPrec < heures(g.escalade.delai_heures);
  if (escalade && g.escalade.modifier_message) {
    const id = prec!.payload.discord_message_id;
    if (typeof id === "string" && (await modifier(id, c.embeds))) {
      await store.enregistrerAlerte({ ...base, payload: { ...base.payload, discord_message_id: id, remplace: prec!.cle }, mention: false, statut: "envoyee" });
      return "modifiee";
    }
  }

  const mention = !escalade && c.niveau === "haute" && (await store.mentionsDepuis(minuitParis(now))) < g.mentions_max_par_jour;
  const ids = await envoyer(c.embeds, mention);
  await store.enregistrerAlerte({ ...base, payload: { ...base.payload, discord_message_id: ids[0] ?? null }, mention, statut: "envoyee" });
  return "envoyee";
}
