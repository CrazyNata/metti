import type { WardrobeItemDto } from "../types.ts";
import type { WardrobeService } from "../wardrobe-service.ts";

const MAX_WARDROBE_PAGES = 10;

export async function listAllActiveWardrobe(
  wardrobe: WardrobeService,
): Promise<WardrobeItemDto[]> {
  const result: WardrobeItemDto[] = [];
  for (let page = 1; page <= MAX_WARDROBE_PAGES; page += 1) {
    const current = await wardrobe.list({
      status: "active",
      page,
      limit: 100,
    });
    result.push(...current.items);
    if (!current.pagination.hasMore || !current.items.length) break;
  }
  return result;
}

export function daysSince(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (Date.now() - timestamp) / 86_400_000);
}
