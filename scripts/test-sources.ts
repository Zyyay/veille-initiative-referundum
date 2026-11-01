// Vérifie que chaque source répond et affiche un aperçu de sa structure. À lancer à l'installation.
import AdmZip from "adm-zip";
import { loadConfig } from "../src/lib/config.js";
import { attendre, recuperer, texte } from "../src/lib/http.js";
import { analyserRss, urlRecherche } from "../src/sources/gnews.js";
import { urlVues } from "../src/sources/wikipedia.js";
import { extraireReunion, extraireScrutin, liste } from "../src/sources/an.js";

const cfg = loadConfig();
const ok = (m: string) => console.log(`✅ ${m}`);
const ko = (m: string) => console.log(`❌ ${m}`);

// 1. Google News
for (const s of cfg.sujets) for (const q of s.requetes_gnews) {
  await attendre(cfg.regles.reseau.gnews_delai_ms);
  try { const it = analyserRss(await texte(urlRecherche(q))); ok(`Google News « ${q} » : ${it.length} articles. Ex. : ${it[0]?.titre ?? "—"} (${it[0]?.source_nom ?? "—"}, ${it[0]?.source_domaine || "domaine inconnu"})`); }
  catch (e) { ko(`Google News « ${q} » : ${(e as Error).message}`); }
}

// 2. Wikipédia
for (const s of cfg.sujets) for (const a of s.wikipedia) {
  const r = await recuperer(urlVues(a, new Date(Date.now() - 10 * 86400_000), new Date(Date.now() - 86400_000)));
  r.ok ? ok(`Wikipédia « ${a} » : ${r.json<{ items?: unknown[] }>().items?.length ?? 0} jours`) : ko(`Wikipédia « ${a} » : HTTP ${r.status}`);
}

// 3. Assemblée : scrutins et agenda
async function zip(nom: string, url: string, f: (j: unknown) => unknown) {
  try {
    const debut = Date.now();
    const r = await recuperer(url, {}, { timeoutMs: cfg.regles.reseau.timeout_telechargement_ms });
    if (!r.ok) return ko(`${nom} : HTTP ${r.status} sur ${url} — corrige l'URL dans config/sources.json`);
    const buf = r.corps;
    const entrees = new AdmZip(buf).getEntries().filter((e) => e.entryName.endsWith(".json"));
    ok(`${nom} : ${(buf.length / 1e6).toFixed(1)} Mo, ${entrees.length} fichiers JSON, ${((Date.now() - debut) / 1000).toFixed(0)} s`);
    console.log(`   ETag : ${r.headers.get("etag") ?? "absent"} · Last-Modified : ${r.headers.get("last-modified") ?? "absent"}`);
    const echantillon = entrees.slice(-3).map((e) => f(JSON.parse(e.getData().toString("utf8"))));
    console.log("   Aperçu des 3 derniers éléments lus par le bot :", JSON.stringify(echantillon, null, 2).slice(0, 2500));
  } catch (e) { ko(`${nom} : ${(e as Error).message}`); }
}
await zip("Scrutins AN", cfg.sources.an_scrutins_zip, (j) => {
  const s = extraireScrutin(j);
  return s && { uid: s.uid, date: s.date, texte: s.texte.slice(0, 150), groupes: liste((s.brut as any)?.ventilationVotes?.organe?.groupes?.groupe).length };
});
await zip("Agenda AN", cfg.sources.an_agenda_zip, (j) => {
  const r = extraireReunion(j);
  return r && { ...r, objet: r.objet.slice(0, 200) };
});
