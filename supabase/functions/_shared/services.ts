import type { AuthenticatedUser } from "./types.ts";
import type { UserDataClient } from "./supabase-client.ts";
import { OutfitService } from "./outfit-service.ts";
import { ProfileService } from "./profile-service.ts";
import { WardrobeService } from "./wardrobe-service.ts";

export interface ApplicationServices {
  wardrobe: WardrobeService;
  profile: ProfileService;
  outfits: OutfitService;
}

export function createApplicationServices(
  client: UserDataClient,
  user: AuthenticatedUser,
): ApplicationServices {
  const wardrobe = new WardrobeService(client, user);
  return {
    wardrobe,
    profile: new ProfileService(client, user),
    outfits: new OutfitService(client, user, wardrobe),
  };
}
