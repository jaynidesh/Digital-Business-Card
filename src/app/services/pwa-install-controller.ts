import { computed, signal } from '@angular/core';

type InstallMode = 'native' | 'ios-safari' | 'ios-other' | 'mac-safari' | 'manual' | null;
type InstallChoice = { outcome: 'accepted' | 'dismissed' };

interface InstallPromptEvent extends Event {
  prompt(): Promise<InstallChoice | void>;
  userChoice?: Promise<InstallChoice>;
}

type InstallNavigator = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> & { standalone?: boolean };
type InstallStorage = Pick<Storage, 'getItem' | 'setItem'>;

const DISMISSAL_KEY = 'sbm-pwa-install-dismissed';

export function isInstallPromptRoute(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0];
  return /^\/staff\/[A-Za-z0-9_-]+\/?$/.test(path);
}

export function isInstallOfferAllowed(url: string, readyPath: string | null): boolean {
  const path = url.split(/[?#]/, 1)[0];
  if (!isInstallPromptRoute(path)) return false;
  return path === readyPath;
}

export class PwaInstallController {
  private readonly browserWindow: Pick<Window, 'addEventListener' | 'removeEventListener' | 'matchMedia'>;
  private readonly browserNavigator: InstallNavigator;
  private readonly storage?: InstallStorage | null;
  private readonly currentPath: () => string;
  private readonly media: MediaQueryList;
  private readonly dismissed = signal(false);
  private deferredPrompt: InstallPromptEvent | null = null;

  readonly mode = signal<InstallMode>(null);
  readonly standalone = signal(false);
  readonly installed = signal(false);
  readonly installing = signal(false);
  readonly promptPath = signal<string | null>(null);
  readonly visible = computed(() => this.mode() !== null && !this.dismissed() && !this.standalone() && !this.installed());
  readonly canPrompt = computed(() => this.mode() === 'native' && this.visible() && !this.installing());

  constructor(
    browserWindow: Pick<Window, 'addEventListener' | 'removeEventListener' | 'matchMedia'>,
    browserNavigator: InstallNavigator,
    storage?: InstallStorage | null,
    currentPath: () => string = () => '/'
  ) {
    this.browserWindow = browserWindow;
    this.browserNavigator = browserNavigator;
    this.storage = storage;
    this.currentPath = currentPath;
    this.media = browserWindow.matchMedia('(display-mode: standalone)');
    this.dismissed.set(this.readDismissal());
    this.standalone.set(this.media.matches || browserNavigator.standalone === true);
    this.installed.set(this.standalone());
    if (!this.standalone() && !this.dismissed()) {
      if (this.isIos()) this.mode.set(this.isSafari() ? 'ios-safari' : 'ios-other');
      else if (this.isSafari() && /Macintosh/i.test(browserNavigator.userAgent)) this.mode.set('mac-safari');
    }
    this.browserWindow.addEventListener('beforeinstallprompt', this.onBeforeInstallPrompt);
    this.browserWindow.addEventListener('appinstalled', this.onAppInstalled);
    if (typeof this.media.addEventListener === 'function') {
      this.media.addEventListener('change', this.onDisplayModeChange);
    } else {
      this.media.addListener(this.onDisplayModeChange);
    }
  }

  private readonly onBeforeInstallPrompt = (event: Event): void => {
    if (!('prompt' in event) || typeof event.prompt !== 'function') return;
    event.preventDefault();
    if (this.dismissed() || this.standalone() || this.installed()) return;
    this.deferredPrompt = event as InstallPromptEvent;
    this.promptPath.set(this.currentPath());
    this.mode.set('native');
  };

  private readonly onAppInstalled = (): void => {
    this.installed.set(true);
    this.deferredPrompt = null;
    this.promptPath.set(null);
    this.mode.set(null);
  };

  private readonly onDisplayModeChange = (): void => {
    this.standalone.set(this.media.matches || this.browserNavigator.standalone === true);
    if (this.standalone()) this.installed.set(true);
  };

  async install(): Promise<void> {
    if (!this.canPrompt() || !this.deferredPrompt || !this.matchesPromptRoute(this.currentPath())) return;
    const event = this.deferredPrompt;
    this.deferredPrompt = null;
    this.promptPath.set(null);
    this.mode.set(null);
    this.installing.set(true);
    try {
      const result = await event.prompt();
      if (!result && event.userChoice) await event.userChoice;
      // Acceptance is not proof of installation. Only appinstalled marks that state.
      this.dismiss();
    } catch {
      if (!this.installed() && !this.standalone()) this.mode.set('manual');
    } finally {
      this.installing.set(false);
    }
  }

  dismiss(): void {
    this.deferredPrompt = null;
    this.promptPath.set(null);
    this.mode.set(null);
    this.dismissed.set(true);
    try { this.storage?.setItem(DISMISSAL_KEY, '1'); } catch { /* Storage can be blocked. */ }
  }

  dispose(): void {
    this.browserWindow.removeEventListener('beforeinstallprompt', this.onBeforeInstallPrompt);
    this.browserWindow.removeEventListener('appinstalled', this.onAppInstalled);
    if (typeof this.media.removeEventListener === 'function') {
      this.media.removeEventListener('change', this.onDisplayModeChange);
    } else {
      this.media.removeListener(this.onDisplayModeChange);
    }
    this.deferredPrompt = null;
    this.promptPath.set(null);
  }

  matchesPromptRoute(url: string): boolean {
    return this.mode() !== 'native' || this.promptPath() === url.split(/[?#]/, 1)[0];
  }

  private readDismissal(): boolean {
    try { return this.storage?.getItem(DISMISSAL_KEY) === '1'; } catch { return false; }
  }

  private isIos(): boolean {
    return /iPhone|iPad|iPod/i.test(this.browserNavigator.userAgent)
      || (this.browserNavigator.platform === 'MacIntel' && this.browserNavigator.maxTouchPoints > 1);
  }

  private isSafari(): boolean {
    return /Version\/[\d.]+.*Safari\//i.test(this.browserNavigator.userAgent)
      && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Chromium|Edg\/|OPR\/|Firefox/i.test(this.browserNavigator.userAgent);
  }
}
