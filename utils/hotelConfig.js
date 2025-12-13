import fs from 'fs';
import path from 'path';

let cache = null;
let cacheAt = 0;
const CACHE_MS = 5 * 60 * 1000;

export async function getHotelConfig() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return cache;

  const filePath = path.join(process.cwd(), 'config', 'hotelInfo.json');
  const raw = await fs.promises.readFile(filePath, 'utf-8');
  cache = JSON.parse(raw);
  cacheAt = now;
  return cache;
}

export function clearHotelConfigCache() {
  cache = null;
  cacheAt = 0;
}

// Helpers
export function getService(info, key) {
  return info?.services?.[key] || null;
}

export function getPolicy(info, key) {
  return info?.policies?.[key] || null;
}

export function getPayment(info) {
  return info?.payment || null;
}

export function getPromotions(info, now = new Date()) {
  const promos = info?.promotions || [];
  return promos.filter(p => {
    const from = p.validFrom ? new Date(p.validFrom) : null;
    const to = p.validTo ? new Date(p.validTo) : null;
    const afterFrom = from ? now >= from : true;
    const beforeTo = to ? now <= to : true;
    return afterFrom && beforeTo;
  });
}

export function getFallbackPrices(info) {
  return info?.roomsFallbackPrice || {};
}

