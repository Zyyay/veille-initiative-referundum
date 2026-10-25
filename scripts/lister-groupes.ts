// Liste les identifiants de groupes (PO...) présents dans le scrutin le plus récent, pour remplir config/groupes.json.
import { loadConfig } from "../src/lib/config.js";
import { requete } from "../src/lib/http.js";
import { extraireScrutin, liste, lireZip } from "../src/sources/an.js";

const cfg = loadConfig();
const r = await requete(cfg.sources.an_scrutins_zip, {}, 2, 180_000);
if (!r.ok) throw new Error(`HTTP ${r.status}`);
const sc = lireZip(Buffer.from(await r.arrayBuffer())).map(extraireScrutin).filter(Boolean)
  .sort((a, b) => b!.date.localeCompare(a!.date))[0]!;
console.log(`Scrutin le plus récent : n° ${sc.numero} du ${sc.date}\n`);
for (const g of liste((sc.brut as any).ventilationVotes?.organe?.groupes?.groupe)) {
  const ref = String((g as any).organeRef);
  console.log(`${ref}  membres : ${(g as any).nombreMembresGroupe}  →  ${cfg.groupes[ref] ?? "À RENSEIGNER"}`);
}
console.log("\nPour trouver le nom d'un groupe : https://www.assemblee-nationale.fr/dyn/17/organes/<PO...>");
