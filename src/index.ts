import { env, loadConfig, type Config, type Sujet } from "./lib/config.js";
import { creerStore, type Store } from "./lib/store.js";
import { enPlageSilencieuse, formatDateHeure, minutesParis, parisParts } from "./lib/time.js";
import { envoyer, COULEURS, type Embed } from "./lib/discord.js";
import { collecterGoogleNews } from "./sources/gnews.js";
import { collecterWikipedia, type SignalWiki } from "./sources/wikipedia.js";
import { collecterAgenda, collecterScrutins, type Reunion } from "./sources/an.js";
import { scorerPresse, rang } from "./scoring.js";
import { embedAgenda, embedBudget, embedPresse, embedTech, embedVote, embedWiki, niveauVote, type Seance } from "./messages.js";
import { publier } from "./alerts.js";

const erreurs: string[] = [];
const log = (m: string) => { console.log(m); erreurs.push(m); };
const info = (m: string) => console.log(m);
const force = (t: string) => env.forcer.split(",").map((x) => x.trim()).includes(t);

async function tache(nom: string, f: () => Promise<void>) {
  try { info(`→ ${nom}`); await f(); }
  catch (e) { log(`${nom} : ${(e as Error).message}`); }
}

/* ---------- Wikipédia : une fois par jour, après 7 h 30 ---------- */
async function tacheWiki(cfg: Config, store: Store, now: Date, jour: string) {
  if (!force("wiki") && (minutesParis(now) < 450 || (await store.lireEtat<string>("wiki_jour")) === jour)) return;
  const signaux = await collecterWikipedia(cfg, store, log);
  const hausses = signaux.filter((s) => s.ratio >= cfg.regles.wikipedia.ratio_min);
  await store.ecrireEtat("wiki_bonus", { jour, sujets: [...new Set(hausses.map((h) => h.sujet_id))] });
  for (const w of hausses) {
    const sujet = cfg.sujets.find((s) => s.id === w.sujet_id)!;
    await publier({ cle: `wiki:${w.sujet_id}:${w.article}:${w.jour}`, sujet, type: "wiki", niveau: "basse", embeds: [embedWiki(sujet, w as SignalWiki)] }, cfg, store, now);
  }
  await store.purger().catch((e) => log(`Purge : ${(e as Error).message}`));
  await store.ecrireEtat("wiki_jour", jour);
  info(`  Wikipédia : ${signaux.length} articles suivis, ${hausses.length} en hausse`);
}

/* ---------- Google News : chaque passage ---------- */
async function tachePresse(cfg: Config, store: Store, now: Date, jour: string) {
  const articles = await collecterGoogleNews(cfg, log);
  const nouveaux = await store.ajouterArticles(articles);
  info(`  Google News : ${articles.length} articles rattachés, ${nouveaux} nouveaux`);
  const bonus = await store.lireEtat<{ jour: string; sujets: string[] }>("wiki_bonus");
  const depuis = new Date(now.getTime() - (cfg.regles.presse.jours_reference + 1) * 86400_000);
  const creneau = new Date(Math.floor(now.getTime() / 1_800_000) * 1_800_000).toISOString();
  const scores = [];
  for (const sujet of cfg.sujets) {
    const arts = await store.articlesDepuis(sujet.id, depuis);
    const sc = scorerPresse(arts, now, cfg, bonus?.jour === jour && bonus.sujets.includes(sujet.id), await store.premierArticle(sujet.id));
    scores.push({ sujet_id: sujet.id, articles_fenetre: sc.articlesFenetre, histoires: sc.histoires.length, medias: sc.medias,
      reference: sc.reference, ratio: Number(sc.ratio.toFixed(2)), bonus_wiki: sc.bonusWiki, historique_jours: sc.historiqueJours, niveau: sc.niveau });
    if (!sc.niveau || sc.niveau === "basse") continue; // le seul bonus Wikipédia est déjà signalé par la tâche Wikipédia
    const faits = sc.histoires.slice(0, 3).map((h) => `- ${h.titre} (${[...new Set(h.articles.map((a) => a.source_nom))].slice(0, 4).join(", ")})`).join("\n");
    const issue = await publier({
      cle: `presse:${sujet.id}:${creneau}`, sujet, type: "presse", niveau: sc.niveau, embeds: [embedPresse(sujet, sc)],
      faits: `Couverture médiatique en hausse (${sc.articlesFenetre} articles en 3 h) :\n${faits}`,
      dernier: sc.histoires.map((h) => h.dernier).sort().at(-1),
    }, cfg, store, now);
    info(`  ${sujet.id} : niveau ${sc.niveau} → ${issue}`);
  }
  await store.ajouterScores(scores);
}

