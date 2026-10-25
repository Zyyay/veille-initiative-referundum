import type { Sujet } from "./lib/config.js";
import { COULEURS, PASTILLE, type Embed } from "./lib/discord.js";
import { formatDateHeure, formatHeure } from "./lib/time.js";
import type { ScorePresse } from "./scoring.js";
import type { AnalyseScrutin } from "./sources/an.js";
import type { Reunion } from "./sources/an.js";
import type { SignalWiki } from "./sources/wikipedia.js";

export function donnee(s: Sujet): string {
  const d = s.donnee;
  if (d.adhesion == null) return "Pas de sondage de référence pour ce sujet";
  const src = d.url ? `[${d.institut}, ${d.date}](${d.url})` : `${d.institut}, ${d.date}`;
  // La question exacte est affichée : un sondage peut ne couvrir qu'une partie du sujet.
  return d.question
    ? `**${d.adhesion} %** de réponses favorables (${src})\nQuestion : « ${d.question} »`
    : `**${d.adhesion} %** des Français favorables (${src})`;
}

const fr = (x: number) => x.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

const liens = (s: Sujet, extra: string[] = []) => [`[Page du sujet](${s.url})`, ...extra].join(" · ");

export function embedPresse(s: Sujet, sc: ScorePresse): Embed {
  const niv = sc.niveau ?? "basse";
  const h = sc.histoires[0];
  const sources = sc.histoires.flatMap((x) => x.articles).sort((a, b) => b.publie_le.localeCompare(a.publie_le)).slice(0, 4)
    .map((a) => `• [${a.source_nom || a.source_domaine}](${a.lien}) — ${formatHeure(new Date(a.publie_le))} — ${a.titre}`).join("\n");
  const ref = `${sc.articlesFenetre} articles en 3 h, ${sc.histoires.length} histoire(s), ${sc.medias.toLocaleString("fr-FR")} média(s) pondérés — ×${fr(sc.ratio)} la normale`
    + (sc.calibration ? ` _(historique de ${sc.historiqueJours} j : référence peu fiable)_` : "")
    + (sc.bonusWiki ? "\nWikipédia : consultations en hausse" : "");
  return {
    title: `${PASTILLE[niv]} ${s.titre}`,
    url: s.url,
    color: COULEURS[niv],
    description: h ? `**Ce qui se passe :** ${h.titre}` : undefined,
    fields: [
      { name: "Déclencheur", value: ref },
      { name: "Sources", value: sources || "—" },
      { name: "Ta donnée", value: donnee(s) },
      { name: "Liens", value: liens(s) },
    ],
    footer: { text: `presse · ${s.id}` },
  };
}

function ligneGroupe(g: AnalyseScrutin["groupes"][number]): string {
  const marques = [g.decisif ? "D" : "", g.sousParticipation ? "↓" : "", g.ecart ? "⚠" : ""].join("");
  const decl = g.positionDeclaree ? (g.positionDeclaree === "pour" ? "pour" : "contre") : "—";
  const pad = (x: string | number, k: number) => String(x).padStart(k);
  return `${g.sigle.slice(0, 10).padEnd(10)}${pad(g.pour, 5)}${pad(g.contre, 5)}${pad(g.abstentions, 5)}${pad(g.absents, 5)}  ${decl.padEnd(6)} ${marques}`;
}

export function niveauVote(a: AnalyseScrutin): "haute" | "moyenne" {
  return a.solennel || a.groupes.some((g) => g.decisif || g.ecart) ? "haute" : "moyenne";
}

