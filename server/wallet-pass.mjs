import {
  createHash,
  createPrivateKey,
  createSign
} from 'node:crypto';

import { execFile } from 'node:child_process';

import {
  access,
  readFile,
  writeFile,
  mkdtemp,
  rm
} from 'node:fs/promises';

import { tmpdir } from 'node:os';

import {
  dirname,
  join,
  resolve
} from 'node:path';

import {
  fileURLToPath
} from 'node:url';

import {
  promisify
} from 'node:util';

import sharp from 'sharp';

const exec = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/*
|--------------------------------------------------------------------------
| PATHS
|--------------------------------------------------------------------------
|
| Expected structure:
|
| SBM-Digital-Contact-Card/
|
| ├── server/
| │   ├── wallet-pass.mjs
| │   └── assets/
| │       ├── icon.png
| │       ├── icon@2x.png
| │       ├── logo.png
| │       └── logo@2x.png
| │
| └── src/
|     └── assets/
|         └── images/
|             └── image002.jpg
|
*/

const walletAssets = join(
  __dirname,
  'assets'
);

const applicationAssets = join(
  __dirname,
  '..',
  'src',
  'assets'
);


/*
|--------------------------------------------------------------------------
| CONTACT URL
|--------------------------------------------------------------------------
*/

function contactUrl(
  profile,
  publicBaseUrl
) {
  return new URL(
    `/contact/${encodeURIComponent(
      profile.publicToken
    )}`,
    publicBaseUrl
  ).toString();
}


/*
|--------------------------------------------------------------------------
| GOOGLE LOCALIZED VALUE
|--------------------------------------------------------------------------
*/

function localized(value) {
  return {
    defaultValue: {
      language: 'en-US',
      value: value || ''
    }
  };
}


/*
|--------------------------------------------------------------------------
| GOOGLE IDs
|--------------------------------------------------------------------------
*/

function googleIds(
  profile,
  issuerId
) {
  const tokenHash =
    createHash('sha256')
      .update(
        profile.publicToken
      )
      .digest('hex')
      .slice(0, 32);

  return {
    classId:
      `${issuerId}.staff_contact`,

    objectId:
      `${issuerId}.contact_${tokenHash}`
  };
}


/*
|--------------------------------------------------------------------------
| VALID WEB URL
|--------------------------------------------------------------------------
*/

function webUrl(value) {
  if (
    typeof value !== 'string' ||
    !value.trim()
  ) {
    return null;
  }

  try {
    const url =
      new URL(
        value.trim()
      );

    if (
      url.protocol === 'https:' ||
      url.protocol === 'http:'
    ) {
      return url.toString();
    }

    return null;

  } catch {
    return null;
  }
}


/*
|--------------------------------------------------------------------------
| PRIVATE / LOCAL HOST CHECK
|--------------------------------------------------------------------------
*/

function isPrivateHost(hostname) {
  if (!hostname) {
    return true;
  }

  const host =
    hostname.toLowerCase();

  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1'
  ) {
    return true;
  }

  if (
    host.startsWith('10.')
  ) {
    return true;
  }

  if (
    host.startsWith('192.168.')
  ) {
    return true;
  }

  /*
   * 172.16.0.0 - 172.31.255.255
   */
  if (
    /^172\.(1[6-9]|2\d|3[01])\./
      .test(host)
  ) {
    return true;
  }

  return false;
}


/*
|--------------------------------------------------------------------------
| GOOGLE PROFILE PHOTO URL
|--------------------------------------------------------------------------
|
| Google Wallet cannot read:
|
| https://10.x.x.x/...
| https://192.168.x.x/...
| localhost
| internal-only URLs
|
| So during local development the contact image
| is simply not added to the Google pass.
|
*/

