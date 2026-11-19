import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({ selector: 'app-examples', standalone: true, templateUrl: './examples.component.html', changeDetection: ChangeDetectionStrategy.OnPush })
export class ExamplesComponent {}
