export type LocationPin = {
  latitude: number;
  longitude: number;
  text: string;
  captured: boolean;
};

type LocationFields = {
  latitude: number;
  longitude: number;
  description?: string;
  address?: string;
  url?: string;
};

function mapsText(loc: LocationFields): string {
  if (loc.url?.trim()) return loc.url.trim();
  if (loc.address?.trim()) return loc.address.trim();
  if (loc.description?.trim()) return loc.description.trim();
  return `${loc.latitude}, ${loc.longitude}`;
}

export function locationFromPayload(loc: LocationFields | null | undefined): LocationPin | null {
  if (!loc) return null;
  const latitude = Number(loc.latitude);
  const longitude = Number(loc.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude, text: mapsText(loc), captured: true };
}

export function latestIncomingLocation(
  messages: Array<{
    type?: string;
    direction?: string;
    fromMe?: boolean;
    location?: LocationFields;
    metadata?: { location?: LocationFields };
  }>,
): LocationPin | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.type !== 'location') continue;
    const incoming = msg.fromMe === false || msg.direction === 'incoming';
    if (!incoming) continue;
    const pin = locationFromPayload(msg.location ?? msg.metadata?.location);
    if (pin) return pin;
  }
  return null;
}
