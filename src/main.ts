import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, Routes, withInMemoryScrolling } from '@angular/router';
import { AppComponent } from './app/app.component';
import { isDevMode } from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';

const routes: Routes = [
  { path: '', loadComponent: () => import('./app/examples/examples.component').then(m => m.ExamplesComponent) },
  { path: 'contact/:token', loadComponent: () => import('./app/public-contact/public-contact.component').then(m => m.PublicContactComponent) },
  { path: 'staff/:token', loadComponent: () => import('./app/staff-card/staff-card.component').then(m => m.StaffCardComponent) },
  { path: '**', redirectTo: '' }
];

bootstrapApplication(AppComponent, {
  providers: [provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'top' })), provideServiceWorker('ngsw-worker.js', {
            enabled: !isDevMode(),
            registrationStrategy: 'registerWhenStable:30000'
          }), provideServiceWorker('ngsw-worker.js', {
            enabled: !isDevMode(),
            registrationStrategy: 'registerWhenStable:30000'
          })]
}).catch(console.error);
