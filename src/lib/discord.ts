import { env } from "./config.js";
import { attendre, requete } from "./http.js";
import { tronquer } from "./text.js";

export interface Champ { name: string; value: string; inline?: boolean }
export interface Embed {
  title?: string; description?: string; url?: string; color?: number; fields?: Champ[];
  footer?: { text: string }; timestamp?: string;
}

export const COULEURS = { haute: 0xe03131, moyenne: 0xf08c00, basse: 0x1c7ed6, info: 0x868e96, tech: 0x495057 } as const;
export const PASTILLE: Record<string, string> = { haute: "🔴", moyenne: "🟠", basse: "🔵", info: "ℹ️" };

/** Respecte les limites Discord : titre 256, description 4096, 25 champs de 1024, 6000 au total. */
export function borner(e: Embed): Embed {
  const out: Embed = { ...e };
  if (out.title) out.title = tronquer(out.title, 256);
  if (out.description) out.description = tronquer(out.description, 4000);
  out.fields = (out.fields ?? []).slice(0, 25).map((f) => ({ ...f, name: tronquer(f.name || "—", 256), value: tronquer(f.value || "—", 1024) }));
  let total = (out.title?.length ?? 0) + (out.description?.length ?? 0) + (out.footer?.text.length ?? 0);
  out.fields = out.fields.filter((f) => (total += f.name.length + f.value.length) <= 5900);
  return out;
}

function mentionsAutorisees(mention: string) {
  const u = mention.match(/^<@!?(\d+)>$/), r = mention.match(/^<@&(\d+)>$/);
  if (u) return { users: [u[1]] };
  if (r) return { roles: [r[1]] };
  if (/@everyone|@here/.test(mention)) return { parse: ["everyone"] };
  return { parse: [] as string[] };
}

export async function envoyer(embeds: Embed[], mention = false, texte = ""): Promise<void> {
  const contenu = [mention ? env.discordMention : "", texte].filter(Boolean).join(" ");
  const lots: Embed[][] = [];
  for (let i = 0; i < embeds.length; i += 10) lots.push(embeds.slice(i, i + 10).map(borner));
  if (!lots.length) lots.push([]);
  for (const [i, lot] of lots.entries()) {
    const corps = {
      username: "Veille Doléances",
      content: i === 0 ? contenu : "",
      embeds: lot,
      allowed_mentions: i === 0 && mention ? mentionsAutorisees(env.discordMention) : { parse: [] },
    };
    if (env.dryRun || !env.discordWebhook) {
      console.log("\n[DISCORD — essai, non envoyé]\n" + JSON.stringify(corps, null, 2));
      continue;
    }
    for (let essai = 0; essai < 3; essai++) {
      const r = await requete(`${env.discordWebhook}?wait=true`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps),
      }, 1);
      if (r.status === 429) {
        const j = (await r.json().catch(() => ({}))) as { retry_after?: number };
        await attendre(Math.ceil((j.retry_after ?? 2) * 1000));
        continue;
      }
      if (!r.ok) throw new Error(`Discord HTTP ${r.status} : ${await r.text()}`);
      break;
    }
    await attendre(600);
  }
}
