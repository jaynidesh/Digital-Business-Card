import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { PwaInstallController } from './pwa-install-controller';

function availableSessionStorage(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

@Injectable({ providedIn: 'root' })
export class PwaInstallService extends PwaInstallController {
  readonly readyPath = signal<string | null>(null);

  constructor() {
    super(window, navigator, availableSessionStorage(), () => window.location.pathname);
    inject(DestroyRef).onDestroy(() => this.dispose());
  }
}
