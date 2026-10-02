/**
 * What every page of the site says the same way: the product's name, where its code lives,
 * who makes it. The product's name is a working name (`apps/web/src/lib/product.ts`):
 * naming it is a change to this file, and to `astro.config.mjs`.
 */
export const PRODUCT = 'Messagerie';
export const REPOSITORY = 'https://github.com/eodia/messagerie';
export const BASEDB = 'https://eodia.github.io/basedb/';
export const EODIA = 'https://eodia.com/fr/';

/** The site's own address of a page: `/guides/installation/` → `/messagerie/guides/installation/`. */
export function href(path: string): string {
	if (/^(https?:|mailto:|#)/.test(path)) return path;
	const base = import.meta.env.BASE_URL.replace(/\/$/, '');
	return `${base}${path}`;
}
