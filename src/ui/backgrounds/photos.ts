/**
 * Photo backgrounds, from Wikimedia Commons. They are not bundled: each PC downloads them once from
 * GitHub Pages, which publishes the files attached to the PHOTO_SET release (DEVELOPMENT.md), and
 * keeps them only if they match `sha256`. Each is the Commons 1920 px rendition re-encoded as WebP;
 * CC BY-SA ones stay under BY-SA. THIRD-PARTY-NOTICES credits every one, and the Theme menu the
 * chosen one.
 */
export const PHOTO_SET = "backgrounds-1";
export const PHOTO_BASE = `https://benddailey.github.io/offline-checkout/${PHOTO_SET}/`;

export interface Photo {
  id: string;
  /** Of the WebP file, lowercase hex. */
  sha256: string;
  label: string;
  /** What and where, for the notices. */
  title: string;
  author: string;
  license: string;
  licenseUrl?: string;
  source: string;
}

export const PHOTOS: readonly Photo[] = [
  {
    id: "loc",
    sha256: "1baddab8a31488aaac6b7a284d25df6a16caf015206384857e26b1b6e9005638",
    label: "Library of Congress",
    title: "Main Reading Room, Library of Congress, Washington, D.C.",
    author:
      "Carol M. Highsmith, Library of Congress, Prints & Photographs Division (Carol M. Highsmith Archive)",
    license: "Public domain",
    source: "https://commons.wikimedia.org/wiki/File:LOC_Main_Reading_Room_Highsmith.jpg",
  },
  {
    id: "peabody",
    sha256: "61e30c2d372437de655b1445d779285ecdc2b381ba095bdd476e0ca41ffa696f",
    label: "George Peabody Library",
    title: "George Peabody Library, Baltimore, Maryland (LCCN2013646464)",
    author:
      "Carol M. Highsmith, Library of Congress, Prints & Photographs Division (Carol M. Highsmith Archive)",
    license: "Public domain",
    source:
      "https://commons.wikimedia.org/wiki/File:George_Peabody_Library,_formerly_the_Library_of_the_Peabody_Institute_of_the_City_of_Baltimore,_is_part_of_the_Johns_Hopkins_Sheridan_Libraries._Baltimore,_Maryland_LCCN2013646464.tif",
  },
  {
    id: "longroom",
    sha256: "ef86fd257e17bacd2153d0936d0a8c585978ed9ae73b65834a683d5749621103",
    label: "Long Room, Dublin",
    title: "Long Room, Old Library, Trinity College Dublin",
    author: "Diliff",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source:
      "https://commons.wikimedia.org/wiki/File:Long_Room_Interior,_Trinity_College_Dublin,_Ireland_-_Diliff.jpg",
  },
  {
    id: "admont",
    sha256: "f6a1773e32dce8fc5228379ab754371573a418880d5ecb505326889857b57a35",
    label: "Admont Abbey",
    title: "Admont Abbey Library, Austria",
    author: "Jorge Royan",
    license: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    source: "https://commons.wikimedia.org/wiki/File:Austria_-_Admont_Abbey_Library_-_1326.jpg",
  },
  {
    id: "admont-books",
    sha256: "de891997c50d122781e7b7a56defd3cc9a2510701e1ad4c0a418b74c9f4ddd2b",
    label: "Admont shelves",
    title: "Books in Admont Abbey Library, Austria",
    author: "Marco Almbauer",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Admont_Abbey_Library_books.jpg",
  },
  {
    id: "strahov",
    sha256: "5d36db3cc1dd2425c02ddf75634e761dfd7c9abbdf4437d01afba9c5371fd42f",
    label: "Strahov, Prague",
    title: "Theological Hall, Strahov Library, Prague",
    author: "Jorge Royan",
    license: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    source: "https://commons.wikimedia.org/wiki/File:Strahov_Theological_Hall,_Prague_-_7585.jpg",
  },
  {
    id: "ottawa",
    sha256: "7ca7baeca77887c675dde13d5f2753752c803e5033b158e55dcd34154a4d0bfe",
    label: "Parliament, Ottawa",
    title: "Library of Parliament, Ottawa",
    author: "Tony Webster",
    license: "CC BY 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
    source:
      "https://commons.wikimedia.org/wiki/File:Library_of_Parliament,_Ottawa_(14579996318).jpg",
  },
  {
    id: "nypl",
    sha256: "25df5e9ed2ea600b759f7ffc85dec69e56e46333e2abb789a6dc97a671468a81",
    label: "NYPL Rose Room",
    title: "Rose Main Reading Room, New York Public Library",
    author: "Nan Palmero",
    license: "CC BY 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
    source:
      "https://commons.wikimedia.org/wiki/File:New_York_Public_Library_Rose_Reading_Room_(40430028925).jpg",
  },
  {
    id: "nypl-pano",
    sha256: "1e6d800f3ce6d1c00ff1fa9b5bc2773e522187111a9c2d21ee755d3a2ededad1",
    label: "NYPL panorama",
    title: "Research room, New York Public Library",
    author: "Diliff",
    license: "CC BY 2.5",
    licenseUrl: "https://creativecommons.org/licenses/by/2.5/",
    source: "https://commons.wikimedia.org/wiki/File:NYC_Public_Library_Research_Room_Jan_2006.jpg",
  },
  {
    id: "stockholm",
    sha256: "2a0ae5c63ee3a46f977985b951d9e1f68a7b9519a83e2e0869b352af4861da65",
    label: "Stockholm rotunda",
    title: "Rotunda, Stockholm Public Library",
    author: "Bermax",
    license: "Public domain",
    source: "https://commons.wikimedia.org/wiki/File:Stockholms_stadsbibliotek_rotundan.jpg",
  },
  {
    id: "indy",
    sha256: "2a66757f4c9905e44ba72e8d0c0d1c92e81e594707cf8c7314f8bdcb99364681",
    label: "Indianapolis Central",
    title: "Atrium, Indianapolis Public Library Central Library",
    author: "Serge Melki",
    license: "CC BY 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
    source: "https://commons.wikimedia.org/wiki/File:Indianapolis_Central_Library_(3440328630).jpg",
  },
  {
    id: "binhai",
    sha256: "7531c9b0f4daf119fbffdf8ef0cb1277f93f94b5638c01c4fe42400faf483dcc",
    label: "Tianjin Binhai",
    title: "Tianjin Binhai Library, China",
    author: "H2v5o68z",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    source: "https://commons.wikimedia.org/wiki/File:Tianjin_Binhai_Library_1.jpg",
  },
];

/** One line for the Theme menu. */
export function credit(p: Photo): string {
  const by = p.author.split(",")[0];
  return `${p.title.replace(/\.$/, "")}. Photo: ${by}, ${p.license}.`;
}
