import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Position = "pour" | "contre" | "non_declaree";

export interface Sujet {
  id: string;
  actif: boolean;
  titre: string;
  url: string;
  donnee: { adhesion: number | null; institut: string; date: string; url: string; question?: string };
  requetes_gnews: string[];
  termes_forts: string[];
  termes_faibles: string[];
  termes_legislatifs: string[];
  wikipedia: string[];
  positions_declarees: Record<string, { position: Position; source: string; date: string }>;
}

export interface Regles {
  fuseau: string;
  plage_silencieuse: { debut: number; fin: number };
  heure_recap: number;
  presse: {
    fenetre_heures: number;
    jours_reference: number;
    fraicheur_max_heures: number;
    haute: { medias_min: number; ratio_min: number };
    moyenne: { histoires_min: number; ratio_min: number };
    similarite_titres: number;
    filtrer_par_titre: boolean;
    historique_min_jours: number;
  };
  wikipedia: { ratio_min: number; jours_reference: number };
  garde_fous: { delai_meme_sujet_heures: number; mentions_max_par_jour: number; peremption_recap_heures: number };
  agenda: { horizon_jours: number; rappel_minutes_avant: number; exclure_textes_budgetaires: boolean };
  scrutins: { jours_reference_participation: number; seuil_sous_participation: number };
}

export interface Medias { medias_nationaux: string[]; domaines_exclus: string[] }
export interface Sources { an_scrutins_zip: string; an_agenda_zip: string; an_page_scrutin: string; an_page_reunion: string }

export interface Config {
  sujets: Sujet[];
  regles: Regles;
  medias: Medias;
  groupes: Record<string, string>;
  sources: Sources;
}

const dir = process.env.CONFIG_DIR ?? join(process.cwd(), "config");
const read = <T>(f: string): T => JSON.parse(readFileSync(join(dir, f), "utf8")) as T;

export function loadConfig(): Config {
  // SUJETS_FILE : fichier de sujets fictifs pour les tests et la simulation.
  const fichierSujets = process.env.SUJETS_FILE ?? join(dir, "sujets.json");
  const sujets = (JSON.parse(readFileSync(fichierSujets, "utf8")) as { sujets: Sujet[] }).sujets.filter((s) => s.actif !== false);
  const ids = new Set<string>();
  for (const s of sujets) {
    if (ids.has(s.id)) throw new Error(`Identifiant de sujet en double : ${s.id}`);
    ids.add(s.id);
    if (!s.termes_forts?.length && (s.termes_faibles?.length ?? 0) < 2)
      throw new Error(`Sujet ${s.id} : il faut au moins un terme fort ou deux termes faibles`);
  }
  return {
    sujets,
    regles: read<Regles>("regles.json"),
    medias: read<Medias>("medias.json"),
    groupes: read<{ groupes: Record<string, string> }>("groupes.json").groupes,
    sources: read<Sources>("sources.json"),
  };
}

export const env = {
  dryRun: process.env.DRY_RUN === "1",
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  discordWebhook: process.env.DISCORD_WEBHOOK_URL ?? "",
  discordMention: process.env.DISCORD_MENTION ?? "@everyone",
  contact: process.env.CONTACT_EMAIL ?? "contact@doleances-france.fr",
  forcer: process.env.FORCER ?? "", // ex. "recap,wiki,agenda" pour lancer une tâche hors créneau
};
