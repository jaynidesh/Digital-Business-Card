import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, defer, switchMap } from 'rxjs';
import { createResponseKey, decryptProfileResponse, EncryptedProfileResponse } from './profile-response-crypto';
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
    return defer(() => createResponseKey()).pipe(switchMap(key =>
      this.http.post<EncryptedProfileResponse>(path, { version: 1, clientPublicKey: key.publicKey }).pipe(
        switchMap(envelope => decryptProfileResponse<StaffProfile>(envelope, key.privateKey, path))
      )
    ));
  }
}