function profilePhotoUrl(
  profile,
  publicBaseUrl
) {
  if (
    typeof profile.photo !== 'string' ||
    !profile.photo.trim()
  ) {
    return null;
  }

  const photo =
    profile.photo.trim();


  /*
   * ------------------------------------------------------------
   * ABSOLUTE URL
   * ------------------------------------------------------------
   */

  try {
    const parsed =
      new URL(photo);

    if (
      parsed.protocol !== 'https:'
    ) {
      console.warn(
        'Google Wallet contact photo skipped because the image is not HTTPS:',
        photo
      );

      return null;
    }

    if (
      isPrivateHost(
        parsed.hostname
      )
    ) {
      console.warn(
        'Google Wallet contact photo skipped because the image uses a private/local host:',
        photo
      );

      return null;
    }

    return parsed.toString();

  } catch {
    /*
     * Not an absolute URL.
     * Continue as relative asset path.
     */
  }


  /*
   * ------------------------------------------------------------
   * RELATIVE URL
   * ------------------------------------------------------------
   */

  try {
    const base =
      new URL(
        publicBaseUrl
      );

    if (
      base.protocol !== 'https:'
    ) {
      console.warn(
        'Google Wallet contact photo skipped because publicBaseUrl is not HTTPS:',
        publicBaseUrl
      );

      return null;
    }

    if (
      isPrivateHost(
        base.hostname
      )
    ) {
      console.warn(
        'Google Wallet contact photo skipped because publicBaseUrl is private/local:',
        publicBaseUrl
      );

      return null;
    }

    const cleanPhoto =
      photo.replace(
        /^\/+/,
        ''
      );

    return new URL(
      `/${cleanPhoto}`,
      publicBaseUrl
    ).toString();

  } catch {

    console.warn(
      'Google Wallet contact photo skipped because publicBaseUrl is invalid:',
      publicBaseUrl
    );

    return null;
  }
}


/*
|--------------------------------------------------------------------------
| APPLE PROFILE PHOTO LOADER
|--------------------------------------------------------------------------
|
| Supported:
|
| profile.photo = "assets/images/image002.jpg"
|
| OR
|
| profile.photo = "https://public.domain/image002.jpg"
|
*/

async function loadProfilePhoto(
  profile
) {
  if (
    typeof profile.photo !== 'string' ||
    !profile.photo.trim()
  ) {
    return null;
  }

  const photo =
    profile.photo.trim();


  /*
   * ------------------------------------------------------------
   * REMOTE IMAGE
   * ------------------------------------------------------------
   */

  if (
    photo.startsWith('https://') ||
    photo.startsWith('http://')
  ) {
    console.log(
      'Loading Apple Wallet contact photo from URL:',
      photo
    );

    const response =
      await fetch(photo);

    if (!response.ok) {
      throw new Error(
        `Unable to download contact photo. HTTP ${response.status}`
      );
    }

    return Buffer.from(
      await response.arrayBuffer()
    );
  }


  /*
   * ------------------------------------------------------------
   * LOCAL IMAGE
   * ------------------------------------------------------------
   *
   * profile.photo:
   *
   * assets/images/image002.jpg
   *
   * resolves to:
   *
   * PROJECT/src/assets/images/image002.jpg
   *
   */

  let relativePath =
    photo.replace(
      /^\/+/,
      ''
    );

  relativePath =
    relativePath.replace(
      /^assets\//,
      ''
    );

  const photoPath =
    resolve(
      applicationAssets,
      relativePath
    );

  console.log(
    'Loading Apple Wallet contact photo:',
    photoPath
  );

  try {
    await access(
      photoPath
    );

  } catch {

    throw new Error(
      `Contact photo not found: ${photoPath}`
    );
  }

  return await readFile(
    photoPath
  );
}


/*
|--------------------------------------------------------------------------
| CREATE APPLE CONTACT THUMBNAILS
|--------------------------------------------------------------------------
*/

async function createAppleContactImages(
  profile,
  work
) {
  const source =
    await loadProfilePhoto(
      profile
    );

  if (!source) {
    console.log(
      'Apple Wallet contact photo not configured.'
    );

    return [];
  }


  /*
   * 1x
   */
  const thumbnail =
    await sharp(source)
      .rotate()
      .resize(
        90,
        90,
        {
          fit: 'cover',
          position: 'centre'
        }
      )
      .png()
      .toBuffer();


  /*
   * 2x
   */
  const thumbnail2x =
    await sharp(source)
      .rotate()
      .resize(
        180,
        180,
        {
          fit: 'cover',
          position: 'centre'
        }
      )
      .png()
      .toBuffer();


  /*
   * 3x
   */
  const thumbnail3x =
    await sharp(source)
      .rotate()
      .resize(
        270,
        270,
        {
          fit: 'cover',
          position: 'centre'
        }
      )
      .png()
      .toBuffer();


  await writeFile(
    join(
      work,
      'thumbnail.png'
    ),
    thumbnail
  );


  await writeFile(
    join(
      work,
      'thumbnail@2x.png'
    ),
    thumbnail2x
  );


  await writeFile(
    join(
      work,
      'thumbnail@3x.png'
    ),
    thumbnail3x
  );


  console.log(
    'Apple Wallet contact thumbnails generated.'
  );


  return [
    'thumbnail.png',
    'thumbnail@2x.png',
    'thumbnail@3x.png'
  ];
}


