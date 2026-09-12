export interface RuleCard {
  number: string;
  title: string;
  body: string;
}
export interface Tab {
  id: string;
  label: string;
  icon: string;
  route: string;
  title: string;
}
/** The GitHub mark as an SVG path on a 16x16 box. */
export const GITHUB_MARK: string;
export const SITE: {
  name: string;
  title: string;
  tagline: string;
  description: string;
  repository: string;
  url: string;
  live: string;
  themeColor: string;
  icon: string;
  analytics: string;
};
export const RULE_CARDS: readonly RuleCard[];
export const HAZARD_CARDS: readonly RuleCard[];
export const RULES_NOTE: { title: string; body: string };
export function ruleCards(cards: readonly RuleCard[]): string;
export const TABS: readonly Tab[];
export const CONTROLLERS: { label: string; route: string };
export function normalizeRoute(route: string): string;
export function tabForRoute(route: string): Tab | null;
export const CONTRACT_CARD: string;
