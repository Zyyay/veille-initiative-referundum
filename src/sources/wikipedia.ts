import type { Config } from "../lib/config.js";
import { requete } from "../lib/http.js";
import { mediane } from "../lib/time.js";
import type { Store } from "../lib/store.js";

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

export function urlVues(article: string, debut: Date, fin: Date): string {
  const titre = encodeURIComponent(article.trim().replace(/ /g, "_"));
  return `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/fr.wikipedia.org/all-access/user/${titre}/daily/${ymd(debut)}/${ymd(fin)}`;
}

export interface SignalWiki { sujet_id: string; article: string; jour: string; vues: number; reference: number; ratio: number }

/** Ratio du dernier jour disponible sur la médiane des N jours précédents. */
export function calculerRatio(serie: { jour: string; vues: number }[], joursReference: number) {
  if (serie.length < 8) return null; // historique trop court pour être fiable
  const dernier = serie[serie.length - 1];
  const ref = mediane(serie.slice(-1 - joursReference, -1).map((x) => x.vues));
  return { jour: dernier.jour, vues: dernier.vues, reference: ref, ratio: dernier.vues / Math.max(ref, 1) };
}

export async function collecterWikipedia(cfg: Config, store: Store, log: (m: string) => void): Promise<SignalWiki[]> {
  const fin = new Date(Date.now() - 86400_000);
  const debut = new Date(Date.now() - (cfg.regles.wikipedia.jours_reference + 3) * 86400_000);
  const signaux: SignalWiki[] = [];
  for (const sujet of cfg.sujets) {
    for (const article of sujet.wikipedia) {
      try {
        const r = await requete(urlVues(article, debut, fin));
        if (r.status === 404) { log(`Wikipédia — article introuvable ou sans données : « ${article} » (sujet ${sujet.id})`); continue; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as { items?: { timestamp: string; views: number }[] };
        const lignes = (json.items ?? []).map((i) => ({
          article, jour: `${i.timestamp.slice(0, 4)}-${i.timestamp.slice(4, 6)}-${i.timestamp.slice(6, 8)}`, vues: i.views,
        }));
        await store.ajouterWiki(lignes);
        const calc = calculerRatio(lignes, cfg.regles.wikipedia.jours_reference);
        if (calc) signaux.push({ sujet_id: sujet.id, article, ...calc });
      } catch (e) {
        log(`Wikipédia — « ${article} » : ${(e as Error).message}`);
      }
    }
  }
  return signaux;
}
