import { Injectable } from '@angular/core';
import { Observable, delay, of, throwError } from 'rxjs';
import profiles from '../../../data/mock-profiles.json';
import { StaffProfile } from '../models/staff-profile';

export const MOCK_PROFILES: StaffProfile[] = profiles as StaffProfile[];

@Injectable({ providedIn: 'root' })
export class PublicProfileService {
  getByToken(token: string): Observable<StaffProfile> {
    // Replace this mock with GET /api/v1/public/contact/{token} when backoffice is available.
    const profile = MOCK_PROFILES.find(item => item.publicToken === token);
    return profile ? of(profile).pipe(delay(320)) : throwError(() => new Error('unavailable'));
  }

  getByStaffToken(token: string): Observable<StaffProfile> {
    const profile = MOCK_PROFILES.find(item => item.staffToken === token);
    return profile ? of(profile).pipe(delay(240)) : throwError(() => new Error('unavailable'));
  }
}
