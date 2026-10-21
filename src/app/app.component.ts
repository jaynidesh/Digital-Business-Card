import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  constructor() {
    inject(Router).events.pipe(filter(event => event instanceof NavigationEnd)).subscribe(() => {
      (window as Window & { updatePwaManifest?: () => void }).updatePwaManifest?.();
    });
  }
}
