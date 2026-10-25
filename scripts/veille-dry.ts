// Passage réel sur les sources, sans envoi Discord. Remplace « DRY_RUN=1 tsx … », qui ne marche pas sous Windows.
// Lancement : npm run veille:dry
process.env.DRY_RUN = "1";
await import("../src/index.js");
export {};
