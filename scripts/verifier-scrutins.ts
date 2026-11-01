// Diagnostic : scrutins publiés sur les N derniers jours (7 par défaut) et sujet auquel le bot les rattache.
// Ne modifie rien. Lancement : npm run test:scrutins   (ou : npx tsx scripts/verifier-scrutins.ts 14)
import { loadConfig, type Sujet } from "../src/lib/config.js";
import { decrireTelechargement, telechargerSiModifie } from "../src/lib/http.js";
import { extraireScrutin, lireZip, type ScrutinBrut } from "../src/sources/an.js";
import { rattacher } from "../src/lib/text.js";

const jours = Number(process.argv[2] ?? 7);
const cfg = loadConfig();

console.log(`Sujets actifs : ${cfg.sujets.map((s) => s.id).join(", ")}`);
for (const s of cfg.sujets) {
  console.log(`  ${s.id} — forts : ${[...s.termes_forts].join(" ; ") || "—"}`);
  console.log(`  ${" ".repeat(s.id.length)}   législatifs : ${s.termes_legislatifs.join(" ; ") || "—"}`);
  console.log(`  ${" ".repeat(s.id.length)}   faibles (il en faut 2) : ${s.termes_faibles.join(" ; ") || "—"}`);
}

const dl = await telechargerSiModifie(cfg.sources.an_scrutins_zip, null);
console.log(`\nFichier des scrutins : ${decrireTelechargement(dl)}`);
console.log(`ETag : ${dl.validateurs.etag ?? "absent"} · Last-Modified : ${dl.validateurs.lastModified ?? "absent"}`);
const tous = lireZip(dl.contenu!).map(extraireScrutin).filter((x): x is ScrutinBrut => !!x).sort((a, b) => b.date.localeCompare(a.date));
console.log(`${tous.length} scrutins dans le fichier ; le plus récent : n° ${tous[0]?.numero ?? "—"} du ${tous[0]?.date ?? "—"}`);

const limite = Date.now() - jours * 86400_000;
const recents = tous.filter((s) => +new Date(s.date) >= limite);
console.log(`\n${recents.length} scrutin(s) sur les ${jours} derniers jours :\n`);

const detail = (s: Sujet, texte: string) => {
  const r = rattacher(texte, s, true);
  const parts = [r.forts.length ? `forts trouvés : ${r.forts.join(", ")}` : "aucun terme fort", `faibles trouvés : ${r.faibles.length ? r.faibles.join(", ") : "aucun"}`];
  return { ok: r.ok, texte: `${s.id} (${parts.join(" ; ")})` };
};

let rattaches = 0;
for (const sc of recents) {
  console.log(`• ${sc.date} — n° ${sc.numero} — ${sc.texte.slice(0, 220)}`);
  const res = cfg.sujets.map((s) => detail(s, sc.texte));
  const ok = res.filter((r) => r.ok);
  if (ok.length) { rattaches++; console.log(`    → sujet : ${ok.map((r) => r.texte).join(" | ")}`); }
  else console.log(`    → aucun — termes testés : ${res.map((r) => r.texte).join(" | ")}`);
}
console.log(`\n${rattaches} scrutin(s) rattaché(s) sur ${recents.length}.`);
console.log("Rappel : en production, le bot n'analyse que les scrutins des 3 derniers jours, et seulement quand le fichier a changé depuis le passage précédent (ETag / Last-Modified).");
