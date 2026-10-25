import { env, type Config, type Sujet } from "./lib/config.js";
import { requete } from "./lib/http.js";
import type { Embed } from "./lib/discord.js";

const CONSIGNES = `Tu rédiges des brouillons de publications pour Doléances, une plateforme civique neutre qui mesure l'écart entre l'opinion des Français (sondages sourcés) et les décisions publiques.
Règles impératives :
- Neutralité absolue : aucun adjectif polarisant, aucune intention prêtée aux élus ni aux groupes, aucun mot comme « trahison », « scandale », « incohérence ».
- Poser le problème, jamais la solution. Mettre les faits côte à côte et laisser le lecteur juger.
- N'utiliser QUE les faits fournis. Ne rien inventer : ni chiffre, ni citation, ni nom.
- Citer la source de la donnée d'opinion (institut et date) quand elle est fournie.
- Si la donnée d'opinion manque, ne pas en inventer : écrire le post sans chiffre d'opinion.
- Pas de lien dans le post principal (il ira en réponse). Pas de hashtag sauf s'il est indispensable.
Réponds UNIQUEMENT par un objet JSON, sans texte autour ni balises de code.`;

const FORMATS: Record<string, string> = {
  x: `"x_post": post X autonome de 280 caractères maximum, "x_reponse": réponse type de 280 caractères maximum à placer sous les posts qui parlent du sujet`,
};

export async function genererBrouillons(cfg: Config, sujet: Sujet, faits: string): Promise<Embed | null> {
  const b = cfg.regles.brouillons;
  if (!b.actifs || !env.anthropicKey) return null;
  const formats = b.reseaux.map((r) => FORMATS[r]).filter(Boolean).join(", ");
  const d = sujet.donnee;
  const message = `Sujet : ${sujet.titre}
Donnée d'opinion : ${d.adhesion == null ? "non disponible" : `${d.adhesion} % favorables${d.question ? ` à la question « ${d.question} »` : ""} (${d.institut}, ${d.date})`}
Faits du moment :
${faits}

Produis un objet JSON avec les clés suivantes : ${formats}.`;
  try {
    const r = await requete("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.anthropicKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: b.modele, max_tokens: 1000, system: CONSIGNES, messages: [{ role: "user", content: message }] }),
    }, 2, 60_000);
    if (!r.ok) throw new Error(`HTTP ${r.status} : ${(await r.text()).slice(0, 200)}`);
    const json = (await r.json()) as { content: { type: string; text?: string }[] };
    const brut = json.content.filter((c) => c.type === "text").map((c) => c.text).join("").replace(/```json|```/g, "").trim();
    const obj = JSON.parse(brut) as Record<string, string>;
    return {
      title: `✍️ Brouillons — ${sujet.titre}`,
      color: 0x7048e8,
      fields: Object.entries(obj).map(([k, v]) => ({ name: `${k} (${String(v).length} car.)`, value: String(v) })),
      footer: { text: "À relire : vérifie chaque fait dans les sources avant de publier." },
    };
  } catch (e) {
    return { title: `✍️ Brouillons indisponibles — ${sujet.titre}`, color: 0x868e96, description: `Erreur : ${(e as Error).message}` };
  }
}
