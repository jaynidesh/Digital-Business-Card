import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import QRCode from 'qrcode';
import { StaffProfile } from '../models/staff-profile';
import { PublicProfileService } from '../services/public-profile.service';

@Component({selector:'app-staff-card',standalone:true,imports:[RouterLink],templateUrl:'./staff-card.component.html',styleUrl:'./staff-card.component.scss',changeDetection:ChangeDetectionStrategy.OnPush})
export class StaffCardComponent {
  private readonly route=inject(ActivatedRoute); private readonly service=inject(PublicProfileService); private readonly router=inject(Router); private readonly destroyRef=inject(DestroyRef);
  readonly profile=signal<StaffProfile|null>(null); readonly qrDataUrl=signal(''); readonly copied=signal(false);
  constructor(){const token=this.route.snapshot.paramMap.get('token')??'';this.service.getByStaffToken(token).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({next:p=>{this.profile.set(p);void this.makeQr(p);},error:()=>void this.router.navigateByUrl('/')});}
  private async makeQr(p:StaffProfile):Promise<void>{const url=`${location.origin}/contact/${p.publicToken}`;this.qrDataUrl.set(await QRCode.toDataURL(url,{width:760,margin:2,errorCorrectionLevel:'M',color:{dark:'#073f38',light:'#ffffff'}}));}
  async share(p:StaffProfile):Promise<void>{const url=`${location.origin}/contact/${p.publicToken}`;if(navigator.share){await navigator.share({title:`${p.displayName} — ${p.company}`,text:`Contact ${p.displayName}`,url});return;}await navigator.clipboard.writeText(url);this.copied.set(true);setTimeout(()=>this.copied.set(false),1800);}
}
