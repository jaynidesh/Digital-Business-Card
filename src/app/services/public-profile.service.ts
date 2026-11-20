import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, EMPTY, catchError, concat, defer, filter, switchMap } from 'rxjs';
import { createResponseKey, decryptProfileResponse, EncryptedProfileResponse } from './profile-response-crypto';
import { profileCache } from './profile-cache';
import { StaffProfile } from '../models/staff-profile';

@Injectable({ providedIn: 'root' })
export class PublicProfileService {
  private readonly http = inject(HttpClient);

  getByToken(token: string): Observable<StaffProfile> {
    return this.getEncrypted(`/api/v1/public/contact/${encodeURIComponent(token)}`);
  }

  getByStaffToken(token: string): Observable<StaffProfile> {
    return this.getEncrypted(`/api/v1/staff/contact/${encodeURIComponent(token)}`);
  }
  private getEncrypted(path: string): Observable<StaffProfile> {
    return defer(() => {
      let displayedCache = false;
      const cached = defer(async () => {
        const entry = await profileCache(path);
        if (!entry || Date.now() - entry.fetchedAt > 24 * 60 * 60 * 1000) return undefined;
        const profile = await decryptProfileResponse<StaffProfile>(entry.envelope, entry.privateKey, path);
        displayedCache = true;
        return profile;
      }).pipe(filter((profile): profile is StaffProfile => profile !== undefined), catchError(() => EMPTY));

      const fresh = defer(async () => ({ ...await createResponseKey(), fetchedAt: Date.now() })).pipe(
        switchMap(key => this.http.post<EncryptedProfileResponse>(path, { version: 1, clientPublicKey: key.publicKey }).pipe(
          switchMap(async envelope => {
            const profile = await decryptProfileResponse<StaffProfile>(envelope, key.privateKey, path);
            if (profile) void profileCache(path, { envelope, privateKey: key.privateKey, fetchedAt: key.fetchedAt }).catch(() => {});
            return profile;
          })
        )),
        catchError(error => {
          if (error.status === 404 || error.status === 410) {
            void profileCache(path, null).catch(() => {});
          } else if (displayedCache) {
            return EMPTY;
          }
          throw error;
        })
      );
      return concat(cached, fresh);
    });
  }
}
