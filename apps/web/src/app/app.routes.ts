import { type Routes } from '@angular/router';
import { SITE } from '../../../../packages/site/content.js';
import { ArenaPage } from './arena/arena-page';

// The arena is the entry and stays in the initial bundle; the rest is lazy.
export const routes: Routes = [
  { path: '', component: ArenaPage, title: SITE.title },
  {
    path: 'lab',
    loadComponent: () => import('./lab/lab-page').then((m) => m.LabPage),
    title: 'Write a robot controller - llms-robot-arena',
  },
  {
    path: 'tournament',
    loadComponent: () => import('./tournament/tournament-page').then((m) => m.TournamentPage),
    title: 'Published standings - llms-robot-arena',
  },
  {
    path: 'rules',
    loadComponent: () => import('./rules/rules-page').then((m) => m.RulesPage),
    title: 'Arena rules and engine constants - llms-robot-arena',
  },
  { path: '**', redirectTo: '' },
];