/* ---------- Scrutins : chaque passage, téléchargement seulement si le fichier a changé ---------- */
async function tacheScrutins(cfg: Config, store: Store, now: Date, jour: string) {
  const res = await collecterScrutins(cfg, store);
  if (res.inchange) { info("  Scrutins : fichier inchangé"); return; }
  const premier = !(await store.lireEtat<boolean>("scrutins_initialise"));
  for (const { sujet, analyse } of res.analyses) {
    const niveau = niveauVote(analyse);
    const lignes = analyse.groupes.map((g) => `${g.sigle} : ${g.pour} pour, ${g.contre} contre, ${g.abstentions} abstentions, ${g.absents} absents${g.positionDeclaree ? ` (position déclarée : ${g.positionDeclaree})` : ""}`).join("\n");
    await publier({
      cle: `vote:${analyse.uid}:${sujet.id}`, sujet, type: "vote", niveau, embeds: [embedVote(sujet, analyse)],
      faits: `Scrutin public du ${analyse.date} : ${analyse.titre}\nRésultat : ${analyse.adopte ? "adopté" : "rejeté"} (${analyse.pour} pour, ${analyse.contre} contre)\n${lignes}`,
      dernier: new Date(analyse.date).toISOString(), forcerAttente: premier,
    }, cfg, store, now);
  }
  await store.ecrireEtat("scrutins_initialise", true);
  if (res.refsInconnues.length) {
    const deja = await store.lireEtat<string>("groupes_inconnus_signal");
    if (deja !== jour) { log(`Groupes non renseignés dans config/groupes.json : ${res.refsInconnues.join(", ")}`); await store.ecrireEtat("groupes_inconnus_signal", jour); }
  }
  info(`  Scrutins : ${res.analyses.length} scrutin(s) récents rattachés à un sujet`);
}

/* ---------- Agenda : à 8 h et à 14 h ---------- */
async function tacheAgenda(cfg: Config, store: Store, now: Date, jour: string) {
  const h = parisParts(now, cfg.regles.fuseau).h;
  const creneau = h >= 14 ? `${jour}-14` : h >= 8 ? `${jour}-8` : null;
  if (!force("agenda") && (!creneau || (await store.lireEtat<string>("agenda_creneau")) === creneau)) return;
  const evts = await collecterAgenda(cfg, store);
  if (evts === null) { info("  Agenda : fichier inchangé"); }
  else {
    const premier = !(await store.lireEtat<boolean>("agenda_initialise"));
    const connus = new Map((await store.agendaTous()).map((a) => [a.uid, a]));
    for (const { reunion: r, sujets, budget } of evts) {
      const prec = connus.get(r.uid);
      const lien = cfg.sources.an_page_reunion;
      if (budget) {
        await publier({ cle: `budget:${r.uid}`, sujet: null, type: "budget", niveau: "info", forcerAttente: true, seance: { debut: r.debut, objet: r.objet },
          embeds: [{ title: "ℹ️ Texte budgétaire à l'ordre du jour", color: COULEURS.info, description: `**${formatDateHeure(new Date(r.debut))}** — ${r.objet.slice(0, 1500)}` }] }, cfg, store, now);
      } else if (!prec) {
        await publier({ cle: `agenda:${r.uid}`, sujet: sujets[0], type: "agenda", niveau: "info", forcerAttente: premier,
          embeds: [embedAgenda(sujets, r, "nouveau", lien)] }, cfg, store, now);
      } else if (prec.debut !== r.debut || prec.etat !== r.etat) {
        await publier({ cle: `agenda_modif:${r.uid}:${r.debut}:${r.etat}`, sujet: sujets[0] ?? null, type: "agenda_modif", niveau: "info",
          embeds: [embedAgenda(sujets, r, "modifie", lien)] }, cfg, store, now);
      }
      await store.enregistrerAgenda({ ...r, sujets: sujets.map((s) => s.id) });
    }
    await store.ecrireEtat("agenda_initialise", true);
    info(`  Agenda : ${evts.length} événement(s) rattaché(s)`);
  }
  if (creneau) await store.ecrireEtat("agenda_creneau", creneau);
}

/* ---------- Rappel 1 h avant une séance publique liée à un sujet ---------- */
async function tacheRappels(cfg: Config, store: Store, now: Date) {
  const avance = (cfg.regles.agenda.rappel_minutes_avant + 30) * 60_000;
  for (const a of await store.agendaTous()) {
    const delta = +new Date(a.debut) - now.getTime();
    if (a.type !== "seance" || /suppr|annul/i.test(a.etat) || !a.sujets.length || delta <= 0 || delta > avance) continue;
    const sujets = a.sujets.map((id) => cfg.sujets.find((s) => s.id === id)).filter((s): s is Sujet => !!s);
    if (!sujets.length) continue;
    const r: Reunion = { uid: a.uid, debut: a.debut, lieu: a.lieu, type: "seance", objet: a.objet, etat: a.etat };
    await publier({ cle: `rappel:${a.uid}`, sujet: sujets[0], type: "rappel", niveau: "haute",
      embeds: [embedAgenda(sujets, r, "rappel", cfg.sources.an_page_reunion)],
      faits: `Séance publique à ${formatDateHeure(new Date(a.debut))}. Ordre du jour : ${a.objet.slice(0, 800)}` }, cfg, store, now);
  }
}

