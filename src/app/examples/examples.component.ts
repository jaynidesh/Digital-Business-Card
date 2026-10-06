import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MOCK_PROFILES } from '../services/public-profile.service';

@Component({ selector:'app-examples', standalone:true, imports:[RouterLink], templateUrl:'./examples.component.html', styleUrl:'./examples.component.scss', changeDetection:ChangeDetectionStrategy.OnPush })
export class ExamplesComponent { readonly profiles = MOCK_PROFILES; }
