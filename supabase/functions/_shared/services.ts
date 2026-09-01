import type { AuthenticatedUser } from "./types.ts";
import type { UserDataClient } from "./supabase-client.ts";
import { ImageService, type ImageServiceOptions } from "./image-service.ts";
import { OutfitService } from "./outfit-service.ts";
import { ProfileService } from "./profile-service.ts";
import { WardrobeService } from "./wardrobe-service.ts";

export interface ApplicationServices {
  wardrobe: WardrobeService;
  images: ImageService;
  profile: ProfileService;
  outfits: OutfitService;
}

export interface ApplicationServiceOptions {
  image?: ImageServiceOptions;
}

export function createApplicationServices(
  client: UserDataClient,
  user: AuthenticatedUser,
  options: ApplicationServiceOptions = {},
): ApplicationServices {
  const images = new ImageService(client, user, options.image);
  const wardrobe = new WardrobeService(client, user, images);
  return {
    wardrobe,
    images,
    profile: new ProfileService(client, user),
    outfits: new OutfitService(client, user, wardrobe),
  };
}
