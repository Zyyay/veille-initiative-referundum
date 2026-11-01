import { XMLParser } from "fast-xml-parser";
import type { Config, Sujet } from "../lib/config.js";
import { attendre, texte } from "../lib/http.js";
import { mediaExclu } from "../lib/medias.js";
import { domaine, nettoyerTitre, rattacher } from "../lib/text.js";
import type { Article } from "../lib/store.js";

export function urlRecherche(requete: string, periode = "2d"): string {
  const q = `${requete} when:${periode}`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr&gl=FR&ceid=FR:fr`;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });

export interface ElementRss { guid: string; titre: string; lien: string; publie_le: string; source_nom: string; source_domaine: string }

export function analyserRss(xml: string): ElementRss[] {
  const doc = parser.parse(xml);
  const items = doc?.rss?.channel?.item;
  const liste = Array.isArray(items) ? items : items ? [items] : [];
  return liste.map((it: Record<string, any>) => {
    const src = it.source ?? {};
    const sourceNom = typeof src === "string" ? src : String(src["#text"] ?? "");
    const sourceUrl = typeof src === "object" ? String(src["@_url"] ?? "") : "";
    const guid = typeof it.guid === "object" ? String(it.guid["#text"] ?? "") : String(it.guid ?? it.link ?? "");
    const date = new Date(String(it.pubDate ?? ""));
    return {
      guid,
      titre: nettoyerTitre(String(it.title ?? ""), sourceNom),
      lien: String(it.link ?? ""),
      publie_le: isNaN(+date) ? new Date().toISOString() : date.toISOString(),
      source_nom: sourceNom,
      source_domaine: domaine(sourceUrl),
    };
  }).filter((x) => x.guid && x.titre);
}

/** Collecte Google News pour tous les sujets ; renvoie les articles rattachés (nouveaux ou non). */
export async function collecterGoogleNews(cfg: Config, log: (m: string) => void): Promise<Article[]> {
  const resultats: Article[] = [];
  let premiere = true;
  for (const sujet of cfg.sujets) {
    const vus = new Set<string>();
    for (const req of sujet.requetes_gnews) {
      // Espacement entre requêtes : des rafales rapprochées déclenchent des HTTP 503 chez Google News.
      if (!premiere) await attendre(cfg.regles.reseau.gnews_delai_ms);
      premiere = false;
      try {
        const xml = await texte(urlRecherche(req));
        for (const el of analyserRss(xml)) {
          if (vus.has(el.guid) || mediaExclu(el.source_domaine, cfg.medias)) continue;
          if (cfg.regles.presse.filtrer_par_titre && !rattacher(el.titre, sujet).ok) continue;
          vus.add(el.guid);
          resultats.push({ sujet_id: sujet.id, ...el });
        }
      } catch (e) {
        log(`Google News — sujet ${sujet.id}, requête « ${req} » : ${(e as Error).message}`);
      }
    }
  }
  return resultats;
}

export function sujetParId(cfg: Config, id: string): Sujet | undefined {
  return cfg.sujets.find((s) => s.id === id);
}