/* ---------- Récapitulatif de 8 h ---------- */
async function tacheRecap(cfg: Config, store: Store, now: Date, jour: string) {
  const { h } = parisParts(now, cfg.regles.fuseau);
  if (!force("recap") && (h < cfg.regles.heure_recap || enPlageSilencieuse(now, cfg.regles.plage_silencieuse.debut, cfg.regles.plage_silencieuse.fin, cfg.regles.fuseau)
    || (await store.lireEtat<string>("recap_jour")) === jour)) return;
  const attente = await store.alertesEnAttente();
  const perime = (d: unknown) => typeof d === "string" && now.getTime() - +new Date(d) > cfg.regles.garde_fous.peremption_recap_heures * 3600_000;
  const aEcarter = attente.filter((a) => a.type === "presse" && perime(a.payload.dernier));
  const garder = attente.filter((a) => !aEcarter.includes(a)).sort((a, b) => rang(b.niveau) - rang(a.niveau));
  const auj = (await store.agendaTous()).filter((a) => a.sujets.length && parisParts(new Date(a.debut), cfg.regles.fuseau).jour === jour)
    .sort((a, b) => a.debut.localeCompare(b.debut));
  const compte = (n: string) => garder.filter((a) => a.niveau === n).length;
  const entete: Embed = {
    title: `☀️ Récapitulatif du ${jour.split("-").reverse().join("/")}`,
    color: COULEURS.info,
    description: [
      garder.length ? `Alertes en attente : ${compte("haute")} haute(s), ${compte("moyenne")} moyenne(s), ${compte("basse")} basse(s), ${compte("info")} information(s).` : "Rien à signaler depuis hier soir.",
      auj.length ? `\n**Aujourd'hui à l'Assemblée :**\n${auj.map((a) => `• ${formatDateHeure(new Date(a.debut))} — ${a.type === "seance" ? "séance" : "commission"} — sujets : ${a.sujets.join(", ")}`).join("\n")}` : "",
      aEcarter.length ? `\n_${aEcarter.length} alerte(s) presse de plus de ${cfg.regles.garde_fous.peremption_recap_heures} h écartée(s)._` : "",
    ].filter(Boolean).join("\n"),
  };
  // Les séances budgétaires sont regroupées en un seul encadré au lieu d'un par séance.
  const budgets = garder.filter((a) => a.type === "budget" && a.payload.seance);
  const autres = garder.filter((a) => !budgets.includes(a));
  const embeds = [entete, ...(budgets.length ? [embedBudget(budgets.map((a) => a.payload.seance as Seance))] : []),
    ...autres.flatMap((a) => (a.payload.embeds as Embed[]) ?? [])];
  await envoyer(embeds, garder.some((a) => a.niveau === "haute"));
  await store.marquerAlertes(garder.map((a) => a.cle), "envoyee");
  await store.marquerAlertes(aEcarter.map((a) => a.cle), "ecartee");
  await store.ecrireEtat("recap_jour", jour);
}

/* ---------- Programme principal ---------- */
async function main() {
  const now = new Date();
  const cfg = loadConfig();
  const store = creerStore();
  const jour = parisParts(now, cfg.regles.fuseau).jour;
  info(`Veille Doléances — ${formatDateHeure(now)} (Paris) — ${cfg.sujets.length} sujet(s)${env.dryRun ? " — MODE ESSAI" : ""}`);

  await tache("Wikipédia", () => tacheWiki(cfg, store, now, jour));
  await tache("Google News", () => tachePresse(cfg, store, now, jour));
  await tache("Scrutins", () => tacheScrutins(cfg, store, now, jour));
  await tache("Agenda", () => tacheAgenda(cfg, store, now, jour));
  await tache("Rappels", () => tacheRappels(cfg, store, now));
  await tache("Récapitulatif", () => tacheRecap(cfg, store, now, jour));

  if (erreurs.length) {
    const deja = (await store.lireEtat<{ jour: string; vus: string[] }>("tech_signales").catch(() => null)) ?? { jour, vus: [] };
    const vus = deja.jour === jour ? deja.vus : [];
    const nouveaux = erreurs.filter((e) => !vus.includes(e.slice(0, 120)));
    if (nouveaux.length && !enPlageSilencieuse(now, cfg.regles.plage_silencieuse.debut, cfg.regles.plage_silencieuse.fin, cfg.regles.fuseau)) {
      await envoyer([embedTech(nouveaux)]).catch((e) => console.error("Envoi Discord impossible :", e));
      await store.ecrireEtat("tech_signales", { jour, vus: [...vus, ...nouveaux.map((e) => e.slice(0, 120))] }).catch(() => {});
    }
  }
  info(`Terminé — ${erreurs.length} problème(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
