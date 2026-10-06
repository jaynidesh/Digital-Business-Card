import { Injectable } from '@angular/core';
import { Observable, delay, of, throwError } from 'rxjs';
import { StaffProfile } from '../models/staff-profile';

export const MOCK_PROFILES: StaffProfile[] = [
  {
    staffToken: 'hEML4Yf4xLr-9loOdeqxUWq2',
    publicToken: 'hGr_tQ2piuR4eNgLkK94CIXh',
    displayName: 'Nourani Madarbux', 
    initials: 'NM',
    photo: "https://10.71.202.215:4200/assets/images/man.jpg",
    jobTitle: 'Head IT Infrastructure - New Initiatives & Digital Projects',
    department: 'SBM Technology', company: 'SBM Bank (Mauritius) Ltd',
    mobile: '+23052524786', mobileDisplay: '+230 5252 4786',
    office: '+2302021558', extension: '1558', email: 'nourani.madarbux@sbmgroup.mu',
    website: 'https://www.sbmgroup.mu/', websiteDisplay: 'https://www.sbmgroup.mu',
    address: '7 Exchange Square, Wall Street, Cybercity, Ebene, Republic of Mauritius', whatsapp: '+23052524786',
    socials: [
      { label: 'LinkedIn', url: 'https://www.linkedin.com', icon: 'linkedin' }
    ]
  },
  {
    staffToken: '_MRIJRcdhoi0DOiouEkNrW0P',
    publicToken: '62bNOR1FoOLy4OyIiIAG6XG1',
    displayName: 'Nousrina Peerbux', 
    initials: 'NP',
    photo: "assets/images/woman.jpg",
    jobTitle: 'Marketing Officer',
    department: 'Marketing & Communications', company: 'SBM Bank (Mauritius) Ltd',
    mobile: '+23052524786', mobileDisplay: '+230 5252 4786',
    office: '+2302024607', extension: '4607', email: 'nousrina.peerbux@sbmgroup.mu',
    website: 'https://www.sbmgroup.mu/', websiteDisplay: 'https://www.sbmgroup.mu',
    address: 'Corporate Office, SBM Tower, 1 Queen Elizabeth II Avenue, Port Louis, Republic of Mauritius', whatsapp: '',
    socials: []
  },
  {
    staffToken: '60iWGd4Pcc4Y5jIZSFr2929F',
    publicToken: 'Xr1_wceLZpmJPyorqolHcoVZ',
    displayName: 'Kamal Bhojah', 
    initials: 'KB',
    photo: "assets/images/man.jpg",
    jobTitle: 'Head of Enterprise Architecture (group)',
    department: 'SBM Technology', company: 'SBM Bank (Mauritius) Ltd',
    mobile: '+23052524786', mobileDisplay: '+230 5252 4786',
    office: '+2302021558', extension: '1558', email: 'kamal.bhojah@sbmgroup.mu',
    website: 'https://www.sbmgroup.mu/', websiteDisplay: 'https://www.sbmgroup.mu',
    address: '7 Exchange Square, Wall Street, Cybercity, Ebene, Republic of Mauritius', whatsapp: '+23052524786',
    socials: [
      { label: 'LinkedIn', url: 'https://www.linkedin.com', icon: 'linkedin' }
    ]
  }
];

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
