// Pages that render without the app chrome (sidebar, bottom bar) and without
// a session: sign-in and the legal pages the bank-data provider links to.
// proxy.ts lets the same paths through unauthenticated.
export const CHROMELESS_PAGES = new Set(["/login", "/privacy", "/terms"]);
