// Simulation hors ligne : remplace les sources par des données fictives pour voir les messages produits.
// Lancement : npm run simulation   (n'envoie rien, n'écrit rien dans Supabase)
import AdmZip from "adm-zip";
import { readFileSync } from "node:fs";

process.env.DRY_RUN = "1";
process.env.SUPABASE_URL = "";
const now = Date.now();
const iso = (h: number) => new Date(now - h * 3600_000).toUTCString();
const medias = [["Le Monde", "lemonde.fr"], ["Le Figaro", "lefigaro.fr"], ["Libération", "liberation.fr"], ["franceinfo", "francetvinfo.fr"]];
const rss = `<?xml version="1.0"?><rss><channel>${medias.map(([n, d], i) =>
  `<item><title>Réforme des retraites : l'âge de départ revient au Parlement - ${n}</title><link>https://news.google.com/rss/articles/S${i}</link><guid>S${i}</guid><pubDate>${iso(0.5 + i * 0.4)}</pubDate><source url="https://www.${d}">${n}</source></item>`).join("")}</channel></rss>`;

const zip = (fichiers: Record<string, unknown>) => { const z = new AdmZip(); for (const [k, v] of Object.entries(fichiers)) z.addFile(k, Buffer.from(JSON.stringify(v))); return z.toBuffer(); };
const scrutin = JSON.parse(readFileSync("test/fixtures/scrutin.json", "utf8"));
scrutin.scrutin.dateScrutin = new Date(now - 3600_000).toISOString().slice(0, 10);
const reunion = JSON.parse(readFileSync("test/fixtures/reunion.json", "utf8"));
reunion.reunion.timeStampDebut = new Date(now + 50 * 60_000).toISOString();

const vrai = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("news.google.com")) return new Response(rss, { status: 200 });
  if (url.includes("Scrutins")) return new Response(zip({ "json/VTANR5L17V9001.json": scrutin }), { status: 200, headers: { etag: "s1" } });
  if (url.includes("Agenda")) return new Response(zip({ "json/R1.json": reunion }), { status: 200, headers: { etag: "a1" } });
  if (url.includes("wikimedia")) return new Response(JSON.stringify({ items: Array.from({ length: 30 }, (_, i) => ({ timestamp: `202610${String(i + 1).padStart(2, "0")}00`, views: i === 29 ? 900 : 300 })) }), { status: 200 });
  return vrai(input);
}) as typeof fetch;

// Les groupes fictifs du scrutin d'exemple et une position déclarée pour montrer le signal ⚠.
process.env.CONFIG_DIR = "config";
process.env.SUJETS_FILE = "test/fixtures/sujets.json";
const { loadConfig } = await import("../src/lib/config.js");
const cfg0 = loadConfig();
void cfg0;
process.env.FORCER = "wiki,agenda";
await import("../src/index.js");
