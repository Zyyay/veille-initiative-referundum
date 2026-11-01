// Envoie un message de test sur le salon Discord configuré (DISCORD_WEBHOOK_URL).
import { loadConfig } from "../src/lib/config.js";
import { envoyer, COULEURS } from "../src/lib/discord.js";

loadConfig(); // réglages réseau
await envoyer([{
  title: "✅ Test de la veille Doléances",
  color: COULEURS.info,
  description: "Si tu lis ce message et que ton téléphone a sonné, le webhook et les notifications fonctionnent.",
}], true);
console.log("Message envoyé.");