/*
|--------------------------------------------------------------------------
| GOOGLE WALLET OBJECT
|--------------------------------------------------------------------------
*/

export function buildGooglePassObject(
  profile,
  {
    issuerId,
    publicBaseUrl
  }
) {
  const {
    classId,
    objectId
  } = googleIds(
    profile,
    issuerId
  );


  const url =
    contactUrl(
      profile,
      publicBaseUrl
    );


  const photoUrl =
    profilePhotoUrl(
      profile,
      publicBaseUrl
    );


  const textModulesData =
    [];


  /*
   * ------------------------------------------------------------
   * TEXT HELPER
   * ------------------------------------------------------------
   */

  const text = (
    id,
    header,
    value
  ) => {

    if (
      typeof value === 'string' &&
      value.trim()
    ) {
      textModulesData.push({
        id,
        header,
        body:
          value.trim()
      });
    }
  };


  /*
   * ------------------------------------------------------------
   * TEXT DATA
   * ------------------------------------------------------------
   */

  text(
    'mobile',
    'Mobile',
    profile.mobileDisplay ||
      profile.mobile
  );


  text(
    'office',
    'Office',

    profile.office
      ? `${profile.office}${
          profile.extension
            ? ` ext. ${profile.extension}`
            : ''
        }`
      : ''
  );


  text(
    'email',
    'Email',
    profile.email
  );


  text(
    'department',
    'Department',
    profile.department
  );


  text(
    'role',
    'Role',
    profile.jobTitle
  );


  text(
    'website',
    'Website',

    profile.websiteDisplay ||
      profile.website
  );


  text(
    'address',
    'Address',
    profile.address
  );


  text(
    'whatsapp',
    'WhatsApp',
    profile.whatsapp
  );


  /*
   * ------------------------------------------------------------
   * GOOGLE LINKS
   * ------------------------------------------------------------
   *
   * Keep links constrained.
   */

  const MAX_GOOGLE_LINKS =
    4;


  const links = [
    {
      id:
        'contact',

      uri:
        url,

      description:
        'Open contact card'
    }
  ];


  const link = (
    id,
    description,
    uri
  ) => {

    if (!uri) {
      return;
    }

    if (
      links.length >=
      MAX_GOOGLE_LINKS
    ) {
      return;
    }

    links.push({
      id,
      uri,
      description
    });
  };


  /*
   * Priority link #2
   */
  link(
    'mobile',
    'Call mobile',

    profile.mobile
      ? `tel:${profile.mobile}`
      : null
  );


  /*
   * Priority link #3
   */
  link(
    'email',
    'Send email',

    profile.email
      ? `mailto:${profile.email}`
      : null
  );


  /*
   * Priority link #4
   */
  const whatsapp =
    profile.whatsapp
      ?.replace(
        /\D/g,
        ''
      );


  link(
    'whatsapp',
    'Message on WhatsApp',

    whatsapp
      ? `https://wa.me/${whatsapp}`
      : null
  );


  /*
   * ------------------------------------------------------------
   * GOOGLE OBJECT
   * ------------------------------------------------------------
   */

  const googleObject = {

    id:
      objectId,

    classId,

    state:
      'ACTIVE',

    cardTitle:
      localized(
        profile.company
      ),

    header:
      localized(
        profile.displayName
      ),

    subheader:
      localized(
        profile.jobTitle
      ),

    hexBackgroundColor:
      '#1E3868',

    barcode: {

      type:
        'QR_CODE',

      value:
        url,

      alternateText:
        'Scan contact card'
    },

    textModulesData,

    linksModuleData: {
      uris:
        links
    }
  };


  /*
   * ------------------------------------------------------------
   * GOOGLE CONTACT PHOTO
   * ------------------------------------------------------------
   *
   * Do not add internal/private URLs.
   */

  if (photoUrl) {

    googleObject.logo = {

      sourceUri: {
        uri:
          photoUrl
      },

      contentDescription:
        localized(
          `${profile.displayName} profile photo`
        )
    };


    console.log(
      'Google Wallet contact photo:',
      photoUrl
    );

  } else {

    console.log(
      'Google Wallet contact photo skipped.'
    );
  }


  return googleObject;
}


