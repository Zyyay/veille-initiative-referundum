import { env } from "./config.js";
import { attendre, recuperer } from "./http.js";

export interface Champ { name: string; value: string; inline?: boolean }
export interface Embed {
  title?: string; description?: string; url?: string; color?: number; fields?: Champ[];
  footer?: { text: string }; timestamp?: string;
}

export const COULEURS = { haute: 0xe03131, moyenne: 0xf08c00, basse: 0x1c7ed6, info: 0x868e96, tech: 0x495057 } as const;
export const PASTILLE: Record<string, string> = { haute: "🔴", moyenne: "🟠", basse: "🔵", info: "ℹ️" };

/** Limites de l'API Discord pour les embeds. */
export const LIMITES = { titre: 256, description: 4096, champs: 25, nomChamp: 256, valeurChamp: 1024, pied: 2048, totalMessage: 6000, embedsMessage: 10 } as const;

const LIEN_COMPLET = /^\[[^\]]*\]\([^)]*\)/;

/**
 * Coupe un texte à `n` caractères sans casser de lien Markdown ni de bloc de code :
 * par lignes entières si possible, sinon avant le lien entamé.
 */
export function couper(s: string, n: number): string {
  if (s.length <= n) return s;
  const bloc = s.startsWith("```");
  const max = n - 1 - (bloc ? 4 : 0); // place pour « … » et la fermeture du bloc de code
  let out = "";
  for (const l of s.split("\n")) {
    const cand = out ? `${out}\n${l}` : l;
    if (cand.length > max) break;
    out = cand;
  }
  if (!out) {
    out = s.slice(0, max);
    const ouvert = out.lastIndexOf("[");
    if (ouvert >= 0 && !LIEN_COMPLET.test(out.slice(ouvert))) out = out.slice(0, ouvert);
    out = out.trimEnd();
  }
  return `${out}…${bloc && (out.match(/```/g)?.length ?? 0) % 2 ? "\n```" : ""}`;
}

export const taille = (e: Embed) => (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0)
  + (e.fields ?? []).reduce((t, f) => t + f.name.length + f.value.length, 0);

/** Respecte les limites Discord : titre 256, description 4096, 25 champs de 1024, pied 2048, 6000 au total. */
export function borner(e: Embed): Embed {
  const out: Embed = { ...e };
  if (out.title) out.title = couper(out.title, LIMITES.titre);
  if (out.description) out.description = couper(out.description, LIMITES.description);
  if (out.footer) out.footer = { text: couper(out.footer.text, LIMITES.pied) };
  out.fields = (out.fields ?? []).slice(0, LIMITES.champs)
    .map((f) => ({ ...f, name: couper(f.name || "—", LIMITES.nomChamp), value: couper(f.value || "—", LIMITES.valeurChamp) }));
  let total = (out.title?.length ?? 0) + (out.description?.length ?? 0) + (out.footer?.text.length ?? 0);
  out.fields = out.fields.filter((f) => (total += f.name.length + f.value.length) <= LIMITES.totalMessage);
  return out;
}

/** Regroupe les embeds en messages de 10 embeds et 6000 caractères au plus. */
export function lots(embeds: Embed[]): Embed[][] {
  const out: Embed[][] = [];
  let courant: Embed[] = [], t = 0;
  for (const e of embeds.map(borner)) {
    const te = taille(e);
    if (courant.length && (courant.length >= LIMITES.embedsMessage || t + te > LIMITES.totalMessage)) { out.push(courant); courant = []; t = 0; }
    courant.push(e); t += te;
  }
  if (courant.length) out.push(courant);
  return out;
}

/** DISCORD_MENTION peut contenir un identifiant brut (que des chiffres) : il devient une mention d'utilisateur <@…>. */
export function mentionDiscord(brut = env.discordMention): string {
  const m = brut.trim();
  return /^\d+$/.test(m) ? `<@${m}>` : m;
}

export function mentionsAutorisees(mention: string) {
  const u = mention.match(/^<@!?(\d+)>$/), r = mention.match(/^<@&(\d+)>$/);
  if (u) return { users: [u[1]] };
  if (r) return { roles: [r[1]] };
  if (/@everyone|@here/.test(mention)) return { parse: ["everyone"] };
  return { parse: [] as string[] };
}

async function appel(url: string, methode: "POST" | "PATCH", corps: unknown) {
  for (let essai = 0; ; essai++) {
    // Pas de relance automatique sur un envoi : elle pourrait doubler le message. Seul le 429 est réessayé.
    const r = await recuperer(url, { method: methode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) }, { relances: 0 });
    if (r.status === 429 && essai < 2) {
      const j = (() => { try { return r.json<{ retry_after?: number }>(); } catch { return {}; } })() as { retry_after?: number };
      await attendre(Math.ceil((j.retry_after ?? 2) * 1000));
      continue;
    }
    return r;
  }
}

/** Envoie les embeds ; renvoie l'identifiant de chaque message créé (vide en mode essai). */
export async function envoyer(embeds: Embed[], mention = false, texte = ""): Promise<string[]> {
  const qui = mentionDiscord();
  const contenu = [mention ? qui : "", texte].filter(Boolean).join(" ");
  const paquets = lots(embeds);
  if (!paquets.length) paquets.push([]);
  const ids: string[] = [];
  for (const [i, lot] of paquets.entries()) {
    const corps = {
      username: "Veille Doléances",
      content: i === 0 ? contenu : "",
      embeds: lot,
      allowed_mentions: i === 0 && mention ? mentionsAutorisees(qui) : { parse: [] },
    };
    if (env.dryRun || !env.discordWebhook) {
      console.log("\n[DISCORD — essai, non envoyé]\n" + JSON.stringify(corps, null, 2));
      continue;
    }
    const r = await appel(`${env.discordWebhook}?wait=true`, "POST", corps);
    if (!r.ok) throw new Error(`Discord HTTP ${r.status} : ${r.texte().slice(0, 300)}`);
    const id = (() => { try { return r.json<{ id?: string }>().id; } catch { return undefined; } })();
    if (id) ids.push(id);
    await attendre(600);
  }
  return ids;
}

/** Remplace le contenu d'un message déjà envoyé par le webhook. Renvoie false si le message n'existe plus. */
export async function modifier(messageId: string, embeds: Embed[]): Promise<boolean> {
  const corps = { content: "", embeds: lots(embeds)[0] ?? [], allowed_mentions: { parse: [] } };
  if (env.dryRun || !env.discordWebhook) {
    console.log(`\n[DISCORD — essai, modification du message ${messageId}]\n` + JSON.stringify(corps, null, 2));
    return true;
  }
  const r = await appel(`${env.discordWebhook}/messages/${messageId}`, "PATCH", corps);
  if (r.status === 404) return false;
  if (!r.ok) throw new Error(`Discord HTTP ${r.status} (modification) : ${r.texte().slice(0, 300)}`);
  return true;
}
