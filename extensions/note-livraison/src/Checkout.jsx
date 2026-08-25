import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useRef, useState} from 'preact/hooks';

/**
 * Note de livraison au checkout.
 *
 * Le client saisit une consigne ; elle est enregistrée dans l'attribut de commande
 * `noteLivraison` et devient lisible dans « Détails supplémentaires » de la commande.
 *
 * Décisions structurantes, documentées dans .claude/features/feature-note-livraison :
 *
 *   - Clé NON préfixée, à l'encontre de la recommandation de la doc. Préfixer avec un
 *     nom d'organisation le ferait entrer dans des données de commande permanentes, sur
 *     un projet public. Écart assumé.
 *
 *   - DEUX mécanismes de défense pour DEUX causes distinctes, et il ne faut pas
 *     confondre le second avec du code mort :
 *       1. `canUpdateAttributes` faux  → on ne rend rien du tout.
 *       2. Instruction vraie MAIS écriture refusée → on affiche l'erreur.
 *     Le cas 2 est annoncé par le schéma livré : « Even when `true`, calls to
 *     `applyAttributeChange()` can still fail during accelerated checkout (Apple Pay,
 *     Google Pay). » Il n'a PAS pu être reproduit ici — Shop Pay écrit sans problème,
 *     et Apple/Google Pay ne sont pas testables sur cette boutique. C'est donc du code
 *     écrit sans avoir vu la panne. Ne pas le supprimer en le prenant pour inutile.
 */

const CLE = 'noteLivraison';

/**
 * Limite applicative, pas une limite de plateforme. Mesuré le 2026-08-24 : le plafond
 * réel se situe entre 1 000 et 5 000 caractères. 200 laisse de la marge tout en gardant
 * une consigne lisible en trois secondes sur un bon de préparation.
 */
const LONGUEUR_MAX = 200;

/**
 * Écrire à chaque frappe produirait une rafale d'appels réseau ; n'écrire qu'au blur
 * ferait perdre la saisie d'un client qui tape puis clique droit sur « Payer ». Le
 * délai couvre le cas courant, l'envoi au blur couvre le cas limite.
 */
const DELAI_DEBOUNCE = 500;

export default async () => {
  render(<NoteLivraison />, document.body);
};

function NoteLivraison() {
  // `null` tant que le client n'a pas tapé : on affiche alors la valeur enregistrée,
  // qui peut arriver après le premier rendu (les attributs sont un signal).
  const [saisie, setSaisie] = useState(null);
  const [erreur, setErreur] = useState(null);
  const minuterie = useRef(null);
  const derniereValeur = useRef('');

  const attributs = shopify.attributes.value ?? [];
  const valeurEnregistree = attributs.find((a) => a.key === CLE)?.value ?? '';
  const valeurAffichee = saisie === null ? valeurEnregistree : saisie;

  derniereValeur.current = valeurAffichee;

  // Mécanisme 1 — la configuration du checkout interdit l'écriture. Rien à afficher :
  // un champ qui n'enregistrerait rien serait un mensonge.
  if (!shopify.instructions.value?.attributes?.canUpdateAttributes) {
    return null;
  }

  return (
    <s-text-area
      // La limite est repliée dans le libellé, et non dans une propriété d'aide :
      // `s-text-area` n'accepte pas `details` (vérifié dans le schéma livré), et un
      // texte placé à côté du champ ne lui serait pas associé pour un lecteur d'écran.
      label={shopify.i18n.translate('label', {max: LONGUEUR_MAX})}
      value={valeurAffichee}
      maxLength={LONGUEUR_MAX}
      rows={2}
      error={erreur ?? undefined}
      onInput={surSaisie}
      onBlur={surSortieDuChamp}
    />
  );

  function surSaisie(evenement) {
    const valeur = (evenement.currentTarget.value ?? '').slice(0, LONGUEUR_MAX);
    setSaisie(valeur);
    derniereValeur.current = valeur;
    planifier(valeur);
  }

  function surSortieDuChamp() {
    // Le client peut quitter le champ et payer avant la fin du délai : on envoie tout
    // de suite plutôt que de courir après la minuterie.
    annulerMinuterie();
    envoyer(derniereValeur.current);
  }

  function planifier(valeur) {
    annulerMinuterie();
    minuterie.current = setTimeout(() => {
      minuterie.current = null;
      envoyer(valeur);
    }, DELAI_DEBOUNCE);
  }

  function annulerMinuterie() {
    if (minuterie.current) {
      clearTimeout(minuterie.current);
      minuterie.current = null;
    }
  }

  async function envoyer(valeurBrute) {
    const nettoyee = (valeurBrute ?? '').trim();
    const existeDeja = (shopify.attributes.value ?? []).some((a) => a.key === CLE);

    let changement;
    if (nettoyee) {
      changement = {type: 'updateAttribute', key: CLE, value: nettoyee};
    } else if (existeDeja) {
      // Effacement : sans cette branche, l'ancienne valeur survivrait à la suppression
      // et la commande porterait une consigne que le client croit avoir retirée.
      changement = {type: 'removeAttribute', key: CLE};
    } else {
      // Rien saisi, rien d'enregistré : trois espaces ne doivent pas créer un attribut
      // vide que le préparateur lirait comme un champ rempli.
      return;
    }

    try {
      const retour = await shopify.applyAttributeChange(changement);

      // Mécanisme 2 — voir l'en-tête de fichier. L'instruction peut valoir `true` et
      // l'écriture échouer malgré tout.
      if (retour?.type === 'error') {
        setErreur(shopify.i18n.translate('erreurEnregistrement'));
        console.error('[note-livraison] écriture refusée', retour.message);
        return;
      }

      setErreur(null);
    } catch (exception) {
      setErreur(shopify.i18n.translate('erreurEnregistrement'));
      console.error('[note-livraison] exception à l\'écriture', exception);
    }
  }
}
