import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { StaffProfile } from '../models/staff-profile';

@Injectable({ providedIn: 'root' })
export class PublicProfileService {
  private readonly http = inject(HttpClient);

  getProfiles(): Observable<StaffProfile[]> {
    return this.http.get<StaffProfile[]>('/data/mock-profiles.json');
  }

  getByToken(token: string): Observable<StaffProfile> {
    return this.findProfile('publicToken', token);
  }

  getByStaffToken(token: string): Observable<StaffProfile> {
    return this.findProfile('staffToken', token);
  }

  private findProfile(field: 'publicToken' | 'staffToken', token: string): Observable<StaffProfile> {
    return this.getProfiles().pipe(map(profiles => {
      const profile = profiles.find(item => item[field] === token);
      if (!profile) throw new Error('unavailable');
      return profile;
    }));
  }
}
