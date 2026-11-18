import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { isInstallOfferAllowed } from '../services/pwa-install-controller';
import { PwaInstallService } from '../services/pwa-install.service';

@Component({
  selector: 'app-pwa-install',
  standalone: true,
  templateUrl: './pwa-install.component.html',
  styleUrl: './pwa-install.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PwaInstallComponent {
  readonly install = inject(PwaInstallService);
  readonly currentRoute = signal(window.location.pathname);
  readonly routeAllowed = computed(() => isInstallOfferAllowed(
    this.currentRoute(), this.install.readyPath()
  ) && this.install.matchesPromptRoute(this.currentRoute()));
  private previousFocus: HTMLElement | null = null;
  private popupElement: HTMLElement | null = null;
  private focusWithinPopup = false;

  constructor() {
    const router = inject(Router);
    router.events.pipe(filter(event => event instanceof NavigationEnd), takeUntilDestroyed()).subscribe(() => {
      this.currentRoute.set(router.url);
    });
  }

  @ViewChild('popup') set popup(element: ElementRef<HTMLElement> | undefined) {
    if (element) {
      const active = document.activeElement;
      this.previousFocus = active instanceof HTMLElement && active !== document.body ? active : null;
      this.popupElement = element.nativeElement;
      queueMicrotask(() => {
        if (this.popupElement === element.nativeElement && element.nativeElement.isConnected) {
          element.nativeElement.focus();
        }
      });
    } else {
      const previous = this.previousFocus;
      const shouldRestore = this.focusWithinPopup
        && (this.popupElement?.contains(document.activeElement) || document.activeElement === document.body);
      this.previousFocus = null;
      this.popupElement = null;
      this.focusWithinPopup = false;
      if (shouldRestore && previous) {
        queueMicrotask(() => previous.isConnected && previous.focus());
      }
    }
  }

  onPopupFocus(): void {
    this.focusWithinPopup = true;
  }

  onPopupBlur(event: FocusEvent): void {
    if (event.relatedTarget && !this.popupElement?.contains(event.relatedTarget as Node)) {
      this.focusWithinPopup = false;
    }
  }

  close(): void {
    this.install.dismiss();
  }
}
