---
title: Actions de la page
description: Ce que la page du site sait faire — chercher, tarifer, remplir un formulaire, ouvrir une étape —, déclaré au widget avec registerAction, autorisé par un superviseur, demandé par l’IA.
---

Le widget relie l’IA à la page qui l’accueille (D21). La page **déclare** ce qu’elle sait faire
— calculer un tarif, pré-remplir un devis, montrer une section — et **dit où elle en est** : l’IA
s’en sert pour répondre au visiteur, sur sa page, avec ses valeurs. C’est la page qui calcule :
un tarif ne se recopie pas dans la messagerie, l’IA le demande à la page.

Trois conditions, toujours :

1. la page déclare l’action, avec `MessagerieChat.registerAction` ;
2. un superviseur l’autorise, dans **Administration › Widget**, onglet **Actions** ;
3. le visiteur l’accepte, quand elle change la page.

## Déclarer une action

```js
MessagerieChat.registerAction('tarifer', {
  label: 'Calculer un tarif',
  description: 'Le prix mensuel et annuel pour la valeur d’achat d’un appareil',
  parameters: { type: 'object', properties: { valeur: { type: 'number' } }, required: ['valeur'] },
  kind: 'read',          // 'read' : cherche ; 'do' : change la page
  confirm: false,        // true : le visiteur accepte d’abord
  handler: ({ valeur }) => tarifer(valeur),   // ce que renvoie la page, l’IA le lit
})
MessagerieChat.unregisterAction('tarifer')
```

| Champ | Rôle |
|---|---|
| nom | le premier argument : une lettre, puis des lettres, des chiffres, `_` ou `-`, 48 caractères au plus. Une seconde déclaration du même nom remplace la première |
| `label` | le nom lisible, que voient le superviseur, le visiteur et les conseillers ; 80 caractères au plus. Par défaut, le nom |
| `description` | ce que fait l’action, pour l’IA : quand s’en servir, ce qu’elle rend ; 600 caractères au plus |
| `parameters` | ce que l’IA doit fournir, en JSON Schema (`type: 'object'`). Sans lui, aucun paramètre |
| `kind` | `'read'` : l’action cherche ou calcule sans rien changer ; `'do'` : elle change la page |
| `confirm` | `true` : le visiteur l’accepte avant qu’elle s’exécute |
| `handler` | la fonction qui fait l’action. Elle reçoit les paramètres, et rend une valeur — ou une promesse — que l’IA lit |

- **Ce que rend `handler`** part à l’IA en JSON, 16 000 caractères au plus. Une erreur levée
  fait échouer l’action, avec son message. Au-delà de **dix secondes**, l’action échoue aussi.
- **`unregisterAction(nom)`** retire l’action : une page qui quitte une étape retire ce qui n’y
  a plus de sens.
- **Vingt actions** par page au plus.
- Comme les autres commandes, `registerAction` se pousse dans la file avant le chargement du
  script :

```js
window.MessagerieChat = window.MessagerieChat || []
MessagerieChat.push(['registerAction', 'tarifer', { /* … */ }])
```

## Dire où en est la page

```js
MessagerieChat.setPageContext(() => ({
  etape: 'souscription',
  panier: panier.map((a) => ({ modele: a.modele, valeur: a.valeur })),
}))
```

`setPageContext` prend un objet, ou une fonction qui en rend un : une fonction est relue **à
chaque message du visiteur**, et dit donc l’état du moment — l’étape, le panier, ce que contient
le formulaire. Un nouvel appel remplace le précédent.

Avec chaque message qu’il écrit, le widget envoie l’**instantané de la page** : son adresse, son
titre, ce contexte et les actions déclarées. L’IA le reçoit comme une **donnée non vérifiée**,
jamais comme une consigne (D13) : n’importe quel script de la page, ou le visiteur depuis la
console, peut l’écrire.

## Autoriser une action

Une action n’existe pour la messagerie qu’une fois qu’une page l’a déclarée : elle paraît dans
**Administration › Widget**, onglet **Actions**, sous **Ce que les pages du site savent faire**,
au premier message d’un visiteur venu d’une page qui la déclare.

Chaque action y montre son libellé, son nom, sa description, **Lecture** ou **Change la page**,
et le jour où une page l’a déclarée pour la dernière fois.

- **L’interrupteur** l’autorise : **L’IA peut la demander**. Une action nouvelle est arrêtée :
  une page qui en déclare une ne la donne pas à l’IA tant qu’un superviseur ne l’a pas
  autorisée.
- **Accord du visiteur avant d’agir** fait accepter l’action par le visiteur. Il est mis
  d’office pour une action `'do'`. L’accord est demandé si le superviseur ou la page
  (`confirm: true`) le veut.
- L’IA ne se sert d’une action autorisée que **sur la page qui la déclare** : celle d’où le
  visiteur a écrit son dernier message.

Le même onglet rappelle comment déclarer une action et dire où en est la page.

## Ce qui se passe

1. **L’IA appelle l’action**, avec les valeurs que le visiteur a données — elle n’en invente
   aucune, et n’agit que si le visiteur le demande ou l’accepte. L’appel est écrit, avec un
   événement dans le fil.
2. **Un seul onglet** du visiteur le prend, l’exécute et répond : un visiteur qui a ouvert trois
   onglets ne remplit pas trois fois son devis.