/*
|--------------------------------------------------------------------------
| GOOGLE SAVE URL
|--------------------------------------------------------------------------
*/

export function createGoogleSaveUrl(
  profile,
  config
) {
  const {
    issuerId,
    clientEmail,
    privateKey,
    publicBaseUrl
  } = config;


  if (
    !issuerId ||
    !clientEmail ||
    !privateKey ||
    !publicBaseUrl
  ) {
    throw new Error(
      'Google Wallet is not configured'
    );
  }


  const {
    classId,
    objectId
  } = googleIds(
    profile,
    issuerId
  );


  const claims = {

    iss:
      clientEmail,

    aud:
      'google',

    typ:
      'savetowallet',

    iat:
      Math.floor(
        Date.now() / 1000
      ),

    origins: [
      new URL(
        publicBaseUrl
      ).origin
    ],

    payload: {

      genericObjects: [
        {
          id:
            objectId,

          classId
        }
      ]
    }
  };


  const jwtHeader =
    Buffer
      .from(
        JSON.stringify({
          alg:
            'RS256',

          typ:
            'JWT'
        })
      )
      .toString(
        'base64url'
      );


  const jwtPayload =
    Buffer
      .from(
        JSON.stringify(
          claims
        )
      )
      .toString(
        'base64url'
      );


  const input =
    `${jwtHeader}.${jwtPayload}`;


  const signature =
    createSign(
      'RSA-SHA256'
    )
      .update(
        input
      )
      .sign(
        privateKey
      )
      .toString(
        'base64url'
      );


  return (
    `https://pay.google.com/gp/v/save/` +
    `${input}.${signature}`
  );
}


/*
|--------------------------------------------------------------------------
| APPLE WALLET PASS
|--------------------------------------------------------------------------
*/

