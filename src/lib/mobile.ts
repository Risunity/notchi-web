import { fetchReleases, type Release } from './github';

const mobileOwner = process.env.MOBILE_GITHUB_OWNER ?? process.env.GITHUB_OWNER ?? 'Risunity';
const mobileRepo = process.env.MOBILE_GITHUB_REPO ?? 'notchi-mobile';

let mobileReleasesPromise: Promise<Release[]> | undefined;

export function getMobileReleases(): Promise<Release[]> {
  mobileReleasesPromise ??= fetchReleases({ owner: mobileOwner, repo: mobileRepo });
  return mobileReleasesPromise;
}

export { type Release };