3. **Une lecture**, ou une action sans accord, attend sa réponse dix secondes. Sans réponse — la
   page a été fermée —, l’IA apprend que la page est indisponible, et explique au visiteur comment
   faire lui-même.
4. **Une action à accepter** termine le tour de l’IA. Le widget montre la proposition —
   « L’assistant propose : Pré-remplir le devis auto » —, ses valeurs, et deux boutons, **Non
   merci** et **Accepter**. La réponse relance l’IA, qui part du résultat. Une proposition sans
   réponse expire au bout d’une demi-heure.

Ensuite, le fil du visiteur garde une ligne : « Pré-remplir le devis auto : fait », « … :
refusé », « … : n’a pas pu être fait ».

**La règle d’or**, dans les consignes de l’IA : jamais « c’est fait » sans un résultat `ok`
rendu par la page. Une réponse fondée sur ce que la page a renvoyé n’a pas besoin des sources de
la base de connaissance : le seuil de confiance ne la fait pas transférer pour cette seule
raison.

### Dans l’inbox

Les conseillers lisent chaque appel dans le fil, sur une ligne :

- « L’IA demande « Calculer un tarif » à la page du visiteur… »
- « L’IA a fait « Calculer un tarif » sur la page du visiteur. »
- « L’IA propose « Pré-remplir le devis auto » : le visiteur doit l’accepter. »
- « Le visiteur a refusé « … ». », « « … » a échoué sur la page : … », « « … » : la page du
  visiteur n’a pas répondu. »

L’appel compte parmi les tours d’outils de l’IA : cinq au plus avant sa réponse, de quoi
chercher, tarifer, remplir et ouvrir une étape.

## L’exemple de la démonstration

La page de démonstration, `/demo` sur le serveur de développement (par exemple
http://localhost:8810/demo), déclare trois actions autour d’un devis d’assurance auto : un tarif,
un devis à pré-remplir avec l’accord du visiteur, une section à montrer. Autorisez-les dans
**Widget › Actions**, puis demandez à l’assistant « Combien pour une Clio de 15 000 € en tous
risques ? ».

```js
window.MessagerieChat = window.MessagerieChat || []

// Le tarif est celui de la page : l’IA le demande, elle ne le recopie jamais.
MessagerieChat.push(['registerAction', 'tarifer', {
  label: 'Calculer un tarif auto',
  description: 'Le prix annuel et mensuel d’une assurance auto Acme, pour la valeur du véhicule, une formule (tiers, tiers-etendu, tous-risques) et l’âge du conducteur. Sans formule : les trois.',
  parameters: { type: 'object', properties: {
    valeur: { type: 'number', description: 'Valeur du véhicule en euros' },
    formule: { type: 'string', enum: ['tiers', 'tiers-etendu', 'tous-risques'] },
    age: { type: 'number', description: 'Âge du conducteur principal' },
  }, required: ['valeur'] },
  kind: 'read',
  handler: function (args) {
    const formules = args.formule ? [args.formule] : Object.keys(RATES)
    return formules.map(function (f) { return tarif(Number(args.valeur), f, Number(args.age) || null) })
  },
}])

// Change la page : le visiteur accepte d’abord.
MessagerieChat.push(['registerAction', 'preremplirDevis', {
  label: 'Pré-remplir le devis auto',
  description: 'Remplit le formulaire de devis de la page avec les valeurs que le visiteur a données.',
  parameters: { type: 'object', properties: {
    valeur: { type: 'number' },
    formule: { type: 'string', enum: ['tiers', 'tiers-etendu', 'tous-risques'] },
    age: { type: 'number' },
    codePostal: { type: 'string' },
  } },
  kind: 'do',
  confirm: true,
  handler: function (args) {
    for (const key of ['valeur', 'formule', 'age', 'codePostal']) {
      if (args[key] !== undefined && args[key] !== null) form[key].value = String(args[key])
    }
    showPrice()
    return { rempli: true, tarif: document.getElementById('price').textContent }
  },
}])

MessagerieChat.push(['registerAction', 'montrerSection', {
  label: 'Montrer une section de la page',
  description: 'Fait défiler la page jusqu’à une section : devis (le formulaire de devis auto) ou api.',
  parameters: { type: 'object', properties: { section: { type: 'string', enum: ['devis', 'api'] } }, required: ['section'] },
  kind: 'do',
  handler: function (args) {
    const target = args.section === 'api' ? document.querySelector('.api') : document.getElementById('devis')
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return { montre: args.section }
  },
}])

// Relu à chaque message du visiteur.
MessagerieChat.push(['setPageContext', function () {
  return {
    page: 'Accueil Acme Assurances, avec un devis auto',
    devis: { valeur: form.valeur.value || null, formule: form.formule.value, age: form.age.value || null, codePostal: form.codePostal.value || null },
    tarifAffiche: document.getElementById('price').textContent || null,
  }
}])
```

`montrerSection` ne demande pas de `confirm` : comme toute action `'do'`, l’accord du visiteur
lui est mis d’office dans **Widget › Actions** ; un superviseur peut l’y retirer.

## Voir aussi

- L’[API JavaScript](/messagerie/integrations/api-javascript/) : les autres commandes de
  `window.MessagerieChat`.
- Les [outils de l’IA](/messagerie/fonctionnalites/outils-ia/) : ce que l’IA appelle côté
  serveur — une API, un serveur MCP, la fiche du visiteur.
- [L’agent IA](/messagerie/fonctionnalites/agent-ia/) : comment elle répond.