export async function createApplePass(
  profile,
  config
) {
  const {
    passTypeId,
    teamId,
    certificatePath,
    privateKeyPath,
    wwdrCertificatePath,
    publicBaseUrl,
    privateKeyPassword
  } = config;


  if (
    ![
      passTypeId,
      teamId,
      certificatePath,
      privateKeyPath,
      wwdrCertificatePath,
      publicBaseUrl
    ].every(Boolean)
  ) {
    throw new Error(
      'Apple Wallet is not configured'
    );
  }


  const url =
    contactUrl(
      profile,
      publicBaseUrl
    );


  const serialNumber =
    createHash(
      'sha256'
    )
      .update(
        profile.publicToken
      )
      .digest(
        'hex'
      )
      .slice(
        0,
        32
      );


  /*
   * ------------------------------------------------------------
   * PASS.JSON
   * ------------------------------------------------------------
   */

  const pass = {

    formatVersion:
      1,

    passTypeIdentifier:
      passTypeId,

    serialNumber,

    teamIdentifier:
      teamId,

    organizationName:
      profile.company,

    description:
      `${profile.displayName} contact card`,

    logoText:
      profile.company,

    backgroundColor:
      'rgb(255,255,255)',

    foregroundColor:
      'rgb(30,56,104)',

    labelColor:
      'rgb(212,174,98)',


    generic: {

      primaryFields: [
        {
          key:
            'name',

          label:
            'CONTACT',

          value:
            profile.displayName
        }
      ],


      secondaryFields: [
        {
          key:
            'title',

          label:
            'ROLE',

          value:
            profile.jobTitle
        }
      ],


      auxiliaryFields: [
        {
          key:
            'department',

          label:
            'DEPARTMENT',

          value:
            profile.department
        }
      ],


      backFields: [

        {
          key:
            'mobile',

          label:
            'Mobile',

          value:
            profile.mobileDisplay ||
            profile.mobile ||
            ''
        },

        {
          key:
            'office',

          label:
            'Office',

          value:
            profile.office
              ? `${profile.office}${
                  profile.extension
                    ? ` ext. ${profile.extension}`
                    : ''
                }`
              : ''
        },

        {
          key:
            'email',

          label:
            'Email',

          value:
            profile.email ||
            ''
        },

        {
          key:
            'website',

          label:
            'Website',

          value:
            profile.websiteDisplay ||
            profile.website ||
            ''
        },

        {
          key:
            'card',

          label:
            'Digital contact card',

          value:
            url
        }
      ]
    },


    barcodes: [
      {
        format:
          'PKBarcodeFormatQR',

        message:
          url,

        messageEncoding:
          'iso-8859-1',

        altText:
          'Scan contact card'
      }
    ]
  };


  /*
   * ------------------------------------------------------------
   * TEMPORARY WORKING DIRECTORY
   * ------------------------------------------------------------
   */

  const work =
    await mkdtemp(
      join(
        tmpdir(),
        'sbm-pkpass-'
      )
    );


  try {

    /*
     * ----------------------------------------------------------
     * SIGNING KEY
     * ----------------------------------------------------------
     */

    let signingKeyPath =
      privateKeyPath;


    if (
      privateKeyPassword
    ) {

      const key =
        createPrivateKey({

          key:
            await readFile(
              privateKeyPath
            ),

          passphrase:
            privateKeyPassword
        });


      signingKeyPath =
        join(
          work,
          'signing-key.pem'
        );


      await writeFile(

        signingKeyPath,

        key.export({
          type:
            'pkcs8',

          format:
            'pem'
        }),

        {
          mode:
            0o600
        }
      );
    }


    /*
     * ----------------------------------------------------------
     * WRITE PASS.JSON
     * ----------------------------------------------------------
     */

    await writeFile(

      join(
        work,
        'pass.json'
      ),

      JSON.stringify(
        pass,
        null,
        2
      )
    );


    /*
     * ----------------------------------------------------------
     * STANDARD APPLE WALLET ASSETS
     * ----------------------------------------------------------
     */

    const standardAssets = [
      'icon.png',
      'icon@2x.png',
      'logo.png',
      'logo@2x.png'
    ];


    for (
      const name
      of standardAssets
    ) {

      const source =
        join(
          walletAssets,
          name
        );


      console.log(
        'Adding Apple Wallet asset:',
        source
      );


      await writeFile(

        join(
          work,
          name
        ),

        await readFile(
          source
        )
      );
    }


    /*
     * ----------------------------------------------------------
     * PROFILE / CONTACT PHOTO
     * ----------------------------------------------------------
     */

    let contactImageAssets =
      [];


    try {

      contactImageAssets =
        await createAppleContactImages(
          profile,
          work
        );

    } catch (error) {

      /*
       * Profile photo is optional.
       *
       * Pass creation still continues if
       * the employee photo cannot be loaded.
       */

      console.error(
        'Unable to add Apple Wallet contact photo:',
        error
      );
    }


    /*
     * ----------------------------------------------------------
     * PASS FILES
     * ----------------------------------------------------------
     */

    const names = [

      'pass.json',

      ...standardAssets,

      ...contactImageAssets
    ];


    /*
     * ----------------------------------------------------------
     * MANIFEST
     * ----------------------------------------------------------
     */

    const manifest =
      {};


    for (
      const name
      of names
    ) {

      const content =
        await readFile(
          join(
            work,
            name
          )
        );


      manifest[name] =
        createHash(
          'sha1'
        )
          .update(
            content
          )
          .digest(
            'hex'
          );
    }


    await writeFile(

      join(
        work,
        'manifest.json'
      ),

      JSON.stringify(
        manifest,
        null,
        2
      )
    );


    /*
     * ----------------------------------------------------------
     * SIGN APPLE PASS
     * ----------------------------------------------------------
     */

    const args = [

      'cms',

      '-sign',

      '-binary',

      '-in',
      'manifest.json',

      '-signer',
      certificatePath,

      '-inkey',
      signingKeyPath,

      '-certfile',
      wwdrCertificatePath,

      '-outform',
      'DER',

      '-out',
      'signature',

      '-nosmimecap'
    ];


    await exec(
      'openssl',
      args,
      {
        cwd:
          work
      }
    );


    /*
     * ----------------------------------------------------------
     * CREATE .PKPASS
     * ----------------------------------------------------------
     */

    await exec(

      'zip',

      [

        '-q',

        '-X',

        'contact.pkpass',

        ...names,

        'manifest.json',

        'signature'
      ],

      {
        cwd:
          work
      }
    );


    /*
     * ----------------------------------------------------------
     * RETURN PASS BUFFER
     * ----------------------------------------------------------
     */

    return await readFile(

      join(
        work,
        'contact.pkpass'
      )
    );


  } finally {

    /*
     * ----------------------------------------------------------
     * CLEANUP
     * ----------------------------------------------------------
     */

    await rm(

      work,

      {
        recursive:
          true,

        force:
          true
      }
    );
  }
}
