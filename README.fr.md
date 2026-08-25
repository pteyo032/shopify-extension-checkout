<p align="right"><a href="README.md">Read in English</a></p>

# Shopify Delivery Note

Un champ au checkout qui permet au client de laisser une consigne de livraison — un code
de portail, « sonner chez le voisin » — et l'enregistre sur la commande, là où le
marchand la lira vraiment.

Construit en app **extension-only** : une Checkout UI extension, pas de serveur, pas
d'hébergement. Elle se rend dans le checkout de Shopify et écrit dans un attribut de
panier via l'API Attributes.


![Le champ de consigne de livraison dans le checkout Shopify : une zone de texte intitulée « Delivery instructions (200 characters maximum) », placée entre la case d'abonnement e-mail et la section de livraison, avec le même style que les autres champs du checkout](docs/screenshots/checkout-delivery-note.png)

## Le problème

Le client détient une information dont le marchand a besoin, et aucun endroit où la
mettre. Il l'écrit dans le mauvais champ, l'envoie par e-mail après coup, ou ne l'envoie
pas — et le colis revient.

La solution évidente consistait autrefois à modifier `checkout.liquid`. Cette porte est
fermée, et la suite de ce README explique pourquoi c'est une bonne nouvelle.

## Fonctionnement

L'extension cible `purchase.checkout.block.render`, un **block target** : le marchand la
positionne où il veut depuis l'éditeur de checkout. L'app recommande `DELIVERY2` — sous
les méthodes de livraison — via `default_placement`, mais la position finale lui
appartient.

Le client saisit ; la valeur est écrite dans l'attribut de panier `noteLivraison` et
apparaît sous **Détails supplémentaires** de la commande.

L'écriture est débouncée à 500 ms, avec un envoi lorsque le champ perd le focus. À
chaque frappe, ce serait une rafale d'appels réseau ; au blur seulement, un client qui
tape puis clique droit sur « Payer » perdrait sa saisie.

### Les trois branches d'écriture

La saisie est trimée avant toute décision :

| Saisie après trim | Action |
| --- | --- |
| Contenu | `updateAttribute` |
| Vide, un attribut existe | `removeAttribute` |
| Vide, rien d'enregistré | Aucun appel |

La branche du milieu compte plus qu'il n'y paraît. Sans elle, un client qui efface le
champ expédierait quand même une commande portant l'ancienne consigne : il croirait
l'avoir retirée, et le préparateur continuerait de la lire. La troisième branche est ce
qui empêche trois espaces de créer un attribut invisible, lu comme un champ rempli.

### Deux défenses, deux causes distinctes

**La configuration du checkout interdit l'écriture** — `canUpdateAttributes` vaut faux.
Le composant ne rend rien. Un champ qui jette silencieusement ce qu'on y tape est pire
que pas de champ du tout.

**L'instruction dit oui et l'écriture échoue quand même.** Le schéma livré est explicite :

> Even when `true`, calls to `applyAttributeChange()` can still fail during accelerated
> checkout (Apple Pay, Google Pay).

Tester l'instruction ne suffit donc pas. Quand une écriture est refusée, l'échec est
rendu visible sur le champ lui-même via la propriété `error`, qui le met en évidence
**et** annonce le message aux lecteurs d'écran.

Ce second chemin n'a pas pu être reproduit pendant les tests — Shop Pay écrit sans
problème, et Apple Pay comme Google Pay ne sont pas testables sur une boutique de
développement. **C'est du code écrit sans avoir observé la panne**, sur la foi du
schéma. Un commentaire en tête du fichier source le dit, pour que personne ne le
supprime en le prenant pour du code mort.

## Pourquoi pas `checkout.liquid`

Les marchands Shopify Plus disposaient autrefois d'un gabarit `checkout.liquid`,
modifiable comme n'importe quel fichier de thème. Il est déprécié, et les raisons
méritent d'être dites clairement : elles expliquent la forme de tout ce qui précède.

**Shopify ne pouvait plus rien livrer.** Un checkout dont le balisage a été réécrit à la
main ne peut pas être mis à jour sans risquer de casser la boutique de quelqu'un. Chaque
amélioration de la plateforme attendait que chacun adapte son fichier.

**La sécurité et la conformité n'étaient pas garantissables.** Une page de paiement
assemblée à partir de code marchand arbitraire est une page que personne ne peut
certifier.

**Les mises à niveau étaient à la charge du marchand.** Nouveaux moyens de paiement,
correctifs d'accessibilité, traductions — tout devait être réimplémenté boutique par
boutique.

La Checkout Extensibility inverse le contrat : Shopify possède la page, les apps
fournissent des composants à des emplacements définis. Le marchand ne peut pas casser le
checkout, Shopify peut le faire évoluer, et l'extension continue de fonctionner.

Le prix est réel, et visible dans ce dépôt. **Pas de CSS arbitraire** — le champ est un
`s-text-area` et ressemble au reste du checkout parce que son style ne nous appartient
pas. **Pas de position arbitraire** — c'est le marchand qui place le bloc. **Pas d'API
arbitraire** — les attributs s'écrivent par une méthode supportée, qui peut refuser et
qui refuse. Ces contraintes sont exactement ce qui permet à l'extension de survivre à
une mise à jour du checkout qui aurait cassé un gabarit Liquid.

## Configuration marchand

Deux réglages font disparaître le champ en silence. Aucun ne produit d'erreur, et les
deux ont leur place dans un document de passation.

**« Inclure le bloc dans Shop Pay »** — désactivé par défaut, dans les réglages du bloc
au sein de l'éditeur de checkout. Laissé éteint, les commandes Shop Pay ne collectent
aucune consigne de livraison.

**Le placement du bloc** — le champ n'existe que là où le marchand l'a mis. Retirer le
bloc retire la fonctionnalité.

Autre chose à savoir : rien n'empêche un marchand de poser deux fois le même bloc, ce
qui affiche deux champs identiques écrivant sur la même clé. Les données restent
correctes — la dernière écriture gagne — mais c'est déroutant. S'en protéger dans le
code supposerait que chaque instance revendique sa place via le panier : c'est racé, ça
pollue les données de commande, et dans le pire des cas le client n'aurait aucun champ.
Échanger un désagrément visible contre une panne silencieuse est un mauvais marché ;
le nombre de blocs reste donc l'affaire du marchand.

## Compromis assumés

**La clé d'attribut n'est pas préfixée.** La documentation de Shopify recommande de
préfixer les clés pour éviter les collisions entre extensions. `noteLivraison` ne l'est
pas : l'alternative faisait entrer un nom d'organisation dans des données de commande
permanentes, sur un dépôt public, et un marchand qui lit `noteLivraison` dans l'admin
comprend ce qu'il voit. Le risque de collision est assumé.

**Un attribut, pas la note de commande.** La note est un champ unique et partagé —
n'importe quelle autre app qui y écrit entre en collision. Une clé nommée, non. Le coût
en visibilité s'est révélé bien moindre que supposé : **Détails supplémentaires**
s'affiche directement sous **Notes** dans la colonne de la commande, sans être enfoui
plus bas.

**Aucune alerte marchand en cas d'échec d'écriture.** L'app est extension-only, sans
serveur : rien ne peut remonter une anomalie. Une note qui ne s'enregistre pas est
indistinguable d'une commande qui n'en a jamais eu. C'est une contrainte
d'architecture, pas un oubli.

## Ce qui n'est pas couvert

- Apple Pay et Google Pay n'ont jamais été exercés — aucun portefeuille disponible sur
  une boutique de développement. Le chemin d'échec en checkout accéléré reste plausible
  et non observé.
- Aucune logique de tarification. Une option payante — un emballage cadeau facturé, par
  exemple — demande une Function ou une cart transform, pas ceci.
- Aucune validation bloquante. Le champ n'empêche jamais le checkout d'aboutir.

## Développement local

```shell
shopify app dev
```

Pour un block target, ajouter `?placement-reference=DELIVERY2` à l'URL du checkout
permet de prévisualiser un emplacement précis sans toucher à l'éditeur.

À savoir : un aperçu de développement et un bloc placé dans l'éditeur injectent tous
deux l'extension, si bien que le champ apparaît en double tant que `shopify app dev`
tourne. Un déploiement fait disparaître le doublon.

```shell
shopify app deploy
```

## Stack

Preact, `@shopify/ui-extensions` 2026.7, version d'API 2026-07. Pas de serveur, aucune
dépendance tierce.
