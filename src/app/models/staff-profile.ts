export interface SocialLink { label: string; url: string; icon: 'linkedin' | 'instagram' | 'facebook'; }

export interface StaffProfile {
  staffToken: string;
  publicToken: string;
  displayName: string;
  initials: string;
  jobTitle: string;
  department: string;
  company: string;
  mobile: string;
  mobileDisplay: string;
  office: string;
  extension: string;
  email: string;
  website: string;
  websiteDisplay: string;
  address: string;
  whatsapp: string;
  socials: SocialLink[];
  photo: string;
}
