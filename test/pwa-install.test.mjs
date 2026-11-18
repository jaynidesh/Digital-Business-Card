import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PwaInstallController, isInstallOfferAllowed, isInstallPromptRoute } from '../src/app/services/pwa-install-controller.ts';

class BrowserWindow extends EventTarget {
  media = new EventTarget();

  constructor(standalone = false) {
    super();
    this.media.matches = standalone;
  }

  matchMedia() {
    return this.media;
  }
}

class SessionStorage {
  values = new Map();

  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}

class InstallEvent extends Event {
  calls = 0;

  constructor(outcome = 'accepted') {
    super('beforeinstallprompt', { cancelable: true });
    this.outcome = outcome;
  }

  async prompt() {
    this.calls++;
    return { outcome: this.outcome };
  }
}

const chrome = { userAgent: 'Mozilla/5.0 Chrome/130.0 Safari/537.36', platform: 'Linux armv8l', maxTouchPoints: 1 };
const safari = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 };
const macSafari = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 0 };
const macChrome = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', platform: 'MacIntel', maxTouchPoints: 0 };
const macEdge = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0', platform: 'MacIntel', maxTouchPoints: 0 };

test('installation popup is limited to staff routes', () => {
  assert.equal(isInstallPromptRoute('/'), false);
  assert.equal(isInstallPromptRoute('/contact/public_token?source=qr'), false);
  assert.equal(isInstallPromptRoute('/staff/staff_token'), true);
  assert.equal(isInstallPromptRoute('/auth/login'), false);
  assert.equal(isInstallPromptRoute('/contact/'), false);
});

test('staff offers require a resolved profile', () => {
  assert.equal(isInstallOfferAllowed('/', null), false);
  assert.equal(isInstallOfferAllowed('/contact/valid', null), false);
  assert.equal(isInstallOfferAllowed('/contact/valid', '/contact/valid'), false);
  assert.equal(isInstallOfferAllowed('/contact/invalid', '/contact/valid'), false);
  assert.equal(isInstallOfferAllowed('/staff/valid', '/staff/valid'), true);
  assert.equal(isInstallOfferAllowed('/staff/other', '/staff/valid'), false);
  assert.equal(isInstallOfferAllowed('/auth/login', '/auth/login'), false);
});

test('native install offer uses the browser event once and waits for appinstalled to mark installed', async () => {
  const window = new BrowserWindow();
  const controller = new PwaInstallController(window, chrome, new SessionStorage());
  const event = new InstallEvent();
  window.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(controller.visible(), true);
  assert.equal(controller.mode(), 'native');

  await controller.install();
  await controller.install();
  assert.equal(event.calls, 1);
  assert.equal(controller.visible(), false);
  assert.equal(controller.installed(), false);

  window.dispatchEvent(new Event('appinstalled'));
  assert.equal(controller.installed(), true);
  controller.dispose();
});

test('Maybe Later and native dismissal suppress offers for the current session only', async () => {
  const storage = new SessionStorage();
  const window = new BrowserWindow();
  const first = new PwaInstallController(window, chrome, storage);
  window.dispatchEvent(new InstallEvent());
  first.dismiss();
  window.dispatchEvent(new InstallEvent());
  assert.equal(first.visible(), false);
  first.dispose();

  const sameSession = new PwaInstallController(window, chrome, storage);
  window.dispatchEvent(new InstallEvent());
  assert.equal(sameSession.visible(), false);
  sameSession.dispose();

  const laterSession = new PwaInstallController(window, chrome, new SessionStorage());
  window.dispatchEvent(new InstallEvent('dismissed'));
  assert.equal(laterSession.visible(), true);
  await laterSession.install();
  assert.equal(laterSession.visible(), false);
  window.dispatchEvent(new InstallEvent());
  assert.equal(laterSession.visible(), false);
  laterSession.dispose();
});

test('iPhone Safari shows manual steps and installed standalone windows show nothing', () => {
  const browserWindow = new BrowserWindow();
  const ios = new PwaInstallController(browserWindow, safari, new SessionStorage());
  assert.equal(ios.visible(), true);
  assert.equal(ios.mode(), 'ios-safari');
  assert.equal(ios.canPrompt(), false);
  ios.dispose();

  const standalone = new PwaInstallController(new BrowserWindow(true), safari, new SessionStorage());
  assert.equal(standalone.visible(), false);
  standalone.dispose();
});

test('Mac Safari offers Add to Dock guidance without a native Install button', () => {
  const controller = new PwaInstallController(new BrowserWindow(), macSafari, new SessionStorage());
  assert.equal(controller.visible(), true);
  assert.equal(controller.mode(), 'mac-safari');
  assert.equal(controller.canPrompt(), false);
  controller.dispose();
});

test('Mac Chrome and Edge wait for their native browser install events', () => {
  for (const browser of [macChrome, macEdge]) {
    const window = new BrowserWindow();
    const controller = new PwaInstallController(window, browser, new SessionStorage());
    assert.equal(controller.visible(), false);
    window.dispatchEvent(new InstallEvent());
    assert.equal(controller.mode(), 'native');
    assert.equal(controller.canPrompt(), true);
    controller.dispose();
  }
});

test('a deferred native prompt is used only on the route where the browser offered it', () => {
  const window = new BrowserWindow();
  let path = '/contact/first';
  const controller = new PwaInstallController(window, chrome, new SessionStorage(), () => path);
  window.dispatchEvent(new InstallEvent());
  assert.equal(controller.matchesPromptRoute('/contact/first'), true);
  path = '/contact/second';
  assert.equal(controller.matchesPromptRoute('/contact/second'), false);
  window.dispatchEvent(new InstallEvent());
  assert.equal(controller.matchesPromptRoute('/contact/second'), true);
  controller.dispose();
});

test('unsupported browsers stay hidden and prompt failure offers manual browser-menu guidance', async () => {
  const window = new BrowserWindow();
  const controller = new PwaInstallController(window, chrome, new SessionStorage());
  assert.equal(controller.visible(), false);
  const event = new InstallEvent();
  event.prompt = async () => { throw new Error('prompt unavailable'); };
  window.dispatchEvent(event);
  await controller.install();
  assert.equal(controller.mode(), 'manual');
  assert.equal(controller.visible(), true);
  assert.equal(controller.canPrompt(), false);
  controller.dispose();
});

test('storage failures do not break dismissal and standalone changes hide the offer', () => {
  const window = new BrowserWindow();
  const storage = {
    getItem() { throw new Error('storage blocked'); },
    setItem() { throw new Error('storage blocked'); }
  };
  const controller = new PwaInstallController(window, chrome, storage);
  window.dispatchEvent(new InstallEvent());
  assert.equal(controller.visible(), true);
  window.media.matches = true;
  window.media.dispatchEvent(new Event('change'));
  assert.equal(controller.visible(), false);
  assert.equal(controller.canPrompt(), false);
  window.media.matches = false;
  window.media.dispatchEvent(new Event('change'));
  controller.dismiss();
  assert.equal(controller.visible(), false);
  controller.dispose();
});

test('older Safari media-query listeners are removed when the service is disposed', () => {
  const window = new BrowserWindow();
  let listener = null;
  let removed = false;
  window.matchMedia = () => ({
    matches: false,
    addListener(callback) { listener = callback; },
    removeListener(callback) { removed = callback === listener; }
  });
  const controller = new PwaInstallController(window, safari, new SessionStorage());
  assert.equal(controller.visible(), true);
  controller.dispose();
  assert.equal(removed, true);
});
