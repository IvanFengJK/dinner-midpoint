import { HttpError } from './http.js';

// Singapore's bounding box, with a little margin.
const SG = { latMin: 1.15, latMax: 1.5, lngMin: 103.55, lngMax: 104.1 };

export function cleanName(value, field, max) {
  if (typeof value !== 'string') throw new HttpError(400, 'Please enter a name.', field);
  const s = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!s) throw new HttpError(400, 'Please enter a name.', field);
  if ([...s].length > max) throw new HttpError(400, `Keep it to ${max} characters.`, field);
  if (/\p{C}/u.test(s)) throw new HttpError(400, 'That name has characters we can’t use.', field);
  return s;
}

export function cleanPlace(value, field) {
  const bad = (msg) => new HttpError(400, msg, field);
  if (!value || typeof value !== 'object') throw bad('Enter a postal code.');
  const { postal, lat, lng } = value;
  if (typeof postal !== 'string' || !/^\d{6}$/.test(postal))
    throw bad('Postal codes have 6 digits.');
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat + lng)) {
    throw bad('That location looks wrong.');
  }
  if (lat < SG.latMin || lat > SG.latMax || lng < SG.lngMin || lng > SG.lngMax) {
    throw bad('That location is outside Singapore.');
  }
  return { postal, lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
}

export function cleanMember(body) {
  return {
    name: cleanName(body.name, 'name', 30),
    work: cleanPlace(body.work, 'work'),
    home: cleanPlace(body.home, 'home'),
  };
}

export function cleanGroupCreate(body) {
  return { groupName: cleanName(body.groupName, 'groupName', 40), member: cleanMember(body) };
}
