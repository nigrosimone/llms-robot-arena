import { Routes } from '@angular/router';
import { ArenaPage } from './arena/arena-page';

// The arena is the entry and stays in the initial bundle; the rest is lazy.
export const routes: Routes = [
  { path: '', component: ArenaPage, title: 'llms-robot-arena — Autonomous combat lab' },
  { path: 'lab', loadComponent: () => import('./placeholder-page').then((m) => m.PlaceholderPage), title: 'Bot Lab', data: { title: 'Your code. Your robot', eyebrow: 'CONTROLLER WORKSPACE / 02' } },
  { path: 'tournament', loadComponent: () => import('./placeholder-page').then((m) => m.PlaceholderPage), title: 'Tournament', data: { title: 'Earn your ranking', eyebrow: 'TOURNAMENT / 03' } },
  { path: 'rules', loadComponent: () => import('./placeholder-page').then((m) => m.PlaceholderPage), title: 'Rules', data: { title: 'Same hardware. Different minds', eyebrow: 'SPEC / 04' } },
  { path: '**', redirectTo: '' },
];