export function embedVote(s: Sujet, a: AnalyseScrutin): Embed {
  const niv = niveauVote(a);
  const tableau = ["Groupe     Pour Ctre Abst Abs.  Décl.  ", ...a.groupes.map(ligneGroupe)].join("\n");
  const signaux = a.groupes.filter((g) => g.decisif || g.ecart || g.sousParticipation).map((g) => {
    const parts: string[] = [];
    if (g.decisif) parts.push(`aurait inversé le résultat si ses ${g.absents} absents et ${g.abstentions} abstentionnistes avaient voté comme la majorité du groupe (${g.positionMajoritaire})`);
    if (g.sousParticipation) parts.push(`participation ${(g.participation * 100).toFixed(0)} % contre ${((g.participationMoyenne ?? 0) * 100).toFixed(0)} % en moyenne`);
    if (g.ecart) parts.push(`${g.ecart} alors que la position déclarée est « ${g.positionDeclaree} »${g.sourceDeclaree ? ` ([source](${g.sourceDeclaree}))` : ""}`);
    return `• **${g.sigle}** : ${parts.join(" ; ")}`;
  }).join("\n");
  const dissidents = a.groupes.filter((g) => g.dissidents > 0).map((g) => `${g.sigle} (${g.dissidents})`).join(", ");
  return {
    title: `${PASTILLE[niv]} Vote — ${s.titre}`,
    url: a.lien,
    color: COULEURS[niv],
    description: `**${a.adopte ? "Adopté" : "Rejeté"}** (${a.pour} pour, ${a.contre} contre, ${a.abstentions} abst.) — ${a.typeVote || "scrutin public"} du ${a.date}\n${a.titre}`,
    fields: [
      { name: "Détail par groupe", value: "```\n" + tableau + "\n```" },
      { name: "Signaux", value: signaux || "Aucun signal particulier" },
      { name: "Votes différents de la majorité du groupe", value: dissidents || "Aucun" },
      { name: "Ta donnée", value: donnee(s) },
      { name: "À vérifier avant de réagir", value: "Sens du texte : ⚠ suppose que voter pour = aller dans le sens du sujet. Lis l'amendement et son exposé des motifs. Contexte de séance (classement A à E) : phase 2." },
      { name: "Liens", value: liens(s, [`[Scrutin n° ${a.numero}](${a.lien})`]) },
    ],
    footer: { text: `vote · ${a.uid} · D = vote décisif · ↓ = sous-participation · ⚠ = écart avec la position déclarée` },
  };
}

export interface Seance { debut: string; objet: string }

/** Un seul encadré pour toutes les séances budgétaires : une ligne par intitulé, avec ses dates. */
export function embedBudget(seances: Seance[]): Embed {
  const parObjet = new Map<string, string[]>();
  for (const s of [...seances].sort((a, b) => a.debut.localeCompare(b.debut))) {
    const k = s.objet.slice(0, 160);
    parObjet.set(k, [...(parObjet.get(k) ?? []), formatDateHeure(new Date(s.debut))]);
  }
  const lignes = [...parObjet].map(([objet, dates]) => `• ${objet} — ${dates.join(", ")}`);
  return { title: `ℹ️ Textes budgétaires à l'ordre du jour (${seances.length})`, color: COULEURS.info, description: lignes.join("\n").slice(0, 4000) };
}

export function embedAgenda(sujets: Sujet[], r: Reunion, nature: "nouveau" | "modifie" | "rappel", lien: string): Embed {
  const niv = nature === "rappel" ? "haute" : "info";
  const titre = nature === "rappel" ? `Séance dans moins d'une heure (${formatHeure(new Date(r.debut))})`
    : nature === "modifie" ? "Changement à l'ordre du jour" : "Nouvel événement à l'ordre du jour";
  return {
    title: `${PASTILLE[niv]} ${titre}`,
    url: lien,
    color: COULEURS[niv],
    description: `**${formatDateHeure(new Date(r.debut))}** — ${r.type === "seance" ? "séance publique" : r.type === "commission" ? "commission" : "réunion"}${r.lieu ? `, ${r.lieu}` : ""}${r.etat ? ` — état : ${r.etat}` : ""}`,
    fields: [
      { name: "Ordre du jour", value: r.objet },
      ...sujets.map((s) => ({ name: `Sujet : ${s.titre}`, value: `${donnee(s)}\n[Page du sujet](${s.url})` })),
      { name: "Liens", value: `[Agenda de l'Assemblée](${lien})` },
    ],
    footer: { text: `agenda · ${r.uid}` },
  };
}

export function embedWiki(s: Sujet, w: SignalWiki): Embed {
  return {
    title: `${PASTILLE.basse} Intérêt en hausse sur Wikipédia — ${s.titre}`,
    url: `https://fr.wikipedia.org/wiki/${encodeURIComponent(w.article.replace(/ /g, "_"))}`,
    color: COULEURS.basse,
    description: `« ${w.article} » : ${w.vues.toLocaleString("fr-FR")} consultations le ${w.jour}, ×${fr(w.ratio)} la médiane (${Math.round(w.reference)}).`,
    fields: [{ name: "Ta donnée", value: donnee(s) }, { name: "Liens", value: liens(s) }],
    footer: { text: `wiki · ${s.id}` },
  };
}

export function embedTech(lignes: string[]): Embed {
  return { title: "⚙️ Problèmes techniques pendant le passage", color: COULEURS.tech, description: lignes.slice(0, 15).map((l) => `• ${l}`).join("\n") };
}
