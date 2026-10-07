import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import QRCode from 'qrcode';
import { StaffProfile } from '../models/staff-profile';
import { PublicProfileService } from '../services/public-profile.service';
import { CommonModule } from '@angular/common';
import { visibleWallets, walletUrl } from './wallet-platform';

@Component({
  selector: 'app-public-contact',
  standalone: true,
  templateUrl: './public-contact.component.html',
  styleUrl: './public-contact.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule
  ],
})
export class PublicContactComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(PublicProfileService);
  private readonly destroyRef = inject(DestroyRef);

  readonly state = signal<'loading' | 'ready' | 'unavailable'>('loading');
  readonly profile = signal<StaffProfile | null>(null);
  readonly qrOpen = signal(false);
  readonly copied = signal(false);
  readonly qrDataUrl = signal('');
  readonly wallets = visibleWallets(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
  readonly walletUrl = walletUrl;

  constructor() {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    this.service.getByToken(token).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: profile => { this.profile.set(profile); this.state.set('ready'); },
      error: () => this.state.set('unavailable')
    });
  }

  downloadVCard(profile: StaffProfile): void {
    const clean = (value: string) => value.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const card = [
      'BEGIN:VCARD', 'VERSION:3.0', `FN:${clean(profile.displayName)}`,
      `ORG:${clean(profile.company)}`, `TITLE:${clean(profile.jobTitle)}`,
      `TEL;TYPE=CELL:${profile.mobile}`, `TEL;TYPE=WORK:${profile.office}`,
      `EMAIL;TYPE=WORK:${profile.email}`, `URL:${profile.website}`,
      `TYPE=WhatsApp:https://wa.me/${profile.mobile}`, `PHOTO;TYPE=JPEG:${profile.photo}`,
      `ADR;TYPE=WORK:;;${clean(profile.address)};;;;`, `NOTE:Department: ${clean(profile.department)}`,
      'END:VCARD', ''
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([card], { type: 'text/vcard;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${profile.displayName.replace(/[^a-z0-9]+/gi, '-')}.vcf`; anchor.click();
    URL.revokeObjectURL(url);
  }

  async openQr(): Promise<void> {
    this.qrOpen.set(true);
    if (!this.qrDataUrl()) {
      this.qrDataUrl.set(await QRCode.toDataURL(location.href, { width: 520, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#073f38', light: '#ffffff' } }));
    }
  }

  // async share(profile: StaffProfile): Promise<void> {
  //   const data = { title: `${profile.displayName} — ${profile.company}`, text: `Contact ${profile.displayName}`, url: location.href };
  //   if (navigator.share) { await navigator.share(data); return; }
  //   await navigator.clipboard.writeText(location.href);
  //   this.copied.set(true); window.setTimeout(() => this.copied.set(false), 1800);
  // }

  async share(profile: StaffProfile): Promise<void> {
    const data = {
      title: `${profile.displayName} — ${profile.company}`,
      text: `Contact ${profile.displayName}`,
      url: location.href
    };

    if (navigator.share) {
      await navigator.share(data);
      return;
    }

    const url = location.href;

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = url;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';

      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    this.copied.set(true);

    window.setTimeout(() => {
      this.copied.set(false);
    }, 1800);
  }
}
