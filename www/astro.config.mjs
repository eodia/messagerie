// @ts-check
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://eodia.github.io',
	base: '/messagerie',
	integrations: [
		starlight({
			title: 'Messagerie',
			logo: {
				light: './src/assets/logo.svg',
				dark: './src/assets/logo-light.svg',
				alt: '',
			},
			favicon: '/favicon.svg',
			head: [
				{ tag: 'meta', attrs: { name: 'theme-color', content: '#143d2b' } },
				{ tag: 'meta', attrs: { name: 'author', content: 'Eodia' } },
				{ tag: 'link', attrs: { rel: 'author', href: 'https://eodia.com/fr/' } },
			],
			description:
				'La messagerie client libre : un agent IA en première ligne, un copilote pour les conseillers, tout réglé dans l’inbox.',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/eodia/messagerie' }],
			editLink: { baseUrl: 'https://github.com/eodia/messagerie/edit/main/www/' },
			components: { Footer: './src/components/DocsFooter.astro' },
			customCss: ['./src/styles/starlight-custom.css'],
			// French only, at the root.
			defaultLocale: 'root',
			locales: { root: { label: 'Français', lang: 'fr' } },
			sidebar: [
				{
					label: 'Pour commencer',
					items: [
						{ slug: 'guides/introduction' },
						{ slug: 'guides/installation' },
						{ slug: 'guides/premiers-pas' },
					],
				},
				{
					label: 'Fonctionnalités',
					items: [
						{ slug: 'fonctionnalites/inbox' },
						{ slug: 'fonctionnalites/widget' },
						{ slug: 'fonctionnalites/agent-ia' },
						{ slug: 'fonctionnalites/copilote' },
						{ slug: 'fonctionnalites/base-de-connaissance' },
						{ slug: 'fonctionnalites/outils-ia' },
						{ slug: 'fonctionnalites/pieces-jointes' },
						{ slug: 'fonctionnalites/contacts' },
						{ slug: 'fonctionnalites/alertes' },
						{ slug: 'fonctionnalites/statistiques' },
						{ slug: 'fonctionnalites/parametrage' },
						{ slug: 'fonctionnalites/conseillers-et-droits' },
					],
				},
				{
					label: 'Intégrations',
					items: [
						{ slug: 'integrations/api-javascript' },
						{ slug: 'integrations/identite-signee' },
						{ slug: 'integrations/api-rest' },
						{ slug: 'integrations/mcp' },
						{ slug: 'integrations/webhooks' },
					],
				},
				{
					label: 'Hébergement',
					items: [
						{ slug: 'hebergement/production' },
						{ slug: 'hebergement/comptes' },
						{ slug: 'hebergement/variables' },
					],
				},
				{
					label: 'Architecture',
					items: [{ slug: 'architecture/principes' }],
				},
			],
		}),
	],
});
