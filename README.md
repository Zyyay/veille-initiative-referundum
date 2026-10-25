# Veille Doléances

Bot de veille qui surveille Google News, Wikipédia et l'Assemblée nationale, rattache ce qu'il trouve aux sujets de Doléances et envoie des alertes sur Discord.

Le guide de mise en place complet est dans le document « Bot de veille Doléances — guide de mise en place ».

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm test` | Tests unitaires (aucun accès réseau) |
| `npm run simulation` | Simulation avec des données fictives : affiche les messages Discord sans rien envoyer |
| `npm run test:sources` | Vérifie que chaque source répond et montre ce que le bot en lit |
| `npm run groupes` | Liste les identifiants de groupes présents dans les scrutins |
| `npm run test:discord` | Envoie un message de test sur Discord |
| `npm run veille:dry` | Passage réel sur les sources, sans envoi Discord (stockage local si Supabase absent) |
| `npm run veille` | Passage complet (utilisé par GitHub Actions) |

## Fichiers à modifier

- `config/sujets.json` : tes sujets, leurs mots-clés, articles Wikipédia et positions déclarées.
- `config/groupes.json` : correspondance identifiant de groupe → sigle.
- `config/regles.json` : seuils, horaires, garde-fous.
- `config/medias.json` : médias nationaux (poids 1) et domaines exclus.
- `config/sources.json` : URL de l'open data de l'Assemblée (à vérifier à l'installation).
