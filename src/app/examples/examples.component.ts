import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicProfileService } from '../services/public-profile.service';

import { AsyncPipe } from '@angular/common';

@Component({ selector:'app-examples', standalone:true, imports:[RouterLink, AsyncPipe], templateUrl:'./examples.component.html', styleUrl:'./examples.component.scss', changeDetection:ChangeDetectionStrategy.OnPush })
export class ExamplesComponent { readonly profiles = inject(PublicProfileService).getProfiles(); }
